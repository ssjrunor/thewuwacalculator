/*
  Author: Runor Ewhro
  Description: Worker that compiles optimizer payloads off the main thread,
               upgrades packed arrays to shared buffers when possible, and
               can also materialize compact result refs back into UID-based
               result entries.
*/

/// <reference lib="webworker" />

import { hydrGameData, initGameData } from '@/data/gameData'
import { initEchoCat } from '@/data/gameData/catalog/echoes'
import { initEchoStts } from '@/data/gameData/catalog/echoStats'
import { initResCat, initResDtls } from '@/data/gameData/resonators/resonatorDataStore'
import { initWpnData } from '@/data/gameData/weapons/weaponDataStore'
import { initEchoSetD } from '@/data/gameData/echoSets/effects'
import type {
  OptStartPay,
  PrepOptPay,
  PrepRotRun,
  PrepTheoryRot,
  PrepTheoryTarget,
  PrepTargetSkill,
} from '@/engine/optimizer/types.ts'
import type {
  OptCompDoneM,
  OptCompRrrMs,
  OptCompInMsg,
  OptMatDoneMs,
} from '@/engine/optimizer/compiler/compileWorker.types.ts'
import { errorOpt, logOptimizer } from '@/engine/optimizer/config/log.ts'

let optCompMdlsP: Promise<{
  cmplOptPay: typeof import('@/engine/optimizer/compiler').compOptPay
  matOptResults: typeof import('@/engine/optimizer/results/materialize.ts').matOptRsltsF
}> | null = null

// the compile worker is now reused across runs, so game data only needs to be
// hydrated once. game data is static for the lifetime of the page, so caching
// this flag is safe and skips the repeated snapshot hydration cost on every
// subsequent run.
let gameDataReady = false

async function loadOptCompM() {
  if (!optCompMdlsP) {
    optCompMdlsP = Promise.all([
      import('@/engine/optimizer/compiler'),
      import('@/engine/optimizer/results/materialize.ts'),
    ]).then(([compiler, materialize]) => ({
      cmplOptPay: compiler.compOptPay,
      matOptResults: materialize.matOptRsltsF,
    }))
  }

  return optCompMdlsP
}

function hydrOptSttcD(
    snapshot: NonNullable<OptStartPay['staticData']>,
): void {
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

// typed-array families we may clone into SharedArrayBuffer-backed views
type ShrdTypdRry =
    | Float32Array
    | Int32Array
    | Uint32Array
    | Uint16Array
    | Uint8Array

// feature check: shared buffers are only available in supported environments
function canShrTypdRr(): boolean {
  return typeof SharedArrayBuffer !== 'undefined'
}

// copy a typed array into a SharedArrayBuffer-backed view of the same type
function shrTypdRry<T extends ShrdTypdRry>(view: T): T {
  if (!canShrTypdRr()) {
    return view
  }

  const sharedBuffer = new SharedArrayBuffer(view.byteLength)
  const Ctor = view.constructor as {
    new (buffer: SharedArrayBuffer, byteOffset?: number, length?: number): T
  }

  const shared = new Ctor(sharedBuffer, 0, view.length)
  shared.set(view)
  return shared
}

// convert every transferable numeric buffer in a target-skill payload
// into shared memory so downstream workers/threads can read it without copies
function shrPrepTgtSk<T extends PrepTargetSkill | PrepTheoryTarget>(payload: T): T {
  if (!canShrTypdRr()) {
    return payload
  }

  return {
    ...payload,
    constraints: shrTypdRry(payload.constraints),
    costs: shrTypdRry(payload.costs),
    sets: shrTypdRry(payload.sets),
    kinds: shrTypdRry(payload.kinds),
    comboIndexMap: shrTypdRry(payload.comboIndexMap),
    comboBinom: shrTypdRry(payload.comboBinom),
    stats: shrTypdRry(payload.stats),
    setConstLut: shrTypdRry(payload.setConstLut),
    mainEchoBuffs: shrTypdRry(payload.mainEchoBuffs),
    lockMainCands: shrTypdRry(payload.lockMainCands),
  }
}

// same shared-memory upgrade path, but for rotation payloads
function shrPrepRotRu<T extends PrepRotRun | PrepTheoryRot>(payload: T): T {
  if (!canShrTypdRr()) {
    return payload
  }

  return {
    ...payload,
    constraints: shrTypdRry(payload.constraints),
    costs: shrTypdRry(payload.costs),
    sets: shrTypdRry(payload.sets),
    kinds: shrTypdRry(payload.kinds),
    comboIndexMap: shrTypdRry(payload.comboIndexMap),
    comboBinom: shrTypdRry(payload.comboBinom),
    lockMainCands: shrTypdRry(payload.lockMainCands),
    contexts: shrTypdRry(payload.contexts),
    contextWeight: shrTypdRry(payload.contextWeight),
    displayContext: shrTypdRry(payload.displayContext),
    stats: shrTypdRry(payload.stats),
    setConstLut: shrTypdRry(payload.setConstLut),
    mainEchoBuffs: shrTypdRry(payload.mainEchoBuffs),
  }
}

// gather transferable buffers for a target-skill payload.
// SharedArrayBuffer-backed views are skipped because they are shared, not transferred.
function cllcTgtSkllT(
    payload: PrepTargetSkill | PrepTheoryTarget,
): Transferable[] {
  const maybePush = (items: Transferable[], buffer: ArrayBufferLike) => {
    if (typeof SharedArrayBuffer !== 'undefined' && buffer instanceof SharedArrayBuffer) {
      return
    }

    items.push(buffer)
  }

  const out: Transferable[] = []
  maybePush(out, payload.constraints.buffer)
  maybePush(out, payload.costs.buffer)
  maybePush(out, payload.sets.buffer)
  maybePush(out, payload.kinds.buffer)
  maybePush(out, payload.comboIndexMap.buffer)
  maybePush(out, payload.comboBinom.buffer)
  maybePush(out, payload.stats.buffer)
  maybePush(out, payload.setConstLut.buffer)
  maybePush(out, payload.mainEchoBuffs.buffer)
  maybePush(out, payload.lockMainCands.buffer)
  return out
}

// gather transferable buffers for a rotation payload
function cllcRotTrns(
    payload: PrepRotRun | PrepTheoryRot,
): Transferable[] {
  const maybePush = (items: Transferable[], buffer: ArrayBufferLike) => {
    if (typeof SharedArrayBuffer !== 'undefined' && buffer instanceof SharedArrayBuffer) {
      return
    }

    items.push(buffer)
  }

  const out: Transferable[] = []
  maybePush(out, payload.constraints.buffer)
  maybePush(out, payload.costs.buffer)
  maybePush(out, payload.sets.buffer)
  maybePush(out, payload.kinds.buffer)
  maybePush(out, payload.comboIndexMap.buffer)
  maybePush(out, payload.comboBinom.buffer)
  maybePush(out, payload.lockMainCands.buffer)
  maybePush(out, payload.contexts.buffer)
  maybePush(out, payload.contextWeight.buffer)
  maybePush(out, payload.displayContext.buffer)
  maybePush(out, payload.stats.buffer)
  maybePush(out, payload.setConstLut.buffer)
  maybePush(out, payload.mainEchoBuffs.buffer)
  return out
}

// route to the correct transferable collector based on payload mode
function cllcTrns(
    payload: PrepOptPay,
): Transferable[] {
  if (payload.mode === 'rotation') {
    return cllcRotTrns(payload)
  }

  if (payload.mode === 'targetSkill') {
    return cllcTgtSkllT(payload)
  }

  if (payload.mode === 'theoryTarget') {
    return cllcTgtSkllT(payload)
  }

  if (payload.mode === 'theoryRotation') {
    return cllcRotTrns(payload)
  }

  return []
}

// route to the correct shared-memory conversion path based on payload mode
function shrPrepPay(
    payload: PrepOptPay,
): PrepOptPay {
  if (payload.mode === 'rotation') {
    return shrPrepRotRu(payload)
  }

  if (payload.mode === 'targetSkill') {
    return shrPrepTgtSk(payload)
  }

  if (payload.mode === 'theoryTarget') {
    return shrPrepTgtSk(payload)
  }

  if (payload.mode === 'theoryRotation') {
    return shrPrepRotRu(payload)
  }

  return payload
}

// main worker entrypoint:
// - "start" compiles a raw optimizer payload and returns the packed result
// - otherwise it materializes compact result refs back into user-facing results
self.onmessage = async (event: MessageEvent<OptCompInMsg>) => {
  const message = event.data
  const scope = self as DedicatedWorkerGlobalScope

  logOptimizer('[optimizer:compile-worker] message received', {
    type: message.type,
    runId: message.runId,
    sharedArrayBufferAvailable: typeof SharedArrayBuffer !== 'undefined',
  })

  try {
    if (message.type === 'start') {
      if (!gameDataReady) {
        if (message.payload.staticData) {
          logOptimizer('[optimizer:compile-worker] hydrating game data from static snapshot', {
            runId: message.runId,
          })
          hydrOptSttcD(message.payload.staticData)
          logOptimizer('[optimizer:compile-worker] static data hydrated', { runId: message.runId })
        } else {
          logOptimizer('[optimizer:compile-worker] fetching game data via initializeGameData()', {
            runId: message.runId,
          })
          await initGameData()
          logOptimizer('[optimizer:compile-worker] game data ready', { runId: message.runId })
        }
        gameDataReady = true
      }

      logOptimizer('[optimizer:compile-worker] loading compiler modules', { runId: message.runId })
      const { cmplOptPay: cmplPtmzPyld } = await loadOptCompM()
      logOptimizer('[optimizer:compile-worker] compiler modules loaded', { runId: message.runId })

      logOptimizer('[optimizer:compile-worker] compiling payload', {
        runId: message.runId,
        rotationMode: message.payload.settings.rotationMode,
        inventorySize: message.payload.invChs.length,
      })

      const t0 = performance.now()
      const compiled = cmplPtmzPyld(message.payload)

      logOptimizer('[optimizer:compile-worker] payload compiled, upgrading buffers', {
        runId: message.runId,
        mode: compiled.mode,
        totalCombos: compiled.totalCombos,
        contextCount: 'contextCount' in compiled ? compiled.contextCount : undefined,
        elapsedMs: Math.round(performance.now() - t0),
        willShareBuffers: typeof SharedArrayBuffer !== 'undefined',
      })

      // compile the raw payload, then upgrade eligible buffers to shared memory
      const payload = shrPrepPay(compiled)

      const trns = cllcTrns(payload)
      logOptimizer('[optimizer:compile-worker] posting compiled payload', {
        runId: message.runId,
        transferableCount: trns.length,
      })

      const response: OptCompDoneM = {
        type: 'done',
        runId: message.runId,
        payload,
      }

      // transfer regular ArrayBuffers to avoid copying large payloads
      scope.postMessage(response, trns)
      return
    }

    // materialize result refs back into UID-based result entries
    logOptimizer('[optimizer:compile-worker] materializing results', {
      runId: message.runId,
      resultCount: message.results.length,
      limit: message.limit,
    })

    const t0 = performance.now()
    const { matOptResults: mtrlPtmzRslt } = await loadOptCompM()
    const results = mtrlPtmzRslt(
        message.uidByIndex,
        message.results,
        {
          payload: message.payload,
          limit: message.limit,
        },
    )

    logOptimizer('[optimizer:compile-worker] materialization complete', {
      runId: message.runId,
      finalizedCount: results.length,
      elapsedMs: Math.round(performance.now() - t0),
    })

    const response: OptMatDoneMs = {
      type: 'materialized',
      runId: message.runId,
      results,
    }

    scope.postMessage(response)
  } catch (error) {
    errorOpt('[optimizer:compile-worker] error', {
      runId: message.runId,
      type: message.type,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    })

    const response: OptCompRrrMs = {
      type: 'error',
      runId: message.runId,
      message: error instanceof Error ? error.message : 'Failed to compile optimizer payload',
    }

    scope.postMessage(response)
  }
}
