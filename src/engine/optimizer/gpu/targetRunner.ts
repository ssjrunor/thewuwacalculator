/*
  Author: Runor Ewhro
  Description: manages target-skill gpu execution for the optimizer.
               this file initializes persistent gpu resources, runs one or
               more target-search gpu subjobs, optionally reduces candidate
               buffers, and decodes packed gpu output back into combo refs.
*/

import tgtShdrCode from '@/engine/optimizer/shaders/target.wgsl?raw'
import wpnShdrCode from '@/engine/optimizer/shaders/weaponSearch.wgsl?raw'
import {
  mkChckBindGr,
  mkChckCmptPp,
  ensureGpuBuffer,
  GPU_CAND_STRIDE,
  readCandBffr,
  sortCnddByDm,
  toGpuPldView,
  writeGpuBffr,
  type ReusableBuffer,
} from '@/engine/optimizer/gpu/common.ts'
import { mkNdxMapXcld, mkJobCmbNdxn } from '@/engine/optimizer/combos/jobIndex.ts'
import { dispCmptPass } from '@/engine/optimizer/gpu/dispatch.ts'
import { runRdcPassIf } from '@/engine/optimizer/gpu/reduce.ts'
import { getGpuDevice } from '@/engine/optimizer/gpu/getDevice.ts'
import {
  CYCLES_PER_CALL,
  GPU_BATCH_MAX_READBACK,
  GPU_COMBO_MODE_BATCH,
  GPU_REDUCE_K,
  OPT_WG_SIZE,
  WEAPON_BIT_MASK,
  WEAPON_RANK_MASK,
  WEAPON_INDEX_SHIFT,
  WEAPON_OVERLAY_STRIDE,
} from '@/engine/optimizer/config/constants.ts'
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

  // weapon search state (only set when the static payload carries overlays).
  // weaponMode swaps in the weapon pipeline + a 14-binding bind group that adds
  // the overlay storage buffer and the weapon-meta uniform.
  weaponMode: boolean
  weaponCount: number
  weaponOverlayBuf: GPUBuffer | null
  weaponMetaBuf: GPUBuffer | null
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
const BTCWGSIZE = 512

// context combo count is limited by the packed rank field width
const MAX_CTX_COMBOS = RANK_MASK + 1

// cached pipeline objects shared across target gpu runs
let cachedPipeline: GPUComputePipeline | null = null
let cachedLayout: GPUBindGroupLayout | null = null

// cached weapon-search pipeline + its 14-binding layout
let cachedWpnPipeline: GPUComputePipeline | null = null
let cachedWpnLayout: GPUBindGroupLayout | null = null

// theory (explicit-batch) pipeline variants: one combo per thread instead of
// CYCLES_PER_CALL. theory emits combos in damage-clustered producer order, so
// the default mini-batch reduction (best of 32 contiguous combos per thread)
// silently drops most of a cluster's top builds before they ever reach the
// collector; one combo per thread surfaces every combo as its own candidate,
// matching the cpu path. inventory keeps CYCLES_PER_CALL (its combo space is
// far larger and its combinadic order is not damage-clustered).
const BATCH_CYCLES = 1
let cachedBatchPipeline: GPUComputePipeline | null = null
let cachedWpnBatchPipeline: GPUComputePipeline | null = null

// the batch pipeline matching the active mode (weapon or plain), reusing the
// same bind-group layout as the default-cycle pipeline.
async function getBatchPipeline(
    device: GPUDevice,
    weaponMode: boolean,
): Promise<GPUComputePipeline> {
  if (weaponMode) {
    if (!cachedWpnBatchPipeline) {
      const { layout } = await getWeaponPipeline(device)
      cachedWpnBatchPipeline = await mkChckCmptPp({
        device,
        label: 'optimizer-weapon-pipeline-batch',
        layout,
        code: wpnShdrCode,
        constants: { CYCLES_PER_INVOCATION: BATCH_CYCLES },
      })
    }
    return cachedWpnBatchPipeline
  }
  if (!cachedBatchPipeline) {
    const { layout } = await getPipeline(device)
    cachedBatchPipeline = await mkChckCmptPp({
      device,
      label: 'optimizer-target-pipeline-batch',
      layout,
      code: tgtShdrCode,
      constants: { CYCLES_PER_INVOCATION: BATCH_CYCLES },
    })
  }
  return cachedBatchPipeline
}

// lazily compile and cache the weapon-search shader pipeline. its layout is the
// target layout plus bindings 12 (weapon meta uniform) and 13 (overlays).
async function getWeaponPipeline(device: GPUDevice): Promise<{ layout: GPUBindGroupLayout; pipeline: GPUComputePipeline }> {
  if (cachedWpnPipeline && cachedWpnLayout) {
    return { layout: cachedWpnLayout, pipeline: cachedWpnPipeline }
  }

  cachedWpnLayout = await mkChckBindGr(device, 'optimizer-weapon-layout', [
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
    { binding: 12, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
    // weapon overlays are a uniform (not storage) so the layout stays within the
    // 10 storage-buffer per-stage limit.
    { binding: 13, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
  ])

  cachedWpnPipeline = await mkChckCmptPp({
    device,
    label: 'optimizer-weapon-pipeline',
    layout: cachedWpnLayout,
    code: wpnShdrCode,
  })

  return { layout: cachedWpnLayout, pipeline: cachedWpnPipeline }
}

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
  targetGpuState.weaponOverlayBuf?.destroy()
  targetGpuState.weaponMetaBuf?.destroy()

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

  const entries: GPUBindGroupEntry[] = [
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
  ]

  // weapon mode adds the meta uniform (12) and overlay storage (13)
  if (state.weaponMode && state.weaponMetaBuf && state.weaponOverlayBuf) {
    entries.push(
        { binding: 12, resource: { buffer: state.weaponMetaBuf } },
        { binding: 13, resource: { buffer: state.weaponOverlayBuf } },
    )
  }

  state.bindGroup = state.device.createBindGroup({
    label: state.weaponMode ? 'optimizer-weapon-bind-group' : 'optimizer-target-bind-group',
    layout: state.layout,
    entries,
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

  // weapon search swaps in the weapon pipeline + overlay/meta buffers when the
  // static payload carries overlays; otherwise the plain target pipeline runs.
  const weaponCount = payload.weaponOverlays && (payload.weaponCount ?? 0) > 0
      ? (payload.weaponCount ?? 0)
      : 0
  const weaponMode = weaponCount > 0
  const { layout, pipeline } = weaponMode
      ? await getWeaponPipeline(device)
      : await getPipeline(device)

  // weapon overlays live in a fixed-size uniform buffer (128 vec4s == 32 weapons
  // x 16 floats == 2048 bytes), matching the shader's array<vec4<f32>, 128>.
  const weaponOverlayBuf = weaponMode && payload.weaponOverlays
      ? (() => {
        const buffer = device.createBuffer({
          size: 128 * 16,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        })
        device.queue.writeBuffer(buffer, 0, toGpuPldView(payload.weaponOverlays))
        return buffer
      })()
      : null
  const weaponMetaBuf = weaponMode
      ? (() => {
        const buffer = device.createBuffer({
          size: 16,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        })
        device.queue.writeBuffer(buffer, 0, new Uint32Array([weaponCount, WEAPON_OVERLAY_STRIDE, 0, 0]))
        return buffer
      })()
      : null

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

    weaponMode,
    weaponCount,
    weaponOverlayBuf,
    weaponMetaBuf,
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
    const candCnt = wgCnt * GPU_REDUCE_K

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

    // read all per-workgroup candidates back (up to the cap) and let the cpu
    // collector select the exact top-k. the gpu reduce pass only runs when the
    // candidate count exceeds the cap.
    const rdBkLmt = Math.max(GPU_REDUCE_K, Math.min(GPU_BATCH_MAX_READBACK, candCnt))
    const rdbcTgt = await runRdcPassIf({
      device: state.device,
      candidateBuffer: candidateBuffer,
      candCnt: candCnt,
      maxReadback: rdBkLmt,
      reduceK: GPU_REDUCE_K,
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
    const subJobCandLm = Math.max(1, job.jobResultLimit * GPU_REDUCE_K)
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
    comboMode: GPU_COMBO_MODE_BATCH,
  })

  const contextBuffer = ensureGpuBuffer(
      state.device,
      state.contextReuse,
      ptchCtx.byteLength,
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  )

  // theory runs one combo per thread (BATCH_CYCLES), so dispatch enough threads
  // to cover every combo and emit one candidate each. this must match the
  // CYCLES_PER_INVOCATION override compiled into the batch pipeline below.
  const batchPipeline = await getBatchPipeline(state.device, state.weaponMode)
  const wgCnt = Math.ceil(job.comboCount / Math.max(1, BTCWGSIZE * BATCH_CYCLES))
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
    pipeline: batchPipeline,
    bindGroup,
    wrkgCnt: wgCnt,
    bfrDsptBtch: (wgBase) => {
      ptchTgtCtxDi(ptchCtx, wgBase)
      state.device.queue.writeBuffer(contextBuffer, 0, toGpuPldView(ptchCtx))
    },
  })

  // with one combo per thread, every combo is its own candidate; read them all
  // back (up to the cap) so the cpu collector, not the lossy gpu reduction,
  // selects the top-k. only fall back to reduction for runs whose candidate
  // count exceeds the cap.
  const rdBkLmt = Math.max(GPU_REDUCE_K, Math.min(GPU_BATCH_MAX_READBACK, candCnt))
  const rdbcTgt = await runRdcPassIf({
    device: state.device,
    candidateBuffer: candidateBuffer,
    candCnt: candCnt,
    maxReadback: rdBkLmt,
    reduceK: GPU_REDUCE_K,
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
  const candLmt = Math.max(1, job.jobResultLimit * GPU_REDUCE_K)
  let pushed = 0

  for (const candidate of candidates) {
    const packedRank = candidate.rank >>> 0
    // weapon mode packs the weapon index in the high bits and pins the main at
    // slot 0; the plain path packs the main position in the top 3 bits.
    const mainPos = state.weaponMode ? 0 : ((packedRank >>> MAINPOSSHFT) & MAINPOSMASK)
    const weapon = state.weaponMode ? ((packedRank >>> WEAPON_INDEX_SHIFT) & WEAPON_BIT_MASK) : -1
    const comboIndex = state.weaponMode ? (packedRank & WEAPON_RANK_MASK) : (packedRank & RANK_MASK)
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
    collector.pushRdrdCmb(candidate.damage, comboIds, mainIndex, weapon)

    pushed += 1
    if (pushed >= candLmt) {
      break
    }
  }

  return collector.sorted(job.jobResultLimit)
}
