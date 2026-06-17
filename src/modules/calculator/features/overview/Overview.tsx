/*
  Author: Runor Ewhro
  Description: Renders the overview surface for the calculator overview flow.
*/

import { Suspense, lazy, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppStore } from '@/domain/state/store.ts'
import {
  selActResId,
  selEnemyProf,
  selVrvwDrvd,
} from '@/domain/state/selectors.ts'
import { mkVrvwSttSmm } from '@/modules/calculator/model/stateSummary.ts'
import { seedRsntById } from '@/modules/calculator/features/resonator/lib/seedData.ts'
import { mkPrepLiveCm } from '@/modules/calculator/model/selectors.ts'
import AppLdrVrly from '@/shared/ui/AppLoaderOverlay.tsx'
import { withDefIconM } from '@/shared/lib/imageFallback.ts'

const LazyCalcVrvw = lazy(async () => ({
  default: (await import('@/modules/calculator/features/overview/OverviewLayer.tsx')).VrvwLyr,
}))

// renders the overview modal stage under a suspense boundary so main bounds stay fast.
export function Overview() {
  const navigate = useNavigate()
  const profilesById = useAppStore((state) => state.calculator.profiles)
  const actResId = useAppStore(selActResId)
  const enemyProfile = useAppStore(selEnemyProf)
  const showNqntVrvw = useAppStore((state) => state.ui.preferences.showUnquantifiedOverviewStates)
  const {
    prepWork: prprWrks,
    actRt: runtime,
    partRtsById: partRntmById,
    initRtsById: ntlzRntmById,
  } = useAppStore(selVrvwDrvd)

  const activeSeed = actResId ? seedRsntById[actResId] ?? null : null
  const simulation = useMemo(
    () => mkPrepLiveCm(activeSeed ? prprWrks : null),
    [activeSeed, prprWrks],
  )
  const vrvwSttSmmr = useMemo(
    () => mkVrvwSttSmm(runtime, partRntmById, prprWrks?.combatGraph ?? null, null, {
      cntxByResId: prprWrks?.cntxByResId,
      enemyProfile,
      showNqntStts: showNqntVrvw,
    }),
    [runtime, partRntmById, prprWrks, enemyProfile, showNqntVrvw],
  )
  const rtngSlctByRe = useMemo(
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
      <Suspense fallback={<AppLdrVrly mode="centered" text="Loading overview..." />}>
        <LazyCalcVrvw
          actResId={actResId}
          enemyProfile={enemyProfile}
          onClose={() => navigate('/calculator')}
          vrvwSttSmmr={vrvwSttSmmr}
          rtngSlctBytf={rtngSlctByRe}
          runtime={runtime}
          runtimesById={ntlzRntmById}
          showExtraStates={showNqntVrvw}
          simulation={simulation}
          onImageError={withDefIconM}
        />
      </Suspense>
    </div>
  )
}
