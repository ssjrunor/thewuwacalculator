/*
  Author: Runor Ewhro
  Description: creates and caches the WebGPU bind group layout and compute
               pipeline used by the rotation-mode optimizer shader.
*/

import rotationShaderCode from '@/engine/optimizer/shaders/rotation.wgsl?raw'
import {
  createCheckedBindGroupLayout,
  createCheckedComputePipeline,
} from '@/engine/optimizer/gpu/common.ts'

// cache the layout/pipeline so shader setup only happens once per session
let cachedRotationLayout: GPUBindGroupLayout | null = null
let cachedRotationPipeline: GPUComputePipeline | null = null

export async function getRotationGpuPipeline(device: GPUDevice): Promise<{
  layout: GPUBindGroupLayout
  pipeline: GPUComputePipeline
}> {
  // reuse the already-created gpu objects
  if (cachedRotationLayout && cachedRotationPipeline) {
    return {
      layout: cachedRotationLayout,
      pipeline: cachedRotationPipeline,
    }
  }

  // bind group layout must match the exact binding layout expected by rotation.wgsl
  // each binding index here corresponds to one @binding(...) entry in the shader.
  cachedRotationLayout = await createCheckedBindGroupLayout(
      device,
      'optimizer-rebuild-rotation-layout',
      [
        // binding 0: packed rotation contexts
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },

        // binding 1: encoded echo stat rows
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },

        // binding 2: encoded set ids per echo
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },

        // binding 3: encoded kind ids per echo
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },

        // binding 4: small uniform block with dispatch/job parameters
        { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },

        // binding 5: set constant lookup table
        { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },

        // binding 6: main echo bonus rows
        { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },

        // binding 7: uniform block for combo search / indexing info
        { binding: 7, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },

        // binding 8: combo index / combinadic map data
        { binding: 8, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },

        // binding 9: writable output buffer for best candidates
        { binding: 9, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },

        // binding 10: per-context weights for rotation aggregation
        { binding: 10, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },

        // binding 11: constraints buffer
        { binding: 11, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },

        // binding 12: final uniform block, typically used for counts/strides/limits
        { binding: 12, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      ],
  )

  // compile the shader and create the compute pipeline once the layout is ready
  cachedRotationPipeline = await createCheckedComputePipeline({
    device,
    label: 'optimizer-rebuild-rotation-pipeline',
    layout: cachedRotationLayout,
    code: rotationShaderCode,
  })

  return {
    layout: cachedRotationLayout,
    pipeline: cachedRotationPipeline,
  }
}
