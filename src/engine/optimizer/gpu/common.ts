/*
  Author: Runor Ewhro
  Description: provides shared gpu buffer helpers for upload, reuse,
               validated pipeline creation, and candidate readback.
*/

export const GPU_CAND_STRIDE = 8

// anything that can be directly uploaded into a gpu buffer
export type PldbBffrSrc = ArrayBuffer | ArrayBufferView<ArrayBufferLike>

// small reuse wrapper so callers can keep one gpu buffer alive and resize only when needed
export interface ReusableBuffer {
  buffer: GPUBuffer | null
  size: number
}

// normalize upload input into something queue.writeBuffer accepts cleanly
export function toGpuPldView(data: PldbBffrSrc): ArrayBuffer | ArrayBufferView<ArrayBuffer> {
  if (data instanceof ArrayBuffer) {
    return data
  }

  return data as ArrayBufferView<ArrayBuffer>
}

// create a storage buffer and optionally upload initial contents into it
export function makeStoreBuffer(device: GPUDevice, data: PldbBffrSrc): GPUBuffer {
  const upload = toGpuPldView(data)

  // both branches expose byteLength, this just keeps intent explicit
  const byteLength = upload instanceof ArrayBuffer ? upload.byteLength : upload.byteLength

  // gpu buffers cannot have size 0, so clamp to at least 4 bytes
  const buffer = device.createBuffer({
    size: Math.max(4, byteLength),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })

  // only upload when there is actual data
  if (byteLength > 0) {
    device.queue.writeBuffer(buffer, 0, upload)
  }

  return buffer
}

// return an existing reusable buffer when large enough, otherwise recreate it
export function ensureGpuBuffer(
    device: GPUDevice,
    reuse: ReusableBuffer,
    neededSize: number,
    usage: GPUBufferUsageFlags,
): GPUBuffer {
  const byteLength = Math.max(4, neededSize)

  // reuse existing allocation if it already satisfies the requested size
  if (reuse.buffer && reuse.size >= byteLength) {
    return reuse.buffer
  }

  // destroy the old buffer before replacing it to avoid leaks
  reuse.buffer?.destroy()

  reuse.buffer = device.createBuffer({
    size: byteLength,
    usage,
  })
  reuse.size = byteLength

  return reuse.buffer
}

// ensure a reusable buffer exists, then upload fresh contents into it
export function writeGpuBffr(
    device: GPUDevice,
    reuse: ReusableBuffer,
    data: PldbBffrSrc,
    usage: GPUBufferUsageFlags,
): GPUBuffer {
  const upload = toGpuPldView(data)
  const byteLength = upload instanceof ArrayBuffer ? upload.byteLength : upload.byteLength
  const buffer = ensureGpuBuffer(device, reuse, byteLength, usage)

  if (byteLength > 0) {
    device.queue.writeBuffer(buffer, 0, upload)
  }

  return buffer
}

// turn shader compilation errors into one readable multiline string
function fmtShdrCmplR(label: string, info: GPUCompilationInfo): string | null {
  const errors = info.messages.filter((message) => message.type === 'error')
  if (errors.length === 0) {
    return null
  }

  return errors
      .map((message) => {
        const line = message.lineNum > 0 ? `:${message.lineNum}:${message.linePos}` : ''
        return `${label}${line} ${message.message}`
      })
      .join('\n')
}

// pop the current validation scope and throw if the gpu reported an error
async function popValidRrr(device: GPUDevice, label: string): Promise<void> {
  const error = await device.popErrorScope()
  if (error) {
    throw new Error(`${label}: ${error.message}`)
  }
}

// create a bind group layout under a validation scope so bad layouts fail early with context
export async function mkChckBindGr(
    device: GPUDevice,
    label: string,
    entries: GPUBindGroupLayoutEntry[],
): Promise<GPUBindGroupLayout> {
  device.pushErrorScope('validation')

  const layout = device.createBindGroupLayout({ label, entries })

  await popValidRrr(device, label)
  return layout
}

// compile a compute shader, surface shader compilation errors, then create a validated pipeline
export async function mkChckCmptPp(options: {
  device: GPUDevice
  label: string
  layout: GPUBindGroupLayout
  code: string
  entryPoint?: string
  // pipeline-override constant values (WGSL `override` declarations), e.g. to
  // compile a lower CYCLES_PER_INVOCATION variant of the same shader.
  constants?: Record<string, number>
}): Promise<GPUComputePipeline> {
  const { device, label, layout, code, entryPoint = 'main', constants } = options

  // create the shader module first so we can inspect compiler diagnostics
  const module = device.createShaderModule({ label: `${label}:shader`, code })

  const info = await module.getCompilationInfo()
  const shaderError = fmtShdrCmplR(label, info)
  if (shaderError) {
    throw new Error(shaderError)
  }

  // wrap pipeline creation in a validation scope so bind/layout mismatches are caught cleanly
  device.pushErrorScope('validation')

  const pipeline = await device.createComputePipelineAsync({
    label,
    layout: device.createPipelineLayout({
      label: `${label}:pipeline-layout`,
      bindGroupLayouts: [layout],
    }),
    compute: {
      module,
      entryPoint,
      ...(constants ? { constants } : {}),
    },
  })

  await popValidRrr(device, label)
  return pipeline
}

// copy a gpu candidate buffer into a cpu-readable staging buffer and decode results
export async function readCandBffr(
    device: GPUDevice,
    candidateBuffer: GPUBuffer,
    candCnt: number,
    reuse: ReusableBuffer = { buffer: null, size: 0 },
): Promise<{ results: Array<{ damage: number; rank: number }>; reuse: ReusableBuffer }> {
  // each candidate occupies 8 bytes:
  // float32 damage + uint32 rank/index
  const byteLength = candCnt * GPU_CAND_STRIDE

  // keep a reusable readback buffer so repeated reads avoid new allocations
  const readBuffer = ensureGpuBuffer(
      device,
      reuse,
      byteLength,
      GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  )

  // schedule a copy from the gpu-only candidate buffer into the readable staging buffer
  const encoder = device.createCommandEncoder()
  encoder.copyBufferToBuffer(candidateBuffer, 0, readBuffer, 0, byteLength)
  device.queue.submit([encoder.finish()])

  // wait for gpu work to finish and map the buffer for cpu access
  await readBuffer.mapAsync(GPUMapMode.READ)

  const mapped = readBuffer.getMappedRange()

  // same bytes are viewed as both float and uint to decode paired fields
  const floatView = new Float32Array(mapped)
  const uintView = new Uint32Array(mapped)

  const results: Array<{ damage: number; rank: number }> = []

  for (let index = 0; index < candCnt; index += 1) {
    const base = index * 2
    const damage = floatView[base]

    // empty or invalid candidate slots are ignored
    if (damage <= 0) {
      continue
    }

    results.push({
      damage,
      rank: uintView[base + 1],
    })
  }

  // unmap so the buffer can be reused later
  readBuffer.unmap()

  return { results, reuse }
}

// candidates are read back unsorted; sort strongest-first before decoding.
export function sortCnddByDm<T extends { damage: number }>(candidates: T[]): void {
  candidates.sort((left, right) => right.damage - left.damage)
}