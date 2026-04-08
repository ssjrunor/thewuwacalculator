/*
  Author: Runor Ewhro
  Description: lazily acquires and caches a WebGPU adapter/device pair,
               and exposes a small helper to test whether WebGPU is usable
               in the current execution context.
*/

import { errorOptimizer, logOptimizer, warnOptimizer } from '@/engine/optimizer/config/log.ts'

let cachedDevice: GPUDevice | null = null
let cachedAdapter: GPUAdapter | null = null

export async function getGpuDevice(): Promise<GPUDevice> {
  // reuse the same device once it has already been created
  if (cachedDevice) {
    return cachedDevice
  }

  // try both worker and general global contexts
  const gpu = self.navigator?.gpu ?? globalThis.navigator?.gpu
  if (!gpu) {
    warnOptimizer('[optimizer:gpu] WebGPU not supported in this context (navigator.gpu is undefined)')
    throw new Error('WebGPU is not supported in this execution context')
  }

  // request a physical/virtual adapter first
  logOptimizer('[optimizer:gpu] requesting WebGPU adapter')
  cachedAdapter = await gpu.requestAdapter()
  if (!cachedAdapter) {
    warnOptimizer('[optimizer:gpu] gpu.requestAdapter() returned null — no suitable GPU adapter found')
    throw new Error('Failed to acquire a WebGPU adapter')
  }

  logOptimizer('[optimizer:gpu] adapter acquired, requesting device')

  // mirror the adapter limits into requiredLimits so the device is created
  // with values the adapter definitely supports
  const adapterLimits = cachedAdapter.limits
  const requiredLimits = {
    // cap storage buffers per shader stage at 10 even if the adapter supports more
    maxStorageBuffersPerShaderStage: Math.min(adapterLimits.maxStorageBuffersPerShaderStage, 10),

    // preserve the adapter's supported maxima for all other limits we rely on
    maxStorageBufferBindingSize: adapterLimits.maxStorageBufferBindingSize,
    maxComputeWorkgroupSizeX: adapterLimits.maxComputeWorkgroupSizeX,
    maxComputeWorkgroupSizeY: adapterLimits.maxComputeWorkgroupSizeY,
    maxComputeWorkgroupSizeZ: adapterLimits.maxComputeWorkgroupSizeZ,
    maxComputeInvocationsPerWorkgroup: adapterLimits.maxComputeInvocationsPerWorkgroup,
    maxComputeWorkgroupStorageSize: adapterLimits.maxComputeWorkgroupStorageSize,
    maxBufferSize: adapterLimits.maxBufferSize,
  }

  // create and cache the gpu device so later calls stay cheap
  cachedDevice = await cachedAdapter.requestDevice({ requiredLimits })

  cachedDevice.lost.then((info) => {
    errorOptimizer('[optimizer:gpu] GPU device lost', {
      reason: info.reason,
      message: info.message,
    })
    cachedDevice = null
    cachedAdapter = null
  })

  logOptimizer('[optimizer:gpu] device acquired', {
    maxStorageBuffersPerShaderStage: requiredLimits.maxStorageBuffersPerShaderStage,
    maxBufferSize: requiredLimits.maxBufferSize,
  })

  return cachedDevice
}

export async function detectWebGpuSupport(): Promise<boolean> {
  try {
    // if device creation succeeds, treat webgpu as available
    await getGpuDevice()
    return true
  } catch (error) {
    // any failure means this environment cannot currently use webgpu
    warnOptimizer('[optimizer:gpu] WebGPU unavailable', {
      error: error instanceof Error ? error.message : String(error),
    })
    return false
  }
}