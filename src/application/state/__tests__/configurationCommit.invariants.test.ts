/*
  Author: Runor Ewhro
  Description: Verifies the atomic store boundaries used by transient
               configuration surfaces.
*/

import { beforeEach, describe, expect, it } from 'vitest'
import { selectedCombatScenario } from '@/domain/entities/scenarioLibrary.ts'
import { useAppStore } from '@/application/state/store.ts'
import { consumePersist } from '@/application/persistence/storage.ts'
import { listResSds } from '@/data/catalog/resonatorSeedService.ts'
import { makeResProfile, makeScenarioMemberFromProfile } from '@/engine/runtime/defaults.ts'
import { insertScenarioTeamMember, removeScenarioTeamMember, replaceScenarioTeamMember } from '@/engine/runtime/scenarioMembers.ts'
import { applyRuntimeToSimulation, materializeScenarioRuntime } from '@/engine/runtime/runtimeAdapters.ts'
import { createConfigurationTransaction } from '@/shared/ui/useConfigurationSession.ts'

describe('configuration commit boundaries', () => {
  beforeEach(() => {
    useAppStore.getState().resetState()
    consumePersist()
  })

  it('publishes a scenario configuration once without retaining app history', () => {
    const before = selectedCombatScenario(useAppStore.getState().combat)
    const historyCount = useAppStore.getState().history.past.length

    useAppStore.getState().commitScenarioConfig(before.id, (scenario) => ({
      ...scenario,
      target: { ...scenario.target, level: scenario.target.level + 7 },
      environment: {
        ...scenario.environment,
        targetModifiers: {
          ...scenario.environment.targetModifiers,
          defenseReduction: 18,
        },
      },
    }))

    const after = selectedCombatScenario(useAppStore.getState().combat)
    expect(after.revision).toBe(before.revision + 1)
    expect(after.target.level).toBe(before.target.level + 7)
    expect(after.environment.targetModifiers.defenseReduction).toBe(18)
    expect(useAppStore.getState().history.past).toHaveLength(historyCount)
    expect(useAppStore.getState().canUndo()).toBe(false)
    expect(consumePersist()).toEqual(['combat.workspace'])
  })

  it('publishes several appearance edits without retaining app history', () => {
    const before = useAppStore.getState()
    const historyCount = before.history.past.length

    before.commitAppearanceConfig((ui) => ({
      ...ui,
      theme: 'background',
      themePreference: 'background',
      blurMode: !ui.blurMode,
    }))

    const after = useAppStore.getState()
    expect(after.ui.theme).toBe('background')
    expect(after.ui.themePreference).toBe('background')
    expect(after.ui.blurMode).toBe(!before.ui.blurMode)
    expect(after.history.past).toHaveLength(historyCount)
    expect(consumePersist()).toEqual(['ui.appearance'])
  })

  it('keeps nested teammate replacements and subsequent edits in the owning draft', () => {
    const initial = selectedCombatScenario(useAppStore.getState().combat)
    const seeds = listResSds().filter((seed) => seed.id !== initial.team.members[0].resonatorId)
    const original = makeScenarioMemberFromProfile(makeResProfile(seeds[0]))
    useAppStore.getState().insertScenarioMember(initial.id, 1, original)
    useAppStore.getState().setScenarioRouting(initial.id, initial.team.members[0].id, 'support', original.id)
    consumePersist()
    const before = selectedCombatScenario(useAppStore.getState().combat)
    const historyCount = useAppStore.getState().history.past.length
    const transaction = createConfigurationTransaction(before, (reducer) => {
      useAppStore.getState().commitScenarioConfig(before.id, reducer)
    })
    const replacement = makeScenarioMemberFromProfile(makeResProfile(seeds[1]))
    transaction.update((scenario) => replaceScenarioTeamMember(scenario, original.id, replacement))

    expect(materializeScenarioRuntime(transaction.read(), replacement.resonatorId)?.id)
      .toBe(replacement.resonatorId)
    transaction.update((scenario) => {
      const runtime = materializeScenarioRuntime(scenario, replacement.resonatorId)!
      return applyRuntimeToSimulation(scenario, replacement.resonatorId, {
        ...runtime,
        base: { ...runtime.base, level: 42 },
      }).scenario
    })
    expect(selectedCombatScenario(useAppStore.getState().combat)).toBe(before)
    expect(consumePersist()).toEqual([])
    transaction.finish()
    transaction.finish()

    const after = selectedCombatScenario(useAppStore.getState().combat)
    expect(after.team.members[1]?.id).toBe(original.id)
    expect(after.team.members[1]?.resonatorId).toBe(replacement.resonatorId)
    expect(after.team.members[1]?.progression.level).toBe(42)
    expect(after.environment.routing.bySourceMemberId[initial.team.members[0].id].support).toBe(original.id)
    expect(after.revision).toBe(before.revision + 1)
    expect(useAppStore.getState().history.past).toHaveLength(historyCount)
    expect(consumePersist()).toEqual(['combat.workspace'])
  })

  it('shares insertion and removal invariants between drafts and canonical commands', () => {
    const before = selectedCombatScenario(useAppStore.getState().combat)
    const seed = listResSds().find((candidate) => candidate.id !== before.team.members[0].resonatorId)!
    const member = makeScenarioMemberFromProfile(makeResProfile(seed))
    const insertedDraft = insertScenarioTeamMember(before, 1, member)
    useAppStore.getState().insertScenarioMember(before.id, 1, member)
    expect(selectedCombatScenario(useAppStore.getState().combat)).toEqual(insertedDraft)
    expect(before.team.members).toHaveLength(1)

    const removedDraft = removeScenarioTeamMember(insertedDraft, member.id)
    useAppStore.getState().removeScenarioMember(before.id, member.id)
    expect(selectedCombatScenario(useAppStore.getState().combat)).toEqual(removedDraft)
    expect(removedDraft.environment.routing.bySourceMemberId[member.id]).toBeUndefined()
    expect(removedDraft.environment.manualEffects).toEqual(before.environment.manualEffects)
    expect(replaceScenarioTeamMember(insertedDraft, member.id, before.team.members[0])).toBe(insertedDraft)
  })
})
