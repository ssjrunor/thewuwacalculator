/*
  Author: Runor Ewhro
  Description: Renders the left surface for the calculator main flow.
*/

import { Suspense, lazy } from 'react'
import type { EnemyProfile, LeftPaneView } from '@/domain/entities/appState'
import type { ResRuntime } from '@/domain/entities/runtime'
import type { SimResult } from '@/engine/pipeline/types'
import { Resonator } from '@/modules/calculator/features/resonator/Pane.tsx'
import AppLdrVrly from '@/shared/ui/AppLoaderOverlay'

const LazyRotPane = lazy(async () => ({
  default: (await import('@/modules/calculator/features/rotation/Pane.tsx')).Rotation,
}))

const LazyCalcBffs = lazy(async () => ({
  default: (await import('@/modules/calculator/features/buffs/BuffsPane.tsx')).BuffsPane,
}))

const LazyCalcChsP = lazy(async () => ({
  default: (await import('@/modules/calculator/features/echoes/Pane.tsx')).Echoes,
}))

const LazyCalcEnem = lazy(async () => ({
  default: (await import('@/modules/calculator/features/enemies/Pane.tsx')).CalcEnemyPmg,
}))

const LazyCalcSugg = lazy(async () => ({
  default: (await import('@/modules/calculator/features/suggesstions/Pane.tsx')).Suggestions,
}))

const LazyCalcTmsP = lazy(async () => ({
  default: (await import('@/modules/calculator/features/teams/Pane.tsx')).Teams,
}))

const LazyCalcWpnP = lazy(async () => ({
  default: (await import('@/modules/calculator/features/weapons/Pane.tsx')).Weapon,
}))

interface CalcLeftPane {
  view: LeftPaneView
  actResId: string | null
  runtime: ResRuntime | null
  prtcRntmById: Record<string, ResRuntime>
  simulation: SimResult | null
  enemyProfile: EnemyProfile
  isDarkMode: boolean
  onRtPdt: (updater: (runtime: ResRuntime) => ResRuntime) => void
  onEnemyChange: (enemy: EnemyProfile) => void
}

function LeftPaneLdr({ text }: { text: string }) {
  return (
    <section className="calc-pane">
      <AppLdrVrly mode="centered" text={text} />
    </section>
  )
}

// routes the left main view selection to the pane that owns each concern.
export function Left({
  view,
  actResId: actResId,
  runtime,
  prtcRntmById: partRntmById,
  simulation,
  enemyProfile,
  isDarkMode,
  onRtPdt: onRtPdt,
  onEnemyChange: onNmyPrflChn,
}: CalcLeftPane) {
  if (!runtime) {
    return <section className="calc-pane">Select a resonator to begin.</section>
  }

  if (view === 'resonators') {
    return (
      <Resonator
        runtime={runtime}
        actResId={actResId}
        onRtPdt={onRtPdt}
        isDarkMode={isDarkMode}
      />
    )
  }

  if (view === 'buffs') {
    return (
      <Suspense fallback={<LeftPaneLdr text="Loading buffs..." />}>
        <LazyCalcBffs
          runtime={runtime}
          onRtPdt={onRtPdt}
        />
      </Suspense>
    )
  }

  if (view === 'echoes') {
    return (
      <Suspense fallback={<LeftPaneLdr text="Loading echoes..." />}>
        <LazyCalcChsP
          runtime={runtime}
          onRtPdt={onRtPdt}
        />
      </Suspense>
    )
  }

  if (view === 'enemy') {
    return (
      <Suspense fallback={<LeftPaneLdr text="Loading enemy controls..." />}>
        <LazyCalcEnem
          runtime={runtime}
          enemyProfile={enemyProfile}
          simulation={simulation}
          onRtPdt={onRtPdt}
          onEnemyChange={onNmyPrflChn}
        />
      </Suspense>
    )
  }

  if (view === 'weapon') {
    return (
      <Suspense fallback={<LeftPaneLdr text="Loading weapon controls..." />}>
        <LazyCalcWpnP
          runtime={runtime}
          onRtPdt={onRtPdt}
        />
      </Suspense>
    )
  }

  if (view === 'teams') {
    return (
      <Suspense fallback={<LeftPaneLdr text="Loading team buffs..." />}>
        <LazyCalcTmsP
          runtime={runtime}
          prtcRntmById={partRntmById}
          onRtPdt={onRtPdt}
        />
      </Suspense>
    )
  }

  if (view === 'rotations') {
    return (
      <Suspense fallback={<LeftPaneLdr text="Loading rotations..." />}>
        <LazyRotPane
          runtime={runtime}
          runtimesById={partRntmById}
          simulation={simulation}
          onRtPdt={onRtPdt}
        />
      </Suspense>
    )
  }

  if (view === 'suggestions') {
    return (
      <Suspense fallback={<LeftPaneLdr text="Loading suggestions..." />}>
        <LazyCalcSugg
          runtime={runtime}
          simulation={simulation}
          enemyProfile={enemyProfile}
          prtcRntmById={partRntmById}
        />
      </Suspense>
    )
  }

  return <section className="calc-pane">Invalid pane view.</section>
}
