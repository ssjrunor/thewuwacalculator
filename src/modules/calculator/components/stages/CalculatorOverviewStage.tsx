import { Suspense, lazy, useMemo } from 'react'
import { useAppStore } from '@/domain/state/store'
import {
  selectActiveResonatorId,
  selectEnemyProfile,
  selectOverviewDerived,
} from '@/domain/state/selectors'
import { buildOverviewStateSummary } from '@/modules/calculator/model/overviewStateSummary'
import { seedResonatorsById } from '@/modules/calculator/model/seedData'
import { buildPreparedLiveComputation } from '@/modules/calculator/model/selectors'
import AppLoaderOverlay from '@/shared/ui/AppLoaderOverlay'
import { withDefaultIconImage } from '@/shared/lib/imageFallback'

const LazyCalculatorOverview = lazy(async () => ({
  default: (await import('@/modules/calculator/components/overview/CalculatorOverview')).CalculatorOverview,
}))

// renders the overview modal stage under a suspense boundary so workspace bounds stay fast.
export function CalculatorOverviewStage() {
  const profilesById = useAppStore((state) => state.calculator.profiles)
  const activeResonatorId = useAppStore(selectActiveResonatorId)
  const enemyProfile = useAppStore(selectEnemyProfile)
  const {
    preparedWorkspace,
    activeRuntime: runtime,
    participantRuntimesById,
    initializedRuntimesById,
  } = useAppStore(selectOverviewDerived)
  const setMainMode = useAppStore((state) => state.setMainMode)

  const activeSeed = activeResonatorId ? seedResonatorsById[activeResonatorId] ?? null : null
  const simulation = useMemo(
    () => buildPreparedLiveComputation(activeSeed ? preparedWorkspace : null),
    [activeSeed, preparedWorkspace],
  )
  const overviewStateSummary = useMemo(
    () => buildOverviewStateSummary(runtime, participantRuntimesById, preparedWorkspace?.combatGraph ?? null, null, {
      contextsByResonatorId: preparedWorkspace?.contextsByResonatorId,
      enemyProfile,
    }),
    [runtime, participantRuntimesById, preparedWorkspace, enemyProfile],
  )
  const routingSelectionsByResonatorId = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(profilesById).map(([resonatorId, profile]) => [
          resonatorId,
          { ...profile.runtime.routing.selectedTargetsByOwnerKey },
        ]),
      ),
    [profilesById],
  )

  return (
    <div className="calculator-stage">
      <Suspense fallback={<AppLoaderOverlay mode="centered" text="Loading overview..." />}>
        <LazyCalculatorOverview
          activeResonatorId={activeResonatorId}
          enemyProfile={enemyProfile}
          onClose={() => setMainMode('default')}
          overviewStateSummary={overviewStateSummary}
          routingSelectionsByResonatorId={routingSelectionsByResonatorId}
          runtime={runtime}
          runtimesById={initializedRuntimesById}
          simulation={simulation}
          onImageError={withDefaultIconImage}
        />
      </Suspense>
    </div>
  )
}
