/*
  Author: Runor Ewhro
  description: protects Lily's packet curves, recipient routing,
               and candidate-dependent Energy Regen crit calculations.
*/

import { beforeAll, describe, expect, it } from 'vitest'
import { initGameData } from '@/data/gameData'
import { getResSeedBy } from '@/data/catalog/resonatorSeedService'
import { listSkillsFor } from '@/data/catalog/gameDataService'
import { makeEnemy, mkMaxResRt } from '@/engine/runtime/defaults'
import { makeRuntimeMap } from '@/engine/runtime/runtimeAdapters'
import { prepSkill, prprRtSkll } from '@/engine/pipeline/prepareRuntimeSkill'
import { resolveSkill } from '@/engine/pipeline/resolveSkill'
import { calcSkillDamage } from '@/engine/formulas/damage'
import { makeOptContext } from '@/engine/search/context/compiled'
import { packTargetCtx } from '@/engine/search/context/pack'
import { evalTarget } from '@/engine/search/score/evaluate'
import { buildSetRows } from '@/engine/search/encode/sets'
import { ECHO_STAT, ECHO_STAT_STRIDE, MAIN_BUFF_LEN } from '@/engine/search/layout/echoLayout'
import type { ResRuntime } from '@/domain/entities/runtime'
import type { EffectScope, SrcPkg } from '@/domain/gameData/contracts'
import { evalCond } from '@/engine/effects/evaluator'
import { applySkllOp } from '@/engine/effects/dataEffects'
import { forkNumericTeam, materializeNumericLane, writeNumericRuntime } from '@/engine/effects/numericTeam'
import betaSourcesRaw from '../../../../public/data/beta/resonators/sources.json?raw'
import betaWeaponsRaw from '../../../../public/data/beta/weapons/sources.json?raw'

const enemy = makeEnemy()
const source = (JSON.parse(betaSourcesRaw) as SrcPkg[]).find((entry) => entry.source.id === '1512')!
const weapon = (JSON.parse(betaWeaponsRaw) as SrcPkg[]).find((entry) => entry.source.id === '21030076')!

function runtimeFor(id = '1512', sequence = 0): ResRuntime {
  const seed = getResSeedBy(id)
  if (!seed) throw new Error(`Missing resonator ${id}`)
  const runtime = mkMaxResRt(seed, sequence)
  return { ...runtime, state: { ...runtime.state, controls: {} } }
}

function prepare(runtime: ResRuntime, skillId: string, runtimes: Record<string, ResRuntime> = {}) {
  const prepared = prepSkill({
    runtime, skillId: skillId.startsWith('echo:') ? '1512001' : skillId, seed: getResSeedBy(runtime.id)!, enemy,
    runtimesById: makeRuntimeMap(runtime, runtimes),
  })
  if (!prepared) throw new Error(`Missing skill ${skillId}`)
  if (skillId.startsWith('echo:')) {
    const skill = listSkillsFor('echo', '6000052').find((entry) => entry.id === skillId)
    if (!skill) throw new Error(`Missing Echo skill ${skillId}`)
    return { context: prepared.context, skill: prprRtSkll(runtime, skill, prepared.context) }
  }
  return prepared
}

beforeAll(async () => { await initGameData({ mode: 'beta' }) })

describe('Lily beta contracts', () => {
  it('keeps S5 free of damage increases and adds 400% S6 damage only to the three finishers', () => {
    for (const id of ['1512015', '1512016', '1512023']) {
      const base = prepare(runtimeFor('1512', 0), id).skill
      const s5 = prepare(runtimeFor('1512', 5), id).skill
      const s6 = prepare(runtimeFor('1512', 6), id).skill
      expect(s5.multiplier).toBe(base.multiplier)
      expect(s6.multiplier).toBe(s5.multiplier)
      expect(s6.skillBuffs?.dmgBonus).toBe((s5.skillBuffs?.dmgBonus ?? 0) + 400)
      expect(s5.damageEntries?.some((entry) => entry.replacesEntryId) ?? false).toBe(false)
    }
    expect(prepare(runtimeFor('1512', 6), '1512014').skill.skillBuffs?.dmgBonus ?? 0).toBe(0)
  })

  it('adds S3 and S4 healing without affecting the shield or unrelated skills', () => {
    for (const [id, extra] of [['1512011', 80], ['1512012', 80], ['1512027', 80], ['1512028', 80], ['1512020', 30]] as const) {
      const base = prepare(runtimeFor('1512', 0), id).skill
      const s4 = prepare(runtimeFor('1512', 4), id).skill
      expect(s4.skillHealingBonus).toBe((base.skillHealingBonus ?? 0) + extra)
    }
    expect(prepare(runtimeFor('1512', 6), '1512:flowers-for-you:shield').skill.skillShieldBonus ?? 0).toBe(0)
  })

  it.each([180, 190, 225, 260, 300])('uses Lily ER for team buffs and preserves Unison eligibility at %s ER', (totalEr) => {
    const lily = runtimeFor('1512', 2)
    const initialEr = prepare(lily, '1512001').context.finalStats.energyRegen
    lily.state.manualBuffs.quick.energyRegen = totalEr - initialEr
    lily.state.controls['resonator:1512:dream_aroma:stacks'] = 4
    lily.state.controls['resonator:1512:silvered_dream:active'] = true
    lily.state.controls['outroSkill:1512:outro:active'] = true
    lily.state.teamEffects = { unisonBoon: 4, unisonBoonMax: 4, unisonBoonPerStack: 3 }
    const atkEffect = source.effects!.find((effect) => effect.id === '1512:silvered-dream:atk')!
    for (const [id, mode, eligible] of [['1312', '', true], ['1311', 'unison', true], ['1311', 'electro_flare', false], ['1506', '', false]] as const) {
      const target = runtimeFor(id)
      target.state.controls['resonator:1311:mode:value'] = mode
      expect(evalCond(atkEffect.condition, { sourceRuntime: lily, targetRuntime: target } as EffectScope)).toBe(eligible)
    }
    const target = runtimeFor('1312')
    target.build.team = [target.id, '1512', null]
    const withBuffs = prepare(target, '1312001', { '1512': lily }).context.finalStats
    const off = { ...lily, state: { ...lily.state, controls: {} } }
    const without = prepare(target, '1312001', { '1512': off }).context.finalStats
    const supportEr = Math.min(Math.max(0, totalEr - 190), 70)
    expect(withBuffs.atk.final - without.atk.final).toBeCloseTo(without.atk.base * supportEr * 0.008)
    expect(withBuffs.skillType.echoSkill.critRate - without.skillType.echoSkill.critRate).toBeCloseTo(supportEr / 7)
    expect(withBuffs.skillType.echoSkill.critDmg - without.skillType.echoSkill.critDmg).toBeCloseTo(supportEr * 2 / 7)
    expect(withBuffs.critRate - without.critRate).toBeCloseTo(8)
    expect(withBuffs.critDmg - without.critDmg).toBeCloseTo(24)
    expect(withBuffs.amplify - without.amplify).toBeCloseTo(25)
    const highErTarget = { ...target, state: { ...target.state, manualBuffs: {
      ...target.state.manualBuffs, quick: { ...target.state.manualBuffs.quick, energyRegen: 200 },
    } } }
    const recipientBuffs = prepare(highErTarget, '1312001', { '1512': lily }).context.finalStats
    expect(recipientBuffs.atk.final).toBeCloseTo(withBuffs.atk.final)
    expect(recipientBuffs.skillType.echoSkill.critRate).toBeCloseTo(withBuffs.skillType.echoSkill.critRate)
  })

  it('updates recipient buffs after Lily ER changes within an existing numeric team', () => {
    const lily = runtimeFor()
    const initialEr = prepare(lily, '1512001').context.finalStats.energyRegen
    lily.state.manualBuffs.quick.energyRegen = 225 - initialEr
    lily.state.controls['resonator:1512:dream_aroma:stacks'] = 4
    lily.state.controls['resonator:1512:silvered_dream:active'] = true
    lily.state.teamEffects = { unisonBoon: 4, unisonBoonMax: 4, unisonBoonPerStack: 3 }
    const target = runtimeFor('1312')
    target.build.team = [target.id, lily.id, null]
    const context = prepare(target, '1312001', { [lily.id]: lily }).context
    const numeric = forkNumericTeam(context.numericTeam!)
    const before = materializeNumericLane(numeric, context.numericLane!).finalStats
    writeNumericRuntime(numeric, lily.id, 'state.manualBuffs.quick.energyRegen', 260 - initialEr)
    const after = materializeNumericLane(numeric, context.numericLane!).finalStats
    expect(after.atk.final - before.atk.final).toBeCloseTo(before.atk.base * 0.28)
    expect(after.skillType.echoSkill.critRate - before.skillType.echoSkill.critRate).toBeCloseTo(5)
    expect(after.skillType.echoSkill.critDmg - before.skillType.echoSkill.critDmg).toBeCloseTo(10)
  })

  it('requires Soothed Soul for Lullaby ATK and routes its Echo bonus to the active recipient', () => {
    const lily = runtimeFor()
    const target = runtimeFor('1506')
    target.build.team = [target.id, '1512', null]
    const baseline = prepare(target, '1506001', { '1512': lily }).context.finalStats
    lily.state.controls['weapon:21030076:passive:unison_atk'] = true
    const noSoul = prepare(target, '1506001', { '1512': lily }).context.finalStats
    expect(noSoul.atk.final).toBe(baseline.atk.final)
    lily.state.controls['weapon:21030076:passive:soothed_soul'] = true
    lily.state.controls['weapon:21030076:passive:echo_bonus'] = true
    const buffed = prepare(target, '1506001', { '1512': lily }).context.finalStats
    expect(buffed.atk.final - baseline.atk.final).toBeCloseTo(baseline.atk.base * 0.16)
    expect(buffed.skillType.echoSkill.dmgBonus - baseline.skillType.echoSkill.dmgBonus).toBe(24)
    const rankFive = { ...lily, build: { ...lily.build, weapon: { ...lily.build.weapon, rank: 5 } } }
    const refined = prepare(target, '1506001', { '1512': rankFive }).context.finalStats
    expect(refined.atk.final - baseline.atk.final).toBeCloseTo(baseline.atk.base * 0.32)
    expect(refined.skillType.echoSkill.dmgBonus - baseline.skillType.echoSkill.dmgBonus).toBe(48)
    const wielder = prepare(lily, '1512001', { '1506': target }).context.finalStats
    expect(wielder.hp.final).toBeGreaterThan(wielder.hp.base * 1.12)
    expect(weapon.effects?.map((effect) => effect.targetScope)).toEqual(['self', 'active', 'active'])
  })

  it.each([0, 60, 180])('recomputes packed damage from candidate ER below and above the cap (+%s ER)', (extraEr) => {
    const baseRuntime = runtimeFor()
    baseRuntime.state.controls['resonator:1512:dream_aroma:stacks'] = 4
    baseRuntime.state.controls['resonator:1512:silvered_dream:active'] = true
    for (const id of ['1512015', '1512016', '1512023', '1512001', '1512014', 'echo:6000052:skill:1']) {
      const prepared = prepare(baseRuntime, id)
      const compiled = makeOptContext({
        resonatorId: '1512', runtime: baseRuntime, skill: prepared.skill,
        finalStats: prepared.context.finalStats, enemy,
      })
      const context = packTargetCtx({
        compiled, skill: prepared.skill, runtime: baseRuntime,
        comboN: 1, comboK: 1, comboCount: 1, comboBaseIndex: 0, lockEchoIdx: -1, setRtMask: 0,
      })
      const stats = new Float32Array(ECHO_STAT_STRIDE)
      stats[ECHO_STAT.energyRegen] = extraEr
      const result = evalTarget({
        context, stats, setConstLut: buildSetRows(baseRuntime), mainEchoBuffs: new Float32Array(MAIN_BUFF_LEN),
        sets: new Uint8Array(1), kinds: new Uint16Array(1), comboIds: new Int32Array([0]), mainIndex: 0,
      })!
      const candidate = { ...baseRuntime, state: { ...baseRuntime.state, manualBuffs: {
        ...baseRuntime.state.manualBuffs, quick: { ...baseRuntime.state.manualBuffs.quick, energyRegen: extraEr },
      } } }
      const truth = prepare(candidate, id)
      const damage = calcSkillDamage(truth.context.finalStats, truth.skill, enemy, candidate.base.level, candidate.state.combat).avg
      expect(result.damage, `${id} at +${extraEr} ER`).toBeCloseTo(damage, 1)
    }
  })

  it('uses the runtime packet resolver and skill operation matcher for crit, excluding normal Intro', () => {
    const runtime = runtimeFor()
    const enhanced = source.skills!.find((skill) => skill.id === '1512023')!
    const normal = source.skills!.find((skill) => skill.id === '1512022')!
    const effect = source.effects!.find((effect) => effect.id === '1512:energy-regen:critRate')!
    const scope = { sourceRuntime: runtime, finalStats: { energyRegen: 400 } } as unknown as EffectScope
    expect(applySkllOp(resolveSkill(runtime, enhanced), effect.operations[0], scope).skillBuffs?.critRate).toBe(80)
    expect(applySkllOp(resolveSkill(runtime, normal), effect.operations[0], scope).skillBuffs?.critRate ?? 0).toBe(0)
  })
})
