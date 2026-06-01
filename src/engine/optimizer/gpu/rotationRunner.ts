/*
  Author: Runor Ewhro
  Description: manages rotation-mode gpu execution for the optimizer.
               this file initializes persistent gpu resources, builds
               per-job runtime buffers, dispatches the rotation shader,
               optionally reduces gpu candidates, decodes packed results,
               and converts them back into optimizer combo refs.
*/

import {
  makeStoreBuffer,
  ensureGpuBuffer,
  GPU_CAND_STRIDE,
  readCandBffr,
  toGpuPldView,
  writeGpuBffr,
  type ReusableBuffer,
} from '@/engine/optimizer/gpu/common.ts'
import { getRotGpuPpl } from '@/engine/optimizer/gpu/rotationPipeline.ts'
import { runRdcPassIf } from '@/engine/optimizer/gpu/reduce.ts'
import { dispCmptPass } from '@/engine/optimizer/gpu/dispatch.ts'
import { getGpuDevice } from '@/engine/optimizer/gpu/getDevice.ts'
import {
  ptchTgtCtxDi,
  ptchTgtCtxFo,
} from '@/engine/optimizer/context/pack.ts'
import {
  CTX_FLOATS,
  ROT_CYCLES,
  ROT_REDUCE_K,
} from '@/engine/optimizer/config/constants.ts'
import type { ComboIndex } from '@/engine/optimizer/combos/combinadic.ts'
import { nrnkCmbnInto } from '@/engine/optimizer/combos/combinadic.ts'
import { OptResultSet } from '@/engine/optimizer/results/collector.ts'
import type {
  OptBagResult,
  PckdRotXctnP,
} from '@/engine/optimizer/types.ts'

interface RotGpuJobPay {
  // absolute combo start index for this job inside the global search space
  comboStart: number

  // number of combos this job is responsible for processing
  comboCount: number

  // fixed main echo index for locked-main mode, or -1 when unlocked
  lockMainIdx: number

  // maximum number of final results this job should keep
  jobResultLimit: number
}

interface RotGpuBtcPay {
  combosBatch: Int32Array
  comboCount: number
  lockMainIdx: number
  jobResultLimit: number
}

interface RotGpuRunHks {
  // cancellation hook checked before and after major gpu stages
  isCancelled?: () => boolean
}

interface RotGpuSttcSt {
  // core gpu objects
  device: GPUDevice
  layout: GPUBindGroupLayout
  pipeline: GPUComputePipeline

  // original packed execution payload used to initialize this state
  execution: PckdRotXctnP

  // static buffers uploaded once per initialization
  statsBuffer: GPUBuffer
  setCnstLutns: GPUBuffer
  setsBuffer: GPUBuffer
  comboMapBox: GPUBuffer
  echoCstsBffr: GPUBuffer
  mainEchoBuff: GPUBuffer
  cstrsBffr: GPUBuffer
  kindBuffer: GPUBuffer
  cmbBnmBffr: GPUBuffer
  rotCntxBffr: GPUBuffer
  rotMetaBffr: GPUBuffer

  // reusable per-job buffers
  paramsReuse: ReusableBuffer
  candRs: ReusableBuffer
  candRdbcRs: ReusableBuffer
  comboRs: ReusableBuffer

  // reusable buffers for the optional reduction pass
  reduceReuse: {
    output: ReusableBuffer
    params: ReusableBuffer
  }

  // cached bind group so we only recreate it when candidate/params buffers change
  bindGroup: GPUBindGroup | null
  bindGroupBuffer: {
    candidates: GPUBuffer | null
    params: GPUBuffer | null
    indexMap: GPUBuffer | null
  }

  // tracks which locked main index the uploaded combo index map currently matches
  actLockMaiok: number
}

// minimal slice of the execution payload needed to rebuild per-job combinadic state
type RotGpuRtPay = Pick<
    PckdRotXctnP,
    | 'costs'
    | 'comboN'
    | 'comboK'
    | 'totalCombos'
    | 'comboIndexMap'
    | 'comboBinom'
    | 'lockMainReq'
    | 'lockMainCands'
>

// singleton worker-side state for rotation gpu execution
let rotGpuState: RotGpuSttcSt | null = null
const GPU_COMBO_BITS = 3
const BTCWGSIZE = 512

// destroy one reusable buffer wrapper and reset it to an empty state
function destroyBuffer(reuse: ReusableBuffer): void {
  reuse.buffer?.destroy()
  reuse.buffer = null
  reuse.size = 0
}

// fully destroy all persistent rotation gpu resources
// release the current payload buffers before loading the next gpu state
function dstrRotGpuSt(): void {
  if (!rotGpuState) {
    return
  }

  destroyBuffer(rotGpuState.paramsReuse)
  destroyBuffer(rotGpuState.candRs)
  destroyBuffer(rotGpuState.candRdbcRs)
  destroyBuffer(rotGpuState.comboRs)
  destroyBuffer(rotGpuState.reduceReuse.output)
  destroyBuffer(rotGpuState.reduceReuse.params)

  rotGpuState.statsBuffer.destroy()
  rotGpuState.setCnstLutns.destroy()
  rotGpuState.setsBuffer.destroy()
  rotGpuState.comboMapBox.destroy()
  rotGpuState.echoCstsBffr.destroy()
  rotGpuState.mainEchoBuff.destroy()
  rotGpuState.cstrsBffr.destroy()
  rotGpuState.kindBuffer.destroy()
  rotGpuState.cmbBnmBffr.destroy()
  rotGpuState.rotCntxBffr.destroy()
  rotGpuState.rotMetaBffr.destroy()

  rotGpuState = null
}

// build a combo index map that excludes one locked main echo from the selectable pool
// this is needed for locked-main jobs when the requested locked echo is not the default one
function mkNdxMapXcld(payload: RotGpuRtPay, lockedMainIndex: number): Int32Array {
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
function mkJobCmbNdxn(payload: RotGpuRtPay, lockedMainIndex: number): ComboIndex {
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

  // if this job uses the same locked main index as the base payload,
  // we can reuse the original index map as-is
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

  // otherwise rebuild the effective candidate map for this locked echo
  return {
    comboN: payload.comboN,
    comboK: payload.comboK,
    totalCombos: payload.totalCombos,
    indexMap: mkNdxMapXcld(payload, lockedMainIndex),
    binom: payload.comboBinom,
    lockedIndex: lockedMainIndex,
  }
}

// helper: convert compact uint8 data into float32 for shader storage buffers
// some gpu paths prefer all numeric payloads in float buffers
function toGpuFltRry(values: Uint8Array): Float32Array {
  const out = new Float32Array(values.length)
  for (let index = 0; index < values.length; index += 1) {
    out[index] = values[index] ?? 0
  }
  return out
}

// helper: convert uint16 ids into int32 values for shader consumption
function toGpuIntRry(values: Uint16Array): Int32Array {
  const out = new Int32Array(values.length)
  for (let index = 0; index < values.length; index += 1) {
    out[index] = values[index] ?? 0
  }
  return out
}

// candidates are read back unsorted, so sort strongest-first before decoding them into combos
function sortCnddByDm(candidates: Array<{ damage: number; rank: number; mainPos: number }>): void {
  candidates.sort((left, right) => right.damage - left.damage)
}

// state guard used by runtime job execution functions
function ensRotGpuStt(): RotGpuSttcSt {
  if (!rotGpuState) {
    throw new Error('Rotation GPU worker state has not been initialized')
  }

  return rotGpuState
}

// constraints are used as uniforms, so keep them in a uniform-compatible buffer
function mkCstrsBffr(device: GPUDevice, constraints: Float32Array): GPUBuffer {
  const buffer = device.createBuffer({
    size: Math.max(16, constraints.byteLength),
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })

  if (constraints.byteLength > 0) {
    device.queue.writeBuffer(buffer, 0, toGpuPldView(constraints))
  }

  return buffer
}

// create or reuse the bind group for the current candidate and params buffers
// everything else is static per initialization and stays bound to persistent buffers
function getBindGroup(
    state: RotGpuSttcSt,
    candidateBuffer: GPUBuffer,
    paramsBuffer: GPUBuffer,
    indexMapBffr: GPUBuffer,
): GPUBindGroup {
  const ndsRcrt =
      !state.bindGroup ||
      state.bindGroupBuffer.candidates !== candidateBuffer ||
      state.bindGroupBuffer.params !== paramsBuffer ||
      state.bindGroupBuffer.indexMap !== indexMapBffr

  if (!ndsRcrt) {
    return state.bindGroup as GPUBindGroup
  }

  state.bindGroup = state.device.createBindGroup({
    label: 'optimizer-rotation-bind-group',
    layout: state.layout,
    entries: [
      // 0: encoded echo stat rows
      { binding: 0, resource: { buffer: state.statsBuffer } },

      // 1: set lookup table
      { binding: 1, resource: { buffer: state.setCnstLutns } },

      // 2: set ids per echo
      { binding: 2, resource: { buffer: state.setsBuffer } },

      // 3: combo index map, or explicit theory rows in batch mode
      { binding: 3, resource: { buffer: indexMapBffr } },

      // 4: per-job params / patched context
      { binding: 4, resource: { buffer: paramsBuffer } },

      // 5: echo costs
      { binding: 5, resource: { buffer: state.echoCstsBffr } },

      // 6: main echo bonus rows
      { binding: 6, resource: { buffer: state.mainEchoBuff } },

      // 7: constraints uniform
      { binding: 7, resource: { buffer: state.cstrsBffr } },

      // 8: kind ids
      { binding: 8, resource: { buffer: state.kindBuffer } },

      // 9: output candidate buffer
      { binding: 9, resource: { buffer: candidateBuffer } },

      // 10: binomial table
      { binding: 10, resource: { buffer: state.cmbBnmBffr } },

      // 11: packed rotation contexts + weights
      { binding: 11, resource: { buffer: state.rotCntxBffr } },

      // 12: small metadata uniform for context count / stride
      { binding: 12, resource: { buffer: state.rotMetaBffr } },
    ],
  })

  state.bindGroupBuffer = {
    candidates: candidateBuffer,
    params: paramsBuffer,
    indexMap: indexMapBffr,
  }

  return state.bindGroup
}

// shader binding count is tight, so contexts and weights are packed into one buffer:
// [all contexts..., all weights...]
function mkRotCtxBffr(payload: PckdRotXctnP): Float32Array {
  const merged = new Float32Array(payload.contexts.length + payload.contextWeight.length)
  merged.set(payload.contexts, 0)
  merged.set(payload.contextWeight, payload.contexts.length)
  return merged
}

// initialize all static gpu state for one packed rotation execution payload
// any previous state is destroyed first
export async function initRotGpu(payload: PckdRotXctnP): Promise<void> {
  dstrRotGpuSt()

  const device = await getGpuDevice()
  const { layout, pipeline } = await getRotGpuPpl(device)

  rotGpuState = {
    device,
    layout,
    pipeline,
    execution: payload,

    // upload all mostly-static buffers once
    statsBuffer: makeStoreBuffer(device, payload.stats),
    setCnstLutns: makeStoreBuffer(device, payload.setConstLut),
    setsBuffer: makeStoreBuffer(device, toGpuFltRry(payload.sets)),
    comboMapBox: makeStoreBuffer(device, payload.comboIndexMap),
    echoCstsBffr: makeStoreBuffer(device, toGpuFltRry(payload.costs)),
    mainEchoBuff: makeStoreBuffer(device, payload.mainEchoBuffs),
    cstrsBffr: mkCstrsBffr(device, payload.constraints),
    kindBuffer: makeStoreBuffer(device, toGpuIntRry(payload.kinds)),
    cmbBnmBffr: makeStoreBuffer(device, payload.comboBinom),
    rotCntxBffr: makeStoreBuffer(device, mkRotCtxBffr(payload)),

    // tiny uniform used by the shader for context layout metadata
    rotMetaBffr: device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    }),

    // reusable runtime buffers
    paramsReuse: { buffer: null, size: 0 },
    candRs: { buffer: null, size: 0 },
    candRdbcRs: { buffer: null, size: 0 },
    comboRs: { buffer: null, size: 0 },

    // reduction scratch
    reduceReuse: {
      output: { buffer: null, size: 0 },
      params: { buffer: null, size: 0 },
    },

    bindGroup: null,
    bindGroupBuffer: {
      candidates: null,
      params: null,
      indexMap: null,
    },

    // if locked-main mode is enabled, assume first candidate index is the current uploaded mapping
    actLockMaiok: payload.lockMainReq
        ? (payload.lockMainCands[0] ?? -1)
        : -1,
  }

  // metadata layout:
  // [contextCount, contextStride, reserved0, reserved1]
  device.queue.writeBuffer(
      rotGpuState.rotMetaBffr,
      0,
      new Uint32Array([payload.contextCount, payload.contextStride, 0, 0]),
  )
}

// build the uniform payload for one rotation gpu job
// this reuses the existing context patcher to keep packing behavior consistent
function mkRotJobPrms(options: {
  comboN: number
  comboK: number
  comboCount: number
  comboBaseIndex: number
  lockEchoIdx: number
  comboMode?: number
}): Float32Array {
  return ptchTgtCtxFo({
    baseContext: new Float32Array(CTX_FLOATS),
    comboN: options.comboN,
    comboK: options.comboK,
    comboCount: options.comboCount,
    comboBaseIndex: options.comboBaseIndex,
    lockEchoIdx: options.lockEchoIdx,
    comboMode: options.comboMode,
  })
}

// decode packed candidate rank field:
// lower 29 bits -> combo rank
// upper 3 bits -> position of the chosen main echo within the decoded combo
function dcdPckdCndd(
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
export async function runRotGpuJob(
    job: RotGpuJobPay,
    hooks: RotGpuRunHks = {},
): Promise<OptBagResult[]> {
  const state = ensRotGpuStt()

  // bail out early for cancellation, empty work, or empty rotation context sets
  if (hooks.isCancelled?.() || job.comboCount <= 0 || state.execution.contextCount <= 0) {
    return []
  }

  const execution = state.execution
  const comboIndex = mkJobCmbNdxn(execution, job.lockMainIdx)

  // in locked-main mode, the combo index map may need to be rewritten if this job uses
  // a different locked main than the one currently uploaded to the gpu
  if (execution.lockMainReq && state.actLockMaiok !== job.lockMainIdx) {
    const nextIndexMap = job.lockMainIdx === (execution.lockMainCands[0] ?? -1)
        ? execution.comboIndexMap
        : mkNdxMapXcld(execution, job.lockMainIdx)

    state.device.queue.writeBuffer(state.comboMapBox, 0, toGpuPldView(nextIndexMap))
    state.actLockMaiok = job.lockMainIdx
  }

  // compute how many workgroups are needed for this combo span
  // each invocation processes OPTIMIZER_ROTATION_CYCLES_PER_INVOCATION combos
  const wgCnt = Math.ceil(job.comboCount / Math.max(1, BTCWGSIZE * ROT_CYCLES))

  // the shader emits OPTIMIZER_ROTATION_REDUCE_K candidates per workgroup
  const candCnt = wgCnt * ROT_REDUCE_K
  if (candCnt <= 0) {
    return []
  }

  // allocate/reuse candidate output buffer
  const candidateBuffer = ensureGpuBuffer(
      state.device,
      state.candRs,
      candCnt * GPU_CAND_STRIDE,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  )

  // build and upload per-job params
  const params = mkRotJobPrms({
    comboN: comboIndex.comboN,
    comboK: comboIndex.comboK,
    comboCount: job.comboCount,
    comboBaseIndex: job.comboStart,
    lockEchoIdx: job.lockMainIdx,
  })

  const paramsBuffer = ensureGpuBuffer(
      state.device,
      state.paramsReuse,
      params.byteLength,
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  )
  state.device.queue.writeBuffer(paramsBuffer, 0, toGpuPldView(params))

  // get/create bind group for these exact runtime buffers
  const bindGroup = getBindGroup(state, candidateBuffer, paramsBuffer, state.comboMapBox)

  // dispatch the rotation shader
  await dispCmptPass({
    device: state.device,
    pipeline: state.pipeline,
    bindGroup,
    wrkgCnt: wgCnt,
    bfrDsptBtch: (wgBase) => {
      ptchTgtCtxDi(params, wgBase)
      state.device.queue.writeBuffer(paramsBuffer, 0, toGpuPldView(params))
    },
  })

  // reduce only when the raw candidates exceed the requested readback budget.
  // the rotation shader already emits local top-k winners per workgroup.
  const rdBkLmt = Math.max(ROT_REDUCE_K, job.jobResultLimit * ROT_REDUCE_K)
  const rdbcTgt = await runRdcPassIf({
    device: state.device,
    candidateBuffer: candidateBuffer,
    candCnt: candCnt,
    maxReadback: rdBkLmt,
    reduceK: ROT_REDUCE_K,
    reuse: state.reduceReuse,
  })

  // read back reduced or original candidates from gpu memory
  const { results } = await readCandBffr(
      state.device,
      rdbcTgt.buffer,
      rdbcTgt.count,
      state.candRdbcRs,
  )

  if (hooks.isCancelled?.()) {
    return []
  }

  // unpack rank/mainPos fields, then sort strongest-first
  const dcddCndd = dcdPckdCndd(results)
  sortCnddByDm(dcddCndd)

  // collect final bag results in the same structure used by cpu paths
  const collector = new OptResultSet(job.jobResultLimit)
  const comboIds = new Int32Array(5)

  // oversample the number of decoded candidates we push through unranking,
  // because many may collapse/dedup before final sorting
  const candLmt = Math.max(1, job.jobResultLimit * ROT_REDUCE_K)
  let pushed = 0

  for (const candidate of dcddCndd) {
    // rebuild the full combo from its combinadic rank
    nrnkCmbnInto(candidate.rank + job.comboStart, comboIndex, comboIds, comboIds.length)

    // mainPos points to one of the 5 slots inside comboIds
    const mainIndex = comboIds[candidate.mainPos] ?? -1
    if (mainIndex < 0) {
      continue
    }

    collector.pushRdrdCmb(candidate.damage, comboIds, mainIndex)
    pushed += 1

    if (pushed >= candLmt) {
      break
    }
  }

  return collector.sorted(job.jobResultLimit)
}

// run one explicit combo batch through the rotation gpu evaluator.
// theory mode owns combo discovery, so this path only uploads the generated
// row buffer and lets the shared shader score each row set.
export async function runRotGpuBtc(
    job: RotGpuBtcPay,
    hooks: RotGpuRunHks = {},
): Promise<OptBagResult[]> {
  const state = ensRotGpuStt()

  if (hooks.isCancelled?.() || job.comboCount <= 0 || state.execution.contextCount <= 0) {
    return []
  }

  const wgCnt = Math.ceil(job.comboCount / Math.max(1, BTCWGSIZE * ROT_CYCLES))
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

  const params = mkRotJobPrms({
    comboN: state.execution.comboN,
    comboK: 5,
    comboCount: job.comboCount,
    comboBaseIndex: 0,
    lockEchoIdx: job.lockMainIdx,
    comboMode: GPU_COMBO_BITS,
  })

  const paramsBuffer = ensureGpuBuffer(
      state.device,
      state.paramsReuse,
      params.byteLength,
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  )
  state.device.queue.writeBuffer(paramsBuffer, 0, toGpuPldView(params))

  const comboBuffer = writeGpuBffr(
      state.device,
      state.comboRs,
      job.combosBatch,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  )

  const bindGroup = getBindGroup(state, candidateBuffer, paramsBuffer, comboBuffer)

  await dispCmptPass({
    device: state.device,
    pipeline: state.pipeline,
    bindGroup,
    wrkgCnt: wgCnt,
    bfrDsptBtch: (wgBase) => {
      ptchTgtCtxDi(params, wgBase)
      state.device.queue.writeBuffer(paramsBuffer, 0, toGpuPldView(params))
    },
  })

  const rdBkLmt = Math.max(ROT_REDUCE_K, job.jobResultLimit * ROT_REDUCE_K)
  const rdbcTgt = await runRdcPassIf({
    device: state.device,
    candidateBuffer: candidateBuffer,
    candCnt: candCnt,
    maxReadback: rdBkLmt,
    reduceK: ROT_REDUCE_K,
    reuse: state.reduceReuse,
  })

  const { results } = await readCandBffr(
      state.device,
      rdbcTgt.buffer,
      rdbcTgt.count,
      state.candRdbcRs,
  )

  if (hooks.isCancelled?.()) {
    return []
  }

  const dcddCndd = dcdPckdCndd(results)
  sortCnddByDm(dcddCndd)

  const collector = new OptResultSet(job.jobResultLimit)
  const comboIds = new Int32Array(5)
  const candLmt = Math.max(1, job.jobResultLimit * ROT_REDUCE_K)
  let pushed = 0

  for (const candidate of dcddCndd) {
    if (candidate.rank >= job.comboCount) {
      continue
    }

    const base = candidate.rank * 5
    comboIds[0] = job.combosBatch[base] ?? -1
    comboIds[1] = job.combosBatch[base + 1] ?? -1
    comboIds[2] = job.combosBatch[base + 2] ?? -1
    comboIds[3] = job.combosBatch[base + 3] ?? -1
    comboIds[4] = job.combosBatch[base + 4] ?? -1

    const mainIndex = comboIds[candidate.mainPos] ?? -1
    collector.pushRdrdCmb(candidate.damage, comboIds, mainIndex)
    pushed += 1

    if (pushed >= candLmt) {
      break
    }
  }

  return collector.sorted(job.jobResultLimit)
}
