/*
  Author: Runor Ewhro
  Description: manages target-skill gpu execution for the optimizer.
               this file initializes persistent gpu resources, runs one or
               more target-search gpu subjobs, optionally reduces candidate
               buffers, and decodes packed gpu output back into combo refs.
*/

import tgtShdrCode from '@/engine/optimizer/shaders/target.wgsl?raw'
import {
  mkChckBindGr,
  mkChckCmptPp,
  ensureGpuBuffer,
  GPU_CAND_STRIDE,
  readCandBffr,
  toGpuPldView,
  writeGpuBffr,
  type ReusableBuffer,
} from '@/engine/optimizer/gpu/common.ts'
import { dispCmptPass } from '@/engine/optimizer/gpu/dispatch.ts'
import { runRdcPassIf } from '@/engine/optimizer/gpu/reduce.ts'
import { getGpuDevice } from '@/engine/optimizer/gpu/getDevice.ts'
import {
  CYCLES_PER_CALL,
  OPT_RDC_K,
  OPT_WG_SIZE,
} from '@/engine/optimizer/config/constants.ts'
import type { ComboIndex } from '@/engine/optimizer/combos/combinadic.ts'
import { nrnkCmbnInto } from '@/engine/optimizer/combos/combinadic.ts'
import {
  OptResultSet,
} from '@/engine/optimizer/results/collector.ts'
import type {
  OptTgtGpuRsl,
  TargetGpuState,
} from '@/engine/optimizer/workers/messages.ts'
import {
  ptchTgtCtxDi,
  ptchTgtCtxFo,
} from '@/engine/optimizer/context/pack.ts'

interface TgtGpuJobPay {
  // absolute combo start for this job within the global search space
  comboStart: number

  // number of combos this job should evaluate
  comboCount: number

  // locked main echo index for locked-main mode, or -1 when unlocked
  lockMainIdx: number

  // final result limit requested for this job
  jobResultLimit: number
}

interface TgtGpuBtcPay {
  combosBatch: Int32Array
  comboCount: number
  lockMainIdx: number
  jobResultLimit: number
}

interface TgtGpuRunHks {
  // optional cancellation callback checked during long-running jobs
  isCancelled?: () => boolean
}

interface TgtGpuSttcSt {
  // core gpu objects
  device: GPUDevice
  layout: GPUBindGroupLayout
  pipeline: GPUComputePipeline

  // small runtime payload reused across all jobs after initialization
  payload: TgtGpuRtPay

  // static buffers uploaded once per initialization
  echoSttsBffr: GPUBuffer
  setCnstLutns: GPUBuffer
  echoSetsBffr: GPUBuffer
  comboMapBox: GPUBuffer
  echoCstsBffr: GPUBuffer
  mainEchoBuff: GPUBuffer
  statCstrsBsy: GPUBuffer
  echoKindIdrr: GPUBuffer
  cmbBnmBffr: GPUBuffer

  // reusable per-job uniform/context buffer
  contextReuse: ReusableBuffer

  // reusable output/readback buffers
  candRs: ReusableBuffer
  candRdbcRs: ReusableBuffer
  comboRs: ReusableBuffer

  // reusable buffers for the optional gpu reduction pass
  reduceReuse: {
    output: ReusableBuffer
    params: ReusableBuffer
  }

  // cached bind group so it is only recreated when one of the bound buffers changes
  bindGroup: GPUBindGroup | null
  bindGroupBuffer: {
    context: GPUBuffer | null
    constraints: GPUBuffer | null
    candidates: GPUBuffer | null
    comboIndexMap: GPUBuffer | null
    comboRows: GPUBuffer | null
  }

  // tracks which locked-main mapping is currently uploaded to comboIndexMapBuffer
  actLockMaiok: number
}

// minimal payload slice needed after initialization
type TgtGpuRtPay = Pick<
    TargetGpuState,
    | 'context'
    | 'costs'
    | 'comboN'
    | 'comboK'
    | 'totalCombos'
    | 'comboIndexMap'
    | 'comboBinom'
    | 'lockMainReq'
    | 'lockMainCands'
>

// packed candidate rank layout:
// upper bits store which of the 5 combo positions is the chosen main echo,
// lower bits store the combinadic rank
const MAINPOSSHFT = 29
const MAINPOSMASK = 0x7
const RANK_MASK = 0x1FFFFFFF
const GPU_COMBO_BITS = 3
const BTCWGSIZE = 512

// context combo count is limited by the packed rank field width
const MAX_CTX_COMBOS = RANK_MASK + 1

// cached pipeline objects shared across target gpu runs
let cachedPipeline: GPUComputePipeline | null = null
let cachedLayout: GPUBindGroupLayout | null = null

// singleton target gpu state for the current initialized payload
let targetGpuState: TgtGpuSttcSt | null = null

// lazily compile and cache the target shader pipeline
async function getPipeline(device: GPUDevice): Promise<{ layout: GPUBindGroupLayout; pipeline: GPUComputePipeline }> {
  if (cachedPipeline && cachedLayout) {
    return { layout: cachedLayout, pipeline: cachedPipeline }
  }

  // layout must match the bindings declared in the target shader
  cachedLayout = await mkChckBindGr(device, 'optimizer-target-layout', [
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
    { binding: 11, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
  ])

  cachedPipeline = await mkChckCmptPp({
    device,
    label: 'optimizer-target-pipeline',
    layout: cachedLayout,
    code: tgtShdrCode,
  })

  return { layout: cachedLayout, pipeline: cachedPipeline }
}

// destroy one reusable buffer wrapper and reset it
function destroyBuffer(reuse: ReusableBuffer): void {
  reuse.buffer?.destroy()
  reuse.buffer = null
  reuse.size = 0
}

// destroy all current target gpu resources before reinitializing with another payload
function dstrTgtGpuSt(): void {
  if (!targetGpuState) {
    return
  }

  destroyBuffer(targetGpuState.contextReuse)
  destroyBuffer(targetGpuState.candRs)
  destroyBuffer(targetGpuState.candRdbcRs)
  destroyBuffer(targetGpuState.comboRs)
  destroyBuffer(targetGpuState.reduceReuse.output)
  destroyBuffer(targetGpuState.reduceReuse.params)

  targetGpuState.echoSttsBffr.destroy()
  targetGpuState.setCnstLutns.destroy()
  targetGpuState.echoSetsBffr.destroy()
  targetGpuState.comboMapBox.destroy()
  targetGpuState.echoCstsBffr.destroy()
  targetGpuState.mainEchoBuff.destroy()
  targetGpuState.statCstrsBsy.destroy()
  targetGpuState.echoKindIdrr.destroy()
  targetGpuState.cmbBnmBffr.destroy()

  targetGpuState = null
}

// local helper for creating storage buffers in this module
function makeStoreBuffer(device: GPUDevice, data: ArrayBuffer | ArrayBufferView<ArrayBufferLike>): GPUBuffer {
  const upload = toGpuPldView(data)
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
function mkNdxMapXcld(payload: TgtGpuRtPay, lockedMainIndex: number): Int32Array {
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
function mkJobCmbNdxn(payload: TgtGpuRtPay, lockedMainIndex: number): ComboIndex {
  // unlocked jobs can use the original indexing directly
  if (!payload.lockMainReq || lockedMainIndex < 0) {
    return {
      comboN: payload.comboN,
      comboK: payload.comboK,
      totalCombos: payload.totalCombos,
      indexMap: payload.comboIndexMap,
      binom: payload.comboBinom,
      lockedIndex: -1,
    }
  }

  const frstLckdMain = payload.lockMainCands[0] ?? -1

  // if this job matches the default locked-main mapping, reuse the original buffers
  if (lockedMainIndex === frstLckdMain) {
    return {
      comboN: payload.comboN,
      comboK: payload.comboK,
      totalCombos: payload.totalCombos,
      indexMap: payload.comboIndexMap,
      binom: payload.comboBinom,
      lockedIndex: lockedMainIndex,
    }
  }

  // otherwise derive an alternate candidate map that excludes the current locked main
  return {
    comboN: payload.comboN,
    comboK: payload.comboK,
    totalCombos: payload.totalCombos,
    indexMap: mkNdxMapXcld(payload, lockedMainIndex),
    binom: payload.comboBinom,
    lockedIndex: lockedMainIndex,
  }
}

// gpu readback returns unsorted candidates, so sort strongest-first before decoding
function sortCnddByDm(candidates: Array<{ damage: number; rank: number }>): void {
  candidates.sort((left, right) => right.damage - left.damage)
}

// create or reuse the bind group for the currently active job buffers
function getBindGroup(
    state: TgtGpuSttcSt,
    candidateBuffer: GPUBuffer,
    contextBuffer: GPUBuffer,
    statCstrsBff: GPUBuffer,
    comboBuffer: GPUBuffer,
): GPUBindGroup {
  const ndsRcrt =
      !state.bindGroup ||
      state.bindGroupBuffer.context !== contextBuffer ||
      state.bindGroupBuffer.constraints !== statCstrsBff ||
      state.bindGroupBuffer.candidates !== candidateBuffer ||
      state.bindGroupBuffer.comboIndexMap !== state.comboMapBox ||
      state.bindGroupBuffer.comboRows !== comboBuffer

  if (!ndsRcrt) {
    return state.bindGroup as GPUBindGroup
  }

  state.bindGroup = state.device.createBindGroup({
    label: 'optimizer-target-bind-group',
    layout: state.layout,
    entries: [
      // 0: encoded echo stat rows
      { binding: 0, resource: { buffer: state.echoSttsBffr } },

      // 1: set lookup table
      { binding: 1, resource: { buffer: state.setCnstLutns } },

      // 2: set id per echo
      { binding: 2, resource: { buffer: state.echoSetsBffr } },

      // 3: combo index map
      { binding: 3, resource: { buffer: state.comboMapBox } },

      // 4: per-job patched context
      { binding: 4, resource: { buffer: contextBuffer } },

      // 5: echo costs
      { binding: 5, resource: { buffer: state.echoCstsBffr } },

      // 6: main echo bonus rows
      { binding: 6, resource: { buffer: state.mainEchoBuff } },

      // 7: constraints uniform
      { binding: 7, resource: { buffer: statCstrsBff } },

      // 8: echo kind ids
      { binding: 8, resource: { buffer: state.echoKindIdrr } },

      // 9: output candidate buffer
      { binding: 9, resource: { buffer: candidateBuffer } },

      // 10: combinadic binomial table
      { binding: 10, resource: { buffer: state.cmbBnmBffr } },

      // 11: explicit combo rows for theory gpu batch mode
      { binding: 11, resource: { buffer: comboBuffer } },
    ],
  })

  state.bindGroupBuffer = {
    context: contextBuffer,
    constraints: statCstrsBff,
    candidates: candidateBuffer,
    comboIndexMap: state.comboMapBox,
    comboRows: comboBuffer,
  }

  return state.bindGroup
}

// state guard used by execution functions
function ensTgtGpuStt(): TgtGpuSttcSt {
  if (!targetGpuState) {
    throw new Error('Target GPU worker state has not been initialized')
  }

  return targetGpuState
}

// initialize persistent target-gpu resources for one static payload
export async function initTgtGpu(payload: TargetGpuState): Promise<void> {
  dstrTgtGpuSt()

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
      totalCombos: payload.totalCombos,
      comboIndexMap: payload.comboIndexMap,
      comboBinom: payload.comboBinom,
      lockMainReq: payload.lockMainReq,
      lockMainCands: payload.lockMainCands,
    },

    // static buffers uploaded once
    echoSttsBffr: makeStoreBuffer(device, payload.stats),
    setCnstLutns: makeStoreBuffer(device, payload.setConstLut),
    echoSetsBffr: makeStoreBuffer(device, payload.sets),
    comboMapBox: makeStoreBuffer(device, payload.comboIndexMap),

    // reused per-job context uniform
    contextReuse: { buffer: null, size: 0 },

    echoCstsBffr: makeStoreBuffer(device, payload.costs),
    mainEchoBuff: makeStoreBuffer(device, payload.mainEchoBuffs),

    // constraints live in a uniform buffer
    statCstrsBsy: (() => {
      const buffer = device.createBuffer({
        size: Math.max(16, payload.constraints.byteLength),
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      })

      if (payload.constraints.byteLength > 0) {
        device.queue.writeBuffer(buffer, 0, toGpuPldView(payload.constraints))
      }

      return buffer
    })(),

    echoKindIdrr: makeStoreBuffer(device, payload.kinds),
    cmbBnmBffr: makeStoreBuffer(device, payload.comboBinom),

    // reusable candidate output/readback
    candRs: { buffer: null, size: 0 },
    candRdbcRs: { buffer: null, size: 0 },
    comboRs: { buffer: null, size: 0 },

    // reusable reduction scratch
    reduceReuse: {
      output: { buffer: null, size: 0 },
      params: { buffer: null, size: 0 },
    },

    bindGroup: null,
    bindGroupBuffer: {
      context: null,
      constraints: null,
      candidates: null,
      comboIndexMap: null,
      comboRows: null,
    },

    // track which locked-main mapping the comboIndexMap buffer currently represents
    actLockMaiok: payload.lockMainReq
        ? (payload.lockMainCands[0] ?? -1)
        : -1,
  }
}

// run one target-gpu job, possibly split into multiple subjobs if comboCount exceeds
// what can be represented inside one packed context rank span
export async function runTgtGpuJob(
    job: TgtGpuJobPay,
    hooks: TgtGpuRunHks = {},
): Promise<OptTgtGpuRsl[]> {
  const state = ensTgtGpuStt()

  if (hooks.isCancelled?.() || job.comboCount <= 0) {
    return []
  }

  // collect results across all subjobs, then sort/limit at the end
  const vrllCllc = new OptResultSet(job.jobResultLimit)

  const comboIndex = mkJobCmbNdxn(state.payload, job.lockMainIdx)

  // if locked-main mode is active and this job uses a different locked echo than the
  // currently uploaded one, update the combo index map buffer first
  if (state.payload.lockMainReq && state.actLockMaiok !== job.lockMainIdx) {
    const nextIndexMap = job.lockMainIdx === (state.payload.lockMainCands[0] ?? -1)
        ? state.payload.comboIndexMap
        : mkNdxMapXcld(state.payload, job.lockMainIdx)

    state.device.queue.writeBuffer(state.comboMapBox, 0, toGpuPldView(nextIndexMap))
    state.actLockMaiok = job.lockMainIdx
  }

  const comboIds = new Int32Array(5)
  let remaining = job.comboCount
  let subJobStart = job.comboStart

  while (remaining > 0) {
    if (hooks.isCancelled?.()) {
      return vrllCllc.sorted(job.jobResultLimit)
    }

    // each subjob is capped so combo rank still fits in the packed gpu candidate format
    const subJobCount = Math.min(remaining, MAX_CTX_COMBOS)

    // patch the base context with this subjob's combo span and locked-main choice
    const ptchCtx = ptchTgtCtxFo({
      baseContext: state.payload.context,
      comboN: comboIndex.comboN,
      comboK: comboIndex.comboK,
      comboCount: subJobCount,
      comboBaseIndex: subJobStart,
      lockEchoIdx: job.lockMainIdx,
    })

    const contextBuffer = ensureGpuBuffer(
        state.device,
        state.contextReuse,
        ptchCtx.byteLength,
        GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    )

    // workgroup/candidate sizing for this subjob
    const callCnt = Math.ceil(subJobCount / CYCLES_PER_CALL)
    const wgCnt = Math.ceil(callCnt / OPT_WG_SIZE)
    const candCnt = wgCnt * OPT_RDC_K

    const candidateBuffer = ensureGpuBuffer(
        state.device,
        state.candRs,
        candCnt * GPU_CAND_STRIDE,
        GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    )

    const comboBuffer = ensureGpuBuffer(
        state.device,
        state.comboRs,
        4,
        GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    )

    const bindGroup = getBindGroup(state, candidateBuffer, contextBuffer, state.statCstrsBsy, comboBuffer)

    await dispCmptPass({
      device: state.device,
      pipeline: state.pipeline,
      bindGroup,
      wrkgCnt: wgCnt,
      bfrDsptBtch: (wgBase) => {
        ptchTgtCtxDi(ptchCtx, wgBase)
        state.device.queue.writeBuffer(contextBuffer, 0, toGpuPldView(ptchCtx))
      },
    })

    // reduce on gpu only when readback would exceed the candidate budget.
    // the search shader already emits local top-k winners per workgroup.
    const rdBkLmt = Math.max(OPT_RDC_K, job.jobResultLimit * OPT_RDC_K)
    const rdbcTgt = await runRdcPassIf({
      device: state.device,
      candidateBuffer: candidateBuffer,
      candCnt: candCnt,
      maxReadback: rdBkLmt,
      reduceK: OPT_RDC_K,
      reuse: state.reduceReuse,
    })

    // read candidates back to cpu
    const { results: candidates } = await readCandBffr(
        state.device,
        rdbcTgt.buffer,
        rdbcTgt.count,
        state.candRdbcRs,
    )

    if (hooks.isCancelled?.()) {
      return vrllCllc.sorted(job.jobResultLimit)
    }

    sortCnddByDm(candidates)

    // only unrank an oversampled prefix of the gpu candidates
    const subJobCandLm = Math.max(1, job.jobResultLimit * OPT_RDC_K)
    let pushed = 0

    for (const candidate of candidates) {
      const packedRank = candidate.rank >>> 0
      const mainPos = (packedRank >>> MAINPOSSHFT) & MAINPOSMASK
      const comboRank = packedRank & RANK_MASK

      // decode the combo back into concrete echo indices
      nrnkCmbnInto(comboRank + subJobStart, comboIndex, comboIds, comboIds.length)

      const mainIndex = comboIds[mainPos] ?? -1
      vrllCllc.pushRdrdCmb(candidate.damage, comboIds, mainIndex)

      pushed += 1
      if (pushed >= subJobCandLm) {
        break
      }
    }

    remaining -= subJobCount
    subJobStart += subJobCount
  }

  return vrllCllc.sorted(job.jobResultLimit)
}

// run one explicit combo batch on the target gpu evaluator.
// theory mode already prunes legal combos in its producer, so this path only
// changes the combo source from combinadic ranks to a transferred row buffer.
export async function runTgtGpuBtc(
    job: TgtGpuBtcPay,
    hooks: TgtGpuRunHks = {},
): Promise<OptTgtGpuRsl[]> {
  const state = ensTgtGpuStt()

  if (hooks.isCancelled?.() || job.comboCount <= 0) {
    return []
  }

  const ptchCtx = ptchTgtCtxFo({
    baseContext: state.payload.context,
    comboN: state.payload.comboN,
    comboK: 5,
    comboCount: job.comboCount,
    comboBaseIndex: 0,
    lockEchoIdx: job.lockMainIdx,
    comboMode: GPU_COMBO_BITS,
  })

  const contextBuffer = ensureGpuBuffer(
      state.device,
      state.contextReuse,
      ptchCtx.byteLength,
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  )

  const wgCnt = Math.ceil(job.comboCount / Math.max(1, BTCWGSIZE * CYCLES_PER_CALL))
  const candCnt = wgCnt * BTCWGSIZE
  if (candCnt <= 0) {
    return []
  }

  const candidateBuffer = ensureGpuBuffer(
      state.device,
      state.candRs,
      candCnt * GPU_CAND_STRIDE,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  )

  const comboBuffer = writeGpuBffr(
      state.device,
      state.comboRs,
      job.combosBatch,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  )

  const bindGroup = getBindGroup(state, candidateBuffer, contextBuffer, state.statCstrsBsy, comboBuffer)

  await dispCmptPass({
    device: state.device,
    pipeline: state.pipeline,
    bindGroup,
    wrkgCnt: wgCnt,
    bfrDsptBtch: (wgBase) => {
      ptchTgtCtxDi(ptchCtx, wgBase)
      state.device.queue.writeBuffer(contextBuffer, 0, toGpuPldView(ptchCtx))
    },
  })

  const rdBkLmt = Math.max(OPT_RDC_K, job.jobResultLimit * OPT_RDC_K)
  const rdbcTgt = await runRdcPassIf({
    device: state.device,
    candidateBuffer: candidateBuffer,
    candCnt: candCnt,
    maxReadback: rdBkLmt,
    reduceK: OPT_RDC_K,
    reuse: state.reduceReuse,
  })

  const { results: candidates } = await readCandBffr(
      state.device,
      rdbcTgt.buffer,
      rdbcTgt.count,
      state.candRdbcRs,
  )

  if (hooks.isCancelled?.()) {
    return []
  }

  sortCnddByDm(candidates)

  const collector = new OptResultSet(job.jobResultLimit)
  const comboIds = new Int32Array(5)
  const candLmt = Math.max(1, job.jobResultLimit * OPT_RDC_K)
  let pushed = 0

  for (const candidate of candidates) {
    const packedRank = candidate.rank >>> 0
    const mainPos = (packedRank >>> MAINPOSSHFT) & MAINPOSMASK
    const comboIndex = packedRank & RANK_MASK
    if (comboIndex >= job.comboCount) {
      continue
    }

    const base = comboIndex * 5
    comboIds[0] = job.combosBatch[base] ?? -1
    comboIds[1] = job.combosBatch[base + 1] ?? -1
    comboIds[2] = job.combosBatch[base + 2] ?? -1
    comboIds[3] = job.combosBatch[base + 3] ?? -1
    comboIds[4] = job.combosBatch[base + 4] ?? -1

    const mainIndex = comboIds[mainPos] ?? -1
    collector.pushRdrdCmb(candidate.damage, comboIds, mainIndex)

    pushed += 1
    if (pushed >= candLmt) {
      break
    }
  }

  return collector.sorted(job.jobResultLimit)
}
