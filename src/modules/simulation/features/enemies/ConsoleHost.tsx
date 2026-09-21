/*
  Author: Runor Ewhro
  Description: Holds session-only enemy-console requests and atomically commits
               drafted target and runtime edits to the owning scenario.
*/

import { useCallback, useEffect, useMemo } from 'react'
import { create } from 'zustand'
import { useAppStore } from '@/application/state'
import { selActResId, selEnemyProf, selWorkDrvd } from '@/application/state'
import type { EnemyProfile } from '@/domain/entities/appState.ts'
import type { ResRuntime } from '@/domain/entities/runtime.ts'
import { reviseCombatScenario } from '@/domain/entities/combatScenario.ts'
import { applyRuntimeToSimulation, materializeScenarioRuntime } from '@/engine/runtime/runtimeAdapters.ts'
import { seedRsntById } from '@/modules/simulation/features/resonator/lib/seedData.ts'
import { selLiveRun } from '@/modules/simulation/model/selectors.ts'
import { useAppModal } from '@/shared/ui/useAppModal.ts'
import { useConfigurationSession } from '@/shared/ui/useConfigurationSession.ts'
import { EnemyConsole } from '@/modules/simulation/features/enemies/Console.tsx'

interface EnemyConsoleStore {
  open: boolean
  show: () => void
  close: () => void
}

interface EnemyConfigDraft {
  runtime: ResRuntime | null
  enemy: EnemyProfile
}

export const useEnemyCnsl = create<EnemyConsoleStore>((set) => ({
  open: false,
  show: () => set({ open: true }),
  close: () => set({ open: false }),
}))

export function openEnemyCnsl(): void {
  useEnemyCnsl.getState().show()
}

export function EnemyConsoleHost() {
  const open = useEnemyCnsl((state) => state.open)
  const closeRequest = useEnemyCnsl((state) => state.close)
  const scenarioId = useAppStore((state) => state.combat.selectedScenarioId)
  const actResId = useAppStore(selActResId)
  const enemyProfile = useAppStore(selEnemyProf)
  const { prepWork, actRt, partRtsById } = useAppStore(selWorkDrvd)
  const commitScenarioConfig = useAppStore((state) => state.commitScenarioConfig)
  const modal = useAppModal()

  // Replay the draft against current scenario state and commit target/runtime
  // changes together, rather than issuing independent store writes.
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

  const activeSeed = actResId ? seedRsntById[actResId] ?? null : null
  const simulation = useMemo(
    () => selLiveRun(activeSeed ? prepWork : null),
    [activeSeed, prepWork],
  )

  // Depend on the stable callback, not the modal object rebuilt by state changes.
  const { show } = modal
  useEffect(() => {
    if (open) show()
  }, [open, show])

  const close = useCallback(() => {
    modal.hide(() => {
      session.finish()
      closeRequest()
    })
  }, [closeRequest, modal, session])

  if (!open) {
    return null
  }

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
