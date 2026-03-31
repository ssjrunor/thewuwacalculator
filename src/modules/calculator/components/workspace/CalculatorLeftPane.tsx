import { Suspense, lazy } from 'react'
import type { EnemyProfile, LeftPaneView } from '@/domain/entities/appState'
import type { ResonatorRuntimeState } from '@/domain/entities/runtime'
import type { SimulationResult } from '@/engine/pipeline/types'
import { Resonator } from '@/modules/calculator/components/resonator/Resonator'
import AppLoaderOverlay from '@/shared/ui/AppLoaderOverlay'

const LazyRotationPane = lazy(async () => ({
  default: (await import('@/modules/calculator/components/rotation/RotationPane')).RotationPane,
}))

const LazyCalculatorBuffsPane = lazy(async () => ({
  default: (await import('@/modules/calculator/components/workspace/panes/left/CalculatorBuffsPane')).CalculatorBuffsPane,
}))

const LazyCalculatorEchoesPane = lazy(async () => ({
  default: (await import('@/modules/calculator/components/workspace/panes/left/CalculatorEchoesPane')).CalculatorEchoesPane,
}))

const LazyCalculatorEnemyPane = lazy(async () => ({
  default: (await import('@/modules/calculator/components/workspace/panes/left/CalculatorEnemyPane')).CalculatorEnemyPane,
}))

const LazyCalculatorSuggestionsPane = lazy(async () => ({
  default: (await import('@/modules/calculator/components/workspace/panes/left/CalculatorSuggestionsPane')).CalculatorSuggestionsPane,
}))

const LazyCalculatorTeamsPane = lazy(async () => ({
  default: (await import('@/modules/calculator/components/workspace/panes/left/CalculatorTeamsPane')).CalculatorTeamsPane,
}))

const LazyCalculatorWeaponPane = lazy(async () => ({
  default: (await import('@/modules/calculator/components/workspace/panes/left/CalculatorWeaponPane')).CalculatorWeaponPane,
}))

interface CalculatorLeftPaneProps {
  view: LeftPaneView
  activeResonatorId: string | null
  runtime: ResonatorRuntimeState | null
  participantRuntimesById: Record<string, ResonatorRuntimeState>
  simulation: SimulationResult | null
  enemyProfile: EnemyProfile
  isDarkMode: boolean
  onRuntimeUpdate: (updater: (runtime: ResonatorRuntimeState) => ResonatorRuntimeState) => void
  onEnemyProfileChange: (enemy: EnemyProfile) => void
}

function LeftPaneLoader({ text }: { text: string }) {
  return (
    <section className="calc-pane">
      <AppLoaderOverlay mode="centered" text={text} />
    </section>
  )
}

// routes the left workspace view selection to the pane that owns each concern.
export function CalculatorLeftPane({
  view,
  activeResonatorId,
  runtime,
  participantRuntimesById,
  simulation,
  enemyProfile,
  isDarkMode,
  onRuntimeUpdate,
  onEnemyProfileChange,
}: CalculatorLeftPaneProps) {
  if (!runtime) {
    return <section className="calc-pane">Select a resonator to begin.</section>
  }

  if (view === 'resonators') {
    return (
      <Resonator
        runtime={runtime}
        activeResonatorId={activeResonatorId}
        onRuntimeUpdate={onRuntimeUpdate}
        isDarkMode={isDarkMode}
      />
    )
  }

  if (view === 'buffs') {
    return (
      <Suspense fallback={<LeftPaneLoader text="Loading buffs..." />}>
        <LazyCalculatorBuffsPane
          runtime={runtime}
          onRuntimeUpdate={onRuntimeUpdate}
        />
      </Suspense>
    )
  }

  if (view === 'echoes') {
    return (
      <Suspense fallback={<LeftPaneLoader text="Loading echoes..." />}>
        <LazyCalculatorEchoesPane
          runtime={runtime}
          onRuntimeUpdate={onRuntimeUpdate}
        />
      </Suspense>
    )
  }

  if (view === 'enemy') {
    return (
      <Suspense fallback={<LeftPaneLoader text="Loading enemy controls..." />}>
        <LazyCalculatorEnemyPane
          runtime={runtime}
          enemyProfile={enemyProfile}
          onRuntimeUpdate={onRuntimeUpdate}
          onEnemyProfileChange={onEnemyProfileChange}
        />
      </Suspense>
    )
  }

  if (view === 'weapon') {
    return (
      <Suspense fallback={<LeftPaneLoader text="Loading weapon controls..." />}>
        <LazyCalculatorWeaponPane
          runtime={runtime}
          onRuntimeUpdate={onRuntimeUpdate}
        />
      </Suspense>
    )
  }

  if (view === 'teams') {
    return (
      <Suspense fallback={<LeftPaneLoader text="Loading team buffs..." />}>
        <LazyCalculatorTeamsPane
          runtime={runtime}
          participantRuntimesById={participantRuntimesById}
          onRuntimeUpdate={onRuntimeUpdate}
        />
      </Suspense>
    )
  }

  if (view === 'rotations') {
    return (
      <Suspense fallback={<LeftPaneLoader text="Loading rotations..." />}>
        <LazyRotationPane
          runtime={runtime}
          runtimesById={participantRuntimesById}
          simulation={simulation}
          onRuntimeUpdate={onRuntimeUpdate}
        />
      </Suspense>
    )
  }

  if (view === 'suggestions') {
    return (
      <Suspense fallback={<LeftPaneLoader text="Loading suggestions..." />}>
        <LazyCalculatorSuggestionsPane
          runtime={runtime}
          simulation={simulation}
          enemyProfile={enemyProfile}
          participantRuntimesById={participantRuntimesById}
        />
      </Suspense>
    )
  }

  return <section className="calc-pane">Invalid pane view.</section>
}
