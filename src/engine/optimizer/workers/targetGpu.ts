/*
  Author: Runor Ewhro
  Description: builds static gpu payloads for target-skill optimizer runs and
               partitions target search space into per-job combo windows,
               including support for locked-main search variants.
*/

import type {
  OptimizerTargetGpuStaticPayload,
} from '@/engine/optimizer/workers/messages.ts'
import type { PreparedOptimizerSharedPayload, PreparedTargetSkillRun } from '@/engine/optimizer/types.ts'
import { createPackedTargetSkillExecution } from '@/engine/optimizer/payloads/targetPayload.ts'

export interface TargetJobSpec {
  // starting combo rank for this job window
  comboStart: number

  // number of combos to evaluate from comboStart
  comboCount: number

  // locked main echo index for this job, or -1 when main is unrestricted
  lockedMainIndex: number
}

// create a stable content hash for typed-array payload parts so static gpu state
// can be identified/reused by content rather than by object identity
function hashTypedArray(view: ArrayBufferView): string {
  const bytes = new Uint8Array(
      view.buffer,
      view.byteOffset,
      view.byteLength,
  )

  // fnv-1a style rolling hash seeded with byte length
  let hash = (2166136261 ^ view.byteLength) >>> 0

  for (let index = 0; index < bytes.length; index += 1) {
    hash ^= bytes[index] ?? 0
    hash = Math.imul(hash, 16777619) >>> 0
  }

  return `${view.byteLength.toString(16)}:${hash.toString(16)}`
}

// shaders read certain small encoded buffers as float arrays,
// so promote u8 storage to f32 here once during static payload construction
function toGpuFloatArray(values: Uint8Array): Float32Array {
  const out = new Float32Array(values.length)

  for (let index = 0; index < values.length; index += 1) {
    out[index] = values[index] ?? 0
  }

  return out
}

// shaders read kind ids as signed integers, so widen u16 ids into i32
function toGpuIntArray(values: Uint16Array): Int32Array {
  const out = new Int32Array(values.length)

  for (let index = 0; index < values.length; index += 1) {
    out[index] = values[index] ?? 0
  }

  return out
}

// build a deterministic cache key for the target gpu static state
// every load-bearing binary blob is included so mismatched payloads cannot collide
export function buildTargetGpuStaticKey(payload: OptimizerTargetGpuStaticPayload): string {
  return [
    `n:${payload.comboN}`,
    `k:${payload.comboK}`,
    `t:${payload.comboTotalCombos}`,
    `l:${payload.lockedMainRequested ? 1 : 0}`,
    `ctx:${hashTypedArray(payload.context)}`,
    `stats:${hashTypedArray(payload.stats)}`,
    `lut:${hashTypedArray(payload.setConstLut)}`,
    `costs:${hashTypedArray(payload.costs)}`,
    `constraints:${hashTypedArray(payload.constraints)}`,
    `main:${hashTypedArray(payload.mainEchoBuffs)}`,
    `sets:${hashTypedArray(payload.sets)}`,
    `kinds:${hashTypedArray(payload.kinds)}`,
    `index:${hashTypedArray(payload.comboIndexMap)}`,
    `binom:${hashTypedArray(payload.comboBinom)}`,
    `locked:${hashTypedArray(payload.lockedMainCandidateIndices)}`,
  ].join('|')
}

// turn a prepared target run into the static gpu init payload
// this converts cpu-friendly typed arrays into the exact buffer shapes the gpu path expects
export function buildTargetGpuStaticPayload(
    prepared: PreparedTargetSkillRun,
): OptimizerTargetGpuStaticPayload {
  const payload = createPackedTargetSkillExecution(prepared)

  return {
    context: payload.context,
    stats: payload.stats,
    setConstLut: payload.setConstLut,
    costs: toGpuFloatArray(payload.costs),
    constraints: payload.constraints,
    mainEchoBuffs: payload.mainEchoBuffs,
    sets: toGpuFloatArray(payload.sets),
    kinds: toGpuIntArray(payload.kinds),
    comboN: payload.comboN,
    comboK: payload.comboK,
    comboTotalCombos: payload.comboTotalCombos,
    comboIndexMap: payload.comboIndexMap,
    comboBinom: payload.comboBinom,
    lockedMainRequested: payload.lockedMainRequested,
    lockedMainCandidateIndices: payload.lockedMainCandidateIndices,
  }
}

// split the full target-search space into fixed-size jobs
// if main echo is locked, we generate one full combo window series per allowed locked index;
// otherwise we generate a single unrestricted series using lockedMainIndex = -1
export function buildTargetJobs(
    payload: Pick<
        PreparedOptimizerSharedPayload,
        'comboTotalCombos' | 'lockedMainRequested' | 'lockedMainCandidateIndices'
    >,
    combosPerJob: number,
    lockedMainIndices: ReadonlyArray<number> | Int32Array = payload.lockedMainRequested
        ? payload.lockedMainCandidateIndices
        : [-1],
): TargetJobSpec[] {
  const jobs: TargetJobSpec[] = []

  for (const lockedMainIndex of lockedMainIndices) {
    for (let comboStart = 0; comboStart < payload.comboTotalCombos; comboStart += combosPerJob) {
      jobs.push({
        comboStart,
        comboCount: Math.min(combosPerJob, payload.comboTotalCombos - comboStart),
        lockedMainIndex,
      })
    }
  }

  return jobs
}
