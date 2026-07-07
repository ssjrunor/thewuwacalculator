import type { SpineInstance } from './spineEngine.ts'

interface WorkerMessage {
  type: 'ready' | 'error'
  message?: string
}

export function canRenderSpineInWorker(canvas: HTMLCanvasElement): boolean {
  return typeof Worker !== 'undefined' && typeof canvas.transferControlToOffscreen === 'function'
}

export function createSpineWorkerInstance(
  canvas: HTMLCanvasElement,
  baseUrl: string,
  skelFile: string,
  atlasFile: string,
  signal?: AbortSignal,
  onError?: () => void,
  zoom = 1,
): Promise<SpineInstance> {
  if (signal?.aborted) return Promise.reject(new DOMException('Spine load aborted', 'AbortError'))

  const offscreen = canvas.transferControlToOffscreen()
  const worker = new Worker(new URL('./spineWorker.ts', import.meta.url), {
    name: 'spine-renderer',
    type: 'module',
  })

  return new Promise<SpineInstance>((resolve, reject) => {
    let ready = false
    let disposed = false

    const dispose = () => {
      if (disposed) return
      disposed = true
      window.clearTimeout(initTimeout)
      signal?.removeEventListener('abort', handleAbort)
      worker.postMessage({ type: 'dispose' })
      worker.terminate()
    }

    const handleAbort = () => {
      dispose()
      if (!ready) reject(new DOMException('Spine load aborted', 'AbortError'))
    }

    const initTimeout = window.setTimeout(() => {
      dispose()
      reject(new Error('Spine worker initialization timed out'))
    }, 30000)

    worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      if (event.data.type === 'ready') {
        if (disposed) return
        ready = true
        window.clearTimeout(initTimeout)
        resolve({
          pause: () => worker.postMessage({ type: 'pause' }),
          resume: () => worker.postMessage({ type: 'resume' }),
          dispose,
        })
        return
      }

      const error = new Error(event.data.message ?? 'Spine worker failed')
      dispose()
      if (ready) onError?.()
      else reject(error)
    }

    worker.onerror = (event) => {
      event.preventDefault()
      const error = new Error(event.message || 'Spine worker failed')
      dispose()
      if (ready) onError?.()
      else reject(error)
    }

    signal?.addEventListener('abort', handleAbort, { once: true })
    worker.postMessage({
      type: 'init',
      canvas: offscreen,
      baseUrl,
      skelFile,
      atlasFile,
      zoom,
    }, [offscreen])
  })
}
