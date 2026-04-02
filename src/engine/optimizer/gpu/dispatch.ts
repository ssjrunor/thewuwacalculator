/*
  Author: Runor Ewhro
  Description: dispatches a compute pipeline in batches so total workgroup
               count can exceed the single-dispatch WebGPU limit.
*/

const MAX_DISPATCH_WORKGROUPS = 65535

export async function dispatchComputePass(options: {
  device: GPUDevice
  pipeline: GPUComputePipeline
  bindGroup: GPUBindGroup
  workgroupCount: number
  maxWorkgroupsPerBatch?: number
  beforeDispatchBatch?: (workgroupBase: number, batchSize: number) => void | Promise<void>
}): Promise<void> {
  const {
    device,
    pipeline,
    bindGroup,
    workgroupCount,
    beforeDispatchBatch,
  } = options

  // WebGPU only allows a limited number of workgroups in one dispatch call.
  // So if the caller requests more than that, split it into multiple dispatches.
  let remaining = workgroupCount
  let dispatched = 0
  const maxWorkgroupsPerBatch = Math.max(
      1,
      options.maxWorkgroupsPerBatch ?? MAX_DISPATCH_WORKGROUPS,
  )

  while (remaining > 0) {
    // take the biggest legal chunk for this pass
    const batch = Math.min(remaining, MAX_DISPATCH_WORKGROUPS, maxWorkgroupsPerBatch)

    await beforeDispatchBatch?.(dispatched, batch)

    // create a fresh encoder/pass for this chunk
    const encoder = device.createCommandEncoder()
    const pass = encoder.beginComputePass()

    // bind pipeline resources once per batch
    pass.setPipeline(pipeline)
    pass.setBindGroup(0, bindGroup)

    // dispatch only this chunk of workgroups
    pass.dispatchWorkgroups(batch)
    pass.end()

    // submit immediately so very large workloads can stream through in pieces
    device.queue.submit([encoder.finish()])

    // subtract the chunk we just launched and continue until done
    remaining -= batch
    dispatched += batch
  }
}
