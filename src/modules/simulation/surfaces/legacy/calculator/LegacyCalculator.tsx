/*
  Author: Runor Ewhro
  Description: Composes the temporary legacy calculator from canonical Simulation state projections.
*/

import { useMemo } from 'react'
import type { EnemyProfile } from '@/domain/entities/appState.ts'
import type { ResRuntime } from '@/domain/entities/runtime.ts'
import { useAppStore } from '@/application/state'
import {
  selActResId,
  selEnemyProf,
  selWorkDrvd,
} from '@/application/state'
import { seedRsntById } from '@/modules/simulation/features/resonator/lib/seedData.ts'
import { mkPrepLiveCm, selLiveRun } from '@/modules/simulation/model/selectors.ts'
import { RszbSplt } from '@/shared/ui/ResizableSplit.tsx'
import { Left } from '@/modules/simulation/surfaces/legacy/calculator/Left.tsx'
import { Right } from '@/modules/simulation/surfaces/legacy/calculator/Right.tsx'
import { useCtxBuilder } from '@/modules/simulation/shell/context-menu/useContextMenuBuilder.ts'
import { ContextTrigger } from '@/application/context-menu/ContextTrigger.tsx'

interface CalcWorkCntn {
  actResId: string | null
  enemyProfile: EnemyProfile
  runtime: ResRuntime | null
  prtcRntmById: Record<string, ResRuntime>
  simulation: ReturnType<typeof mkPrepLiveCm>
  isCllpMode: boolean
  ui: ReturnType<typeof useAppStore.getState>['ui']
  setEnemyProf: ReturnType<typeof useAppStore.getState>['setEnemy']
  pdtActResRt: ReturnType<typeof useAppStore.getState>['updActRt']
}

function CalcCntn({
  actResId: actResId,
  enemyProfile,
  runtime,
  prtcRntmById: partRntmById,
  simulation,
  isCllpMode: isCllpMode,
  ui,
  setEnemyProf: setNmyPrfl,
  pdtActResRt: pdtActResRt,
}: CalcWorkCntn) {
  const menu = useCtxBuilder()

  return (
    <div className="calculator-stage calculator-stage--workspace">
      <ContextTrigger
        asChild
        ariaLabel="Calculator main actions"
        items={menu.simulation.workspace()}
      >
        <section className="calculator-workspace"
          aria-label="Calculator workspace"
        >
          <RszbSplt
            storageKey="wwcalc.simulation.split.default"
            leftId="left-pane"
            rightId="right-pane"
            leftClssName="calculator-pane partition"
            rghtClssName="calculator-pane partition"
            isCollapsed={isCllpMode}
            defLeftPrcn={50}
            left={
              <Left
                view={ui.leftPaneView}
                actResId={actResId}
                runtime={runtime}
                simulation={simulation}
                enemyProfile={enemyProfile}
                isDarkMode={ui.theme === 'dark'}
                prtcRntmById={partRntmById}
                onRtPdt={pdtActResRt}
                onEnemyChange={setNmyPrfl}
              />
            }
            right={<Right simulation={simulation} runtime={runtime} enemy={enemyProfile} />}
          />
        </section>
      </ContextTrigger>
    </div>
  )
}

// wires up the main split and feeds both panes with derived runtimes.
export function LegacyCalculator({ isCllpMode }: { isCllpMode: boolean }) {
  const ui = useAppStore((state) => state.ui)
  const actResId = useAppStore(selActResId)
  const enemyProfile = useAppStore(selEnemyProf)
  const {
    prepWork: prprWrks,
    actRt: runtime,
    partRtsById: partRntmById,
  } = useAppStore(selWorkDrvd)
  const setEnemyProf = useAppStore((state) => state.setEnemy)
  const updActResRt = useAppStore((state) => state.updActRt)

  const activeSeed = actResId ? seedRsntById[actResId] ?? null : null
  const simulation = useMemo(
    () => selLiveRun(activeSeed ? prprWrks : null),
    [activeSeed, prprWrks],
  )

  return (
    <CalcCntn
      actResId={actResId}
      enemyProfile={enemyProfile}
      runtime={runtime}
      prtcRntmById={partRntmById}
      simulation={simulation}
      isCllpMode={isCllpMode}
      ui={ui}
      setEnemyProf={setEnemyProf}
      pdtActResRt={updActResRt}
    />
  )
}
