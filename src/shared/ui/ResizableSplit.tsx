import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Group,
  type GroupImperativeHandle,
  type Layout,
  Panel,
  Separator,
} from 'react-resizable-panels'

interface ResizableSplitProps {
  left: ReactNode
  right: ReactNode
  leftId: string
  rightId: string
  leftClassName?: string
  rightClassName?: string
  isCollapsed?: boolean
  defaultLeftPercent?: number
  minLeftPx?: number
  minRightPx?: number
  storageKey?: string
  stackBelowPx?: number
}

function readStoredPercent(storageKey: string | undefined, fallback: number): number {
  if (!storageKey || typeof window === 'undefined') {
    return fallback
  }

  const raw = window.localStorage.getItem(storageKey)
  const parsed = raw ? Number(raw) : Number.NaN
  if (!Number.isFinite(parsed)) {
    return fallback
  }

  return Math.max(20, Math.min(80, parsed))
}

function persistStoredPercent(storageKey: string | undefined, leftPercent: number) {
  if (!storageKey || typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(storageKey, String(leftPercent))
}

export function ResizableSplit({
  left,
  right,
  leftId,
  rightId,
  leftClassName,
  rightClassName,
  isCollapsed = false,
  defaultLeftPercent = 50,
  minLeftPx = 360,
  minRightPx = 360,
  storageKey,
  stackBelowPx = 1070,
}: ResizableSplitProps) {
  const initialLeftPercent = readStoredPercent(storageKey, defaultLeftPercent)
  const groupRef = useRef<GroupImperativeHandle | null>(null)
  const pendingLeftPercentRef = useRef<number>(initialLeftPercent)
  const [defaultLayout] = useState<Layout>(() => ({
    [leftId]: initialLeftPercent,
    [rightId]: 100 - initialLeftPercent,
  }))
  const [isDragging, setIsDragging] = useState(false)
  const [isStacked, setIsStacked] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.innerWidth <= stackBelowPx
  })

  useEffect(() => {
    if (typeof window === 'undefined') return

    const media = window.matchMedia(`(max-width: ${stackBelowPx}px)`)

    const update = () => {
      setIsStacked(media.matches)
      if (media.matches) {
        setIsDragging(false)
      }
    }

    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [stackBelowPx])

  useEffect(() => {
    if (!isDragging) {
      document.body.classList.remove('split-resizing')
      return
    }

    document.body.classList.add('split-resizing')
    const handlePointerUp = () => setIsDragging(false)
    const handlePointerCancel = () => setIsDragging(false)
    const handleWindowBlur = () => setIsDragging(false)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerCancel)
    window.addEventListener('blur', handleWindowBlur)
    return () => {
      document.body.classList.remove('split-resizing')
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerCancel)
      window.removeEventListener('blur', handleWindowBlur)
    }
  }, [isDragging])

  const shouldSplit = !isCollapsed && !isStacked
  const handleResizeStart = () => setIsDragging(true)
  const handleResizeEnd = () => {
    setIsDragging(false)
    persistStoredPercent(storageKey, pendingLeftPercentRef.current)
  }

  const resetLayout = () => {
    groupRef.current?.setLayout(defaultLayout)
    pendingLeftPercentRef.current = defaultLayout[leftId] ?? defaultLeftPercent
    persistStoredPercent(storageKey, defaultLayout[leftId] ?? defaultLeftPercent)
  }

  return (
    <div
      className={[
        'split',
        'resizable-split',
        isCollapsed ? 'is-collapsed' : '',
        isDragging ? 'is-dragging' : '',
        isStacked ? 'is-stacked' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {shouldSplit ? (
        <Group
          orientation="horizontal"
          id={storageKey ?? `${leftId}:${rightId}`}
          className="split split-inner"
          disableCursor
          groupRef={groupRef}
          defaultLayout={defaultLayout}
          onLayoutChanged={(layout) => {
            pendingLeftPercentRef.current = layout[leftId] ?? defaultLeftPercent
            if (!isDragging) {
              persistStoredPercent(storageKey, pendingLeftPercentRef.current)
            }
          }}
        >
          <Panel
            id={leftId}
            className={['split-panel', leftClassName].filter(Boolean).join(' ')}
            defaultSize={defaultLayout[leftId]}
            minSize={`${minLeftPx}px`}
          >
            {left}
          </Panel>

          <Separator
            className="gutter"
            onDoubleClick={resetLayout}
            onPointerDown={handleResizeStart}
            onPointerUp={handleResizeEnd}
            onPointerCancel={handleResizeEnd}
          />

          <Panel
            id={rightId}
            className={['split-panel', rightClassName].filter(Boolean).join(' ')}
            defaultSize={defaultLayout[rightId]}
            minSize={`${minRightPx}px`}
          >
            {right}
          </Panel>
        </Group>
      ) : (
        <>
          <div id={leftId} className={['split-panel', leftClassName].filter(Boolean).join(' ')}>
            {left}
          </div>
          <div id={rightId} className={['split-panel', rightClassName].filter(Boolean).join(' ')}>
            {right}
          </div>
        </>
      )}
    </div>
  )
}
