import { describe, expect, it } from 'vitest'
import type { UnifiedBuffPool, SkillDef } from '@/domain/entities/stats'
import type { ManualBuffs } from '@/domain/entities/manualBuffs'
import { applyMnlBffs, applyMnlSkll } from '@/engine/manualBuffs'
import { mkNfdBuffPoo } from '@/engine/resolvers/buffPool'

function makeSkill(overrides: Partial<SkillDef> = {}): SkillDef {
  return {
    id: 'skill',
    label: 'Skill',
    tab: 'resonanceSkill',
    element: 'fusion',
    skillType: ['resonanceSkill'],
    archetype: 'skillDamage',
    aggregationType: 'damage',
    scaling: { atk: 1, hp: 0, def: 0, energyRegen: 0 },
    multiplier: 1,
    flat: 0,
    hits: [{ count: 1, multiplier: 1 }],
    ...overrides,
  }
}

function makeManualBuffs(modifiers: ManualBuffs['modifiers']): ManualBuffs {
  return {
    quick: {
      atk: { flat: 0, percent: 0 },
      hp: { flat: 0, percent: 0 },
      def: { flat: 0, percent: 0 },
      critRate: 0,
      critDmg: 0,
      energyRegen: 0,
      healingBonus: 0,
    },
    modifiers,
  }
}

describe('applyManualSkillModifiers', () => {
  it('adds mv to a matched skill as multiplier percentage points', () => {
    const skill = makeSkill()
    const next = applyMnlSkll(skill, makeManualBuffs([
      {
        id: 'skill:add-mv',
        enabled: true,
        scope: 'skill',
        matchMode: 'skillId',
        skillId: 'skill',
        effect: 'addMultiplier',
        value: 50,
      },
    ]))

    expect(next.multiplier).toBeCloseTo(1.5)
    expect(next.hits[0]?.multiplier).toBeCloseTo(1.5)
  })

  it('scales mv on a matched skill by percent increase', () => {
    const skill = makeSkill({
      hits: [
        { count: 1, multiplier: 0.6 },
        { count: 2, multiplier: 0.2 },
      ],
      multiplier: 1,
    })
    const next = applyMnlSkll(skill, makeManualBuffs([
      {
        id: 'skill:scale-mv',
        enabled: true,
        scope: 'skill',
        matchMode: 'tab',
        tab: 'resonanceSkill',
        effect: 'scaleMultiplier',
        value: 25,
      },
    ]))

    expect(next.multiplier).toBeCloseTo(1.25)
    expect(next.hits[0]?.multiplier).toBeCloseTo(0.75)
    expect(next.hits[1]?.multiplier).toBeCloseTo(0.25)
  })

  it('adds mv to a specific hit row on a matched skill', () => {
    const skill = makeSkill({
      hits: [
        { count: 1, multiplier: 0.6 },
        { count: 1, multiplier: 0.4 },
      ],
      multiplier: 1,
    })
    const next = applyMnlSkll(skill, makeManualBuffs([
      {
        id: 'skill:hit-mv',
        enabled: true,
        scope: 'skill',
        matchMode: 'skillType',
        skillType: 'resonanceSkill',
        effect: 'addHitMultiplier',
        hitIndex: 1,
        value: 30,
      },
    ]))

    expect(next.multiplier).toBeCloseTo(1.3)
    expect(next.hits[0]?.multiplier).toBeCloseTo(0.6)
    expect(next.hits[1]?.multiplier).toBeCloseTo(0.7)
  })

  it('adds scalar fields to matched skills', () => {
    const skill = makeSkill()
    const next = applyMnlSkll(skill, makeManualBuffs([
      {
        id: 'skill:scalar',
        enabled: true,
        scope: 'skill',
        matchMode: 'skillType',
        skillType: 'all',
        effect: 'scalar',
        field: 'fixedDmg',
        value: 1234,
      },
    ]))

    expect(next.fixedDmg).toBe(1234)
  })

  it('adds negative effect modifiers to the buff pool', () => {
    const pool: UnifiedBuffPool = mkNfdBuffPoo()
    applyMnlBffs(pool, makeManualBuffs([
      {
        id: 'negative:crit',
        enabled: true,
        scope: 'negativeEffect',
        negativeEffect: 'spectroFrazzle',
        mod: 'critRate',
        value: 12,
      },
    ]))

    expect(pool.negativeEffect.spectroFrazzle.critRate).toBe(12)
  })
})
