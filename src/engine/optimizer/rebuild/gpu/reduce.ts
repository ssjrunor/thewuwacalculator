/*
  Author: Runor Ewhro
  Description: runs an optional gpu-side candidate reduction pass.
               if the raw candidate count is already small enough, it
               returns the original buffer unchanged. otherwise it launches
               a compute shader that reduces candidates in workgroup-sized
               chunks into a smaller output buffer.
*/

import reduceShaderCode from '@/engine/optimizer/rebuild/shaders/reduceCandidates.wgsl?raw'
import {
  createCheckedBindGroupLayout,
  createCheckedComputePipeline,
  ensureGpuBuffer,
  writeGpuBuffer,
  type ReusableGpuBuffer,
} from '@/engine/optimizer/rebuild/gpu/common'

// must stay aligned with the workgroup size expected by reduceCandidates.wgsl
const REDUCE_WORKGROUP_SIZE = 256

interface ReduceReusableBuffers {
  // destination buffer reused across reduction calls
  output: ReusableGpuBuffer

  // small uniform buffer reused for reduction params
  params: ReusableGpuBuffer
}

// cached pipeline objects so shader compilation/layout creation only happens once
let cachedPipeline: GPUComputePipeline | null = null
let cachedLayout: GPUBindGroupLayout | null = null

// cached bind group so we only recreate it when one of its bound buffers changes
let cachedBindGroup: GPUBindGroup | null = null
let cachedBindGroupBuffers: {
  input: GPUBuffer | null
  output: GPUBuffer | null
  params: GPUBuffer | null
} = {
  input: null,
  output: null,
  params: null,
}

// lazily create the reduction pipeline and its bind group layout
async function getReducePipeline(device: GPUDevice): Promise<{
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
  cachedLayout = await createCheckedBindGroupLayout(device, 'optimizer-reduce-layout', [
    { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
    { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
    { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
  ])

  // compile the compute pipeline with validation + shader error checking
  cachedPipeline = await createCheckedComputePipeline({
    device,
    label: 'optimizer-reduce-pipeline',
    layout: cachedLayout,
    code: reduceShaderCode,
    entryPoint: 'reduceCandidates',
  })

  return { layout: cachedLayout, pipeline: cachedPipeline }
}

export async function runReducePassIfNeeded(options: {
  device: GPUDevice
  candidateBuffer: GPUBuffer
  candidateCount: number
  reduceK: number
  reuse: ReduceReusableBuffers
}): Promise<{ buffer: GPUBuffer; count: number }> {
  const { device, candidateBuffer, candidateCount, reduceK, reuse } = options

  // no reduction needed if we already have at most K candidates
  if (candidateCount <= reduceK) {
    return { buffer: candidateBuffer, count: candidateCount }
  }

  const { layout, pipeline } = await getReducePipeline(device)

  // each workgroup reduces one chunk of REDUCE_WORKGROUP_SIZE candidates
  const reduceGroups = Math.ceil(candidateCount / REDUCE_WORKGROUP_SIZE)

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
  const paramsBuffer = writeGpuBuffer(
      device,
      reuse.params,
      new Uint32Array([candidateCount, 0, 0, 0]),
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  )

  // recreate the bind group only when one of the bound buffers has changed
  const needsBindGroup =
      !cachedBindGroup ||
      cachedBindGroupBuffers.input !== candidateBuffer ||
      cachedBindGroupBuffers.output !== outputBuffer ||
      cachedBindGroupBuffers.params !== paramsBuffer

  if (needsBindGroup) {
    cachedBindGroup = device.createBindGroup({
      label: 'optimizer-reduce-bind-group',
      layout,
      entries: [
        { binding: 0, resource: { buffer: candidateBuffer } },
        { binding: 1, resource: { buffer: outputBuffer } },
        { binding: 2, resource: { buffer: paramsBuffer } },
      ],
    })

    cachedBindGroupBuffers = {
      input: candidateBuffer,
      output: outputBuffer,
      params: paramsBuffer,
    }
  }

  // launch one dispatch where each workgroup handles one reduction chunk
  const encoder = device.createCommandEncoder()
  const pass = encoder.beginComputePass()
  pass.setPipeline(pipeline)
  pass.setBindGroup(0, cachedBindGroup as GPUBindGroup)
  pass.dispatchWorkgroups(reduceGroups)
  pass.end()
  device.queue.submit([encoder.finish()])

  // return the reduced buffer and its logical candidate count
  return { buffer: outputBuffer, count: reduceCount }
}