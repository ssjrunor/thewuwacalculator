/*
  Author: Runor Ewhro
  Description: Portals build-rail actions into the persistent shell and keeps
               their position synchronized with the active rail slot.
*/

import { useCallback, useLayoutEffect, useMemo, useState } from 'react'
import type { CSSProperties, ReactNode, RefObject } from 'react'
import { createPortal } from 'react-dom'
import { CircleFadingArrowUp, Check, BookOpenText, Sparkles } from 'lucide-react'
import type { ResRuntime } from '@/domain/entities/runtime'
import type { CombatScenarioId } from '@/domain/entities/combatScenario.ts'
import { getResDtlsBy } from '@/data/gameData/resonators/resonatorDataStore.ts'
import { isResRtMaxed, maxResRt } from '@/domain/gameData/resonatorMax.ts'
import { useSkllData } from '@/modules/simulation/features/resonator/SkillDataHost.tsx'
import { openTeamCnsl } from '@/modules/simulation/features/teams/lib/teamConsoleStore.ts'
import { chromePortal } from '@/shared/lib/portalTarget.ts'
import type { BuildWorkspacePage } from './SimulationTools'

type CssVars = CSSProperties & Record<string, string | number>

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

  const level = runtime?.base.level ?? 1
  const climbed = ceiling > 1 ? Math.min(1, Math.max(0, (level - 1) / (ceiling - 1))) : 0

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

  const runMax = useCallback(() => {
    if (!resId || !runtime || maxed) return
    onRuntimeUpdate(resId, (prev) => maxResRt(prev, getResDtlsBy()[resId] ?? null, {
      targetSequence: prev.base.sequence,
    }))
  }, [maxed, onRuntimeUpdate, resId, runtime])

  if (!seat || !resId || !runtime) {
    return null
  }

  return createPortal(
    <div
      className="rdk"
      data-view={page}
      style={{ '--rdk-top': `${seat.top}px`, '--rdk-climb': climbed, '--resonator-accent': accent } as CssVars}
    >
      <DockTab
        role="max"
        label={maxed ? 'Maxed' : 'Max'}
        hint={maxed ? 'Already at maximum' : 'Max level, skills, forte nodes and states'}
        icon={maxed ? <Check size="1em" /> : <CircleFadingArrowUp size="1em" />}
        disabled={maxed}
        onActivate={runMax}
      />
      <span className="rdk-gap" aria-hidden="true" />
      <DockTab
        role="buffs"
        label="Buffs"
        hint="Open the buffs channel for this resonator"
        icon={<Sparkles size="1em" />}
        onActivate={() => openTeamCnsl(resId, 'buffs', scenarioId)}
      />
      <DockTab
        role="skills"
        label="Skills"
        hint="Open skill data for this resonator"
        icon={<BookOpenText size="1em" />}
        onActivate={() => skillData.openFor(resId)}
      />
    </div>,
    seat.host,
  )
}

function DockTab({
  role,
  label,
  hint,
  icon,
  disabled,
  onActivate,
}: {
  role: 'max' | 'buffs' | 'skills'
  label: string
  hint: string
  icon: ReactNode
  disabled?: boolean
  onActivate: () => void
}) {
  return (
    <button
      type="button"
      className="rdk-tab"
      data-role={role}
      data-done={disabled ? 'true' : undefined}
      disabled={disabled}
      aria-label={hint}
      title={hint}
      onClick={onActivate}
    >
      <span className="rdk-word">{label}</span>
      <span className="rdk-glyph" aria-hidden="true">{icon}</span>
    </button>
  )
}
