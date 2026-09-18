/*
  Author: Runor Ewhro
  Description: Portals build-rail actions into the persistent shell and keeps
               their position synchronized with the active rail slot.
*/

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { AnimationEvent, CSSProperties, RefObject } from 'react'
import { createPortal } from 'react-dom'
import type { ResDtls, SkillTabKey } from '@/domain/entities/resonator'
import type { ResRuntime, SkillLevels } from '@/domain/entities/runtime'
import type { CombatScenarioId } from '@/domain/entities/combatScenario.ts'
import { getResDtlsBy } from '@/data/gameData/resonators/resonatorDataStore.ts'
import { isResRtMaxed, maxResRt } from '@/domain/gameData/resonatorMax.ts'
import { getResSeedBy } from '@/domain/services/resonatorSeedService'
import { useSkllData } from '@/modules/simulation/features/resonator/SkillDataHost.tsx'
import { openTeamCnsl } from '@/modules/simulation/features/teams/lib/teamConsoleStore.ts'
import { chromePortal } from '@/shared/lib/portalTarget.ts'
import type { BuildWorkspacePage } from './SimulationTools'

type CssVars = CSSProperties & Record<string, string | number>

type LogRow = { label: string, value: string }

type DockLog = {
  resId: string
  name: string
  rows: LogRow[]
  changes: number
  before: ResRuntime
  after: ResRuntime
  undone?: 'done' | 'blocked'
  closing?: boolean
}

const NOISE = 'ABCDEFGHJKLMNPRSTVXZ0123456789#/+=<>'
const FAR = -1e5

const pad = (value: number) => String(value).padStart(2, '0')

function skillTabs(runtime: ResRuntime, details: ResDtls | null): Array<keyof SkillLevels> {
  if (!details) return []
  return (Object.keys(details.skillsByTab) as SkillTabKey[])
    .filter((tab): tab is keyof SkillLevels => tab !== 'outroSkill' && tab in runtime.base.skillLevels)
}

function skillSpan(runtime: ResRuntime, tabs: Array<keyof SkillLevels>): string {
  if (!tabs.length) return '-'
  const levels = tabs.map((tab) => runtime.base.skillLevels[tab])
  const low = Math.min(...levels)
  const high = Math.max(...levels)
  return low === high ? String(low) : `${low}-${high}`
}

function activeNodes(runtime: ResRuntime, details: ResDtls | null): number {
  const active = runtime.base.traceNodes.activeNodes
  return details
    ? details.traceNodes.filter((node) => active[node.id]).length
    : Object.values(active).filter(Boolean).length
}

function changedControls(before: ResRuntime, after: ResRuntime): number {
  const keys = new Set([...Object.keys(before.state.controls), ...Object.keys(after.state.controls)])
  return [...keys].filter((key) => !Object.is(before.state.controls[key], after.state.controls[key])).length
}

function maxLog(resId: string, before: ResRuntime, after: ResRuntime, details: ResDtls | null): DockLog {
  const tabs = skillTabs(before, details)
  const total = details?.traceNodes.length ?? 0
  const nodesBefore = activeNodes(before, details)
  const nodesAfter = activeNodes(after, details)
  const skillsBefore = skillSpan(before, tabs)
  const skillsAfter = skillSpan(after, tabs)
  const states = changedControls(before, after)
  const rows: LogRow[] = [{ label: 'level', value: `${pad(before.base.level)} → ${pad(after.base.level)}` }]
  if (tabs.length) rows.push({ label: `skills ×${tabs.length}`, value: `${skillsBefore} → ${skillsAfter}` })
  if (total) rows.push({ label: 'forte nodes', value: `${nodesBefore} → ${nodesAfter}` })
  rows.push({ label: 'states', value: states ? `${states} set` : 'unchanged' })

  const changes = [
    before.base.level !== after.base.level,
    skillsBefore !== skillsAfter,
    nodesBefore !== nodesAfter,
    states > 0,
  ].filter(Boolean).length

  return { resId, name: getResSeedBy(resId)?.name ?? '', rows, changes, before, after }
}

function sameMaxed(current: ResRuntime, after: ResRuntime): boolean {
  return current.base.level === after.base.level
    && current.base.sequence === after.base.sequence
    && JSON.stringify(current.base.skillLevels) === JSON.stringify(after.base.skillLevels)
    && JSON.stringify(current.base.traceNodes.activeNodes) === JSON.stringify(after.base.traceNodes.activeNodes)
    && JSON.stringify(current.state.controls) === JSON.stringify(after.state.controls)
}

function paintGlyphs(glyphs: NodeListOf<HTMLElement>, reveal: number) {
  const count = glyphs.length
  const open = Math.round(reveal * count)
  glyphs.forEach((glyph, index) => {
    const char = glyph.dataset.c ?? ''
    const plain = index < open || char === ' ' || char === '·'
    const next = plain
      ? (char === ' ' ? ' ' : char)
      : NOISE[Math.floor(Math.random() * NOISE.length)]
    if (glyph.dataset.t !== next) glyph.dataset.t = next
    glyph.toggleAttribute('data-noise', !plain)
  })
}

function motionOff(): boolean {
  return document.documentElement.classList.contains('reduce-animation')
}

function Glyphs({ text, className }: { text: string, className?: string }) {
  return (
    <span className={className} aria-hidden="true">
      {text.split('').map((char, index) => (
        <span key={index} className="rdk-ch" data-c={char} data-t={char === ' ' ? ' ' : char} />
      ))}
    </span>
  )
}

export function RailDock({
  anchorRef,
  resId,
  runtime,
  scenarioId,
  page,
  accent,
  onRuntimeUpdate,
}: {
  anchorRef: RefObject<HTMLElement | null>
  resId: string | null
  runtime: ResRuntime | null
  scenarioId?: CombatScenarioId | null
  page: BuildWorkspacePage
  accent: string
  onRuntimeUpdate: (resonatorId: string, updater: (prev: ResRuntime) => ResRuntime) => void
}) {
  const skillData = useSkllData()
  const details = resId ? getResDtlsBy()[resId] ?? null : null

  // Derive the progression ceiling from the same maxing operation used by the action.
  const ceiling = useMemo(() => (
    runtime ? maxResRt(runtime, details, { targetSequence: runtime.base.sequence }).base.level : 1
  ), [details, runtime])
  const maxed = useMemo(() => (
    runtime ? isResRtMaxed(runtime, details) : false
  ), [details, runtime])

  /* Portal outside the named route-transition root, but copy the rail slot's
     viewport position after layout. Resize, transition, and next-frame updates
     cover geometry changes that do not share a React render. */
  const [seat, setSeat] = useState<{ host: HTMLElement, top: number } | null>(null)
  useLayoutEffect(() => {
    const anchor = anchorRef.current
    const slot = anchor?.parentElement
    if (!anchor || !slot) return undefined

    const sync = () => {
      const host = anchor.closest<HTMLElement>('.ax-chrome') ?? chromePortal()
      if (!host) return
      const top = Math.round((anchor.getBoundingClientRect().top - host.getBoundingClientRect().top) * 2.5)
      setSeat((prev) => (prev && prev.host === host && prev.top === top ? prev : { host, top }))
    }
    sync()
    const frame = requestAnimationFrame(sync)

    const observer = new ResizeObserver(sync)
    observer.observe(anchor)
    observer.observe(slot)
    anchor.addEventListener('animationend', sync)
    window.addEventListener('resize', sync)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      anchor.removeEventListener('animationend', sync)
      window.removeEventListener('resize', sync)
    }
  }, [anchorRef, resId])

  const [log, setLog] = useState<DockLog | null>(null)
  const closeTimer = useRef(0)
  useEffect(() => {
    const timer = closeTimer
    return () => window.clearTimeout(timer.current)
  }, [])

  const closeLog = useCallback(() => {
    setLog((prev) => (prev ? { ...prev, closing: true } : prev))
  }, [])

  const runMax = useCallback(() => {
    if (!resId || !runtime || maxed) return
    const resDetails = getResDtlsBy()[resId] ?? null
    let before = runtime
    let after = maxResRt(runtime, resDetails, { targetSequence: runtime.base.sequence })
    onRuntimeUpdate(resId, (prev) => {
      before = prev
      after = maxResRt(prev, getResDtlsBy()[resId] ?? null, { targetSequence: prev.base.sequence })
      return after
    })
    window.clearTimeout(closeTimer.current)
    setLog(maxLog(resId, before, after, resDetails))
  }, [maxed, onRuntimeUpdate, resId, runtime])

  const undoMax = useCallback(() => {
    if (!log || log.undone) return
    let applied = false
    onRuntimeUpdate(log.resId, (prev) => {
      if (!sameMaxed(prev, log.after)) return prev
      applied = true
      return {
        ...prev,
        base: log.before.base,
        state: { ...prev.state, controls: log.before.state.controls },
      }
    })
    setLog({ ...log, undone: applied ? 'done' : 'blocked' })
    window.clearTimeout(closeTimer.current)
    closeTimer.current = window.setTimeout(closeLog, 1400)
  }, [closeLog, log, onRuntimeUpdate])

  const onLogAnimationEnd = useCallback((event: AnimationEvent<HTMLDivElement>) => {
    if (event.animationName === 'rdk-timer') closeLog()
    if (event.animationName === 'rdk-log-out') setLog(null)
  }, [closeLog])

  const dockRef = useRef<HTMLDivElement | null>(null)
  const mounted = Boolean(seat && resId && runtime)
  const shownLog = log && log.resId === resId ? log : null

  useEffect(() => {
    const dock = dockRef.current
    if (!mounted || !dock) return undefined

    let px = FAR
    let py = FAR
    let touch = window.matchMedia('(hover: none)').matches
    const reveal = new WeakMap<Element, number>()

    const onMove = (event: PointerEvent) => {
      touch = event.pointerType === 'touch'
      px = event.clientX
      py = event.clientY
    }
    const onLeave = () => {
      px = FAR
      py = FAR
    }

    const tick = () => {
      if (document.hidden) return
      const calm = touch || motionOff()
      const keys = dock.querySelectorAll<HTMLElement>('.rdk-key')
      const logOpen = Boolean(dock.querySelector('.rdk-log'))
      let near: HTMLElement | null = null
      let nearest = 70

      keys.forEach((key) => {
        const rect = key.getBoundingClientRect()
        const dx = Math.max(0, rect.left - px)
        const dy = Math.max(0, Math.abs(py - (rect.top + rect.height / 2)) - rect.height / 2)
        const distance = key === document.activeElement ? -1 : Math.hypot(dx, dy * 1.4)
        if (distance < nearest) {
          near = key
          nearest = distance
        }
      })

      keys.forEach((key) => {
        const line = key.querySelector<HTMLElement>('.rdk-line')
        if (!line) return
        const on = key === near && !logOpen
        const current = reveal.get(line) ?? 0
        const next = on ? Math.min(1, current + (calm ? 1 : 0.12)) : 0
        reveal.set(line, next)
        line.toggleAttribute('data-on', on)
        paintGlyphs(line.querySelectorAll<HTMLElement>('.rdk-ch'), next)
      })
    }

    tick()
    const interval = window.setInterval(tick, 60)
    window.addEventListener('pointermove', onMove, { passive: true })
    document.documentElement.addEventListener('pointerleave', onLeave)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('pointermove', onMove)
      document.documentElement.removeEventListener('pointerleave', onLeave)
    }
  }, [mounted, seat?.host])

  if (!seat || !resId || !runtime) {
    return null
  }

  const tabs = skillTabs(runtime, details)
  const nodes = activeNodes(runtime, details)
  const nodeTotal = details?.traceNodes.length ?? 0
  const maxLine = maxed
    ? `LV ${pad(runtime.base.level)} · SKILLS ${skillSpan(runtime, tabs)} · FORTE ${nodes}/${nodeTotal}`
    : `LV ${pad(runtime.base.level)} > ${pad(ceiling)} · SKILLS 10 · FORTE ${nodeTotal}/${nodeTotal}`

  return createPortal(
    <div
      ref={dockRef}
      className="rdk"
      data-view={page}
      style={{ '--rdk-top': `${seat.top}px`, '--resonator-accent': accent } as CssVars}
    >
      <i className="rdk-spine" aria-hidden="true" />
      <DockKey
        role="max"
        word={maxed ? 'MAXED' : 'MAX'}
        line={maxLine}
        hint={maxed ? 'Already at maximum' : 'Max level, skills, forte nodes and states'}
        done={maxed}
        onActivate={runMax}
      />
      <DockKey
        role="buffs"
        word="BUFFS"
        line="BUFFS"
        hint="Open the buffs channel for this resonator"
        onActivate={() => openTeamCnsl(resId, 'buffs', scenarioId)}
      />
      <DockKey
        role="skills"
        word="SKILLS"
        line={`LV.${skillSpan(runtime, tabs)} · NODES ${nodes}/${nodeTotal}`}
        hint="Open skill data for this resonator"
        onActivate={() => skillData.openFor(resId)}
      />
      {shownLog ? (
        <MaxLogPanel log={shownLog} onUndo={undoMax} onClose={closeLog} onAnimationEnd={onLogAnimationEnd} />
      ) : null}
    </div>,
    seat.host,
  )
}

function DockKey({
  role,
  word,
  line,
  hint,
  done,
  onActivate,
}: {
  role: 'max' | 'buffs' | 'skills'
  word: string
  line: string
  hint: string
  done?: boolean
  onActivate: () => void
}) {
  return (
    <button
      type="button"
      className="rdk-key"
      data-role={role}
      data-done={done ? 'true' : undefined}
      aria-disabled={done || undefined}
      aria-label={hint}
      title={hint}
      onClick={done ? undefined : onActivate}
    >
      <span className="rdk-word" aria-hidden="true">{word}</span>
      <Glyphs text={line} className="rdk-line" />
    </button>
  )
}

function MaxLogPanel({
  log,
  onUndo,
  onClose,
  onAnimationEnd,
}: {
  log: DockLog
  onUndo: () => void
  onClose: () => void
  onAnimationEnd: (event: AnimationEvent<HTMLDivElement>) => void
}) {
  const panelRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const panel = panelRef.current
    if (!panel) return undefined
    const start = performance.now()
    const rows = panel.querySelectorAll<HTMLElement>('.rdk-log-row')

    const tick = () => {
      const elapsed = motionOff() ? Infinity : performance.now() - start
      let done = true
      rows.forEach((row, index) => {
        const reveal = Math.min(1, Math.max(0, (elapsed - 200 - index * 190) / 240))
        if (reveal < 1) done = false
        paintGlyphs(row.querySelectorAll<HTMLElement>('.rdk-ch'), reveal)
      })
      if (done) window.clearInterval(interval)
    }

    const interval = window.setInterval(tick, 40)
    tick()
    return () => window.clearInterval(interval)
  }, [])

  const footer = log.undone === 'done'
    ? `Back to Lv ${log.before.base.level}`
    : log.undone === 'blocked'
      ? 'Build changed since, nothing undone'
      : 'Undo is available for a few seconds'

  return (
    <div
      ref={panelRef}
      className="rdk-log"
      role="status"
      data-closing={log.closing ? 'true' : undefined}
      onAnimationEnd={onAnimationEnd}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose()
      }}
    >
      <div className="rdk-log-head">
        <span>MAX · <b>{log.name.toUpperCase()}</b></span>
        <span>{log.changes} {log.changes === 1 ? 'CHANGE' : 'CHANGES'}</span>
      </div>
      <div className="rdk-log-rows">
        {log.rows.map((row, index) => (
          <div key={row.label} className="rdk-log-row" style={{ '--i': index } as CssVars}>
            <i aria-hidden="true">&gt;</i>
            <Glyphs text={row.label} />
            <Glyphs text={row.value} />
            <em aria-hidden="true">OK</em>
            <span className="rdk-sr">{`${row.label} ${row.value}`}</span>
          </div>
        ))}
      </div>
      <div className="rdk-log-foot">
        <span>{footer}</span>
        <button type="button" className="rdk-undo" disabled={Boolean(log.undone)} onClick={onUndo}>
          {log.undone === 'done' ? 'Undone' : 'Undo'}
        </button>
        {log.undone ? null : <i className="rdk-timer" aria-hidden="true" />}
      </div>
    </div>
  )
}
