/*
  Author: Runor Ewhro
  Description: manages target-skill gpu execution for the optimizer.
               this file initializes persistent gpu resources, runs one or
               more target-search gpu subjobs, optionally reduces candidate
               buffers, and decodes packed gpu output back into combo refs.
*/

import targetShaderCode from '@/engine/optimizer/rebuild/shaders/target.wgsl?raw'
import {
  createCheckedBindGroupLayout,
  createCheckedComputePipeline,
  ensureGpuBuffer,
  GPU_CANDIDATE_STRIDE_BYTES,
  readCandidateBuffer,
  toGpuUploadView,
  type ReusableGpuBuffer,
} from '@/engine/optimizer/rebuild/gpu/common'
import { runReducePassIfNeeded } from '@/engine/optimizer/rebuild/gpu/reduce'
import { getGpuDevice } from '@/engine/optimizer/rebuild/gpu/getDevice'
import {
  OPTIMIZER_CYCLES_PER_INVOCATION,
  OPTIMIZER_REDUCE_K,
  OPTIMIZER_WORKGROUP_SIZE,
} from '@/engine/optimizer/constants'
import type { CombinadicIndexing } from '@/engine/optimizer/rebuild/combinadic'
import { unrankCombinadicInto } from '@/engine/optimizer/rebuild/combinadic'
import {
  OptimizerBagResultCollector,
} from '@/engine/optimizer/rebuild/results'
import type {
  OptimizerTargetGpuResultEntry,
  OptimizerTargetGpuStaticPayload,
} from '@/engine/optimizer/rebuild/workers/messages'
import {
  patchTargetContextDispatchWorkgroupBase,
  patchTargetContextForGpuJob,
} from '@/engine/optimizer/rebuild/context/pack'

interface TargetGpuJobPayload {
  // absolute combo start for this job within the global search space
  comboStart: number

  // number of combos this job should evaluate
  comboCount: number

  // locked main echo index for locked-main mode, or -1 when unlocked
  lockedMainIndex: number

  // final result limit requested for this job
  jobResultsLimit: number
}

interface TargetGpuRunHooks {
  // optional cancellation callback checked during long-running jobs
  isCancelled?: () => boolean
}

interface TargetGpuStaticState {
  // core gpu objects
  device: GPUDevice
  layout: GPUBindGroupLayout
  pipeline: GPUComputePipeline

  // small runtime payload reused across all jobs after initialization
  payload: TargetGpuRuntimePayload

  // static buffers uploaded once per initialization
  echoStatsBuffer: GPUBuffer
  setConstLutBuffer: GPUBuffer
  echoSetsBuffer: GPUBuffer
  comboIndexMapBuffer: GPUBuffer
  echoCostsBuffer: GPUBuffer
  mainEchoBuffsBuffer: GPUBuffer
  statConstraintsBuffer: GPUBuffer
  echoKindIdsBuffer: GPUBuffer
  comboBinomBuffer: GPUBuffer

  // reusable per-job uniform/context buffer
  contextReuse: ReusableGpuBuffer

  // reusable output/readback buffers
  candidateReuse: ReusableGpuBuffer
  candidateReadbackReuse: ReusableGpuBuffer

  // reusable buffers for the optional gpu reduction pass
  reduceReuse: {
    output: ReusableGpuBuffer
    params: ReusableGpuBuffer
  }

  // cached bind group so it is only recreated when one of the bound buffers changes
  bindGroup: GPUBindGroup | null
  bindGroupBuffers: {
    context: GPUBuffer | null
    constraints: GPUBuffer | null
    candidates: GPUBuffer | null
    comboIndexMap: GPUBuffer | null
  }

  // tracks which locked-main mapping is currently uploaded to comboIndexMapBuffer
  activeLockedMainIndex: number
}

// minimal payload slice needed after initialization
type TargetGpuRuntimePayload = Pick<
    OptimizerTargetGpuStaticPayload,
    | 'context'
    | 'costs'
    | 'comboN'
    | 'comboK'
    | 'comboTotalCombos'
    | 'comboIndexMap'
    | 'comboBinom'
    | 'lockedMainRequested'
    | 'lockedMainCandidateIndices'
>

// packed candidate rank layout:
// upper bits store which of the 5 combo positions is the chosen main echo,
// lower bits store the combinadic rank
const MAIN_POS_SHIFT = 29
const MAIN_POS_MASK = 0x7
const RANK_MASK = 0x1FFFFFFF

// hard safety cap for one dispatch call
const MAX_DISPATCH_WORKGROUPS = 65535

// context combo count is limited by the packed rank field width
const MAX_CONTEXT_COMBO_COUNT = RANK_MASK + 1

// additional soft cap so one gpu submit does not get too huge
const TARGET_DISPATCH_COMBOS_PER_SUBMIT = 10_000_000
const TARGET_DISPATCH_WORKGROUPS_PER_SUBMIT = Math.max(
    1,
    Math.ceil(
        Math.ceil(TARGET_DISPATCH_COMBOS_PER_SUBMIT / OPTIMIZER_CYCLES_PER_INVOCATION) /
        OPTIMIZER_WORKGROUP_SIZE,
    ),
)

// cached pipeline objects shared across target gpu runs
let cachedPipeline: GPUComputePipeline | null = null
let cachedLayout: GPUBindGroupLayout | null = null

// singleton target gpu state for the current initialized payload
let targetGpuState: TargetGpuStaticState | null = null

// lazily compile and cache the target shader pipeline
async function getPipeline(device: GPUDevice): Promise<{ layout: GPUBindGroupLayout; pipeline: GPUComputePipeline }> {
  if (cachedPipeline && cachedLayout) {
    return { layout: cachedLayout, pipeline: cachedPipeline }
  }

  // layout must match the bindings declared in the target shader
  cachedLayout = await createCheckedBindGroupLayout(device, 'optimizer-target-layout', [
    { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
    { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
    { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
    { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
    { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
    { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
    { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
    { binding: 7, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
    { binding: 8, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
    { binding: 9, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
    { binding: 10, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
  ])

  cachedPipeline = await createCheckedComputePipeline({
    device,
    label: 'optimizer-target-pipeline',
    layout: cachedLayout,
    code: targetShaderCode,
  })

  return { layout: cachedLayout, pipeline: cachedPipeline }
}

// destroy one reusable buffer wrapper and reset it
function destroyReusableBuffer(reuse: ReusableGpuBuffer): void {
  reuse.buffer?.destroy()
  reuse.buffer = null
  reuse.size = 0
}

// destroy all current target gpu resources before reinitializing with another payload
function destroyTargetGpuState(): void {
  if (!targetGpuState) {
    return
  }

  destroyReusableBuffer(targetGpuState.contextReuse)
  destroyReusableBuffer(targetGpuState.candidateReuse)
  destroyReusableBuffer(targetGpuState.candidateReadbackReuse)
  destroyReusableBuffer(targetGpuState.reduceReuse.output)
  destroyReusableBuffer(targetGpuState.reduceReuse.params)

  targetGpuState.echoStatsBuffer.destroy()
  targetGpuState.setConstLutBuffer.destroy()
  targetGpuState.echoSetsBuffer.destroy()
  targetGpuState.comboIndexMapBuffer.destroy()
  targetGpuState.echoCostsBuffer.destroy()
  targetGpuState.mainEchoBuffsBuffer.destroy()
  targetGpuState.statConstraintsBuffer.destroy()
  targetGpuState.echoKindIdsBuffer.destroy()
  targetGpuState.comboBinomBuffer.destroy()

  targetGpuState = null
}

// local helper for creating storage buffers in this module
function createStorageBuffer(device: GPUDevice, data: ArrayBuffer | ArrayBufferView<ArrayBufferLike>): GPUBuffer {
  const upload = toGpuUploadView(data)
  const byteLength = upload instanceof ArrayBuffer ? upload.byteLength : upload.byteLength

  const buffer = device.createBuffer({
    size: Math.max(4, byteLength),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })

  if (byteLength > 0) {
    device.queue.writeBuffer(buffer, 0, upload)
  }

  return buffer
}

// rebuild the effective combo index map when a different locked main echo is used
function buildIndexMapExcluding(payload: TargetGpuRuntimePayload, lockedMainIndex: number): Int32Array {
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

// build the combinadic indexing view used to unrank combos for this job
function buildJobComboIndexing(payload: TargetGpuRuntimePayload, lockedMainIndex: number): CombinadicIndexing {
  // unlocked jobs can use the original indexing directly
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

  // if this job matches the default locked-main mapping, reuse the original buffers
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

  // otherwise derive an alternate candidate map that excludes the current locked main
  return {
    comboN: payload.comboN,
    comboK: payload.comboK,
    totalCombos: payload.comboTotalCombos,
    indexMap: buildIndexMapExcluding(payload, lockedMainIndex),
    binom: payload.comboBinom,
    lockedIndex: lockedMainIndex,
  }
}

// gpu readback returns unsorted candidates, so sort strongest-first before decoding
function sortCandidatesByDamageDesc(candidates: Array<{ damage: number; rank: number }>): void {
  candidates.sort((left, right) => right.damage - left.damage)
}

// create or reuse the bind group for the currently active job buffers
function getBindGroup(
    state: TargetGpuStaticState,
    candidateBuffer: GPUBuffer,
    contextBuffer: GPUBuffer,
    statConstraintsBuffer: GPUBuffer,
): GPUBindGroup {
  const needsRecreate =
      !state.bindGroup ||
      state.bindGroupBuffers.context !== contextBuffer ||
      state.bindGroupBuffers.constraints !== statConstraintsBuffer ||
      state.bindGroupBuffers.candidates !== candidateBuffer ||
      state.bindGroupBuffers.comboIndexMap !== state.comboIndexMapBuffer

  if (!needsRecreate) {
    return state.bindGroup as GPUBindGroup
  }

  state.bindGroup = state.device.createBindGroup({
    label: 'optimizer-target-bind-group',
    layout: state.layout,
    entries: [
      // 0: encoded echo stat rows
      { binding: 0, resource: { buffer: state.echoStatsBuffer } },

      // 1: set lookup table
      { binding: 1, resource: { buffer: state.setConstLutBuffer } },

      // 2: set id per echo
      { binding: 2, resource: { buffer: state.echoSetsBuffer } },

      // 3: combo index map
      { binding: 3, resource: { buffer: state.comboIndexMapBuffer } },

      // 4: per-job patched context
      { binding: 4, resource: { buffer: contextBuffer } },

      // 5: echo costs
      { binding: 5, resource: { buffer: state.echoCostsBuffer } },

      // 6: main echo bonus rows
      { binding: 6, resource: { buffer: state.mainEchoBuffsBuffer } },

      // 7: constraints uniform
      { binding: 7, resource: { buffer: statConstraintsBuffer } },

      // 8: echo kind ids
      { binding: 8, resource: { buffer: state.echoKindIdsBuffer } },

      // 9: output candidate buffer
      { binding: 9, resource: { buffer: candidateBuffer } },

      // 10: combinadic binomial table
      { binding: 10, resource: { buffer: state.comboBinomBuffer } },
    ],
  })

  state.bindGroupBuffers = {
    context: contextBuffer,
    constraints: statConstraintsBuffer,
    candidates: candidateBuffer,
    comboIndexMap: state.comboIndexMapBuffer,
  }

  return state.bindGroup
}

// state guard used by execution functions
function ensureTargetGpuState(): TargetGpuStaticState {
  if (!targetGpuState) {
    throw new Error('Target GPU worker state has not been initialized')
  }

  return targetGpuState
}

// dispatch the target pipeline in chunks, patching the dispatch workgroup base before each submit
async function dispatchTargetPipeline(
    device: GPUDevice,
    pipeline: GPUComputePipeline,
    bindGroup: GPUBindGroup,
    contextBuffer: GPUBuffer,
    patchedContext: Float32Array,
    workgroupCount: number,
): Promise<void> {
  let remaining = workgroupCount
  let dispatched = 0

  while (remaining > 0) {
    const batch = Math.min(
        remaining,
        MAX_DISPATCH_WORKGROUPS,
        TARGET_DISPATCH_WORKGROUPS_PER_SUBMIT,
    )

    // tell the shader where this dispatch chunk starts within the full job
    patchTargetContextDispatchWorkgroupBase(patchedContext, dispatched)
    device.queue.writeBuffer(contextBuffer, 0, toGpuUploadView(patchedContext))

    const encoder = device.createCommandEncoder()
    const pass = encoder.beginComputePass()
    pass.setPipeline(pipeline)
    pass.setBindGroup(0, bindGroup)
    pass.dispatchWorkgroups(batch)
    pass.end()
    device.queue.submit([encoder.finish()])

    remaining -= batch
    dispatched += batch

    // wait between submits so extremely large jobs stream in controlled chunks
    if (remaining > 0) {
      await device.queue.onSubmittedWorkDone()
    }
  }
}

// initialize persistent target-gpu resources for one static payload
export async function initializeTargetGpu(payload: OptimizerTargetGpuStaticPayload): Promise<void> {
  destroyTargetGpuState()

  const device = await getGpuDevice()
  const { layout, pipeline } = await getPipeline(device)

  targetGpuState = {
    device,
    layout,
    pipeline,

    // keep only the runtime slice needed for later jobs
    payload: {
      context: payload.context,
      costs: payload.costs,
      comboN: payload.comboN,
      comboK: payload.comboK,
      comboTotalCombos: payload.comboTotalCombos,
      comboIndexMap: payload.comboIndexMap,
      comboBinom: payload.comboBinom,
      lockedMainRequested: payload.lockedMainRequested,
      lockedMainCandidateIndices: payload.lockedMainCandidateIndices,
    },

    // static buffers uploaded once
    echoStatsBuffer: createStorageBuffer(device, payload.stats),
    setConstLutBuffer: createStorageBuffer(device, payload.setConstLut),
    echoSetsBuffer: createStorageBuffer(device, payload.sets),
    comboIndexMapBuffer: createStorageBuffer(device, payload.comboIndexMap),

    // reused per-job context uniform
    contextReuse: { buffer: null, size: 0 },

    echoCostsBuffer: createStorageBuffer(device, payload.costs),
    mainEchoBuffsBuffer: createStorageBuffer(device, payload.mainEchoBuffs),

    // constraints live in a uniform buffer
    statConstraintsBuffer: (() => {
      const buffer = device.createBuffer({
        size: Math.max(16, payload.constraints.byteLength),
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      })

      if (payload.constraints.byteLength > 0) {
        device.queue.writeBuffer(buffer, 0, toGpuUploadView(payload.constraints))
      }

      return buffer
    })(),

    echoKindIdsBuffer: createStorageBuffer(device, payload.kinds),
    comboBinomBuffer: createStorageBuffer(device, payload.comboBinom),

    // reusable candidate output/readback
    candidateReuse: { buffer: null, size: 0 },
    candidateReadbackReuse: { buffer: null, size: 0 },

    // reusable reduction scratch
    reduceReuse: {
      output: { buffer: null, size: 0 },
      params: { buffer: null, size: 0 },
    },

    bindGroup: null,
    bindGroupBuffers: {
      context: null,
      constraints: null,
      candidates: null,
      comboIndexMap: null,
    },

    // track which locked-main mapping the comboIndexMap buffer currently represents
    activeLockedMainIndex: payload.lockedMainRequested
        ? (payload.lockedMainCandidateIndices[0] ?? -1)
        : -1,
  }
}

// run one target-gpu job, possibly split into multiple subjobs if comboCount exceeds
// what can be represented inside one packed context rank span
export async function runTargetGpuJob(
    job: TargetGpuJobPayload,
    hooks: TargetGpuRunHooks = {},
): Promise<OptimizerTargetGpuResultEntry[]> {
  const state = ensureTargetGpuState()

  if (hooks.isCancelled?.() || job.comboCount <= 0) {
    return []
  }

  // collect results across all subjobs, then sort/limit at the end
  const overallCollector = new OptimizerBagResultCollector(job.jobResultsLimit)

  const comboIndexing = buildJobComboIndexing(state.payload, job.lockedMainIndex)

  // if locked-main mode is active and this job uses a different locked echo than the
  // currently uploaded one, update the combo index map buffer first
  if (state.payload.lockedMainRequested && state.activeLockedMainIndex !== job.lockedMainIndex) {
    const nextIndexMap = job.lockedMainIndex === (state.payload.lockedMainCandidateIndices[0] ?? -1)
        ? state.payload.comboIndexMap
        : buildIndexMapExcluding(state.payload, job.lockedMainIndex)

    state.device.queue.writeBuffer(state.comboIndexMapBuffer, 0, toGpuUploadView(nextIndexMap))
    state.activeLockedMainIndex = job.lockedMainIndex
  }

  const comboIds = new Int32Array(5)
  let remaining = job.comboCount
  let subJobStart = job.comboStart

  while (remaining > 0) {
    if (hooks.isCancelled?.()) {
      return overallCollector.sorted(job.jobResultsLimit)
    }

    // each subjob is capped so combo rank still fits in the packed gpu candidate format
    const subJobCount = Math.min(remaining, MAX_CONTEXT_COMBO_COUNT)

    // patch the base context with this subjob's combo span and locked-main choice
    const patchedContext = patchTargetContextForGpuJob({
      baseContext: state.payload.context,
      comboN: comboIndexing.comboN,
      comboK: comboIndexing.comboK,
      comboCount: subJobCount,
      comboBaseIndex: subJobStart,
      lockedEchoIndex: job.lockedMainIndex,
    })

    const contextBuffer = ensureGpuBuffer(
        state.device,
        state.contextReuse,
        patchedContext.byteLength,
        GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    )

    // workgroup/candidate sizing for this subjob
    const invocationCount = Math.ceil(subJobCount / OPTIMIZER_CYCLES_PER_INVOCATION)
    const workgroupCount = Math.ceil(invocationCount / OPTIMIZER_WORKGROUP_SIZE)
    const candidateCount = workgroupCount * OPTIMIZER_REDUCE_K

    const candidateBuffer = ensureGpuBuffer(
        state.device,
        state.candidateReuse,
        candidateCount * GPU_CANDIDATE_STRIDE_BYTES,
        GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    )

    const bindGroup = getBindGroup(state, candidateBuffer, contextBuffer, state.statConstraintsBuffer)

    await dispatchTargetPipeline(
        state.device,
        state.pipeline,
        bindGroup,
        contextBuffer,
        patchedContext,
        workgroupCount,
    )

    // reduce on gpu if the raw candidate count is still too large
    const readbackTarget = await runReducePassIfNeeded({
      device: state.device,
      candidateBuffer,
      candidateCount,
      reduceK: OPTIMIZER_REDUCE_K,
      reuse: state.reduceReuse,
    })

    // read candidates back to cpu
    const { results: candidates } = await readCandidateBuffer(
        state.device,
        readbackTarget.buffer,
        readbackTarget.count,
        state.candidateReadbackReuse,
    )

    if (hooks.isCancelled?.()) {
      return overallCollector.sorted(job.jobResultsLimit)
    }

    sortCandidatesByDamageDesc(candidates)

    // only unrank an oversampled prefix of the gpu candidates
    const subJobCandidateLimit = Math.max(1, job.jobResultsLimit * OPTIMIZER_REDUCE_K)
    let pushed = 0

    for (const candidate of candidates) {
      const packedRank = candidate.rank >>> 0
      const mainPos = (packedRank >>> MAIN_POS_SHIFT) & MAIN_POS_MASK
      const comboRank = packedRank & RANK_MASK

      // decode the combo back into concrete echo indices
      unrankCombinadicInto(comboRank + subJobStart, comboIndexing, comboIds, comboIds.length)

      const mainIndex = comboIds[mainPos] ?? -1
      overallCollector.pushOrderedCombo(candidate.damage, comboIds, mainIndex)

      pushed += 1
      if (pushed >= subJobCandidateLimit) {
        break
      }
    }

    remaining -= subJobCount
    subJobStart += subJobCount
  }

  return overallCollector.sorted(job.jobResultsLimit)
}