/* eslint-disable react-refresh/only-export-features */

/*
  Author: Runor Ewhro
  Description: Hosts app-wide floating selection actions so features can
               register top-center selection toolbars without owning layout.
*/

import { createContext as mkCtx, useContext, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { AnimatePresence as NmtPrsn, motion } from 'motion/react'
import { createPortal } from 'react-dom'
import { bodyPortal } from '@/shared/lib/portalTarget'

export interface FltnSelCtn {
  id: string
  label: ReactNode
  icon?: ReactNode
  title?: string
  disabled?: boolean
  danger?: boolean
  onSelect: () => void
}

export interface FltnSelSssn {
  active: boolean
  ariaLabel?: string
  activationId?: number
  priority?: number
  focusScopeId?: string
  focusScopeEl?: HTMLElement | null
  onRqstExit?: () => void
  groups: FltnSelCtn[][]
}

interface RgstFltnSelS extends FltnSelSssn {
  key: string
  sequence: number
}

interface SelectValue {
  upsert: (key: string, session: FltnSelSssn) => void
  remove: (key: string) => void
}

const SelectContext = mkCtx<SelectValue | null>(null)

function selActSssn(
  sessions: RgstFltnSelS[],
): RgstFltnSelS | null {
  const actSssn = sessions.filter((session) => session.active && session.groups.some((group) => group.length > 0))
  if (actSssn.length === 0) {
    return null
  }

  return actSssn.reduce<RgstFltnSelS | null>((best, session) => {
    if (!best) {
      return session
    }

    const bestPriority = best.priority ?? 0
    const sssnPrrt = session.priority ?? 0
    if (sssnPrrt !== bestPriority) {
      return sssnPrrt > bestPriority ? session : best
    }

    const bestCtvt = best.activationId ?? 0
    const sssnCtvt = session.activationId ?? 0
    if (sssnCtvt !== bestCtvt) {
      return sssnCtvt > bestCtvt ? session : best
    }

    return session.sequence > best.sequence ? session : best
  }, null)
}

function resFcsScp(session: RgstFltnSelS | null): HTMLElement | null {
  if (!session || typeof document === 'undefined') {
    return null
  }

  if (session.focusScopeEl?.isConnected) {
    return session.focusScopeEl
  }

  if (!session.focusScopeId) {
    return null
  }

  return document.querySelector<HTMLElement>(
    `[data-selection-focus-scope="${session.focusScopeId}"]`,
  )
}

function FltnSelCtnsH({ session }: { session: RgstFltnSelS | null }) {
  const actionsRef = useRef<HTMLDivElement | null>(null)
  const portalTarget = (typeof document === 'undefined'
    ? null
    : document.querySelector<HTMLElement>('.app-shell')) ?? bodyPortal()

  useEffect(() => {
    if (!session?.onRqstExit) {
      return
    }

    const onPntrDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) {
        return
      }

      if (actionsRef.current?.contains(target)) {
        return
      }

      if (resFcsScp(session)?.contains(target)) {
        return
      }

      session.onRqstExit?.()
    }

    document.addEventListener('pointerdown', onPntrDown, true)
    return () => {
      document.removeEventListener('pointerdown', onPntrDown, true)
    }
  }, [session])

  if (!portalTarget) {
    return null
  }

  return createPortal(
    <NmtPrsn>
      {session ? (
        <motion.div
          key={session.key}
          ref={actionsRef}
          className="selection-focus-actions"
          role="toolbar"
          aria-label={session.ariaLabel ?? 'Selection actions'}
          initial={{ opacity: 0, y: -18, scale: 0.92, filter: 'blur(8px)' }}
          animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
          exit={{ opacity: 0, y: -12, scale: 0.96, filter: 'blur(6px)' }}
          transition={{
            type: 'spring',
            stiffness: 420,
            damping: 30,
            mass: 0.82,
            opacity: { duration: 0.18, ease: 'easeOut' },
            filter: { duration: 0.2, ease: 'easeOut' },
          }}
          layout
        >
          {session.groups.map((group, groupIndex) => (
            group.length > 0 ? (
              <div key={`${session.key}:group:${groupIndex}`} className="selection-focus-actions__group">
                {group.map((action) => (
                  <button
                    key={action.id}
                    type="button"
                    className={`selection-focus-actions__button${action.danger ? ' danger' : ''}`}
                    title={action.title}
                    disabled={action.disabled}
                    onClick={action.onSelect}
                  >
                    {action.icon ? <span className="selection-focus-actions__icon">{action.icon}</span> : null}
                    <span className="selection-focus-actions__label">{action.label}</span>
                  </button>
                ))}
              </div>
            ) : null
          ))}
        </motion.div>
      ) : null}
    </NmtPrsn>,
    portalTarget,
  )
}

export function FltnSelCtnsP({ children }: { children: ReactNode }) {
  const sequenceRef = useRef(0)
  const [sessions, setSessions] = useState<RgstFltnSelS[]>([])

  const registry = useMemo<SelectValue>(() => ({
    upsert: (key, session) => {
      setSessions((previous) => {
        const nextSequence = sequenceRef.current + 1
        sequenceRef.current = nextSequence
        const nextEntry: RgstFltnSelS = {
          ...session,
          key,
          sequence: nextSequence,
        }

        if (!previous.some((entry) => entry.key === key)) {
          return [...previous, nextEntry]
        }

        return previous.map((entry) => entry.key === key ? nextEntry : entry)
      })
    },
    remove: (key) => {
      setSessions((previous) => previous.filter((entry) => entry.key !== key))
    },
  }), [])

  const actSssnpt = useMemo(() => selActSssn(sessions), [sessions])

  return (
    <SelectContext.Provider value={registry}>
      {children}
      <FltnSelCtnsH session={actSssnpt} />
    </SelectContext.Provider>
  )
}

export function useFltnSelCt(session: FltnSelSssn | null): void {
  const registry = useContext(SelectContext)
  if (!registry) {
    throw new Error('useFloatingSelectionActions must be used within FloatingSelectionActionsProvider')
  }

  const key = useId()

  useEffect(() => {
    return () => {
      registry.remove(key)
    }
  }, [key, registry])

  useEffect(() => {
    if (!session) {
      registry.remove(key)
      return
    }

    registry.upsert(key, session)
  }, [key, registry, session])
}
