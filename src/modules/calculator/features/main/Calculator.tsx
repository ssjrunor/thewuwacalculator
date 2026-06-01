/*
  Author: Runor Ewhro
  Description: Renders the calculator surface for the calculator main flow.
*/

import { useMemo } from 'react'
import type { EnemyProfile } from '@/domain/entities/appState.ts'
import type { ResRuntime } from '@/domain/entities/runtime.ts'
import { useAppStore } from '@/domain/state/store.ts'
import {
  selActResId,
  selEnemyProf,
  selWorkDrvd,
} from '@/domain/state/selectors.ts'
import { seedRsntById } from '@/modules/calculator/features/resonator/lib/seedData.ts'
import { mkPrepLiveCm } from '@/modules/calculator/model/selectors.ts'
import { RszbSplt } from '@/shared/ui/ResizableSplit.tsx'
import { Left } from '@/modules/calculator/features/main/Left.tsx'
import { Right } from '@/modules/calculator/features/main/Right.tsx'
import { useCtxBuilder } from '@/shared/context-menu/useCtxBuilder.ts'
import { ContextTrigger } from '@/shared/ui/CtxTrigger.tsx'

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
        items={menu.calculator.workspace()}
      >
        <section
          className="calculator-workspace"
          aria-label="Calculator workspace"
        >
          <RszbSplt
            storageKey="wwcalc.calculator.split.default"
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
export function Calculator({ isCllpMode: isCllpMode }: { isCllpMode: boolean }) {
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
    () => mkPrepLiveCm(activeSeed ? prprWrks : null),
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
