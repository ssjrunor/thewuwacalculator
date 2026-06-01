/*
  Author: Runor Ewhro
  Description: creates and caches the WebGPU bind group layout and compute
               pipeline used by the rotation-mode optimizer shader.
*/

import rotShdrCode from '@/engine/optimizer/shaders/rotation.wgsl?raw'
import {
  mkChckBindGr,
  mkChckCmptPp,
} from '@/engine/optimizer/gpu/common.ts'

// cache the layout/pipeline so shader setup only happens once per session
let cchdRotLyt: GPUBindGroupLayout | null = null
let cchdRotPpln: GPUComputePipeline | null = null

export async function getRotGpuPpl(device: GPUDevice): Promise<{
  layout: GPUBindGroupLayout
  pipeline: GPUComputePipeline
}> {
  // reuse the already-created gpu objects
  if (cchdRotLyt && cchdRotPpln) {
    return {
      layout: cchdRotLyt,
      pipeline: cchdRotPpln,
    }
  }

  // bind group layout must match the exact binding layout expected by rotation.wgsl
  // each binding index here corresponds to one @binding(...) entry in the shader.
  cchdRotLyt = await mkChckBindGr(
      device,
      'optimizer-rebuild-rotation-layout',
      [
        // binding 0: encoded echo stat rows
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },

        // binding 1: set constant lookup table
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },

        // binding 2: encoded set ids per echo
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },

        // binding 3: combo index map, or explicit theory rows in batch mode
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },

        // binding 4: small uniform block with dispatch/job parameters
        { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },

        // binding 5: echo costs
        { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },

        // binding 6: main echo bonus rows
        { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },

        // binding 7: stat constraints uniform
        { binding: 7, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },

        // binding 8: encoded kind ids per echo
        { binding: 8, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },

        // binding 9: writable output buffer for best candidates
        { binding: 9, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },

        // binding 10: combinadic binomial table
        { binding: 10, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },

        // binding 11: packed rotation contexts and weights
        { binding: 11, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },

        // binding 12: rotation context metadata uniform
        { binding: 12, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      ],
  )

  // compile the shader and create the compute pipeline once the layout is ready
  cchdRotPpln = await mkChckCmptPp({
    device,
    label: 'optimizer-rebuild-rotation-pipeline',
    layout: cchdRotLyt,
    code: rotShdrCode,
  })

  return {
    layout: cchdRotLyt,
    pipeline: cchdRotPpln,
  }
}
