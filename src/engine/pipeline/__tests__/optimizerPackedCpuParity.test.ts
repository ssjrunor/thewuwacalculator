import { describe, expect, it } from 'vitest'
import type { EnemyProfile } from '@/domain/entities/appState'
import type { FinalStats, SkillDefinition } from '@/domain/entities/stats'
import { getResonatorSeedById } from '@/domain/services/resonatorSeedService'
import { createDefaultResonatorRuntime, makeDefaultEnemyProfile } from '@/domain/state/defaults'
import { computeSkillDamage } from '@/engine/formulas/damage'
import {
  OPTIMIZER_MAIN_ECHO_BUFFS_PER_ECHO,
  OPTIMIZER_STATS_PER_ECHO,
} from '@/engine/optimizer/config/constants'
import { createCpuScratch } from '@/engine/optimizer/cpu/scratch'
import { createComboDamageScratch, evaluateTargetSkillCombo } from '@/engine/optimizer/cpu/computeDamage'
import { buildCompiledOptimizerContext } from '@/engine/optimizer/context/compiled'
import { packTargetContext } from '@/engine/optimizer/context/pack'
import { packCompiledContext } from '@/engine/optimizer/context/vector'
import { runRotationSearchBatch } from '@/engine/optimizer/search/rotationCpu'
import { buildSetRows, buildSetRuntimeMask } from '@/engine/optimizer/encode/sets'
import { evaluateTargetCpuCombo } from '@/engine/optimizer/target/cpu'

function makeBuff() {
  return {
    resShred: 0,
    dmgBonus: 0,
    amplify: 0,
    defIgnore: 0,
    defShred: 0,
    dmgVuln: 0,
    critRate: 0,
    critDmg: 0,
  }
}

function makeNegativeEffectBuff() {
  return {
    critRate: 0,
    critDmg: 0,
    multiplier: 0,
  }
}

function makeFinalStats(overrides: Partial<FinalStats> = {}): FinalStats {
  return {
    atk: { base: 1000, final: 1000 },
    hp: { base: 1000, final: 1000 },
    def: { base: 1000, final: 1000 },
    attribute: {
      all: makeBuff(),
      physical: makeBuff(),
      glacio: makeBuff(),
      fusion: makeBuff(),
      electro: makeBuff(),
      aero: makeBuff(),
      spectro: makeBuff(),
      havoc: makeBuff(),
    },
    skillType: {
      all: makeBuff(),
      basicAtk: makeBuff(),
      heavyAtk: makeBuff(),
      resonanceSkill: makeBuff(),
      resonanceLiberation: makeBuff(),
      introSkill: makeBuff(),
      outroSkill: makeBuff(),
      echoSkill: makeBuff(),
      coord: makeBuff(),
      spectroFrazzle: makeBuff(),
      aeroErosion: makeBuff(),
      fusionBurst: makeBuff(),
      havocBane: makeBuff(),
      glacioChafe: makeBuff(),
      electroFlare: makeBuff(),
      healing: makeBuff(),
      shield: makeBuff(),
      tuneRupture: makeBuff(),
    },
    negativeEffect: {
      spectroFrazzle: makeNegativeEffectBuff(),
      aeroErosion: makeNegativeEffectBuff(),
      fusionBurst: makeNegativeEffectBuff(),
      havocBane: makeNegativeEffectBuff(),
      glacioChafe: makeNegativeEffectBuff(),
      electroFlare: makeNegativeEffectBuff(),
    },
    flatDmg: 0,
    amplify: 0,
    critRate: 5,
    critDmg: 150,
    energyRegen: 100,
    healingBonus: 0,
    shieldBonus: 0,
    dmgBonus: 0,
    defIgnore: 0,
    defShred: 0,
    dmgVuln: 0,
    tuneBreakBoost: 0,
    special: 0,
    ...overrides,
  }
}

const tuneRuptureSkill: SkillDefinition = {
  id: 'tune-rupture',
  label: 'Tune Rupture',
  tab: 'tuneBreak',
  element: 'physical',
  skillType: ['tuneRupture'],
  archetype: 'tuneRupture',
  aggregationType: 'damage',
  scaling: { atk: 0, hp: 0, def: 0, energyRegen: 0 },
  multiplier: 0,
  flat: 0,
  tuneRuptureCritRate: 0.35,
  tuneRuptureCritDmg: 2.1,
  hits: [
    { count: 4, multiplier: 1 },
    { count: 1, multiplier: 12 },
  ],
}

const spectroFrazzleSkill: SkillDefinition = {
  id: 'spectro-frazzle',
  label: 'Spectro Frazzle',
  tab: 'negativeEffect',
  element: 'spectro',
  skillType: ['spectroFrazzle'],
  archetype: 'spectroFrazzle',
  aggregationType: 'damage',
  scaling: { atk: 0, hp: 0, def: 0, energyRegen: 0 },
  multiplier: 0,
  flat: 0,
  negativeEffectCritRate: 0.25,
  negativeEffectCritDmg: 2.3,
  hits: [{ count: 1, multiplier: 1 }],
}

const fusionBurstSkill: SkillDefinition = {
  id: 'fusion-burst',
  label: 'Fusion Burst',
  tab: 'negativeEffect',
  element: 'fusion',
  skillType: ['fusionBurst'],
  archetype: 'fusionBurst',
  aggregationType: 'damage',
  scaling: { atk: 0, hp: 0, def: 0, energyRegen: 0 },
  multiplier: 0,
  flat: 0,
  negativeEffectCritRate: 0.4,
  negativeEffectCritDmg: 2.6,
  hits: [{ count: 1, multiplier: 1 }],
}

const glacioChafeSkill: SkillDefinition = {
  id: 'glacio-chafe',
  label: 'Glacio Chafe',
  tab: 'negativeEffect',
  element: 'glacio',
  skillType: ['glacioChafe'],
  archetype: 'glacioChafe',
  aggregationType: 'damage',
  scaling: { atk: 0, hp: 0, def: 0, energyRegen: 0 },
  multiplier: 0,
  flat: 0,
  negativeEffectCritRate: 0.3,
  negativeEffectCritDmg: 2.4,
  hits: [{ count: 1, multiplier: 1 }],
}

const electroFlareSkill: SkillDefinition = {
  id: 'electro-flare',
  label: 'Electro Flare',
  tab: 'negativeEffect',
  element: 'electro',
  skillType: ['electroFlare'],
  archetype: 'electroFlare',
  aggregationType: 'damage',
  scaling: { atk: 0, hp: 0, def: 0, energyRegen: 0 },
  multiplier: 0,
  flat: 0,
  negativeEffectCritRate: 0.2,
  negativeEffectCritDmg: 2.2,
  hits: [{ count: 1, multiplier: 1 }],
}

const resonanceSkillTarget: SkillDefinition = {
  id: 'rotation-skill',
  label: 'Rotation Skill',
  tab: 'resonanceSkill',
  element: 'fusion',
  skillType: ['resonanceSkill'],
  archetype: 'skillDamage',
  aggregationType: 'damage',
  scaling: { atk: 1, hp: 0, def: 0, energyRegen: 0 },
  multiplier: 1,
  flat: 0,
  hits: [{ count: 1, multiplier: 1 }],
}

const liberationTarget: SkillDefinition = {
  id: 'rotation-lib',
  label: 'Rotation Liberation',
  tab: 'resonanceLiberation',
  element: 'fusion',
  skillType: ['resonanceLiberation'],
  archetype: 'skillDamage',
  aggregationType: 'damage',
  scaling: { atk: 1, hp: 0, def: 0, energyRegen: 0 },
  multiplier: 1,
  flat: 0,
  hits: [{ count: 1, multiplier: 1 }],
}

function createDisabledConstraints(): Float32Array {
  return new Float32Array([
    1, 0,
    1, 0,
    1, 0,
    1, 0,
    1, 0,
    1, 0,
    1, 0,
    1, 0,
  ])
}

function evaluatePackedCpuSkill(params: {
  runtimeCombat?: {
    spectroFrazzle?: number
    aeroErosion?: number
    fusionBurst?: number
    glacioChafe?: number
    electroFlare?: number
    electroRage?: number
  }
  finalStats: FinalStats
  skill: SkillDefinition
  enemy: EnemyProfile
}): number {
  const seed = getResonatorSeedById('1209')
  if (!seed) {
    throw new Error('Missing test seed 1209')
  }

  const runtime = createDefaultResonatorRuntime(seed)
  runtime.base.level = 90
  runtime.state.combat = {
    ...runtime.state.combat,
    ...params.runtimeCombat,
  }

  const compiled = buildCompiledOptimizerContext({
    resonatorId: runtime.id,
    runtime,
    skill: params.skill,
    finalStats: params.finalStats,
    enemy: params.enemy,
    combatState: runtime.state.combat,
  })

  const evaluated = evaluateTargetSkillCombo({
    context: packCompiledContext(compiled),
    stats: new Float32Array(5 * OPTIMIZER_STATS_PER_ECHO),
    sets: new Uint8Array([0, 1, 2, 3, 4]),
    kinds: new Uint16Array([0, 1, 2, 3, 4]),
    setConstLut: buildSetRows(runtime),
    mainEchoBuffs: new Float32Array(5 * OPTIMIZER_MAIN_ECHO_BUFFS_PER_ECHO),
    constraints: createDisabledConstraints(),
    comboIds: new Int32Array([0, 1, 2, 3, 4]),
    lockedMainIndex: 0,
    scratch: createComboDamageScratch(),
  })

  return evaluated?.damage ?? 0
}

describe('optimizer packed cpu parity', () => {
  it('matches computeSkillDamage for tune rupture', () => {
    const enemy = makeDefaultEnemyProfile()
    const finalStats = makeFinalStats({
      amplify: 18,
      dmgVuln: 12,
      tuneBreakBoost: 24,
      skillType: {
        ...makeFinalStats().skillType,
        tuneRupture: {
          ...makeBuff(),
          dmgBonus: 35,
        },
      },
    })

    const expected = computeSkillDamage(finalStats, tuneRuptureSkill, enemy, 90).avg
    const packed = evaluatePackedCpuSkill({
      finalStats,
      skill: tuneRuptureSkill,
      enemy,
    })

    expect(Math.abs(packed - expected)).toBeLessThan(0.01)
  })

  it('matches computeSkillDamage for spectro frazzle', () => {
    const enemy = makeDefaultEnemyProfile()
    const finalStats = makeFinalStats({
      amplify: 15,
      dmgVuln: 10,
      special: 28,
      skillType: {
        ...makeFinalStats().skillType,
        spectroFrazzle: {
          ...makeBuff(),
          amplify: 20,
          dmgBonus: 30,
        },
      },
    })

    const combat = { spectroFrazzle: 4 }
    const expected = computeSkillDamage(finalStats, spectroFrazzleSkill, enemy, 90, combat).avg
    const packed = evaluatePackedCpuSkill({
      finalStats,
      skill: spectroFrazzleSkill,
      enemy,
      runtimeCombat: combat,
    })

    expect(Math.abs(packed - expected)).toBeLessThan(0.001)
  })

  it('matches computeSkillDamage for fusion burst', () => {
    const enemy = makeDefaultEnemyProfile()
    const finalStats = makeFinalStats({
      amplify: 12,
      dmgVuln: 7,
      special: 14,
      negativeEffect: {
        ...makeFinalStats().negativeEffect,
        fusionBurst: {
          ...makeNegativeEffectBuff(),
          multiplier: 1.8,
        },
      },
      skillType: {
        ...makeFinalStats().skillType,
        fusionBurst: {
          ...makeBuff(),
          amplify: 22,
          dmgBonus: 18,
        },
      },
    })

    const combat = { fusionBurst: 3 }
    const expected = computeSkillDamage(finalStats, fusionBurstSkill, enemy, 90, combat).avg
    const packed = evaluatePackedCpuSkill({
      finalStats,
      skill: fusionBurstSkill,
      enemy,
      runtimeCombat: combat,
    })

    expect(Math.abs(packed - expected)).toBeLessThan(0.001)
  })

  it('matches computeSkillDamage for glacio chafe', () => {
    const enemy = makeDefaultEnemyProfile()
    const finalStats = makeFinalStats({
      skillType: {
        ...makeFinalStats().skillType,
        glacioChafe: {
          ...makeBuff(),
          dmgBonus: 18,
          amplify: 12,
        },
      },
    })
    const combat = { glacioChafe: 4 }
    const expected = computeSkillDamage(finalStats, glacioChafeSkill, enemy, 90, combat).avg
    const actual = evaluatePackedCpuSkill({
      finalStats,
      skill: glacioChafeSkill,
      enemy,
      runtimeCombat: combat,
    })

    expect(Math.abs(actual - expected)).toBeLessThan(0.001)
  })

  it('matches computeSkillDamage for fixed-mv glacio bite', () => {
    const enemy = makeDefaultEnemyProfile()
    const finalStats = makeFinalStats({
      skillType: {
        ...makeFinalStats().skillType,
        glacioChafe: {
          ...makeBuff(),
          dmgBonus: 18,
          amplify: 12,
        },
      },
    })
    const combat = { glacioChafe: 10 }
    const skill = {
      ...glacioChafeSkill,
      id: 'glacio-bite',
      label: 'Glacio Bite',
      fixedMv: 10200,
    }
    const expected = computeSkillDamage(finalStats, skill, enemy, 90, combat).avg
    const actual = evaluatePackedCpuSkill({
      finalStats,
      skill,
      enemy,
      runtimeCombat: combat,
    })

    expect(Math.abs(actual - expected)).toBeLessThan(0.001)
  })

  it('matches computeSkillDamage for electro flare', () => {
    const enemy = makeDefaultEnemyProfile()
    const finalStats = makeFinalStats({
      amplify: 16,
      dmgVuln: 11,
      special: 9,
      skillType: {
        ...makeFinalStats().skillType,
        electroFlare: {
          ...makeBuff(),
          amplify: 14,
          dmgBonus: 27,
        },
      },
    })

    const combat = { electroFlare: 5 }
    const expected = computeSkillDamage(finalStats, electroFlareSkill, enemy, 90, combat).avg
    const packed = evaluatePackedCpuSkill({
      finalStats,
      skill: electroFlareSkill,
      enemy,
      runtimeCombat: combat,
    })

    expect(Math.abs(packed - expected)).toBeLessThan(0.001)
  })

  it('matches computeSkillDamage for electro flare when electro rage stacks are also present', () => {
    const enemy = makeDefaultEnemyProfile()
    const finalStats = makeFinalStats({
      amplify: 16,
      dmgVuln: 11,
      special: 9,
      skillType: {
        ...makeFinalStats().skillType,
        electroFlare: {
          ...makeBuff(),
          amplify: 14,
          dmgBonus: 27,
        },
      },
    })

    const combat = { electroFlare: 11, electroRage: 3 }
    const expected = computeSkillDamage(finalStats, electroFlareSkill, enemy, 90, combat).avg
    const packed = evaluatePackedCpuSkill({
      finalStats,
      skill: electroFlareSkill,
      enemy,
      runtimeCombat: combat,
    })

    expect(Math.abs(packed - expected)).toBeLessThan(0.001)
  })

  it('uses one shared main echo across the full CPU rotation total', async () => {
    const seed = getResonatorSeedById('1209')
    expect(seed).toBeTruthy()
    if (!seed) {
      return
    }

    const runtime = createDefaultResonatorRuntime(seed)
    runtime.base.level = 90
    const enemy = makeDefaultEnemyProfile()
    const finalStats = makeFinalStats({
      critRate: 0,
      critDmg: 100,
    })
    const setRuntimeMask = buildSetRuntimeMask(runtime)

    const compiledSkill = buildCompiledOptimizerContext({
      resonatorId: runtime.id,
      runtime,
      skill: resonanceSkillTarget,
      finalStats,
      enemy,
      combatState: runtime.state.combat,
    })
    const compiledLib = buildCompiledOptimizerContext({
      resonatorId: runtime.id,
      runtime,
      skill: liberationTarget,
      finalStats,
      enemy,
      combatState: runtime.state.combat,
    })

    const contextSkill = packTargetContext({
      compiled: compiledSkill,
      skill: resonanceSkillTarget,
      runtime,
      comboN: 5,
      comboK: 5,
      comboCount: 1,
      comboBaseIndex: 0,
      lockedEchoIndex: -1,
      setRuntimeMask,
    })
    const contextLib = packTargetContext({
      compiled: compiledLib,
      skill: liberationTarget,
      runtime,
      comboN: 5,
      comboK: 5,
      comboCount: 1,
      comboBaseIndex: 0,
      lockedEchoIndex: -1,
      setRuntimeMask,
    })

    const stats = new Float32Array(5 * 20)
    const mainEchoBuffs = new Float32Array(5 * 15)
    mainEchoBuffs[0 * 15 + 4] = 100
    mainEchoBuffs[1 * 15 + 5] = 100

    const sharedPayload = {
      mode: 'rotation' as const,
      resultsLimit: 4,
      lowMemoryMode: false,
      constraints: createDisabledConstraints(),
      costs: new Uint8Array([4, 1, 1, 1, 1]),
      sets: new Uint8Array([0, 1, 2, 3, 4]),
      kinds: new Uint16Array([0, 1, 2, 3, 4]),
      comboN: 5,
      comboK: 5,
      comboTotalCombos: 1,
      comboIndexMap: new Int32Array([0, 1, 2, 3, 4]),
      comboBinom: new Uint32Array(0),
      lockedMainRequested: false,
      lockedMainCandidateIndices: new Int32Array([0, 1, 2, 3, 4]),
      progressFactor: 1,
      contextStride: contextSkill.length,
      contextCount: 2,
      contexts: new Float32Array([...contextSkill, ...contextLib]),
      contextWeights: new Float32Array([1, 1]),
      displayContext: contextSkill,
      stats,
      setConstLut: buildSetRows(runtime),
      mainEchoBuffs,
    }

    const comboIds = new Int32Array([0, 1, 2, 3, 4])
    const totalsByMain = Array.from(comboIds, (mainIndex) => {
      const skillDamage = evaluateTargetCpuCombo({
        context: contextSkill,
        stats,
        setConstLut: sharedPayload.setConstLut,
        mainEchoBuffs,
        sets: sharedPayload.sets,
        kinds: sharedPayload.kinds,
        constraints: createDisabledConstraints(),
        comboIds,
        lockedMainIndex: mainIndex,
        scratch: createCpuScratch(),
      })?.damage ?? 0
      const libDamage = evaluateTargetCpuCombo({
        context: contextLib,
        stats,
        setConstLut: sharedPayload.setConstLut,
        mainEchoBuffs,
        sets: sharedPayload.sets,
        kinds: sharedPayload.kinds,
        constraints: createDisabledConstraints(),
        comboIds,
        lockedMainIndex: mainIndex,
        scratch: createCpuScratch(),
      })?.damage ?? 0

      return skillDamage + libDamage
    })

    const expectedDamage = Math.max(...totalsByMain)
    const expectedMainIndex = totalsByMain.indexOf(expectedDamage)
    expect(expectedDamage).toBeGreaterThan(0)

    const results = await runRotationSearchBatch(
      sharedPayload,
      {
        combosBatch: comboIds,
        comboCount: 1,
        lockedMainIndex: -1,
        jobResultsLimit: 4,
      },
    )

    expect(results).toHaveLength(1)
    expect(results[0]?.i0).toBe(expectedMainIndex)
    expect(Math.abs((results[0]?.damage ?? 0) - expectedDamage)).toBeLessThan(0.001)
  })
})
