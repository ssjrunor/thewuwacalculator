import type * as SpineWebGL from '@esotericsoftware/spine-webgl'
import type {
  AnimationState as AnimationStateT,
  Skeleton as SkeletonT,
} from '@esotericsoftware/spine-webgl'
// The package's CJS build is mangled by esbuild's dep optimizer (its binary
// skeleton reader breaks), so load the prebuilt IIFE as a classic script and
// use the window global instead. Vite emits it as a hashed asset in prod.
import spineRuntimeUrl from '@esotericsoftware/spine-webgl/dist/iife/spine-webgl.min.js?url'
import { canRenderSpineInWorker, createSpineWorkerInstance } from './spineWorkerClient.ts'

type SpineRuntime = typeof SpineWebGL

declare global {
  interface Window {
    spine?: SpineRuntime
  }
}

let runtimePromise: Promise<SpineRuntime> | null = null

function loadSpineRuntime(): Promise<SpineRuntime> {
  if (runtimePromise) return runtimePromise
  runtimePromise = new Promise<SpineRuntime>((resolve, reject) => {
    if (window.spine) {
      resolve(window.spine)
      return
    }
    const script = document.createElement('script')
    script.src = spineRuntimeUrl
    script.async = true
    script.onload = () => {
      if (window.spine) resolve(window.spine)
      else reject(new Error('spine runtime loaded but window.spine is missing'))
    }
    script.onerror = () => {
      runtimePromise = null
      reject(new Error('failed to load spine runtime'))
    }
    document.head.appendChild(script)
  })
  return runtimePromise
}

export interface SpineInstance {
  dispose(): void
  pause(): void
  resume(): void
}

const GL_ONE = 1
const GL_ONE_MINUS_SRC_COLOR = 0x0301
const GL_ONE_MINUS_SRC_ALPHA = 0x0303

// Override spine-webgl's blend modes so Multiply/Screen compositing works on a
// transparent canvas. Mirrors PixiJS's blend table; the alpha channel always
// uses Porter-Duff "over" so shading overlays never destroy framebuffer alpha.
// Coupled to spine-webgl 4.1.x.
function patchBlendModes(gl: WebGLRenderingContext): void {
  const orig = gl.blendFuncSeparate.bind(gl)
  gl.blendFuncSeparate = (srcRGB: number, dstRGB: number, srcAlpha: number) => {
    if (srcAlpha === GL_ONE_MINUS_SRC_COLOR) {
      orig(srcRGB, GL_ONE_MINUS_SRC_COLOR, GL_ONE, GL_ONE_MINUS_SRC_ALPHA)
    } else {
      orig(srcRGB, dstRGB, GL_ONE, GL_ONE_MINUS_SRC_ALPHA)
    }
  }
}

async function fetchRequired(url: string, signal?: AbortSignal): Promise<Response> {
  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error(`Failed to load ${url}: ${response.status}`)
  return response
}

async function loadSpineAssets(
  spine: SpineRuntime,
  context: SpineWebGL.ManagedWebGLRenderingContext,
  baseUrl: string,
  skelFile: string,
  atlasFile: string,
  signal?: AbortSignal,
) {
  const [skelResponse, atlasResponse] = await Promise.all([
    fetchRequired(`${baseUrl}${skelFile}`, signal),
    fetchRequired(`${baseUrl}${atlasFile}`, signal),
  ])
  const [skel, atlasText] = await Promise.all([
    skelResponse.arrayBuffer().then((buffer) => new Uint8Array(buffer)),
    atlasResponse.text(),
  ])
  const atlas = new spine.TextureAtlas(atlasText)

  try {
    for (const page of atlas.pages) {
      const blob = await fetchRequired(`${baseUrl}${page.name}`, signal).then((response) => response.blob())
      const textureScale = Math.min(1, 4096 / Math.max(page.width, page.height))
      const bitmap = await createImageBitmap(blob, {
        premultiplyAlpha: 'premultiply',
        colorSpaceConversion: 'none',
        resizeWidth: Math.max(1, Math.round(page.width * textureScale)),
        resizeHeight: Math.max(1, Math.round(page.height * textureScale)),
        resizeQuality: 'high',
      })
      const texture = new spine.GLTexture(context, bitmap)
      context.removeRestorable(texture)
      ;(texture as unknown as { _image: { width: number; height: number } })._image = {
        width: page.width,
        height: page.height,
      }
      bitmap.close()
      page.setTexture(texture)
    }
  } catch (error) {
    atlas.dispose()
    throw error
  }

  return { atlas, skel }
}

export async function createSpineInstance(
  canvas: HTMLCanvasElement,
  baseUrl: string,
  skelFile: string,
  atlasFile: string,
  signal?: AbortSignal,
  onError?: () => void,
  zoom = 1,
): Promise<SpineInstance> {
  if (signal?.aborted) {
    throw new DOMException('Spine load aborted', 'AbortError')
  }

  if (canRenderSpineInWorker(canvas)) {
    canvas.dataset.spineRenderer = 'worker'
    return createSpineWorkerInstance(canvas, baseUrl, skelFile, atlasFile, signal, onError, zoom)
  }
  canvas.dataset.spineRenderer = 'main'

  // Lazy-load the runtime (classic script) only when a resonator actually has
  // spine data to render.
  const spine = await loadSpineRuntime()

  const glContext =
    canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, preserveDrawingBuffer: false })
    || canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false, preserveDrawingBuffer: false })
  if (!glContext) throw new Error('WebGL not available')
  const gl = glContext

  // Straight-alpha uploads break effect-heavy screen/additive compositions.
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
  patchBlendModes(gl)

  const context = new spine.ManagedWebGLRenderingContext(gl)
  const assets = await loadSpineAssets(spine, context, baseUrl, skelFile, atlasFile, signal)

  const canvasSize = canvas.width

  const atlasLoader = new spine.AtlasAttachmentLoader(assets.atlas)

  // First pass at scale 1 to measure bounds, then rebuild at the fitted scale.
  const measureBinary = new spine.SkeletonBinary(atlasLoader)
  measureBinary.scale = 1
  const measureSkeleton = new spine.Skeleton(measureBinary.readSkeletonData(assets.skel))
  measureSkeleton.setToSetupPose()
  measureSkeleton.updateWorldTransform()

  const offset = new spine.Vector2()
  const size = new spine.Vector2()
  measureSkeleton.getBounds(offset, size, [])

  const boundsW = size.x
  const boundsH = size.y
  const nativeCx = offset.x + boundsW / 2
  const nativeCy = offset.y + boundsH / 2
  const fitScale = (canvasSize / Math.max(boundsW, boundsH)) * zoom
  const camX = Math.round(nativeCx * fitScale)
  const camY = Math.round(nativeCy * fitScale)

  const binary = new spine.SkeletonBinary(atlasLoader)
  binary.scale = fitScale
  const skeleton: SkeletonT = new spine.Skeleton(binary.readSkeletonData(assets.skel))
  skeleton.setToSetupPose()

  const stateData = new spine.AnimationStateData(skeleton.data)
  stateData.defaultMix = 0.2
  const animState: AnimationStateT = new spine.AnimationState(stateData)

  const defaultAnim =
    skeleton.data.animations.find((a) => a.name.toLowerCase().includes('idle')) || skeleton.data.animations[0]
  if (defaultAnim) {
    animState.setAnimation(0, defaultAnim.name, true)
  }
  skeleton.updateWorldTransform()

  const renderer = new spine.SceneRenderer(canvas, context)
  renderer.camera.position.x = camX
  renderer.camera.position.y = camY
  renderer.camera.zoom = 1
  renderer.camera.setViewport(canvasSize, canvasSize)
  renderer.camera.update()

  let rafId: number | null = null
  let lastTime = performance.now()
  let disposed = false
  let firstFrame = true
  const FRAME_INTERVAL = 1000 / 30

  function dispose() {
    if (disposed) return
    disposed = true
    if (rafId != null) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
    canvas.removeEventListener('webglcontextlost', handleContextLost)
    renderer.dispose()
    assets.atlas.dispose()
  }

  function handleContextLost() {
    dispose()
    onError?.()
  }

  canvas.addEventListener('webglcontextlost', handleContextLost)

  function loop(now: number) {
    if (disposed) return
    rafId = requestAnimationFrame(loop)
    if (now - lastTime < FRAME_INTERVAL) return

    try {
      const delta = Math.min((now - lastTime) / 1000, 0.1)
      lastTime = now

      animState.update(delta)
      animState.apply(skeleton)
      skeleton.updateWorldTransform()

      gl.viewport(0, 0, canvasSize, canvasSize)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)

      renderer.begin()
      renderer.drawSkeleton(skeleton, true)
      renderer.end()

      if (firstFrame) {
        firstFrame = false
        const glError = gl.getError()
        if (glError !== gl.NO_ERROR) {
          throw new Error(`WebGL error after first frame: 0x${glError.toString(16)}`)
        }
      }
    } catch (err) {
      console.error('SpinePortrait: render error', err)
      dispose()
      onError?.()
    }
  }

  if (signal?.aborted) {
    dispose()
    throw new DOMException('Spine load aborted', 'AbortError')
  }

  rafId = requestAnimationFrame(loop)

  return {
    pause() {
      if (disposed || rafId == null) return
      cancelAnimationFrame(rafId)
      rafId = null
    },
    resume() {
      if (disposed || rafId != null) return
      lastTime = performance.now()
      rafId = requestAnimationFrame(loop)
    },
    dispose() {
      dispose()
    },
  }
}
