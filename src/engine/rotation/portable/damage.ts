/*
  Author: Runor Ewhro
  description: lowers skill matching and damage operations into portable scalar
               arithmetic used by rotation candidate scoring.
*/

import { isNoEnemy } from '@/domain/entities/appState'
import type { SkillDef, ModBuff, NegEffectKey } from '@/domain/entities/stats'
import type { EffectOp, FeatDef, SkllMtchRule } from '@/domain/gameData/contracts'
import { getEnemyRes } from '@/engine/formulas/damageFactors'
import { getNegBase, type NegFfctArch } from '@/engine/formulas/negativeEffects'
import { getEnemyMaxOffTune, getTuneLevel } from '@/engine/formulas/tuneRupture'
import { getNegEffectDef, NEG_EFFECT_ELEM } from '@/engine/gameData/negativeEffects'
import { finalCoreCell, finalTopCell, finalAttributeCell, finalSkillTypeCell, finalNegativeCell } from '../numericLayout'
import { ScalarOp, type Scalar } from './ir'
import { PortableTeam } from './team'

export interface PortableSkill {
  definition: SkillDef
  hits: Array<{ count: number; multiplier: Scalar }>
  multiplier: Scalar
  flat: Scalar
  buffs: Partial<Record<keyof ModBuff, Scalar>>
  scalars: Record<string, Scalar>
}
function isSkillOperation(operation: EffectOp): boolean {
  return operation.type === 'add_skill_mod' || operation.type === 'add_skill_scalar' || operation.type === 'add_skill_multiplier' || operation.type === 'add_skill_hit_multiplier' || operation.type === 'scale_skill_multiplier'
}
export function matchesSkill(skill: SkillDef, match: SkllMtchRule | undefined): boolean {
  if (!match) return true
  return (!match.skillIds?.length || match.skillIds.includes(skill.id))
    && (!match.tabs?.length || match.tabs.includes(skill.tab))
    && (!match.skillTypes?.length || match.skillTypes.some((type) => skill.skillType.includes(type)))
    && (!match.elements?.length || match.elements.includes(skill.element))
    && (!match.labelIncludes?.length || match.labelIncludes.some((text) => skill.label.includes(text)))
}

// resolve skill variants, scaling, hit data, and scoped modifiers into scalar expressions for portable execution.
export function lowerSkill(team: PortableTeam, lane: number, definition: SkillDef, feature: FeatDef): PortableSkill {
  team.sync()
  const { ir } = team
  const skill: PortableSkill = {
    definition, hits: definition.hits.map((hit) => ({ count: hit.count, multiplier: ir.constant(hit.multiplier) })),
    multiplier: ir.constant(definition.multiplier), flat: ir.constant(definition.flat),
    buffs: Object.fromEntries(Object.entries(definition.skillBuffs ?? {}).map(([key, value]) => [key, ir.constant(value!)])),
    scalars: Object.fromEntries(['fixedDmg', 'offTune', 'directOffTune', 'skillHealingBonus', 'skillShieldBonus', 'tuneRuptureCritRate', 'tuneRuptureCritDmg', 'negativeEffectCritRate', 'negativeEffectCritDmg', 'fixedMv'].map((key) => [key, ir.constant((definition as unknown as Record<string, number>)[key] ?? 0)])),
  }
  const scalarWrites = new Map<string, Scalar>()
  const sumHits = () => ir.sum(skill.hits.map((hit) => ir.mul(hit.multiplier, ir.constant(hit.count))))
  for (const row of team.sources) for (const effect of row.effects) {
    if (effect.trigger !== 'skill' && !effect.operations.some(isSkillOperation)) continue
    const gate = team.effectGate(row, effect, lane)
    if (ir.value(gate) === 0) continue
    for (const operation of effect.operations) {
      if (!isSkillOperation(operation) || !('value' in operation) || !matchesSkill(definition, 'match' in operation ? operation.match : undefined)) continue
      const value = team.effectAmount(row, effect, lane, operation)
      if (operation.type === 'add_skill_mod') skill.buffs[operation.mod] = ir.select(gate, ir.add(skill.buffs[operation.mod] ?? ir.zero, value), skill.buffs[operation.mod] ?? ir.zero)
      else if (operation.type === 'add_skill_scalar') {
        skill.scalars[operation.field] = ir.select(gate, ir.add(skill.scalars[operation.field] ?? ir.zero, value), skill.scalars[operation.field] ?? ir.zero)
        scalarWrites.set(operation.field, ir.or(scalarWrites.get(operation.field) ?? ir.zero, ir.and(gate, ir.not(ir.eq(value, ir.zero)))))
      }
      else if (operation.type === 'add_skill_multiplier') {
        const applied = ir.and(gate, ir.operation(ScalarOp.lt, ir.zero, skill.multiplier))
        if (skill.hits.length === 0) skill.multiplier = ir.select(applied, ir.add(skill.multiplier, value), skill.multiplier)
        else {
          const ratio = ir.select(applied, ir.div(ir.add(skill.multiplier, value), skill.multiplier), ir.one)
          skill.hits = skill.hits.map((hit) => ({ ...hit, multiplier: ir.mul(hit.multiplier, ratio) }))
          skill.multiplier = sumHits()
        }
      } else if (operation.type === 'add_skill_hit_multiplier' && skill.hits[operation.hitIndex]) {
        skill.hits = skill.hits.map((hit, index) => index === operation.hitIndex ? { ...hit, multiplier: ir.select(gate, ir.add(hit.multiplier, value), hit.multiplier) } : hit)
        skill.multiplier = sumHits()
      } else if (operation.type === 'scale_skill_multiplier') {
        const read = team.scope(row.lane, lane, row.source)
        const scaleReader = team.scaleReader(row.lane, lane)
        const scale = ir.min(team.dsl.scale(effect.condition, read, scaleReader), team.dsl.formulaScale(operation.value, scaleReader))
        const raw = team.dsl.formula(operation.value, read)
        const ratio = ir.select(gate, ir.add(ir.one, ir.mul(ir.sub(raw, ir.one), scale)), ir.one)
        if (skill.hits.length === 0) skill.multiplier = ir.mul(skill.multiplier, ratio)
        else { skill.hits = skill.hits.map((hit) => ({ ...hit, multiplier: ir.mul(hit.multiplier, ratio) })); skill.multiplier = sumHits() }
      }
    }
  }
  for (const key of ['tuneRuptureCritDmg', 'negativeEffectCritDmg'] as const) if (definition[key] === undefined) skill.scalars[key] = ir.select(scalarWrites.get(key) ?? ir.zero, skill.scalars[key]!, ir.one)
  if (feature.variant === 'subHit' && feature.hitIndex !== undefined) {
    const entry = feature.damageEntryId ? definition.damageEntries?.find((entry) => entry.id === feature.damageEntryId || entry.replacesEntryId === feature.damageEntryId) : undefined
    const hit = skill.hits[entry?.hitIndex ?? feature.hitIndex]
    if (hit) {
      skill.hits = [{ ...hit, count: 1 }]; skill.multiplier = hit.multiplier
      skill.definition = { ...definition, label: feature.label, ...(entry ? { skillType: entry.skillType, element: entry.element, scaling: entry.scaling } : {}) }
    }
  }
  return skill
}

/** damage arithmetic is lowered once; candidate scoring executes only scalar
 * instructions, including caps, immunity and each archetype's distinct factors. */
export function lowerDamage(
  team: PortableTeam, lane: number, skill: PortableSkill, plane: readonly Scalar[],
  combat: Readonly<Record<string, Scalar>>, multiplier: Scalar,
): Scalar {
  const { ir } = team, definition = skill.definition, enemy = team.enemy
  const c = (value: number) => ir.constant(value)
  const top = (key: Parameters<typeof finalTopCell>[0]) => plane[finalTopCell(key)]!
  const attribute = (key: Parameters<typeof finalAttributeCell>[0], field: keyof ModBuff) => plane[finalAttributeCell(key, field)]!
  const type = (key: Parameters<typeof finalSkillTypeCell>[0], field: keyof ModBuff) => plane[finalSkillTypeCell(key, field)]!
  const types = (field: keyof ModBuff) => ir.sum([type('all', field), ...[...new Set(definition.skillType)].filter((key) => key !== 'all').map((key) => type(key, field))])
  const layer = (field: keyof ModBuff) => ir.sum([attribute('all', field), attribute(definition.element, field), types(field), skill.buffs[field] ?? ir.zero])
  const scalar = (key: string) => skill.scalars[key] ?? ir.zero
  const percent = (value: Scalar) => ir.add(ir.one, ir.div(value, c(100)))
  // absent scaling terms must disappear before liveness analysis: retaining
  // ATK * 0 would incorrectly make ATK a Theory search dependency for an HP
  // skill, multiplying the candidate space without changing damage.
  const scaling = [
    [definition.scaling.atk, plane[finalCoreCell('atk', 'final')]!],
    [definition.scaling.hp, plane[finalCoreCell('hp', 'final')]!],
    [definition.scaling.def, plane[finalCoreCell('def', 'final')]!],
    [definition.scaling.energyRegen, top('energyRegen')],
  ] as const
  const basePower = ir.sum(scaling.filter(([coefficient]) => coefficient !== 0).map(([coefficient, value]) => ir.mul(value, c(coefficient))))
  const level = team.dsl.number(team.runtime(lane, 'base.level'))
  const knownLevel = ir.value(level)
  const levelDefense = ir.add(c(800), ir.mul(c(8), level))
  const resistance = (res: Scalar) => ir.select(ir.operation(ScalarOp.lt, res, ir.zero), ir.sub(ir.one, ir.div(res, c(200))), ir.select(ir.operation(ScalarOp.lt, res, c(75)), ir.sub(ir.one, ir.div(res, c(100))), ir.div(ir.one, ir.add(ir.one, ir.mul(c(5), ir.div(res, c(100)))))))
  const defense = (ignore: Scalar, shred: Scalar, noEnemy = isNoEnemy(enemy)) => {
    if (noEnemy) return ir.one
    const reduction = ir.mul(ir.sub(ir.one, ir.div(shred, c(100))), ir.sub(ir.one, ir.div(ignore, c(100))))
    return ir.div(levelDefense, ir.add(levelDefense, ir.max(ir.zero, ir.mul(c(8 * enemy.level + 792), reduction))))
  }
  const average = (normal: Scalar, rate: Scalar, damage: Scalar) => {
    const crit = ir.mul(normal, damage)
    return ir.select(ir.operation(ScalarOp.le, ir.one, rate), crit, ir.add(ir.mul(crit, rate), ir.mul(normal, ir.sub(ir.one, rate))))
  }
  const hitSum = (fn: (hit: PortableSkill['hits'][number]) => Scalar, fallback?: Scalar) => ir.sum((skill.hits.length ? skill.hits : fallback !== undefined ? [{ count: 1, multiplier: fallback }] : []).map((hit) => ir.mul(fn(hit), c(hit.count))))
  if (definition.archetype === 'healing' || definition.archetype === 'shield') {
    const bonus = definition.archetype === 'healing' ? ir.add(top('healingBonus'), scalar('skillHealingBonus')) : ir.add(top('shieldBonus'), scalar('skillShieldBonus'))
    return ir.max(ir.one, ir.mul(ir.add(ir.mul(ir.mul(basePower, skill.multiplier), multiplier), skill.flat), percent(bonus)))
  }
  let immune = ir.zero
  for (const entry of team.immunities[lane] ?? []) {
    const scope = entry.scope
    const matches = scope.target === 'all' || (scope.target === 'element' && scope.keys.includes(definition.element))
      || (scope.target === 'skillType' && scope.keys.some((key) => definition.skillType.includes(key)))
      || (scope.target === 'negativeEffect' && scope.keys.includes(definition.archetype as NegEffectKey))
    if (matches) immune = ir.or(immune, entry.gate)
  }
  let result = ir.zero
  if (definition.archetype === 'skillDamage') {
    const res = getEnemyRes(enemy, definition.element)
    const total = ir.product([
      isNoEnemy(enemy) ? ir.one : resistance(ir.sub(c(res), layer('resShred'))),
      defense(ir.add(top('defIgnore'), layer('defIgnore')), ir.add(top('defShred'), layer('defShred'))),
      percent(ir.add(top('dmgVuln'), layer('dmgVuln'))), percent(ir.add(top('dmgBonus'), layer('dmgBonus'))),
      percent(ir.add(top('amplify'), layer('amplify'))), percent(top('finalDmg')),
    ])
    const rate = ir.div(ir.add(top('critRate'), layer('critRate')), c(100)), critDamage = ir.div(ir.add(top('critDmg'), layer('critDmg')), c(100))
    result = hitSum((hit) => average(ir.mul(ir.add(ir.mul(ir.mul(basePower, hit.multiplier), multiplier), ir.add(top('flatDmg'), skill.flat)), total), rate, critDamage))
    const totalScale = hitSum((hit) => ir.mul(hit.multiplier, multiplier), ir.one)
    const fixed = hitSum((hit) => ir.select(ir.operation(ScalarOp.lt, ir.zero, totalScale), ir.div(ir.mul(ir.max(ir.one, scalar('fixedDmg')), ir.mul(hit.multiplier, multiplier)), totalScale), ir.max(ir.one, scalar('fixedDmg'))), ir.one)
    result = ir.select(ir.operation(ScalarOp.lt, ir.zero, scalar('fixedDmg')), fixed, res === 100 ? ir.zero : result)
  } else if (definition.archetype === 'tuneRupture' || definition.archetype === 'hack') {
    const kind = definition.archetype, res = getEnemyRes(enemy, definition.element)
    if (res === 100) return ir.zero
    // same damage rules, separate buff identities; general amplification is excluded.
    const perHit = ir.product([
      resistance(ir.sub(c(res), layer('resShred'))),
      defense(ir.add(types('defIgnore'), skill.buffs.defIgnore ?? ir.zero), ir.add(top('defShred'), layer('defShred')), false),
      percent(ir.add(top('dmgVuln'), layer('dmgVuln'))), c(getEnemyMaxOffTune(enemy.class)),
      percent(type(kind, 'dmgBonus')),
      percent(top('tuneBreakBoost')), percent(top('finalDmg')),
    ])
    const tuneLevel = knownLevel === undefined ? ir.table(ir.clamp(ir.operation(ScalarOp.round, level), 1, 90), Array.from({ length: 91 }, (_, index) => getTuneLevel(index))) : c(getTuneLevel(knownLevel))
    result = hitSum((hit) => average(ir.product([hit.multiplier, multiplier, tuneLevel, perHit]), kind === 'tuneRupture' ? scalar('tuneRuptureCritRate') : ir.zero, kind === 'tuneRupture' ? scalar('tuneRuptureCritDmg') : ir.one), skill.scalars.tuneRuptureScale ?? c(definition.tuneRuptureScale ?? 16))
  } else {
    const kind = definition.archetype as NegFfctArch
    const element = NEG_EFFECT_ELEM[kind]
    if (!element) throw new Error(`Unknown portable damage archetype ${definition.archetype}`)
    const manualStacks = combat[kind] ?? ir.zero
    const stacks = definition.stackMode === 'fixedMax' ? c(definition.stackMax ?? getNegEffectDef(kind)) : manualStacks
    const additional = kind === 'electroFlare' ? ir.select(ir.operation(ScalarOp.lt, c(getNegEffectDef(kind)), manualStacks), combat.electroRage ?? ir.zero, ir.zero) : ir.zero
    let levelUnit = knownLevel === undefined ? ir.zero : c(getNegBase(kind, knownLevel, 1, { fixedMv: 1 }))
    if (knownLevel === undefined) {
      const anchors = [1, 20, 40, 50, 60, 70, 80, 90]
      for (let index = anchors.length - 2; index >= 0; index--) {
        const low = anchors[index]!, high = anchors[index + 1]!
        const start = getNegBase(kind, low, 1, { fixedMv: 1 }), end = getNegBase(kind, high, 1, { fixedMv: 1 })
        const progress = ir.div(ir.sub(level, c(low)), c(high - low))
        const curve = ir.mul(c(start), ir.operation(ScalarOp.pow, c(end / start), progress))
        const matches = ir.and(ir.operation(ScalarOp.le, c(low), level), ir.operation(ScalarOp.le, level, c(high)))
        levelUnit = ir.select(matches, curve, levelUnit)
      }
    }
    const negativeBase = (value: Scalar) => {
      const ordinary = kind === 'spectroFrazzle'
        ? ir.add(c(209.9), ir.mul(c(895.8), value))
        : kind === 'aeroErosion'
          ? ir.select(ir.eq(value, ir.one), c(1655.1), ir.sub(ir.mul(c(4133.45), value), c(4132.37)))
          : knownLevel === undefined
            ? ir.mul(ir.table(value, Array.from({ length: 20 }, (_, stacks) => getNegBase(kind, 90, stacks) / getNegBase(kind, 90, 1, { fixedMv: 1 }))), levelUnit)
            : ir.table(value, Array.from({ length: 20 }, (_, stacks) => getNegBase(kind, knownLevel, stacks)))
      const fixed = ir.mul(scalar('fixedMv'), levelUnit)
      return ir.select(ir.operation(ScalarOp.lt, ir.zero, value), definition.fixedMv !== undefined ? fixed : ordinary, ir.zero)
    }
    const res = getEnemyRes(enemy, element)
    if (res === 100) return ir.zero
    const multiplierValue = ir.product([
      ir.add(negativeBase(stacks), negativeBase(additional)), percent(ir.add(type(kind, 'amplify'), skill.buffs.amplify ?? ir.zero)), percent(types('dmgBonus')), percent(top('finalDmg')),
      isNoEnemy(enemy) ? ir.one : resistance(ir.sub(ir.sub(ir.sub(c(res), attribute('all', 'resShred')), attribute(element, 'resShred')), types('resShred'))),
      defense(ir.add(types('defIgnore'), skill.buffs.defIgnore ?? ir.zero), ir.sum([top('defShred'), attribute('all', 'defShred'), attribute(element, 'defShred'), types('defShred')])),
      ir.add(ir.one, plane[finalNegativeCell(kind, 'multiplier')]!), percent(ir.sum([top('dmgVuln'), attribute('all', 'dmgVuln'), attribute(element, 'dmgVuln'), types('dmgVuln')])),
    ])
    const rate = ir.add(scalar('negativeEffectCritRate'), ir.div(plane[finalNegativeCell(kind, 'critRate')]!, c(100)))
    const damage = ir.add(scalar('negativeEffectCritDmg'), ir.div(plane[finalNegativeCell(kind, 'critDmg')]!, c(100)))
    result = hitSum((hit) => average(ir.product([hit.multiplier, multiplier, multiplierValue]), rate, damage), ir.one)
  }
  return ir.select(immune, ir.zero, result)
}
