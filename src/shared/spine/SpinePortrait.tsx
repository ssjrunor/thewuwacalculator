/*
  Author: Runor Ewhro
  Description: Manages Spine manifest fallback, resolution selection, playback,
               and worker-backed rendering for reusable resonator portraits.
*/

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { createSpineInstance } from './spineEngine.ts'
import type { SpineInstance } from './spineEngine.ts'
import { getLoadedSpineManifest, loadSpineManifest, spineBaseUrl, spineSetupUrl } from './spineManifest.ts'
import type { SpineVariant } from './spineManifest.ts'

export interface SpinePlacement {
  /** Focal point in the intrinsic square canvas coordinate space. */
  x: number
  y: number
  /** Canvas scale relative to the containing block. */
  scale: number
}

const SPINE_PLACEMENT_SPACE = 4096
const SPINE_RESOLUTION_BUCKETS = [1024, 1536, 2048, 2560, 3072] as const
const SPINE_DPR_CAP = 1.5
const SPINE_RESIZE_SETTLE_MS = 520
function chooseSpineResolution(cssSize: number): number {
  const dpr = Math.min(SPINE_DPR_CAP, Math.max(1, window.devicePixelRatio || 1))
  const target = Math.max(SPINE_RESOLUTION_BUCKETS[0], cssSize * dpr)
  return SPINE_RESOLUTION_BUCKETS.find((size) => size >= target)
    ?? SPINE_RESOLUTION_BUCKETS[SPINE_RESOLUTION_BUCKETS.length - 1]
}

function placementStyle({ x, y, scale }: SpinePlacement, canvasSize: number): CSSProperties {
  return {
    left: '50%',
    top: '50%',
    width: `${scale * 100}%`,
    height: `${scale * 100}%`,
    transform: `translate(${-(x / canvasSize) * 100}%, ${-(y / canvasSize) * 100}%)`,
  }
}

function useSpineVariantAvailable(resId: string | null, variant: SpineVariant): boolean | null {
  const [manifest, setManifest] = useState<Awaited<ReturnType<typeof loadSpineManifest>> | null>(
    () => getLoadedSpineManifest(),
  )

  useEffect(() => {
    if (manifest) return undefined
    let live = true
    loadSpineManifest().then((loaded) => {
      if (live) setManifest(loaded)
    })
    return () => {
      live = false
    }
  }, [manifest])

  if (!resId) return false
  if (!manifest) return null
  return Boolean(manifest[resId]?.[variant])
}

export function SpineSetupBackground({
  resId,
  fallbackUrl,
  className,
  variant = 'luckdraw',
  style,
}: {
  resId: string | null
  fallbackUrl: string
  className: string
  variant?: SpineVariant
  style?: CSSProperties
}) {
  const variantAvailable = useSpineVariantAvailable(resId, variant)

  if (variantAvailable == null) {
    return <SpineBackgroundLayer className={className} imageUrl={fallbackUrl} style={style} />
  }
  if (!variantAvailable || !resId) {
    return <SpineBackgroundLayer className={className} imageUrl={fallbackUrl} style={style} />
  }

  return (
    <SpineSetupBackgroundLayer
      key={`${resId}:${variant}`}
      resId={resId}
      variant={variant}
      className={className}
      style={style}
    />
  )
}

function SpineSetupBackgroundLayer({
  resId,
  variant,
  className,
  style,
}: {
  resId: string
  variant: SpineVariant
  className: string
  style?: CSSProperties
}) {
  return <SpineBackgroundLayer className={className} imageUrl={spineSetupUrl(resId, variant)} style={style} />
}

function SpineBackgroundLayer({
  className,
  imageUrl,
  style,
}: {
  className: string
  imageUrl: string
  style?: CSSProperties
}) {
  return (
    <div
      className={className}
      style={{ backgroundImage: `url("${imageUrl}")`, ...style }}
      aria-hidden="true"
    />
  )
}

function SpineCanvas({
  resId,
  variant,
  placementSpace,
  zoom,
  className,
  placement,
  playing,
  onPreparing,
  onReady,
  onUnsupported,
}: {
  resId: string
  variant: SpineVariant
  placementSpace: number
  zoom: number
  className: string
  placement: SpinePlacement
  playing: boolean
  onPreparing: () => void
  onReady: () => void
  onUnsupported: () => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const instanceRef = useRef<SpineInstance | null>(null)
  const renderSizeRef = useRef<number | null>(null)
  const resizeTimerRef = useRef<number | null>(null)
  const [renderSize, setRenderSize] = useState<number | null>(null)
  const onReadyRef = useRef(onReady)
  const onUnsupportedRef = useRef(onUnsupported)
  const onPreparingRef = useRef(onPreparing)
  const playingRef = useRef(playing)
  const intersectingRef = useRef(true)
  const windowActiveRef = useRef(
    typeof document === 'undefined' || (!document.hidden && document.hasFocus()),
  )

  useEffect(() => {
    onReadyRef.current = onReady
    onUnsupportedRef.current = onUnsupported
    onPreparingRef.current = onPreparing
  })

  const syncPlayback = useCallback(() => {
    const instance = instanceRef.current
    if (!instance) return
    if (playingRef.current && intersectingRef.current && windowActiveRef.current) instance.resume()
    else instance.pause()
  }, [])

  useEffect(() => {
    playingRef.current = playing
    syncPlayback()
  }, [playing, syncPlayback])

  useLayoutEffect(() => {
    const canvas = canvasRef.current
    const container = canvas?.parentElement
    if (!canvas || !container || typeof ResizeObserver === 'undefined') return undefined

    const clearResizeTimer = () => {
      if (resizeTimerRef.current != null) {
        window.clearTimeout(resizeTimerRef.current)
        resizeTimerRef.current = null
      }
    }
    const measure = () => {
      const bounds = canvasRef.current?.getBoundingClientRect()
      const cssSize = bounds ? Math.max(bounds.width, bounds.height) : 0
      if (cssSize <= 0) return
      const nextSize = chooseSpineResolution(cssSize)
      const currentSize = renderSizeRef.current
      // Shrinking a live canvas requires a new OffscreenCanvas, worker, WebGL
      // context, atlas decode, and texture upload. Keep the high-water bucket
      // for this mounted portrait so routine layout changes never churn those
      // native allocations.
      if (nextSize === currentSize || (currentSize != null && nextSize < currentSize)) {
        clearResizeTimer()
        return
      }

      clearResizeTimer()
      const delay = currentSize == null ? 0 : SPINE_RESIZE_SETTLE_MS
      resizeTimerRef.current = window.setTimeout(() => {
        resizeTimerRef.current = null
        if (renderSizeRef.current != null) onPreparingRef.current()
        renderSizeRef.current = nextSize
        setRenderSize(nextSize)
      }, delay)
    }

    const observer = new ResizeObserver(measure)
    observer.observe(container)
    window.addEventListener('resize', measure, { passive: true })
    measure()
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
      clearResizeTimer()
    }
  }, [placement.scale])

  useEffect(() => {
    if (renderSize == null) return undefined
    const canvas = canvasRef.current!
    let disposed = false
    const abortController = new AbortController()

    // StrictMode probes effects with setup -> cleanup -> setup on the same DOM
    // node. Defer the one-shot canvas transfer so the probe cleanup can cancel
    // the first attempt before transferControlToOffscreen() runs.
    const startFrame = requestAnimationFrame(() => {
      createSpineInstance(
        canvas,
        spineBaseUrl(resId, variant),
        'skel.skel',
        'atlas.atlas',
        abortController.signal,
        () => {
          if (!disposed) onUnsupportedRef.current()
        },
        zoom,
      )
        .then((instance) => {
          if (disposed) {
            instance.dispose()
            return
          }
          instanceRef.current = instance
          syncPlayback()
          onReadyRef.current()
        })
        .catch((err) => {
          if ((err as DOMException | undefined)?.name === 'AbortError') return
          if (!disposed) onUnsupportedRef.current()
        })
    })

    return () => {
      disposed = true
      cancelAnimationFrame(startFrame)
      abortController.abort()
      instanceRef.current?.dispose()
      instanceRef.current = null
    }
  }, [renderSize, resId, syncPlayback, variant, zoom])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || typeof IntersectionObserver === 'undefined') return undefined
    const observer = new IntersectionObserver((entries) => {
      intersectingRef.current = entries.some((entry) => entry.isIntersecting)
      syncPlayback()
    }, { threshold: 0.01 })
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [renderSize, syncPlayback])

  useEffect(() => {
    const syncWindowActivity = () => {
      windowActiveRef.current = !document.hidden && document.hasFocus()
      syncPlayback()
    }
    document.addEventListener('visibilitychange', syncWindowActivity)
    window.addEventListener('focus', syncWindowActivity)
    window.addEventListener('blur', syncWindowActivity)
    return () => {
      document.removeEventListener('visibilitychange', syncWindowActivity)
      window.removeEventListener('focus', syncWindowActivity)
      window.removeEventListener('blur', syncWindowActivity)
    }
  }, [syncPlayback])

  return (
    <canvas
      key={renderSize ?? 'probe'}
      ref={canvasRef}
      width={renderSize ?? 1}
      height={renderSize ?? 1}
      className={className}
      style={placementStyle(placement, placementSpace)}
      data-spine-variant={variant}
      data-spine-resolution={renderSize ?? undefined}
      aria-hidden="true"
    />
  )
}

export function SpinePortrait({
  resId,
  variant = 'luckdraw',
  animated,
  spineClassName,
  placementSpace = SPINE_PLACEMENT_SPACE,
  zoom = 1,
  playing = true,
  placement,
  fallback,
  overrideImageUrl,
}: {
  resId: string | null
  variant?: SpineVariant
  animated: boolean
  spineClassName: string
  placementSpace?: number
  zoom?: number
  playing?: boolean
  placement: SpinePlacement
  fallback: ReactNode
  overrideImageUrl?: string | null
}) {
  const variantAvailable = useSpineVariantAvailable(resId, variant)

  if (overrideImageUrl) {
    return (
      <OverridePortrait
        key={overrideImageUrl}
        url={overrideImageUrl}
        spineClassName={spineClassName}
        style={placementStyle(placement, placementSpace)}
      />
    )
  }

  // Pending and missing are distinct: defer fallback selection until the manifest resolves.
  if (variantAvailable == null) return null
  if (!variantAvailable || !resId) return fallback

  return (
    <SpineLayers
      key={`${resId}:${variant}`}
      resId={resId}
      variant={variant}
      animated={animated}
      spineClassName={spineClassName}
      placementSpace={placementSpace}
      zoom={zoom}
      playing={playing}
      placement={placement}
      fallback={fallback}
    />
  )
}

function OverridePortrait({
  url,
  spineClassName,
  style,
}: {
  url: string
  spineClassName: string
  style: CSSProperties
}) {
  const [loaded, setLoaded] = useState(false)
  return (
    <img
      className={`${spineClassName} is-override${loaded ? ' is-ready' : ''}`}
      style={style}
      src={url}
      alt=""
      aria-hidden="true"
      draggable={false}
      onLoad={() => setLoaded(true)}
    />
  )
}

function SpineLayers({
  resId,
  variant,
  animated,
  spineClassName,
  placementSpace,
  zoom,
  playing,
  placement,
  fallback,
}: {
  resId: string
  variant: SpineVariant
  animated: boolean
  spineClassName: string
  placementSpace: number
  zoom: number
  playing: boolean
  placement: SpinePlacement
  fallback: ReactNode
}) {
  const [setupReady, setSetupReady] = useState(false)
  const [setupPresented, setSetupPresented] = useState(false)
  const [setupUnsupported, setSetupUnsupported] = useState(false)
  const [animationReady, setAnimationReady] = useState(false)
  const [animationUnsupported, setAnimationUnsupported] = useState(false)
  const setupFrameRef = useRef<number | null>(null)

  useEffect(() => () => {
    if (setupFrameRef.current != null) cancelAnimationFrame(setupFrameRef.current)
  }, [])

  // Pausing preserves the worker, WebGL context, and decoded atlas; `animated`
  // controls playback while the allocated canvas remains mounted.
  const [canvasMounted, setCanvasMounted] = useState(animated)
  const [wasAnimated, setWasAnimated] = useState(animated)
  if (wasAnimated !== animated) {
    setWasAnimated(animated)
    if (animated) {
      setCanvasMounted(true)
      // Re-enabling after a failed attempt is the user asking to retry, and
      // that retry does mount a fresh canvas owing its own ready signal.
      if (animationUnsupported) {
        setAnimationUnsupported(false)
        setAnimationReady(false)
      }
    }
  }

  const showAnimation = canvasMounted && !animationUnsupported
  const animationVisible = animated && showAnimation && animationReady && setupPresented

  return (
    <>
      {setupUnsupported ? fallback : null}
      {!setupUnsupported ? (
        <img
          src={spineSetupUrl(resId, variant)}
          alt=""
          className={`${spineClassName} spine-setup${setupReady ? ' is-ready' : ''}${animationVisible ? ' is-obscured' : ''}`}
          style={placementStyle(placement, placementSpace)}
          decoding="async"
          draggable={false}
          aria-hidden="true"
          onLoad={() => {
            setSetupReady(true)
            if (setupFrameRef.current != null) cancelAnimationFrame(setupFrameRef.current)
            setupFrameRef.current = requestAnimationFrame(() => {
              setupFrameRef.current = null
              setSetupPresented(true)
            })
          }}
          onError={() => {
            if (setupFrameRef.current != null) cancelAnimationFrame(setupFrameRef.current)
            setupFrameRef.current = null
            setSetupReady(false)
            setSetupPresented(false)
            setSetupUnsupported(true)
          }}
        />
      ) : null}
      {showAnimation ? (
        <SpineCanvas
          resId={resId}
          variant={variant}
          placementSpace={placementSpace}
          zoom={zoom}
          playing={playing && animated}
          placement={placement}
          className={`${spineClassName} spine-animated${animationVisible ? ' is-ready' : ''}`}
          onPreparing={() => setAnimationReady(false)}
          onReady={() => setAnimationReady(true)}
          onUnsupported={() => {
            setAnimationReady(false)
            setAnimationUnsupported(true)
          }}
        />
      ) : null}
    </>
  )
}
