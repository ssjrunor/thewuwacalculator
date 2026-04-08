/*
  Author: Runor Ewhro
  Description: Worker that compiles optimizer payloads off the main thread,
               upgrades packed arrays to shared buffers when possible, and
               can also materialize compact result refs back into UID-based
               result entries.
*/

/// <reference lib="webworker" />

import { hydrateGameDataRegistry, initializeGameData } from '@/data/gameData'
import { initEchoCatalog } from '@/data/gameData/catalog/echoes'
import { initResonatorCatalog, initResonatorDetails } from '@/data/gameData/resonators/resonatorDataStore'
import { initWeaponData } from '@/data/gameData/weapons/weaponDataStore'
import { initEchoSetDefinitions } from '@/data/gameData/echoSets/effects'
import type {
  OptimizerStartPayload,
  PreparedOptimizerPayload,
  PreparedRotationRun,
  PreparedTargetSkillRun,
} from '@/engine/optimizer/types.ts'
import type {
  OptimizerCompileDoneMessage,
  OptimizerCompileErrorMessage,
  OptimizerCompileInMessage,
  OptimizerMaterializeDoneMessage,
} from '@/engine/optimizer/compiler/compileWorker.types.ts'
import { errorOptimizer, logOptimizer } from '@/engine/optimizer/config/log.ts'

let optimizerCompileModulesPromise: Promise<{
  compileOptimizerPayload: typeof import('@/engine/optimizer/compiler').compileOptimizerPayload
  materializeOptimizerResultsFromUids: typeof import('@/engine/optimizer/results/materialize.ts').materializeOptimizerResultsFromUids
}> | null = null

async function loadOptimizerCompileModules() {
  if (!optimizerCompileModulesPromise) {
    optimizerCompileModulesPromise = Promise.all([
      import('@/engine/optimizer/compiler'),
      import('@/engine/optimizer/results/materialize.ts'),
    ]).then(([compiler, materialize]) => ({
      compileOptimizerPayload: compiler.compileOptimizerPayload,
      materializeOptimizerResultsFromUids: materialize.materializeOptimizerResultsFromUids,
    }))
  }

  return optimizerCompileModulesPromise
}

function hydrateOptimizerStaticData(
    snapshot: NonNullable<OptimizerStartPayload['staticData']>,
): void {
  hydrateGameDataRegistry(snapshot.gameDataRegistry)
  initResonatorCatalog(Object.values(snapshot.resonatorCatalogById))
  initResonatorDetails(snapshot.resonatorDetailsById)
  initWeaponData(Object.values(snapshot.weaponsById))
  initEchoCatalog(Object.values(snapshot.echoCatalogById))
  initEchoSetDefinitions(snapshot.echoSetDefs)
}

// typed-array families we may clone into SharedArrayBuffer-backed views
type SharedableTypedArray =
    | Float32Array
    | Int32Array
    | Uint32Array
    | Uint16Array
    | Uint8Array

// feature check: shared buffers are only available in supported environments
function canShareTypedArrays(): boolean {
  return typeof SharedArrayBuffer !== 'undefined'
}

// copy a typed array into a SharedArrayBuffer-backed view of the same type
function shareTypedArray<T extends SharedableTypedArray>(view: T): T {
  if (!canShareTypedArrays()) {
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
function sharePreparedTargetSkillRun(payload: PreparedTargetSkillRun): PreparedTargetSkillRun {
  if (!canShareTypedArrays()) {
    return payload
  }

  return {
    ...payload,
    constraints: shareTypedArray(payload.constraints),
    costs: shareTypedArray(payload.costs),
    sets: shareTypedArray(payload.sets),
    kinds: shareTypedArray(payload.kinds),
    comboIndexMap: shareTypedArray(payload.comboIndexMap),
    comboBinom: shareTypedArray(payload.comboBinom),
    stats: shareTypedArray(payload.stats),
    setConstLut: shareTypedArray(payload.setConstLut),
    mainEchoBuffs: shareTypedArray(payload.mainEchoBuffs),
    lockedMainCandidateIndices: shareTypedArray(payload.lockedMainCandidateIndices),
  }
}

// same shared-memory upgrade path, but for rotation payloads
function sharePreparedRotationRun(payload: PreparedRotationRun): PreparedRotationRun {
  if (!canShareTypedArrays()) {
    return payload
  }

  return {
    ...payload,
    constraints: shareTypedArray(payload.constraints),
    costs: shareTypedArray(payload.costs),
    sets: shareTypedArray(payload.sets),
    kinds: shareTypedArray(payload.kinds),
    comboIndexMap: shareTypedArray(payload.comboIndexMap),
    comboBinom: shareTypedArray(payload.comboBinom),
    lockedMainCandidateIndices: shareTypedArray(payload.lockedMainCandidateIndices),
    contexts: shareTypedArray(payload.contexts),
    contextWeights: shareTypedArray(payload.contextWeights),
    displayContext: shareTypedArray(payload.displayContext),
    stats: shareTypedArray(payload.stats),
    setConstLut: shareTypedArray(payload.setConstLut),
    mainEchoBuffs: shareTypedArray(payload.mainEchoBuffs),
  }
}

// gather transferable buffers for a target-skill payload.
// SharedArrayBuffer-backed views are skipped because they are shared, not transferred.
function collectTargetSkillTransferables(
    payload: PreparedTargetSkillRun,
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
  maybePush(out, payload.lockedMainCandidateIndices.buffer)
  return out
}

// gather transferable buffers for a rotation payload
function collectRotationTransferables(
    payload: PreparedRotationRun,
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
  maybePush(out, payload.lockedMainCandidateIndices.buffer)
  maybePush(out, payload.contexts.buffer)
  maybePush(out, payload.contextWeights.buffer)
  maybePush(out, payload.displayContext.buffer)
  maybePush(out, payload.stats.buffer)
  maybePush(out, payload.setConstLut.buffer)
  maybePush(out, payload.mainEchoBuffs.buffer)
  return out
}

// route to the correct transferable collector based on payload mode
function collectTransferables(
    payload: PreparedOptimizerPayload,
): Transferable[] {
  return payload.mode === 'rotation'
      ? collectRotationTransferables(payload)
      : collectTargetSkillTransferables(payload)
}

// route to the correct shared-memory conversion path based on payload mode
function sharePreparedPayload(
    payload: PreparedOptimizerPayload,
): PreparedOptimizerPayload {
  return payload.mode === 'rotation'
      ? sharePreparedRotationRun(payload)
      : sharePreparedTargetSkillRun(payload)
}

// main worker entrypoint:
// - "start" compiles a raw optimizer payload and returns the packed result
// - otherwise it materializes compact result refs back into user-facing results
self.onmessage = async (event: MessageEvent<OptimizerCompileInMessage>) => {
  const message = event.data
  const scope = self as DedicatedWorkerGlobalScope

  logOptimizer('[optimizer:compile-worker] message received', {
    type: message.type,
    runId: message.runId,
    sharedArrayBufferAvailable: typeof SharedArrayBuffer !== 'undefined',
  })

  try {
    if (message.type === 'start') {
      if (message.payload.staticData) {
        logOptimizer('[optimizer:compile-worker] hydrating game data from static snapshot', {
          runId: message.runId,
        })
        hydrateOptimizerStaticData(message.payload.staticData)
        logOptimizer('[optimizer:compile-worker] static data hydrated', { runId: message.runId })
      } else {
        logOptimizer('[optimizer:compile-worker] fetching game data via initializeGameData()', {
          runId: message.runId,
        })
        await initializeGameData()
        logOptimizer('[optimizer:compile-worker] game data ready', { runId: message.runId })
      }

      logOptimizer('[optimizer:compile-worker] loading compiler modules', { runId: message.runId })
      const { compileOptimizerPayload } = await loadOptimizerCompileModules()
      logOptimizer('[optimizer:compile-worker] compiler modules loaded', { runId: message.runId })

      logOptimizer('[optimizer:compile-worker] compiling payload', {
        runId: message.runId,
        rotationMode: message.payload.settings.rotationMode,
        inventorySize: message.payload.inventoryEchoes.length,
      })

      const t0 = performance.now()
      const compiled = compileOptimizerPayload(message.payload)

      logOptimizer('[optimizer:compile-worker] payload compiled, upgrading buffers', {
        runId: message.runId,
        mode: compiled.mode,
        comboTotalCombos: compiled.comboTotalCombos,
        contextCount: 'contextCount' in compiled ? compiled.contextCount : undefined,
        elapsedMs: Math.round(performance.now() - t0),
        willShareBuffers: typeof SharedArrayBuffer !== 'undefined',
      })

      // compile the raw payload, then upgrade eligible buffers to shared memory
      const payload = sharePreparedPayload(compiled)

      const transferables = collectTransferables(payload)
      logOptimizer('[optimizer:compile-worker] posting compiled payload', {
        runId: message.runId,
        transferableCount: transferables.length,
      })

      const response: OptimizerCompileDoneMessage = {
        type: 'done',
        runId: message.runId,
        payload,
      }

      // transfer regular ArrayBuffers to avoid copying large payloads
      scope.postMessage(response, transferables)
      return
    }

    // materialize result refs back into UID-based result entries
    logOptimizer('[optimizer:compile-worker] materializing results', {
      runId: message.runId,
      resultCount: message.results.length,
      limit: message.limit,
    })

    const t0 = performance.now()
    const { materializeOptimizerResultsFromUids } = await loadOptimizerCompileModules()
    const results = materializeOptimizerResultsFromUids(
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

    const response: OptimizerMaterializeDoneMessage = {
      type: 'materialized',
      runId: message.runId,
      results,
    }

    scope.postMessage(response)
  } catch (error) {
    errorOptimizer('[optimizer:compile-worker] error', {
      runId: message.runId,
      type: message.type,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    })

    const response: OptimizerCompileErrorMessage = {
      type: 'error',
      runId: message.runId,
      message: error instanceof Error ? error.message : 'Failed to compile optimizer payload',
    }

    scope.postMessage(response)
  }
}
