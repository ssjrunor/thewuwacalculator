/*
  Author: Runor Ewhro
  description: stores session-only enemy-console requests and commits target and runtime edits to the selected scenario.
*/

import { useCallback, useEffect, useMemo } from 'react'
import { useAppStore } from '@/application/state'
import { selActResId, selEnemyProf, selWorkDrvd } from '@/application/state'
import type { EnemyProfile } from '@/domain/entities/appState.ts'
import type { ResRuntime } from '@/domain/entities/runtime.ts'
import { reviseCombatScenario } from '@/domain/entities/combatScenario.ts'
import { applyRuntimeToSimulation, materializeScenarioRuntime } from '@/engine/runtime/runtimeAdapters.ts'
import { prepareEnemyConsoleDraft } from './lib/draftSimulation'
import { useAppModal } from '@/shared/ui/useAppModal.ts'
import { useConfigurationSession } from '@/shared/ui/useConfigurationSession.ts'
import { EnemyConsole } from '@/modules/simulation/features/enemies/Console.tsx'
import { useEnemyCnsl } from '@/modules/simulation/features/enemies/consoleRequest'
export { openEnemyCnsl, useEnemyCnsl } from '@/modules/simulation/features/enemies/consoleRequest'

interface EnemyConfigDraft {
  runtime: ResRuntime | null
  enemy: EnemyProfile
}

export function EnemyConsoleHost() {
  const open = useEnemyCnsl((state) => state.open)
  const closeRequest = useEnemyCnsl((state) => state.close)
  return open ? <EnemyConsoleSession closeRequest={closeRequest} /> : null
}

function EnemyConsoleSession({ closeRequest }: { closeRequest: () => void }) {
  const scenarioId = useAppStore((state) => state.combat.selectedScenarioId)
  const actResId = useAppStore(selActResId)
  const enemyProfile = useAppStore(selEnemyProf)
  const { scenario, actRt, partRtsById } = useAppStore(selWorkDrvd)
  const commitScenarioConfig = useAppStore((state) => state.commitScenarioConfig)
  const modal = useAppModal()

  // replay the draft against current scenario state and commit target and
  // runtime changes atomically.
  const commitDraft = useCallback((reducer: (current: EnemyConfigDraft) => EnemyConfigDraft) => {
    commitScenarioConfig(scenarioId, (scenario) => {
      const currentRuntime = actResId ? materializeScenarioRuntime(scenario, actResId) : null
      const next = reducer({ runtime: currentRuntime, enemy: scenario.target })
      let nextScenario = scenario

      if (actResId && currentRuntime && next.runtime && next.runtime !== currentRuntime) {
        nextScenario = applyRuntimeToSimulation(nextScenario, actResId, next.runtime).scenario
      }
      if (next.enemy !== scenario.target) {
        nextScenario = reviseCombatScenario(nextScenario, { target: next.enemy })
      }
      return nextScenario
    }, 'Updated Enemy Configuration')
  }, [actResId, commitScenarioConfig, scenarioId])
  const session = useConfigurationSession<EnemyConfigDraft>({
    source: { runtime: actRt, enemy: enemyProfile },
    active: modal.visible,
    commit: commitDraft,
  })
  const draftRuntime = session.draft.runtime
  const draftRuntimesById = draftRuntime
    ? { ...partRtsById, [draftRuntime.id]: draftRuntime }
    : partRtsById

  const simulation = useMemo(
    () => prepareEnemyConsoleDraft(scenario, draftRuntime, session.draft.enemy),
    [scenario, draftRuntime, session.draft.enemy],
  )

  // depend on the stable callback, not the modal object rebuilt by state changes.
  const { show } = modal
  useEffect(() => {
    show()
  }, [show])

  const close = useCallback(() => {
    modal.hide(() => {
      session.finish()
      closeRequest()
    })
  }, [closeRequest, modal, session])

  return (
    <EnemyConsole
      visible={modal.visible}
      open={modal.open}
      closing={modal.closing}
      runtime={draftRuntime}
      runtimesById={draftRuntimesById}
      enemyProfile={session.draft.enemy}
      simulation={simulation}
      onRtPdt={(updater) => session.update((draft) => ({
        ...draft,
        runtime: draft.runtime ? updater(draft.runtime) : draft.runtime,
      }))}
      onEnemyChange={(enemy) => session.update((draft) => ({ ...draft, enemy }))}
      onClose={close}
    />
  )
}
