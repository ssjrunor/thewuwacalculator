/*
  Author: Runor Ewhro
  Description: Verifies canonical working-scenario commands and saved-snapshot boundaries.
*/

import { beforeEach, describe, expect, it } from 'vitest'
import type { RotationNode } from '@/domain/gameData/contracts'
import { contextScenarioMember } from '@/domain/entities/combatScenario'
import { selectedCombatScenario } from '@/domain/entities/scenarioLibrary'
import { listResRttn } from '@/domain/services/gameDataService'
import { listResSds } from '@/domain/services/resonatorSeedService'
import { makeResProfile, makeScenarioFromProfiles, makeScenarioMemberFromProfile } from '@/domain/state/defaults'
import { resolveEnvironmentManualBuffs } from '@/domain/state/scenarioEnvironment'
import { useAppStore } from '@/domain/state/store'
import { consumePersist } from '@/infra/persistence/storage'

describe('combat scenario store', () => {
  beforeEach(() => {
    useAppStore.getState().resetState()
    consumePersist()
  })

  it('mutates addressed members, routing, target, environment, and program in canonical state', () => {
    const [firstSeed, secondSeed] = listResSds().slice(0, 2)
    const initial = selectedCombatScenario(useAppStore.getState().combat)
    const first = initial.team.members[0]
    const second = makeScenarioMemberFromProfile(makeResProfile(secondSeed))
    useAppStore.getState().insertScenarioMember(initial.id, 1, second)
    useAppStore.getState().updateScenarioMember(initial.id, second.id, (member) => ({
      ...member,
      progression: { ...member.progression, level: 42 },
    }))
    useAppStore.getState().setScenarioRouting(initial.id, first.id, 'support-target', second.id)
    useAppStore.getState().moveScenarioMember(initial.id, second.id, 0)
    useAppStore.getState().setScenarioInitialOnField(initial.id, first.id)
    const node: RotationNode = {
      id: 'scenario-program-node',
      type: 'feature',
      featureId: 'scenario-feature',
      resonatorId: secondSeed.id,
      enabled: true,
      multiplier: 1,
    }
    useAppStore.getState().setScenarioProgram(initial.id, {
      sequence: [],
      program: [node],
      lastRanAt: 123,
    })
    useAppStore.getState().upsertEnvironmentManualEffect(initial.id, {
      id: 'test:all-atk',
      enabled: true,
      selector: { kind: 'all' },
      buffs: {
        quick: {
          atk: { flat: 0, percent: 12 },
          hp: { flat: 0, percent: 0 },
          def: { flat: 0, percent: 0 },
          critRate: 0,
          critDmg: 0,
          energyRegen: 0,
          healingBonus: 0,
        },
        modifiers: [],
      },
    })
    useAppStore.getState().setEnvironmentTargetModifiers(initial.id, {
      defenseReduction: 20,
      resistanceReduction: { [firstSeed.attribute]: 15 },
      damageTakenAmplification: 8,
    })
    useAppStore.getState().setScenarioTarget(initial.id, {
      ...initial.target,
      level: initial.target.level + 1,
    })

    const scenario = selectedCombatScenario(useAppStore.getState().combat)
    expect(scenario.team.members[0].id).toBe(second.id)
    expect(scenario.team.members[0].progression.level).toBe(42)
    expect(scenario.environment.routing.bySourceMemberId[first.id]).toEqual({
      'support-target': second.id,
    })
    expect(scenario.program.program).toEqual([node])
    expect(scenario.target.level).toBe(initial.target.level + 1)
    expect(resolveEnvironmentManualBuffs(scenario.environment, scenario.team.members[0]).quick.atk.percent)
      .toBe(12)
    expect(scenario.environment.targetModifiers.defenseReduction).toBe(20)
    expect(consumePersist()).toEqual(['combat.workspace'])
  })

  it('creates a context resonator once and reuses its working scenario thereafter', () => {
    const state = useAppStore.getState()
    const currentContext = contextScenarioMember(selectedCombatScenario(state.combat)).resonatorId
    const seed = listResSds().find((candidate) => candidate.id !== currentContext)!

    state.actRes(seed)
    const afterFirst = useAppStore.getState()
    const createdId = afterFirst.combat.selectedScenarioId
    expect(afterFirst.combat.order).toHaveLength(2)

    afterFirst.swRes(currentContext)
    useAppStore.getState().actRes(seed)
    const afterSecond = useAppStore.getState()
    expect(afterSecond.combat.selectedScenarioId).toBe(createdId)
    expect(afterSecond.combat.order).toHaveLength(2)
  })

  it("instantiates a context resonator's team program from its default rotation", () => {
    const current = selectedCombatScenario(useAppStore.getState().combat)
    const candidate = listResSds()
      .map((seed) => ({ seed, defaultRotation: listResRttn(seed.id)[0] }))
      .find(({ seed, defaultRotation }) => (
        seed.id !== contextScenarioMember(current).resonatorId
        && Boolean(defaultRotation?.items.length)
      ))
    if (!candidate?.defaultRotation) {
      throw new Error('Expected a second resonator with a default rotation')
    }
    const { seed, defaultRotation } = candidate

    useAppStore.getState().actRes(seed)

    const scenario = selectedCombatScenario(useAppStore.getState().combat)
    expect(contextScenarioMember(scenario).resonatorId).toBe(seed.id)
    expect(scenario.program.sequence).toEqual(defaultRotation.items)
    expect(scenario.program.program).toEqual(defaultRotation.items)
    expect(scenario.program.program).not.toBe(scenario.program.sequence)
  })

  it('updates an addressed scenario runtime without redirecting the write to the selected scenario', () => {
    const original = selectedCombatScenario(useAppStore.getState().combat)
    const originalMember = original.team.members[0]
    const seed = listResSds().find((candidate) => candidate.id !== originalMember.resonatorId)!

    useAppStore.getState().actRes(seed)
    const selectedId = useAppStore.getState().combat.selectedScenarioId
    const selectedBefore = useAppStore.getState().combat.scenariosById[selectedId]

    useAppStore.getState().updScenarioResRt(original.id, originalMember.resonatorId, (runtime) => ({
      ...runtime,
      base: { ...runtime.base, level: 42 },
    }))

    const after = useAppStore.getState()
    expect(after.combat.selectedScenarioId).toBe(selectedId)
    expect(after.combat.scenariosById[original.id].team.members[0].progression.level).toBe(42)
    expect(after.combat.scenariosById[selectedId]).toEqual(selectedBefore)
  })

  it('loads an immutable saved snapshot into the context working slot without changing its live id', () => {
    const before = selectedCombatScenario(useAppStore.getState().combat)
    const saved = useAppStore.getState().saveScenario({ name: 'Snapshot A', note: 'kept' })
    expect(saved).not.toBeNull()
    if (!saved) return

    const savedMemberIds = saved.scenario.team.members.map((member) => member.id)
    useAppStore.getState().setScenarioTarget(before.id, { ...before.target, level: before.target.level + 10 })
    const loadedId = useAppStore.getState().loadSavedScenario(saved.id)
    const loaded = selectedCombatScenario(useAppStore.getState().combat)

    expect(loadedId).toBe(before.id)
    expect(loaded.id).toBe(before.id)
    expect(loaded.target.level).toBe(before.target.level)
    expect(loaded.team.members.map((member) => member.id)).not.toEqual(savedMemberIds)
    expect(useAppStore.getState().library.scenarios[0]).toEqual(saved)
    expect(useAppStore.getState().combat.order).toHaveLength(1)
  })

  it('applies a detached snapshot only once for a new context resonator', () => {
    const current = selectedCombatScenario(useAppStore.getState().combat)
    const seed = listResSds().find((candidate) => (
      candidate.id !== contextScenarioMember(current).resonatorId
    ))!
    const detached = makeScenarioFromProfiles(
      { [seed.id]: makeResProfile(seed) },
      { activeResonatorId: seed.id, enemyProfile: current.target },
      0,
      seed.id,
    )

    const firstId = useAppStore.getState().applyScenarioSnapshot(detached)
    const count = useAppStore.getState().combat.order.length
    const secondId = useAppStore.getState().applyScenarioSnapshot({
      ...detached,
      target: { ...detached.target, level: detached.target.level + 5 },
    })

    expect(secondId).toBe(firstId)
    expect(useAppStore.getState().combat.order).toHaveLength(count)
    expect(selectedCombatScenario(useAppStore.getState().combat).target.level)
      .toBe(detached.target.level + 5)
  })

  it('never permits an empty team when removing members', () => {
    const scenario = selectedCombatScenario(useAppStore.getState().combat)
    useAppStore.getState().removeScenarioMember(scenario.id, scenario.team.members[0].id)
    expect(selectedCombatScenario(useAppStore.getState().combat).team.members).toHaveLength(1)
  })
})
