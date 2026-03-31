import { useMemo } from 'react'
import { useAppStore } from '@/domain/state/store'
import {
  selectActiveResonatorId,
  selectEnemyProfile,
  selectWorkspaceDerived,
} from '@/domain/state/selectors'
import { seedResonatorsById } from '@/modules/calculator/model/seedData'
import { buildPreparedLiveComputation } from '@/modules/calculator/model/selectors'
import { ResizableSplit } from '@/shared/ui/ResizableSplit'
import { CalculatorLeftPane } from '@/modules/calculator/components/workspace/CalculatorLeftPane'
import { CalculatorRightPane } from '@/modules/calculator/components/workspace/CalculatorRightPane'

// wires up the workspace split and feeds both panes with derived runtimes.
export function CalculatorWorkspaceStage({ isCollapsedMode }: { isCollapsedMode: boolean }) {
  const ui = useAppStore((state) => state.ui)
  const activeResonatorId = useAppStore(selectActiveResonatorId)
  const enemyProfile = useAppStore(selectEnemyProfile)
  const {
    preparedWorkspace,
    activeRuntime: runtime,
    participantRuntimesById,
  } = useAppStore(selectWorkspaceDerived)
  const setEnemyProfile = useAppStore((state) => state.setEnemyProfile)
  const updateActiveResonatorRuntime = useAppStore((state) => state.updateActiveResonatorRuntime)

  const activeSeed = activeResonatorId ? seedResonatorsById[activeResonatorId] ?? null : null
  const simulation = useMemo(
    () => buildPreparedLiveComputation(activeSeed ? preparedWorkspace : null),
    [activeSeed, preparedWorkspace],
  )

  return (
    <div className="calculator-stage calculator-stage--workspace">
      <section className="calculator-workspace" aria-label="Calculator workspace">
        <ResizableSplit
          storageKey="wwcalc.calculator.split.default"
          leftId="left-pane"
          rightId="right-pane"
          leftClassName="calculator-pane partition"
          rightClassName="calculator-pane partition"
          isCollapsed={isCollapsedMode}
          defaultLeftPercent={50}
          left={
            <CalculatorLeftPane
              view={ui.leftPaneView}
              activeResonatorId={activeResonatorId}
              runtime={runtime}
              simulation={simulation}
              enemyProfile={enemyProfile}
              isDarkMode={ui.theme === 'dark'}
              participantRuntimesById={participantRuntimesById}
              onRuntimeUpdate={updateActiveResonatorRuntime}
              onEnemyProfileChange={setEnemyProfile}
            />
          }
          right={<CalculatorRightPane simulation={simulation} runtime={runtime} enemy={enemyProfile} />}
        />
      </section>
    </div>
  )
}
