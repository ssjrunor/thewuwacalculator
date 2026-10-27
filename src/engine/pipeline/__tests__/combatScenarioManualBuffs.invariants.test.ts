import { describe, expect, it } from 'vitest'
import { makeScenarioTeam, type CombatScenario } from '@/domain/entities/combatScenario'
import type { RotationNode } from '@/domain/gameData/contracts'
import { getResSeedBy } from '@/data/catalog/resonatorSeedService'
import { makeResProfile, makeScenarioFromProfiles, makeScenarioMemberFromProfile } from '@/engine/runtime/defaults'
import { makeEmptyManualBuffs } from '@/engine/runtime/scenarioEnvironment'
import { projectScenarioUiRuntimes } from '@/engine/runtime/scenarioRuntime'
import { runResSmlt } from '@/engine/pipeline'
import {
  executeCombatScenarioProgram,
  prepareCombatScenario,
  prepareCombatScenarioForUi,
  simulateCombatScenario,
} from '@/engine/pipeline/combatScenario'

function makeScenario(): CombatScenario {
  const seed = getResSeedBy('1506')!
  const scenario = makeScenarioFromProfiles({ [seed.id]: makeResProfile(seed) }, null, 0, seed.id)
  const teammate = makeScenarioMemberFromProfile(makeResProfile(getResSeedBy('1507')!))
  const buffs = makeEmptyManualBuffs()
  buffs.quick.atk.percent = 12
  buffs.quick.critRate = 12
  buffs.modifiers = [
    { id: 'flat-atk', enabled: true, scope: 'baseStat', stat: 'atk', field: 'flat', value: 80 },
    { id: 'dmg', enabled: true, scope: 'topStat', stat: 'dmgBonus', value: 12 },
    { id: 'element', enabled: true, scope: 'attribute', attribute: 'spectro', mod: 'dmgBonus', value: 14 },
    { id: 'type', enabled: true, scope: 'skillType', skillType: 'basicAtk', mod: 'amplify', value: 16 },
    { id: 'negative', enabled: true, scope: 'negativeEffect', negativeEffect: 'spectroFrazzle', mod: 'multiplier', value: 18 },
    { id: 'disabled', enabled: false, scope: 'topStat', stat: 'critRate', value: 99 },
  ]
  return {
    ...scenario,
    team: makeScenarioTeam([...scenario.team.members, teammate]),
    environment: {
      ...scenario.environment,
      manualEffects: [{ id: 'shared', enabled: true, selector: { kind: 'all' }, buffs }],
    },
    program: {
      ...scenario.program,
      program: [{ id: 'hit', type: 'feature', featureId: 'damage:1506016', multiplier: 1 }],
    },
  }
}

describe('scenario manual buff calculation ownership', () => {
  it('applies quick buffs and every pool modifier once to each member while retaining editor values', () => {
    const scenario = makeScenario()
    const before = structuredClone(scenario)
    const baseline = prepareCombatScenarioForUi({ ...scenario, environment: { ...scenario.environment, manualEffects: [] } })
    const prepared = prepareCombatScenarioForUi(scenario)
    const canonical = prepareCombatScenario(scenario)
    const projection = projectScenarioUiRuntimes(scenario)

    for (const member of scenario.team.members) {
      const base = baseline.workspace.cntxByResId[member.resonatorId].buffs
      const actual = prepared.workspace.cntxByResId[member.resonatorId].buffs
      expect(actual.atk.percent - base.atk.percent).toBe(12)
      expect(actual.atk.flat - base.atk.flat).toBe(80)
      expect(actual.critRate - base.critRate).toBe(12)
      expect(actual.dmgBonus - base.dmgBonus).toBe(12)
      expect(actual.attribute.spectro.dmgBonus - base.attribute.spectro.dmgBonus).toBe(14)
      expect(actual.skillType.basicAtk.amplify - base.skillType.basicAtk.amplify).toBe(16)
      expect(actual.negativeEffect.spectroFrazzle.multiplier - base.negativeEffect.spectroFrazzle.multiplier).toBe(18)
      expect(actual).toEqual(canonical.workspace.cntxByResId[member.resonatorId].buffs)
      expect(prepared.runtimesByMemberId[member.id]).toBe(projection.runtimesByMemberId[member.id])
      expect(prepared.runtimesByMemberId[member.id].state.manualBuffs).toEqual(scenario.environment.manualEffects[0].buffs)
    }
    expect(scenario).toEqual(before)
  })

  it('preserves recipient exclusions, target modifiers, and the UI subject independently of the on-field member', () => {
    const base = makeScenario()
    const [primary, teammate] = base.team.members
    const scenario: CombatScenario = {
      ...base,
      contextMemberId: teammate!.id,
      initialOnFieldMemberId: teammate!.id,
      environment: {
        ...base.environment,
        manualEffects: [
          { ...base.environment.manualEffects[0], excludedMemberIds: [primary.id] },
          { ...base.environment.manualEffects[0], id: 'disabled-source', enabled: false },
        ],
        targetModifiers: { defenseReduction: 20, damageTakenAmplification: 8, resistanceReduction: { spectro: 15 } },
      },
    }
    const baseline = prepareCombatScenarioForUi({ ...scenario, environment: { ...scenario.environment, manualEffects: [] } })
    const prepared = prepareCombatScenarioForUi(scenario)
    expect(prepared.subjectMemberId).toBe(primary.id)
    expect(prepared.workspace.combatGraph!.participants[prepared.workspace.combatGraph!.activeSlotId].memberId).toBe(teammate!.id)
    for (const member of scenario.team.members) {
      const actual = prepared.workspace.cntxByResId[member.resonatorId].buffs
      const before = baseline.workspace.cntxByResId[member.resonatorId].buffs
      expect(actual.atk.percent - before.atk.percent).toBe(member.id === primary.id ? 0 : 12)
      expect(actual.defShred).toBe(20)
      expect(actual.dmgVuln).toBe(8)
      expect(actual.attribute.spectro.resShred).toBe(15)
    }
  })

  it('matches standalone damage for direct features, default rotations, and advanced programs', () => {
    const scenario = makeScenario()
    const prepared = prepareCombatScenarioForUi(scenario)
    const runtime = prepared.subjectRuntime
    const standalone = runResSmlt(runtime, getResSeedBy(runtime.id)!, scenario.target, { ...prepared.runtimesById }, { ...prepared.selectedTargets })
    const actual = simulateCombatScenario(prepared)!
    expect(actual.rotation.sequence.total.avg).toBeGreaterThan(0)
    expect(actual.rotation.program.total.avg).toBeGreaterThan(0)
    expect(actual.allFeatures.map(({ id, normal, crit, avg }) => ({ id, normal, crit, avg })))
      .toEqual(standalone.allFeatures.map(({ id, normal, crit, avg }) => ({ id, normal, crit, avg })))
    expect(actual.rotation.sequence.total).toEqual(standalone.rotation.sequence.total)
    expect(actual.rotation.program.total).toEqual(standalone.rotation.program.total)
    const detailed = executeCombatScenarioProgram(prepared)!
    expect(detailed.entries[0].avg).toBe(standalone.rotation.program.entries[0].avg)
  })

  it('keeps skill-specific bonuses and multiplier edits applied once in direct and advanced calculations', () => {
    const scenario = makeScenario()
    const baseline = prepareCombatScenarioForUi(scenario)
    const buffs = structuredClone(scenario.environment.manualEffects[0].buffs)
    buffs.modifiers.push(
      { id: 'skill-bonus', enabled: true, scope: 'skill', matchMode: 'skillId', skillId: '1506016', effect: 'mod', mod: 'dmgBonus', value: 17 },
      { id: 'skill-scale', enabled: true, scope: 'skill', matchMode: 'skillId', skillId: '1506016', effect: 'scaleMultiplier', value: 25 },
    )
    const prepared = prepareCombatScenarioForUi({
      ...scenario,
      environment: { ...scenario.environment, manualEffects: [{ ...scenario.environment.manualEffects[0], buffs }] },
    })
    const baseDirect = baseline.workspace.directOutput!.allFeatures.find((entry) => entry.feature.id === 'damage:1506016')!
    const actualDirect = prepared.workspace.directOutput!.allFeatures.find((entry) => entry.feature.id === 'damage:1506016')!
    const baseProgram = executeCombatScenarioProgram(baseline)!.entries[0]
    const actualProgram = executeCombatScenarioProgram(prepared)!.entries[0]
    for (const [before, after] of [[baseDirect, actualDirect], [baseProgram, actualProgram]]) {
      expect(after.skill.multiplier).toBeCloseTo(before.skill.multiplier * 1.25)
      expect((after.skill.skillBuffs?.dmgBonus ?? 0) - (before.skill.skillBuffs?.dmgBonus ?? 0)).toBe(17)
      expect(after.avg).toBeGreaterThan(before.avg)
    }
  })

  it('replaces a projected quick buff with the authored value during rotation execution', () => {
    const scenario = makeScenario()
    const prepared = prepareCombatScenarioForUi(scenario)
    const before = executeCombatScenarioProgram(prepared)!.entries[0]
    const items: RotationNode[] = [
      {
        id: 'change-manual-crit', type: 'condition',
        changes: [{ type: 'set', path: 'runtime.state.manualBuffs.quick.critRate', value: 20 }],
      },
      ...scenario.program.program,
    ]
    const after = executeCombatScenarioProgram(prepared, items)!.entries[0]
    expect(after.effectiveStats!.critRate! - before.effectiveStats!.critRate!).toBe(8)
    expect(prepared.subjectRuntime.state.manualBuffs.quick.critRate).toBe(12)
    expect(scenario.environment.manualEffects[0].buffs.quick.critRate).toBe(12)
  })
})
