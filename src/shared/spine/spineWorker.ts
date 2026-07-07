import {
  AnimationState,
  AnimationStateData,
  AtlasAttachmentLoader,
  GLTexture,
  ManagedWebGLRenderingContext,
  SceneRenderer,
  Skeleton,
  SkeletonBinary,
  TextureAtlas,
  Vector2,
} from '@esotericsoftware/spine-webgl'

interface InitMessage {
  type: 'init'
  canvas: OffscreenCanvas
  baseUrl: string
  skelFile: string
  atlasFile: string
  zoom: number
}

type WorkerCommand = InitMessage | { type: 'pause' | 'resume' | 'dispose' }

interface WorkerRenderer {
  pause(): void
  resume(): void
  dispose(): void
}

const GL_ONE = 1
const GL_ONE_MINUS_SRC_COLOR = 0x0301
const GL_ONE_MINUS_SRC_ALPHA = 0x0303
const FRAME_INTERVAL = 1000 / 30

function patchBlendModes(gl: WebGLRenderingContext): void {
  const original = gl.blendFuncSeparate.bind(gl)
  gl.blendFuncSeparate = (srcRGB: number, dstRGB: number, srcAlpha: number) => {
    original(
      srcRGB,
      srcAlpha === GL_ONE_MINUS_SRC_COLOR ? GL_ONE_MINUS_SRC_COLOR : dstRGB,
      GL_ONE,
      GL_ONE_MINUS_SRC_ALPHA,
    )
  }
}

async function fetchRequired(url: string): Promise<Response> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Failed to load ${url}: ${response.status}`)
  return response
}

async function loadWorkerAssets(
  context: ManagedWebGLRenderingContext,
  baseUrl: string,
  skelFile: string,
  atlasFile: string,
) {
  const [skelResponse, atlasResponse] = await Promise.all([
    fetchRequired(`${baseUrl}${skelFile}`),
    fetchRequired(`${baseUrl}${atlasFile}`),
  ])
  const [skel, atlasText] = await Promise.all([
    skelResponse.arrayBuffer().then((buffer) => new Uint8Array(buffer)),
    atlasResponse.text(),
  ])
  const atlas = new TextureAtlas(atlasText)
  try {
    for (const page of atlas.pages) {
      const blob = await fetchRequired(`${baseUrl}${page.name}`).then((response) => response.blob())
      const textureScale = Math.min(1, 4096 / Math.max(page.width, page.height))
      const bitmap = await createImageBitmap(blob, {
        premultiplyAlpha: 'premultiply',
        colorSpaceConversion: 'none',
        resizeWidth: Math.max(1, Math.round(page.width * textureScale)),
        resizeHeight: Math.max(1, Math.round(page.height * textureScale)),
        resizeQuality: 'high',
      })
      const texture = new GLTexture(context, bitmap)

      // GLTexture retains its upload source for context restoration. This app
      // recreates the whole Spine instance after context loss, so retaining a
      // second decoded 8K atlas wastes roughly 128 MB. Preserve only the
      // original dimensions needed by Spine's attachment geometry.
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

async function createRenderer({ canvas, baseUrl, skelFile, atlasFile, zoom }: InitMessage): Promise<WorkerRenderer> {
  const gl = (canvas.getContext('webgl2', {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    preserveDrawingBuffer: false,
  }) || canvas.getContext('webgl', {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    preserveDrawingBuffer: false,
  })) as WebGLRenderingContext | null
  if (!gl) throw new Error('Worker WebGL not available')

  // Luckdraw screen/additive layers are authored for premultiplied-alpha.
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
  patchBlendModes(gl)
  const context = new ManagedWebGLRenderingContext(gl)
  const assets = await loadWorkerAssets(context, baseUrl, skelFile, atlasFile)

  const canvasSize = canvas.width
  const atlasLoader = new AtlasAttachmentLoader(assets.atlas)
  const measureBinary = new SkeletonBinary(atlasLoader)
  const measureSkeleton = new Skeleton(measureBinary.readSkeletonData(assets.skel))
  measureSkeleton.setToSetupPose()
  measureSkeleton.updateWorldTransform()

  const offset = new Vector2()
  const size = new Vector2()
  measureSkeleton.getBounds(offset, size, [])
  const fitScale = (canvasSize / Math.max(size.x, size.y)) * zoom
  const cameraX = Math.round((offset.x + size.x / 2) * fitScale)
  const cameraY = Math.round((offset.y + size.y / 2) * fitScale)

  const binary = new SkeletonBinary(atlasLoader)
  binary.scale = fitScale
  const skeleton = new Skeleton(binary.readSkeletonData(assets.skel))
  skeleton.setToSetupPose()
  const stateData = new AnimationStateData(skeleton.data)
  stateData.defaultMix = 0.2
  const animationState = new AnimationState(stateData)
  const defaultAnimation = skeleton.data.animations.find((animation) => animation.name.toLowerCase().includes('idle'))
    ?? skeleton.data.animations[0]
  if (defaultAnimation) animationState.setAnimation(0, defaultAnimation.name, true)
  skeleton.updateWorldTransform()

  const renderer = new SceneRenderer(canvas as unknown as HTMLCanvasElement, context)
  renderer.camera.position.x = cameraX
  renderer.camera.position.y = cameraY
  renderer.camera.zoom = 1
  renderer.camera.setViewport(canvasSize, canvasSize)
  renderer.camera.update()

  let timer: ReturnType<typeof setTimeout> | null = null
  let lastTime = performance.now()
  let disposed = false
  let firstFrame = true

  const dispose = () => {
    if (disposed) return
    disposed = true
    if (timer != null) clearTimeout(timer)
    timer = null
    renderer.dispose()
    assets.atlas.dispose()
  }

  const renderFrame = (now: number) => {
    const delta = Math.min((now - lastTime) / 1000, 0.1)
    lastTime = now
    animationState.update(delta)
    animationState.apply(skeleton)
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
      if (glError !== gl.NO_ERROR) throw new Error(`Worker WebGL error: 0x${glError.toString(16)}`)
    }
  }

  const loop = () => {
    if (disposed) return
    try {
      renderFrame(performance.now())
    } catch (error) {
      dispose()
      postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) })
      return
    }
    timer = setTimeout(loop, FRAME_INTERVAL)
  }

  // Do not report ready until pixels have reached the transferred canvas.
  renderFrame(performance.now())
  timer = setTimeout(loop, FRAME_INTERVAL)
  return {
    pause() {
      if (disposed || timer == null) return
      clearTimeout(timer)
      timer = null
    },
    resume() {
      if (disposed || timer != null) return
      lastTime = performance.now()
      timer = setTimeout(loop, 0)
    },
    dispose,
  }
}

let activeRenderer: WorkerRenderer | null = null

self.onmessage = async (event: MessageEvent<WorkerCommand>) => {
  const message = event.data
  if (message.type === 'pause') activeRenderer?.pause()
  if (message.type === 'resume') activeRenderer?.resume()
  if (message.type === 'dispose') {
    activeRenderer?.dispose()
    activeRenderer = null
  }
  if (message.type !== 'init') return

  try {
    activeRenderer?.dispose()
    activeRenderer = await createRenderer(message)
    postMessage({ type: 'ready' })
  } catch (error) {
    postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) })
  }
}
