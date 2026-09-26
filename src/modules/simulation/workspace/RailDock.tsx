/*
  Author: Runor Ewhro
  Description: Portals build actions into persistent chrome and synchronizes them with the active member.
*/

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AnimationEvent, CSSProperties, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { ResDtls, SkillTabKey } from '@/domain/entities/resonator'
import type { ResRuntime, SkillLevels } from '@/domain/entities/runtime'
import type { CombatScenarioId } from '@/domain/entities/combatScenario.ts'
import { getResDtlsBy } from '@/data/gameData/resonators/resonatorDataStore.ts'
import { isResRtMaxed, maxResRt } from '@/engine/gameData/resonatorMax.ts'
import { getResSeedBy } from '@/data/catalog/resonatorSeedService'
import { loadEnemySummary, type EnemySummary } from '@/data/catalog/enemyCatalogService.ts'
import { useAppStore, selEnemyProf } from '@/application/state'
import type { EnemyProfile } from '@/domain/entities/appState'
import type { AttributeKey } from '@/domain/entities/stats'
import {
  ENEMY_CLASS_TXT,
  ENEMY_ELEM_ATTR,
  ENEMY_PRST,
  getEnemyIcon,
  isEnemyClssI,
  type EnemyElemId,
} from '@/domain/entities/enemy'
import { ATTR_COLORS, getAttributeIconSrc } from '@/domain/gameData/attributeDisplay.ts'
import { openEnemyCnsl } from '@/modules/simulation/features/enemies/ConsoleHost.tsx'
import { openEchoImport } from '@/modules/simulation/features/echoes/lib/echoImportStore.ts'
import { withDefIconM } from '@/shared/lib/imageFallback'
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

const ELEMENTS = Object.keys(ENEMY_ELEM_ATTR).map(Number) as EnemyElemId[]

type Matchup = { word: string, ink: string }

// Tower and open-world tables put an enemy's own element at 60 and 40.
function matchup(res: number, attribute: AttributeKey): Matchup {
  if (res >= 40) return { word: 'Resists you', ink: 'var(--rdk-resist)' }
  if (res <= 0) return { word: 'Weak to you', ink: 'var(--rdk-weak)' }
  return { word: 'Standard', ink: ATTR_COLORS[attribute] }
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

type HudRole = 'max' | 'import' | 'buffs' | 'skills' | 'target'

const HOTKEYS: Record<string, HudRole> = { m: 'max', i: 'import', b: 'buffs', k: 'skills', t: 'target' }

function typingInto(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)
}

const ICONS: Record<Exclude<HudRole, 'target'>, ReactNode> = {
  max: <><path d="m7 11 5-5 5 5" /><path d="m7 18 5-5 5 5" /></>,
  import: <><path d="M3 7V5a2 2 0 0 1 2-2h2" /><path d="M17 3h2a2 2 0 0 1 2 2v2" /><path d="M21 17v2a2 2 0 0 1-2 2h-2" /><path d="M7 21H5a2 2 0 0 1-2-2v-2" /><path d="M8 12h8" /></>,
  buffs: <><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /><path d="M19 17l.6 1.4L21 19l-1.4.6L19 21l-.6-1.4L17 19l1.4-.6z" /></>,
  skills: <><path d="M12 2 21 7v10l-9 5-9-5V7z" /><path d="M12 22V12" /><path d="m21 7-9 5-9-5" /></>,
}

const RING_R = 22
const RING_C = 2 * Math.PI * RING_R

export function RailDock({
  resId,
  runtime,
  scenarioId,
  page,
  accent,
  onRuntimeUpdate,
}: {
  resId: string | null
  runtime: ResRuntime | null
  scenarioId?: CombatScenarioId | null
  page: BuildWorkspacePage
  accent: string
  onRuntimeUpdate: (resonatorId: string, updater: (prev: ResRuntime) => ResRuntime) => void
}) {
  const skillData = useSkllData()
  const enemy = useAppStore(selEnemyProf)
  const [enemySummary, setEnemySummary] = useState<EnemySummary | null>(null)
  useEffect(() => {
    if (!/^\d+$/.test(enemy.id)) return
    let active = true
    void loadEnemySummary().then((summary) => {
      if (active) setEnemySummary(summary)
    }).catch(() => undefined)
    return () => { active = false }
  }, [enemy.id])
  const details = resId ? getResDtlsBy()[resId] ?? null : null

  const preparedMax = useMemo(() => (
    runtime ? maxResRt(runtime, details, { targetSequence: runtime.base.sequence }) : null
  ), [details, runtime])
  const maxed = runtime && preparedMax ? isResRtMaxed(runtime, details, preparedMax) : false
  const ceiling = preparedMax?.base.level ?? 1

  /* Portal outside the named route-transition root into the persistent
     chrome, which spans the viewport, so the dock centres on the page. */
  const [host] = useState(chromePortal)

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
    const resDetails = details
    let before = runtime
    let after = preparedMax ?? runtime
    onRuntimeUpdate(resId, (prev) => {
      before = prev
      after = prev === runtime && preparedMax
        ? preparedMax
        : maxResRt(prev, resDetails, { targetSequence: prev.base.sequence })
      return after
    })
    window.clearTimeout(closeTimer.current)
    setLog(maxLog(resId, before, after, resDetails))
  }, [details, maxed, onRuntimeUpdate, preparedMax, resId, runtime])

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

  // A press sweeps the pressed button's edge once; the sequence restarts it.
  const [cast, setCast] = useState<{ role: HudRole, seq: number } | null>(null)

  const activate = useCallback((role: HudRole) => {
    if (!resId) return
    setCast((prev) => ({ role, seq: (prev?.seq ?? 0) + 1 }))
    if (role === 'max') runMax()
    else if (role === 'import') openEchoImport(resId)
    else if (role === 'buffs') openTeamCnsl(resId, 'buffs', scenarioId)
    else if (role === 'skills') skillData.openFor(resId)
    else openEnemyCnsl()
  }, [resId, runMax, scenarioId, skillData])

  const dockRef = useRef<HTMLDivElement | null>(null)
  const mounted = Boolean(host && resId && runtime)

  // Bare-letter hotkeys, only while the dock is on screen and nothing else
  // (a field, a modal) owns the keyboard.
  useEffect(() => {
    if (!mounted) return undefined
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return
      const role = HOTKEYS[event.key.toLowerCase()]
      if (!role || typingInto(event.target)) return
      if (!dockRef.current?.offsetParent) return
      if (document.querySelector('.app-modal-overlay.open')) return
      event.preventDefault()
      activate(role)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activate, mounted])

  if (!host || !resId || !runtime) {
    return null
  }

  const shownLog = log && log.resId === resId ? log : null
  const seed = getResSeedBy(resId)
  const catalogEntry = enemySummary?.[enemy.id]
  const enemyName = catalogEntry?.name
    ?? ENEMY_PRST.find((preset) => preset.id === enemy.id)?.label
    ?? 'Custom target'
  const castSeq = (role: HudRole) => (cast?.role === role ? cast.seq : null)
  const clearCast = () => setCast(null)

  return createPortal(
    <div
      ref={dockRef}
      className="rdk"
      data-view={page}
      style={{ '--resonator-accent': accent } as CssVars}
    >
      <HudKey
        role="max"
        hotkey="M"
        title={maxed ? 'Maxed' : 'Max build'}
        detail={maxed
          ? 'Level, skills and forte are at the cap'
          : `Lv ${runtime.base.level} → ${ceiling}, skills 10, forte nodes`}
        due={!maxed}
        cast={castSeq('max')}
        onCastEnd={clearCast}
        onActivate={activate}
      />
      <HudKey
        role="import"
        hotkey="I"
        title="Import echoes"
        detail="Read echoes from a build card screenshot"
        cast={castSeq('import')}
        onCastEnd={clearCast}
        onActivate={activate}
      />
      <HudKey
        role="buffs"
        hotkey="B"
        title="Buffs"
        detail="Open the buffs channel"
        cast={castSeq('buffs')}
        onCastEnd={clearCast}
        onActivate={activate}
      />
      <HudKey
        role="skills"
        hotkey="K"
        title="Skill data"
        detail="Skill levels and forte nodes"
        cast={castSeq('skills')}
        onCastEnd={clearCast}
        onActivate={activate}
      />
      <TargetKey
        enemy={enemy}
        name={enemyName}
        element={catalogEntry?.element ?? null}
        attribute={seed?.attribute ?? null}
        cast={castSeq('target')}
        onCastEnd={clearCast}
        onActivate={activate}
      />
      {shownLog ? (
        <MaxLogPanel log={shownLog} onUndo={undoMax} onClose={closeLog} onAnimationEnd={onLogAnimationEnd} />
      ) : null}
    </div>,
    host,
  )
}

function Edge({ cast, onCastEnd, measure }: { cast: number | null, onCastEnd: () => void, measure?: number }) {
  const size = 2 * RING_R + 8
  return (
    <svg className="rdk-ring" viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <circle className="rdk-edge" cx={size / 2} cy={size / 2} r={RING_R} />
      {measure != null ? (
        <circle
          className="rdk-measure"
          cx={size / 2}
          cy={size / 2}
          r={RING_R}
          strokeDasharray={RING_C}
          strokeDashoffset={RING_C * (1 - measure)}
        />
      ) : null}
      {cast != null ? (
        <circle
          key={cast}
          className="rdk-sweep"
          cx={size / 2}
          cy={size / 2}
          r={RING_R}
          strokeDasharray={RING_C}
          style={{ '--rdk-c': RING_C } as CssVars}
          onAnimationEnd={onCastEnd}
        />
      ) : null}
    </svg>
  )
}

function HudKey({
  role,
  hotkey,
  title,
  detail,
  due,
  cast,
  onCastEnd,
  onActivate,
}: {
  role: Exclude<HudRole, 'target'>
  hotkey: string
  title: string
  detail: string
  due?: boolean
  cast: number | null
  onCastEnd: () => void
  onActivate: (role: HudRole) => void
}) {
  return (
    <button
      type="button"
      className="rdk-key"
      data-role={role}
      data-due={due ? 'true' : undefined}
      aria-label={`${title}. ${detail}`}
      aria-keyshortcuts={hotkey}
      onClick={() => onActivate(role)}
    >
      <Edge cast={cast} onCastEnd={onCastEnd} />
      <svg className="rdk-icon" viewBox="0 0 24 24" aria-hidden="true">{ICONS[role]}</svg>
      <kbd className="rdk-kbd" aria-hidden="true">{hotkey}</kbd>
      <span className="rdk-tip" aria-hidden="true">
        {title}
        <small>{detail}</small>
      </span>
    </button>
  )
}

function TargetKey({
  enemy,
  name,
  element,
  attribute,
  cast,
  onCastEnd,
  onActivate,
}: {
  enemy: EnemyProfile
  name: string
  element: EnemyElemId | null
  attribute: AttributeKey | null
  cast: number | null
  onCastEnd: () => void
  onActivate: (role: HudRole) => void
}) {
  const yours = attribute
    ? ELEMENTS.find((id) => ENEMY_ELEM_ATTR[id] === attribute) ?? null
    : null
  const res = yours != null ? enemy.res[yours] : null
  const lands = res != null ? 100 - res : null
  const match = res != null && attribute ? matchup(res, attribute) : null
  const enemyColor = element != null ? ATTR_COLORS[ENEMY_ELEM_ATTR[element]] : 'var(--text)'
  const icon = getEnemyIcon(enemy.id) ?? '/assets/game/default.webp'
  const className = isEnemyClssI(enemy.class) ? ENEMY_CLASS_TXT[enemy.class] : null
  const elementIcon = element != null ? getAttributeIconSrc(ENEMY_ELEM_ATTR[element]) : null
  const label = [
    `Target ${name}, Lv ${enemy.level}.`,
    match && lands != null ? `${match.word}, ${lands}% of your damage lands.` : '',
    'Opens the target console.',
  ].filter(Boolean).join(' ')

  return (
    <button
      type="button"
      className="rdk-key rdk-target"
      data-role="target"
      aria-label={label}
      aria-keyshortcuts="T"
      style={{
        '--rdk-match': match?.ink ?? 'var(--text)',
        '--rdk-enemy': enemyColor,
      } as CssVars}
      onClick={() => onActivate('target')}
    >
      <Edge cast={cast} onCastEnd={onCastEnd} measure={lands != null ? Math.max(0, Math.min(1, lands / 100)) : undefined} />
      <img className="rdk-face" src={icon} alt="" onError={withDefIconM} />
      <kbd className="rdk-kbd" aria-hidden="true">T</kbd>
      <span className="rdk-plate" aria-hidden="true">
        <img className="rdk-plate-art" src={icon} alt="" onError={withDefIconM} />
        <span className="rdk-plate-head">
          <span className="rdk-plate-name">{name}</span>
          <span className="rdk-plate-pills">
            {className ? (
              <span className="rdk-pill">
                {elementIcon ? <img src={elementIcon} alt="" /> : null}
                {className}
              </span>
            ) : null}
            <span className="rdk-pill">Lv {enemy.level}</span>
          </span>
        </span>
        <span className="rdk-wells">
          {ELEMENTS.map((id) => {
            const src = getAttributeIconSrc(ENEMY_ELEM_ATTR[id])
            return (
              <span key={id} className="rdk-well" data-you={id === yours ? 'true' : undefined}>
                <i>{src ? <img src={src} alt="" /> : null}</i>
                {enemy.res[id]}
              </span>
            )
          })}
        </span>
        {match && lands != null && attribute ? (
          <span className="rdk-lands">
            <span>{match.word}. {ATTR_LABEL[attribute]} damage multiplier</span>
            <b>{lands}%</b>
            <span className="rdk-cells">
              {Array.from({ length: 10 }, (_, index) => (
                <i key={index} data-on={index < Math.round(Math.max(0, Math.min(100, lands)) / 10) ? 'true' : undefined} />
              ))}
            </span>
          </span>
        ) : null}
      </span>
    </button>
  )
}

const ATTR_LABEL: Record<AttributeKey, string> = {
  aero: 'Aero',
  glacio: 'Glacio',
  spectro: 'Spectro',
  fusion: 'Fusion',
  electro: 'Electro',
  havoc: 'Havoc',
  physical: 'Physical',
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
