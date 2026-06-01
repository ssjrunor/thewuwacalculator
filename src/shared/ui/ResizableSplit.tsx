/*
  Author: Runor Ewhro
  Description: Two-pane resizable layout wrapper built on react-resizable-panels
               for calculator and page-shell split views.
*/

import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Group,
  type GroupImperativeHandle as GrpMprtOn,
  type Layout,
  Panel,
  Separator,
} from 'react-resizable-panels'

interface RszbSpltPrps {
  left: ReactNode
  right: ReactNode
  leftId: string
  rightId: string
  leftClssName?: string
  rghtClssName?: string
  isCollapsed?: boolean
  defLeftPrcn?: number
  minLeftPx?: number
  minRightPx?: number
  storageKey?: string
  stackBelowPx?: number
}

function readStrdPrcn(storageKey: string | undefined, fallback: number): number {
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

function prssStrdPrcn(storageKey: string | undefined, leftPercent: number) {
  if (!storageKey || typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(storageKey, String(leftPercent))
}

export function RszbSplt({
  left,
  right,
  leftId,
  rightId,
  leftClssName: leftClssName,
  rghtClssName: rghtClssName,
  isCollapsed = false,
  defLeftPrcn: dfltLeftPrcn = 50,
  minLeftPx = 360,
  minRightPx = 360,
  storageKey,
  stackBelowPx = 1070,
}: RszbSpltPrps) {
  const ntlLeftPrcn = readStrdPrcn(storageKey, dfltLeftPrcn)
  const groupRef = useRef<GrpMprtOn | null>(null)
  const pndnLeftPrcn = useRef<number>(ntlLeftPrcn)
  const [dfltLyt] = useState<Layout>(() => ({
    [leftId]: ntlLeftPrcn,
    [rightId]: 100 - ntlLeftPrcn,
  }))
  const [isDragging, setIsDrgg] = useState(false)
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
        setIsDrgg(false)
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
    const onPntrUp = () => setIsDrgg(false)
    const onPntrCncl = () => setIsDrgg(false)
    const onWndwBlur = () => setIsDrgg(false)
    window.addEventListener('pointerup', onPntrUp)
    window.addEventListener('pointercancel', onPntrCncl)
    window.addEventListener('blur', onWndwBlur)
    return () => {
      document.body.classList.remove('split-resizing')
      window.removeEventListener('pointerup', onPntrUp)
      window.removeEventListener('pointercancel', onPntrCncl)
      window.removeEventListener('blur', onWndwBlur)
    }
  }, [isDragging])

  const shouldSplit = !isCollapsed && !isStacked
  const onRszStart = () => setIsDrgg(true)
  const onRszEnd = () => {
    setIsDrgg(false)
    prssStrdPrcn(storageKey, pndnLeftPrcn.current)
  }

  const resetLayout = () => {
    groupRef.current?.setLayout(dfltLyt)
    pndnLeftPrcn.current = dfltLyt[leftId] ?? dfltLeftPrcn
    prssStrdPrcn(storageKey, dfltLyt[leftId] ?? dfltLeftPrcn)
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
          defaultLayout={dfltLyt}
          onLayoutChanged={(layout) => {
            pndnLeftPrcn.current = layout[leftId] ?? dfltLeftPrcn
            if (!isDragging) {
              prssStrdPrcn(storageKey, pndnLeftPrcn.current)
            }
          }}
        >
          <Panel
            id={leftId}
            className={['split-panel', leftClssName].filter(Boolean).join(' ')}
            defaultSize={dfltLyt[leftId]}
            minSize={`${minLeftPx}px`}
          >
            {left}
          </Panel>

          <Separator
            className="gutter"
            onDoubleClick={resetLayout}
            onPointerDown={onRszStart}
            onPointerUp={onRszEnd}
            onPointerCancel={onRszEnd}
          />

          <Panel
            id={rightId}
            className={['split-panel', rghtClssName].filter(Boolean).join(' ')}
            defaultSize={dfltLyt[rightId]}
            minSize={`${minRightPx}px`}
          >
            {right}
          </Panel>
        </Group>
      ) : (
        <>
          <div id={leftId} className={['split-panel', leftClssName].filter(Boolean).join(' ')}>
            {left}
          </div>
          <div id={rightId} className={['split-panel', rghtClssName].filter(Boolean).join(' ')}>
            {right}
          </div>
        </>
      )}
    </div>
  )
}
