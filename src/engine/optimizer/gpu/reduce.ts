/*
  Author: Runor Ewhro
  Description: runs an optional gpu-side candidate reduction pass.
               if the raw candidate count is already small enough, it
               returns the original buffer unchanged. otherwise it launches
               a compute shader that reduces candidates in workgroup-sized
               chunks into a smaller output buffer.
*/

import rdcShdrCode from '@/engine/optimizer/shaders/reduceCandidates.wgsl?raw'
import {
  mkChckBindGr,
  mkChckCmptPp,
  ensureGpuBuffer,
  writeGpuBffr,
  type ReusableBuffer,
} from '@/engine/optimizer/gpu/common.ts'

// must stay aligned with the workgroup size expected by reduceCandidates.wgsl
const RDC_WG_SIZE = 256

interface RdcRsblBffr {
  // destination buffer reused across reduction calls
  output: ReusableBuffer

  // small uniform buffer reused for reduction params
  params: ReusableBuffer
}

// cached pipeline objects so shader compilation/layout creation only happens once
let cachedPipeline: GPUComputePipeline | null = null
let cachedLayout: GPUBindGroupLayout | null = null

// cached bind group so we only recreate it when one of its bound buffers changes
let cchdBindGrp: GPUBindGroup | null = null
let cchdBindGrpB: {
  input: GPUBuffer | null
  output: GPUBuffer | null
  params: GPUBuffer | null
} = {
  input: null,
  output: null,
  params: null,
}

// lazily create the reduction pipeline and its bind group layout
async function getRdcPpln(device: GPUDevice): Promise<{
  layout: GPUBindGroupLayout
  pipeline: GPUComputePipeline
}> {
  // fast path: reuse previously created gpu objects
  if (cachedPipeline && cachedLayout) {
    return { layout: cachedLayout, pipeline: cachedPipeline }
  }

  // layout must match the shader bindings in reduceCandidates.wgsl:
  // 0 -> input candidates
  // 1 -> reduced output candidates
  // 2 -> uniform params
  cachedLayout = await mkChckBindGr(device, 'optimizer-reduce-layout', [
    { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
    { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
    { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
  ])

  // compile the compute pipeline with validation + shader error checking
  cachedPipeline = await mkChckCmptPp({
    device,
    label: 'optimizer-reduce-pipeline',
    layout: cachedLayout,
    code: rdcShdrCode,
    entryPoint: 'reduceCandidates',
  })

  return { layout: cachedLayout, pipeline: cachedPipeline }
}

export async function runRdcPassIf(options: {
  device: GPUDevice
  candidateBuffer: GPUBuffer
  candCnt: number
  maxReadback?: number
  reduceK: number
  reuse: RdcRsblBffr
}): Promise<{ buffer: GPUBuffer; count: number }> {
  const {
    device,
    candidateBuffer: cnddBffr,
    candCnt: cnddCnt,
    maxReadback,
    reduceK,
    reuse,
  } = options

  // keep the raw candidate list when it is already within the caller's
  // readback budget. the main optimizer shaders have already emitted local
  // top-k candidates, so reducing again too early can starve large result caps.
  const rdBkLmt = Math.max(reduceK, Math.floor(maxReadback ?? reduceK))
  if (cnddCnt <= rdBkLmt) {
    return { buffer: cnddBffr, count: cnddCnt }
  }

  const { layout, pipeline } = await getRdcPpln(device)

  // each workgroup reduces one chunk of REDUCE_WORKGROUP_SIZE candidates
  const reduceGroups = Math.ceil(cnddCnt / RDC_WG_SIZE)

  // each group emits up to reduceK reduced candidates, so total reduced count is:
  const reduceCount = reduceGroups * reduceK

  // each candidate entry is 8 bytes:
  // float damage + uint rank/index
  const outputBuffer = ensureGpuBuffer(
      device,
      reuse.output,
      reduceCount * 8,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  )

  // params layout is shader-defined.
  // currently only candidateCount is meaningfully populated; remaining slots are padding/reserved.
  const paramsBuffer = writeGpuBffr(
      device,
      reuse.params,
      new Uint32Array([cnddCnt, 0, 0, 0]),
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  )

  // recreate the bind group only when one of the bound buffers has changed
  const ndsBindGrp =
      !cchdBindGrp ||
      cchdBindGrpB.input !== cnddBffr ||
      cchdBindGrpB.output !== outputBuffer ||
      cchdBindGrpB.params !== paramsBuffer

  if (ndsBindGrp) {
    cchdBindGrp = device.createBindGroup({
      label: 'optimizer-reduce-bind-group',
      layout,
      entries: [
        { binding: 0, resource: { buffer: cnddBffr } },
        { binding: 1, resource: { buffer: outputBuffer } },
        { binding: 2, resource: { buffer: paramsBuffer } },
      ],
    })

    cchdBindGrpB = {
      input: cnddBffr,
      output: outputBuffer,
      params: paramsBuffer,
    }
  }

  // launch one dispatch where each workgroup handles one reduction chunk
  const encoder = device.createCommandEncoder()
  const pass = encoder.beginComputePass()
  pass.setPipeline(pipeline)
  pass.setBindGroup(0, cchdBindGrp as GPUBindGroup)
  pass.dispatchWorkgroups(reduceGroups)
  pass.end()
  device.queue.submit([encoder.finish()])

  // return the reduced buffer and its logical candidate count
  return { buffer: outputBuffer, count: reduceCount }
}
