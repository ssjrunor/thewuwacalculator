/*
  Author: Runor Ewhro
  Description: Keyed batch scheduling for independent simulations. Callers
               provide immutable structural keys, allowing exact result reuse,
               in-flight de-duplication, and worker-backed executors later.
*/

export interface SimulationBatchJob<T> {
  id: string
  key: string
  input: T
}

export interface SimulationBatchOptions<T> {
  signal?: AbortSignal
  onResult?: (id: string, value: T) => void
}

export interface SimulationBatchRunnerOptions {
  /** Disable only when execution already crosses an asynchronous boundary. */
  yieldBeforeExecute?: boolean
}

function yieldToHost(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

/**
 * Stable compact fingerprint for plain simulation inputs. The old
 * implementation rebuilt every object with sorted keys and retained the full
 * JSON text as a cache key. Streaming tokens into two independent 32-bit
 * accumulators keeps key memory constant while preserving structural ordering.
 */
export function stableSimulationKey(value: unknown): string {
  let left = 0x811c9dc5
  let right = 0x9e3779b9
  let length = 0
  const seen = new WeakSet<object>()
  const token = (text: string): void => {
    length += text.length
    for (let index = 0; index < text.length; index += 1) {
      const code = text.charCodeAt(index)
      left = Math.imul(left ^ code, 0x01000193)
      right = Math.imul(right ^ (code + index), 0x85ebca6b)
      right ^= right >>> 13
    }
  }
  const visit = (child: unknown): void => {
    if (child === null) { token('n;'); return }
    if (child === undefined) { token('u;'); return }
    if (typeof child !== 'object') {
      token(`${typeof child}:${String(child)};`)
      return
    }
    if (seen.has(child)) throw new TypeError('Simulation inputs must be acyclic')
    seen.add(child)
    if (Array.isArray(child)) {
      token(`a${child.length}[`)
      for (const entry of child) visit(entry)
      token(']')
    } else {
      const record = child as Record<string, unknown>
      const keys = Object.keys(record).sort()
      token(`o${keys.length}{`)
      for (const key of keys) {
        token(`k${key.length}:${key}`)
        visit(record[key])
      }
      token('}')
    }
    seen.delete(child)
  }
  visit(value)
  return `${(left >>> 0).toString(16).padStart(8, '0')}${(right >>> 0).toString(16).padStart(8, '0')}:${length.toString(16)}`
}

export class SimulationBatchRunner<TInput, TOutput> {
  private readonly cache = new Map<string, TOutput>()
  private readonly inFlight = new Map<string, Promise<TOutput>>()
  private readonly execute: (input: TInput) => TOutput | Promise<TOutput>
  private readonly concurrency: number
  private readonly cacheLimit: number
  private readonly yieldBeforeExecute: boolean

  constructor(
    execute: (input: TInput) => TOutput | Promise<TOutput>,
    concurrency = 1,
    cacheLimit = 64,
    options: SimulationBatchRunnerOptions = {},
  ) {
    this.execute = execute
    this.concurrency = concurrency
    this.cacheLimit = cacheLimit
    this.yieldBeforeExecute = options.yieldBeforeExecute ?? true
  }

  private remember(key: string, value: TOutput): TOutput {
    this.cache.delete(key)
    this.cache.set(key, value)
    while (this.cache.size > this.cacheLimit) {
      const oldest = this.cache.keys().next().value as string | undefined
      if (oldest === undefined) break
      this.cache.delete(oldest)
    }
    return value
  }

  private resolve(job: SimulationBatchJob<TInput>): Promise<TOutput> {
    if (this.cache.has(job.key)) {
      const cached = this.cache.get(job.key) as TOutput
      this.remember(job.key, cached)
      return Promise.resolve(cached)
    }

    const pending = this.inFlight.get(job.key)
    if (pending) return pending

    const next = Promise.resolve().then(() => this.execute(job.input))
      .then((value) => this.remember(job.key, value))
      .finally(() => this.inFlight.delete(job.key))
    this.inFlight.set(job.key, next)
    return next
  }

  async run(
    jobs: readonly SimulationBatchJob<TInput>[],
    options: SimulationBatchOptions<TOutput> = {},
  ): Promise<Map<string, TOutput>> {
    const results = new Map<string, TOutput>()
    const queued: SimulationBatchJob<TInput>[] = []
    for (const job of jobs) {
      if (!this.cache.has(job.key)) {
        queued.push(job)
        continue
      }
      const cached = this.cache.get(job.key) as TOutput
      this.remember(job.key, cached)
      results.set(job.id, cached)
      options.onResult?.(job.id, cached)
    }
    let cursor = 0
    const worker = async () => {
      while (cursor < queued.length && !options.signal?.aborted) {
        const job = queued[cursor]
        cursor += 1
        if (!job) break

        // Synchronous engines need a paint/input boundary between jobs. A
        // worker-backed executor is already off-thread and must not pay for a
        // clamped host timer before every message.
        if (this.yieldBeforeExecute) await yieldToHost()
        if (options.signal?.aborted) break
        const value = await this.resolve(job)
        if (options.signal?.aborted) break
        results.set(job.id, value)
        options.onResult?.(job.id, value)
      }
    }

    const workers = Array.from(
      { length: Math.min(Math.max(1, this.concurrency), queued.length) },
      () => worker(),
    )
    await Promise.all(workers)
    return new Map(jobs.flatMap((job) => (
      results.has(job.id) ? [[job.id, results.get(job.id) as TOutput] as const] : []
    )))
  }
}
