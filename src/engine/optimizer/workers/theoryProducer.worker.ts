/*
  Author: Runor Ewhro
  Description: Streams theory-mode combo batches from the synthetic row space
               on a dedicated worker so the orchestrating thread never blocks
               on combo generation between worker dispatches.
*/

/// <reference lib="webworker" />

import { gnrtThryCpuCm } from '@/engine/optimizer/target/theoryBatches.ts'
import { hydrGameData, initGameData } from '@/data/gameData'
import { initEchoCat } from '@/data/gameData/catalog/echoes'
import { initEchoStts } from '@/data/gameData/catalog/echoStats'
import { initResCat, initResDtls } from '@/data/gameData/resonators/resonatorDataStore'
import { initWpnData } from '@/data/gameData/weapons/weaponDataStore'
import { initEchoSetD } from '@/data/gameData/echoSets/effects'
import type { OptStartPay } from '@/engine/optimizer/types.ts'
import type {
  OptThryProdIn,
  OptThryProdBt,
  OptThryProdDn,
  OptThryProdRr,
} from '@/engine/optimizer/workers/messages.ts'
import { errorOpt, logOptimizer } from '@/engine/optimizer/config/log.ts'

const scope = self as DedicatedWorkerGlobalScope

let activeRunId: number | null = null
let cancelled = false
let gameDataReady = false

// returned batch buffers waiting to be reused by the next emit.
const freeBuffers: Int32Array[] = []

function hydrFromSnpsh(snapshot: NonNullable<OptStartPay['staticData']>): void {
  hydrGameData(snapshot.gameDataReg)
  initResCat(Object.values(snapshot.resCatById))
  initResDtls(snapshot.resDtlsById)
  initWpnData(Object.values(snapshot.weaponsById))
  initEchoCat(Object.values(snapshot.echoCatById))
  initEchoSetD(snapshot.echoSetDefs)
  if (snapshot.echoStats) {
    initEchoStts(snapshot.echoStats)
  }
}

function postError(runId: number, error: unknown): void {
  const message: OptThryProdRr = {
    type: 'theoryProducerError',
    runId,
    message: error instanceof Error ? error.message : 'Theory producer worker failed unexpectedly',
  }
  scope.postMessage(message)
}

// yield to the message loop so cancellation messages and buffer returns can land.
function yieldToLoop(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
}

async function runProducer(
    runId: number,
    payload: import('@/engine/optimizer/types.ts').PrepTheoryTarget | import('@/engine/optimizer/types.ts').PrepTheoryRot,
    batchSize: number,
): Promise<void> {
  const t0 = performance.now()
  let generated = 0
  let batchesEmitted = 0

  const iterator = gnrtThryCpuCm({
    payload,
    batchSize,
    borrowBuffer: (length) => {
      while (freeBuffers.length > 0) {
        const buffer = freeBuffers.pop()!
        if (buffer.length === length) {
          return buffer
        }
      }
      return new Int32Array(length)
    },
  })

  while (true) {
    if (activeRunId !== runId || cancelled) {
      break
    }

    const next = iterator.next()
    if (next.done) {
      break
    }

    const batch = next.value
    generated += batch.comboCount
    batchesEmitted += 1

    const message: OptThryProdBt = {
      type: 'theoryBatch',
      runId,
      combos: batch.combos,
      comboCount: batch.comboCount,
      lockMainIdx: batch.lockMainIdx,
    }
    scope.postMessage(message, [batch.combos.buffer])

    // give the worker event loop a turn so cancel / returnTheoryBuffer messages
    // can be processed without waiting for the next batch.
    await yieldToLoop()
  }

  if (activeRunId !== runId) {
    return
  }

  const done: OptThryProdDn = {
    type: 'theoryProducerDone',
    runId,
    generated,
  }

  logOptimizer('[optimizer:theory-producer] run done', {
    runId,
    generated,
    batchesEmitted,
    elapsedMs: Math.round(performance.now() - t0),
  })

  scope.postMessage(done)
}

async function startRun(
    runId: number,
    payload: import('@/engine/optimizer/types.ts').PrepTheoryTarget | import('@/engine/optimizer/types.ts').PrepTheoryRot,
    batchSize: number,
): Promise<void> {
  if (!gameDataReady) {
    if (payload.staticData) {
      hydrFromSnpsh(payload.staticData)
    } else {
      await initGameData()
    }
    gameDataReady = true
  }

  await runProducer(runId, payload, batchSize)
}

scope.onmessage = (event: MessageEvent<OptThryProdIn>) => {
  const message = event.data

  if (message.type === 'returnTheoryBuffer') {
    if (activeRunId === message.runId) {
      // in low-memory mode we only need one buffer parked in the pool at a
      // time (max-in-flight is also 1), so drop any returned buffer past
      // that. otherwise allow one extra cushion so the producer can yield
      // without immediately starving on its next batch allocation.
      const cap = message.lowMem ? 1 : 2
      if (freeBuffers.length < cap) {
        freeBuffers.push(message.buffer)
      }
    }
    return
  }

  if (message.type === 'cancelTheoryProducer') {
    if (activeRunId === message.runId) {
      cancelled = true
    }
    return
  }

  // start
  activeRunId = message.runId
  cancelled = false
  freeBuffers.length = 0

  logOptimizer('[optimizer:theory-producer] run start', {
    runId: message.runId,
    mode: message.payload.mode,
    theoryTotal: message.payload.theoryTotal,
    batchSize: message.batchSize,
    gameDataReady,
  })

  void startRun(message.runId, message.payload, message.batchSize).catch((error) => {
    errorOpt('[optimizer:theory-producer] error', {
      runId: message.runId,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    })
    postError(message.runId, error)
  })
}
