/*
  Author: Runor Ewhro
  Description: manages rotation-mode gpu execution for the optimizer.
               this file initializes persistent gpu resources, builds
               per-job runtime buffers, dispatches the rotation shader,
               optionally reduces gpu candidates, decodes packed results,
               and converts them back into optimizer combo refs.
*/

import {
  createStorageBuffer,
  ensureGpuBuffer,
  GPU_CANDIDATE_STRIDE_BYTES,
  readCandidateBuffer,
  toGpuUploadView,
  type ReusableGpuBuffer,
} from '@/engine/optimizer/gpu/common.ts'
import { getRotationGpuPipeline } from '@/engine/optimizer/gpu/rotationPipeline.ts'
import { runReducePassIfNeeded } from '@/engine/optimizer/gpu/reduce.ts'
import { dispatchComputePass } from '@/engine/optimizer/gpu/dispatch.ts'
import { getGpuDevice } from '@/engine/optimizer/gpu/getDevice.ts'
import {
  patchTargetContextDispatchWorkgroupBase,
  patchTargetContextForGpuJob,
} from '@/engine/optimizer/context/pack.ts'
import {
  OPTIMIZER_CONTEXT_FLOATS,
  OPTIMIZER_ROTATION_CYCLES_PER_INVOCATION,
  OPTIMIZER_ROTATION_REDUCE_K,
  OPTIMIZER_ROTATION_WORKGROUP_SIZE,
} from '@/engine/optimizer/config/constants.ts'
import type { CombinadicIndexing } from '@/engine/optimizer/combos/combinadic.ts'
import { unrankCombinadicInto } from '@/engine/optimizer/combos/combinadic.ts'
import { OptimizerBagResultCollector } from '@/engine/optimizer/results/collector.ts'
import type {
  OptimizerBagResultRef,
  PackedRotationExecutionPayload,
} from '@/engine/optimizer/types.ts'

interface RotationGpuJobPayload {
  // absolute combo start index for this job inside the global search space
  comboStart: number

  // number of combos this job is responsible for processing
  comboCount: number

  // fixed main echo index for locked-main mode, or -1 when unlocked
  lockedMainIndex: number

  // maximum number of final results this job should keep
  jobResultsLimit: number
}

interface RotationGpuRunHooks {
  // cancellation hook checked before and after major gpu stages
  isCancelled?: () => boolean
}

interface RotationGpuStaticState {
  // core gpu objects
  device: GPUDevice
  layout: GPUBindGroupLayout
  pipeline: GPUComputePipeline

  // original packed execution payload used to initialize this state
  execution: PackedRotationExecutionPayload

  // static buffers uploaded once per initialization
  statsBuffer: GPUBuffer
  setConstLutBuffer: GPUBuffer
  setsBuffer: GPUBuffer
  comboIndexMapBuffer: GPUBuffer
  echoCostsBuffer: GPUBuffer
  mainEchoBuffsBuffer: GPUBuffer
  constraintsBuffer: GPUBuffer
  kindBuffer: GPUBuffer
  comboBinomBuffer: GPUBuffer
  rotationContextsBuffer: GPUBuffer
  rotationMetaBuffer: GPUBuffer

  // reusable per-job buffers
  paramsReuse: ReusableGpuBuffer
  candidateReuse: ReusableGpuBuffer
  candidateReadbackReuse: ReusableGpuBuffer

  // reusable buffers for the optional reduction pass
  reduceReuse: {
    output: ReusableGpuBuffer
    params: ReusableGpuBuffer
  }

  // cached bind group so we only recreate it when candidate/params buffers change
  bindGroup: GPUBindGroup | null
  bindGroupBuffers: {
    candidates: GPUBuffer | null
    params: GPUBuffer | null
  }

  // tracks which locked main index the uploaded combo index map currently matches
  activeLockedMainIndex: number
}

// minimal slice of the execution payload needed to rebuild per-job combinadic state
type RotationGpuRuntimePayload = Pick<
    PackedRotationExecutionPayload,
    | 'costs'
    | 'comboN'
    | 'comboK'
    | 'comboTotalCombos'
    | 'comboIndexMap'
    | 'comboBinom'
    | 'lockedMainRequested'
    | 'lockedMainCandidateIndices'
>

// singleton worker-side state for rotation gpu execution
let rotationGpuState: RotationGpuStaticState | null = null

// destroy one reusable buffer wrapper and reset it to an empty state
function destroyReusableBuffer(reuse: ReusableGpuBuffer): void {
  reuse.buffer?.destroy()
  reuse.buffer = null
  reuse.size = 0
}

// fully destroy all persistent rotation gpu resources
// called before reinitialization so old payloads do not leak buffers
function destroyRotationGpuState(): void {
  if (!rotationGpuState) {
    return
  }

  destroyReusableBuffer(rotationGpuState.paramsReuse)
  destroyReusableBuffer(rotationGpuState.candidateReuse)
  destroyReusableBuffer(rotationGpuState.candidateReadbackReuse)
  destroyReusableBuffer(rotationGpuState.reduceReuse.output)
  destroyReusableBuffer(rotationGpuState.reduceReuse.params)

  rotationGpuState.statsBuffer.destroy()
  rotationGpuState.setConstLutBuffer.destroy()
  rotationGpuState.setsBuffer.destroy()
  rotationGpuState.comboIndexMapBuffer.destroy()
  rotationGpuState.echoCostsBuffer.destroy()
  rotationGpuState.mainEchoBuffsBuffer.destroy()
  rotationGpuState.constraintsBuffer.destroy()
  rotationGpuState.kindBuffer.destroy()
  rotationGpuState.comboBinomBuffer.destroy()
  rotationGpuState.rotationContextsBuffer.destroy()
  rotationGpuState.rotationMetaBuffer.destroy()

  rotationGpuState = null
}

// build a combo index map that excludes one locked main echo from the selectable pool
// this is needed for locked-main jobs when the requested locked echo is not the default one
function buildIndexMapExcluding(payload: RotationGpuRuntimePayload, lockedMainIndex: number): Int32Array {
  const indexMap = new Int32Array(payload.costs.length - 1)
  let cursor = 0

  for (let index = 0; index < payload.costs.length; index += 1) {
    if (index === lockedMainIndex) {
      continue
    }

    indexMap[cursor] = index
    cursor += 1
  }

  return indexMap
}

// derive the combinadic indexing view for this specific job
// unlocked jobs can reuse the execution payload directly
// locked jobs may need a remapped index map depending on which locked main is active
function buildJobComboIndexing(payload: RotationGpuRuntimePayload, lockedMainIndex: number): CombinadicIndexing {
  if (!payload.lockedMainRequested || lockedMainIndex < 0) {
    return {
      comboN: payload.comboN,
      comboK: payload.comboK,
      totalCombos: payload.comboTotalCombos,
      indexMap: payload.comboIndexMap,
      binom: payload.comboBinom,
      lockedIndex: -1,
    }
  }

  const firstLockedMainIndex = payload.lockedMainCandidateIndices[0] ?? -1

  // if this job uses the same locked main index as the base payload,
  // we can reuse the original index map as-is
  if (lockedMainIndex === firstLockedMainIndex) {
    return {
      comboN: payload.comboN,
      comboK: payload.comboK,
      totalCombos: payload.comboTotalCombos,
      indexMap: payload.comboIndexMap,
      binom: payload.comboBinom,
      lockedIndex: lockedMainIndex,
    }
  }

  // otherwise rebuild the effective candidate map for this locked echo
  return {
    comboN: payload.comboN,
    comboK: payload.comboK,
    totalCombos: payload.comboTotalCombos,
    indexMap: buildIndexMapExcluding(payload, lockedMainIndex),
    binom: payload.comboBinom,
    lockedIndex: lockedMainIndex,
  }
}

// helper: convert compact uint8 data into float32 for shader storage buffers
// some gpu paths prefer all numeric payloads in float buffers
function toGpuFloatArray(values: Uint8Array): Float32Array {
  const out = new Float32Array(values.length)
  for (let index = 0; index < values.length; index += 1) {
    out[index] = values[index] ?? 0
  }
  return out
}

// helper: convert uint16 ids into int32 values for shader consumption
function toGpuIntArray(values: Uint16Array): Int32Array {
  const out = new Int32Array(values.length)
  for (let index = 0; index < values.length; index += 1) {
    out[index] = values[index] ?? 0
  }
  return out
}

// candidates are read back unsorted, so sort strongest-first before decoding them into combos
function sortCandidatesByDamageDesc(candidates: Array<{ damage: number; rank: number; mainPos: number }>): void {
  candidates.sort((left, right) => right.damage - left.damage)
}

// state guard used by runtime job execution functions
function ensureRotationGpuState(): RotationGpuStaticState {
  if (!rotationGpuState) {
    throw new Error('Rotation GPU worker state has not been initialized')
  }

  return rotationGpuState
}

// constraints are used as uniforms, so keep them in a uniform-compatible buffer
function createConstraintsBuffer(device: GPUDevice, constraints: Float32Array): GPUBuffer {
  const buffer = device.createBuffer({
    size: Math.max(16, constraints.byteLength),
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })

  if (constraints.byteLength > 0) {
    device.queue.writeBuffer(buffer, 0, toGpuUploadView(constraints))
  }

  return buffer
}

// create or reuse the bind group for the current candidate and params buffers
// everything else is static per initialization and stays bound to persistent buffers
function getBindGroup(
    state: RotationGpuStaticState,
    candidateBuffer: GPUBuffer,
    paramsBuffer: GPUBuffer,
): GPUBindGroup {
  const needsRecreate =
      !state.bindGroup ||
      state.bindGroupBuffers.candidates !== candidateBuffer ||
      state.bindGroupBuffers.params !== paramsBuffer

  if (!needsRecreate) {
    return state.bindGroup as GPUBindGroup
  }

  state.bindGroup = state.device.createBindGroup({
    label: 'optimizer-rotation-bind-group',
    layout: state.layout,
    entries: [
      // 0: encoded echo stat rows
      { binding: 0, resource: { buffer: state.statsBuffer } },

      // 1: set lookup table
      { binding: 1, resource: { buffer: state.setConstLutBuffer } },

      // 2: set ids per echo
      { binding: 2, resource: { buffer: state.setsBuffer } },

      // 3: combo index map
      { binding: 3, resource: { buffer: state.comboIndexMapBuffer } },

      // 4: per-job params / patched context
      { binding: 4, resource: { buffer: paramsBuffer } },

      // 5: echo costs
      { binding: 5, resource: { buffer: state.echoCostsBuffer } },

      // 6: main echo bonus rows
      { binding: 6, resource: { buffer: state.mainEchoBuffsBuffer } },

      // 7: constraints uniform
      { binding: 7, resource: { buffer: state.constraintsBuffer } },

      // 8: kind ids
      { binding: 8, resource: { buffer: state.kindBuffer } },

      // 9: output candidate buffer
      { binding: 9, resource: { buffer: candidateBuffer } },

      // 10: binomial table
      { binding: 10, resource: { buffer: state.comboBinomBuffer } },

      // 11: packed rotation contexts + weights
      { binding: 11, resource: { buffer: state.rotationContextsBuffer } },

      // 12: small metadata uniform for context count / stride
      { binding: 12, resource: { buffer: state.rotationMetaBuffer } },
    ],
  })

  state.bindGroupBuffers = {
    candidates: candidateBuffer,
    params: paramsBuffer,
  }

  return state.bindGroup
}

// shader binding count is tight, so contexts and weights are packed into one buffer:
// [all contexts..., all weights...]
function buildRotationContextBuffer(payload: PackedRotationExecutionPayload): Float32Array {
  const merged = new Float32Array(payload.contexts.length + payload.contextWeights.length)
  merged.set(payload.contexts, 0)
  merged.set(payload.contextWeights, payload.contexts.length)
  return merged
}

// initialize all static gpu state for one packed rotation execution payload
// any previous state is destroyed first
export async function initializeRotationGpu(payload: PackedRotationExecutionPayload): Promise<void> {
  destroyRotationGpuState()

  const device = await getGpuDevice()
  const { layout, pipeline } = await getRotationGpuPipeline(device)

  rotationGpuState = {
    device,
    layout,
    pipeline,
    execution: payload,

    // upload all mostly-static buffers once
    statsBuffer: createStorageBuffer(device, payload.stats),
    setConstLutBuffer: createStorageBuffer(device, payload.setConstLut),
    setsBuffer: createStorageBuffer(device, toGpuFloatArray(payload.sets)),
    comboIndexMapBuffer: createStorageBuffer(device, payload.comboIndexMap),
    echoCostsBuffer: createStorageBuffer(device, toGpuFloatArray(payload.costs)),
    mainEchoBuffsBuffer: createStorageBuffer(device, payload.mainEchoBuffs),
    constraintsBuffer: createConstraintsBuffer(device, payload.constraints),
    kindBuffer: createStorageBuffer(device, toGpuIntArray(payload.kinds)),
    comboBinomBuffer: createStorageBuffer(device, payload.comboBinom),
    rotationContextsBuffer: createStorageBuffer(device, buildRotationContextBuffer(payload)),

    // tiny uniform used by the shader for context layout metadata
    rotationMetaBuffer: device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    }),

    // reusable runtime buffers
    paramsReuse: { buffer: null, size: 0 },
    candidateReuse: { buffer: null, size: 0 },
    candidateReadbackReuse: { buffer: null, size: 0 },

    // reduction scratch
    reduceReuse: {
      output: { buffer: null, size: 0 },
      params: { buffer: null, size: 0 },
    },

    bindGroup: null,
    bindGroupBuffers: {
      candidates: null,
      params: null,
    },

    // if locked-main mode is enabled, assume first candidate index is the current uploaded mapping
    activeLockedMainIndex: payload.lockedMainRequested
        ? (payload.lockedMainCandidateIndices[0] ?? -1)
        : -1,
  }

  // metadata layout:
  // [contextCount, contextStride, reserved0, reserved1]
  device.queue.writeBuffer(
      rotationGpuState.rotationMetaBuffer,
      0,
      new Uint32Array([payload.contextCount, payload.contextStride, 0, 0]),
  )
}

// build the uniform payload for one rotation gpu job
// this reuses the existing context patcher to keep packing behavior consistent
function createRotationJobParams(options: {
  comboN: number
  comboK: number
  comboCount: number
  comboBaseIndex: number
  lockedEchoIndex: number
}): Float32Array {
  return patchTargetContextForGpuJob({
    baseContext: new Float32Array(OPTIMIZER_CONTEXT_FLOATS),
    comboN: options.comboN,
    comboK: options.comboK,
    comboCount: options.comboCount,
    comboBaseIndex: options.comboBaseIndex,
    lockedEchoIndex: options.lockedEchoIndex,
  })
}

// decode packed candidate rank field:
// lower 29 bits -> combo rank
// upper 3 bits -> position of the chosen main echo within the decoded combo
function decodePackedCandidates(
    candidates: Array<{ damage: number; rank: number }>,
): Array<{ damage: number; rank: number; mainPos: number }> {
  const out: Array<{ damage: number; rank: number; mainPos: number }> = []

  for (const candidate of candidates) {
    const packed = candidate.rank >>> 0
    out.push({
      damage: candidate.damage,
      rank: packed & 0x1fffffff,
      mainPos: packed >>> 29,
    })
  }

  return out
}

// run one rotation gpu job from dispatch through readback and final combo decoding
export async function runRotationGpuJob(
    job: RotationGpuJobPayload,
    hooks: RotationGpuRunHooks = {},
): Promise<OptimizerBagResultRef[]> {
  const state = ensureRotationGpuState()

  // bail out early for cancellation, empty work, or empty rotation context sets
  if (hooks.isCancelled?.() || job.comboCount <= 0 || state.execution.contextCount <= 0) {
    return []
  }

  const execution = state.execution
  const comboIndexing = buildJobComboIndexing(execution, job.lockedMainIndex)

  // in locked-main mode, the combo index map may need to be rewritten if this job uses
  // a different locked main than the one currently uploaded to the gpu
  if (execution.lockedMainRequested && state.activeLockedMainIndex !== job.lockedMainIndex) {
    const nextIndexMap = job.lockedMainIndex === (execution.lockedMainCandidateIndices[0] ?? -1)
        ? execution.comboIndexMap
        : buildIndexMapExcluding(execution, job.lockedMainIndex)

    state.device.queue.writeBuffer(state.comboIndexMapBuffer, 0, toGpuUploadView(nextIndexMap))
    state.activeLockedMainIndex = job.lockedMainIndex
  }

  // compute how many workgroups are needed for this combo span
  // each invocation processes OPTIMIZER_ROTATION_CYCLES_PER_INVOCATION combos
  const invocationCount = Math.ceil(job.comboCount / OPTIMIZER_ROTATION_CYCLES_PER_INVOCATION)
  const workgroupCount = Math.ceil(invocationCount / OPTIMIZER_ROTATION_WORKGROUP_SIZE)

  // the shader emits OPTIMIZER_ROTATION_REDUCE_K candidates per workgroup
  const candidateCount = workgroupCount * OPTIMIZER_ROTATION_REDUCE_K
  if (candidateCount <= 0) {
    return []
  }

  // allocate/reuse candidate output buffer
  const candidateBuffer = ensureGpuBuffer(
      state.device,
      state.candidateReuse,
      candidateCount * GPU_CANDIDATE_STRIDE_BYTES,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  )

  // build and upload per-job params
  const params = createRotationJobParams({
    comboN: comboIndexing.comboN,
    comboK: comboIndexing.comboK,
    comboCount: job.comboCount,
    comboBaseIndex: job.comboStart,
    lockedEchoIndex: job.lockedMainIndex,
  })

  const paramsBuffer = ensureGpuBuffer(
      state.device,
      state.paramsReuse,
      params.byteLength,
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  )
  state.device.queue.writeBuffer(paramsBuffer, 0, toGpuUploadView(params))

  // get/create bind group for these exact runtime buffers
  const bindGroup = getBindGroup(state, candidateBuffer, paramsBuffer)

  // dispatch the rotation shader
  await dispatchComputePass({
    device: state.device,
    pipeline: state.pipeline,
    bindGroup,
    workgroupCount,
    beforeDispatchBatch: (workgroupBase) => {
      patchTargetContextDispatchWorkgroupBase(params, workgroupBase)
      state.device.queue.writeBuffer(paramsBuffer, 0, toGpuUploadView(params))
    },
  })

  // if candidate output is still too large, perform a reduction pass before readback
  const readbackTarget = await runReducePassIfNeeded({
    device: state.device,
    candidateBuffer,
    candidateCount,
    reduceK: OPTIMIZER_ROTATION_REDUCE_K,
    reuse: state.reduceReuse,
  })

  // read back reduced or original candidates from gpu memory
  const { results } = await readCandidateBuffer(
      state.device,
      readbackTarget.buffer,
      readbackTarget.count,
      state.candidateReadbackReuse,
  )

  if (hooks.isCancelled?.()) {
    return []
  }

  // unpack rank/mainPos fields, then sort strongest-first
  const decodedCandidates = decodePackedCandidates(results)
  sortCandidatesByDamageDesc(decodedCandidates)

  // collect final bag results in the same structure used by cpu paths
  const collector = new OptimizerBagResultCollector(job.jobResultsLimit)
  const comboIds = new Int32Array(5)

  // oversample the number of decoded candidates we push through unranking,
  // because many may collapse/dedup before final sorting
  const candidateLimit = Math.max(1, job.jobResultsLimit * OPTIMIZER_ROTATION_REDUCE_K)
  let pushed = 0

  for (const candidate of decodedCandidates) {
    // rebuild the full combo from its combinadic rank
    unrankCombinadicInto(candidate.rank + job.comboStart, comboIndexing, comboIds, comboIds.length)

    // mainPos points to one of the 5 slots inside comboIds
    const mainIndex = comboIds[candidate.mainPos] ?? -1
    if (mainIndex < 0) {
      continue
    }

    collector.pushOrderedCombo(candidate.damage, comboIds, mainIndex)
    pushed += 1

    if (pushed >= candidateLimit) {
      break
    }
  }

  return collector.sorted(job.jobResultsLimit)
}
