/*
  Author: Runor Ewhro
  Description: Defines helpers for building weapon game-data packages,
               passive state controls, and runtime effect definitions.
*/

import type { GeneratedWeapon } from '@/domain/entities/weapon.ts'
import type {
  SourcePackage,
  DataSourceRef,
  SourceOwnerDefinition,
  SourceStateDefinition,
  EffectDefinition,
  EffectOperation,
  FormulaExpression,
  ConditionExpression,
  BaseStatKey,
  BaseStatField,
  TopBuffStatKey,
} from '@/domain/gameData/contracts.ts'
import type { AttributeKey, SkillTypeKey } from '@/domain/entities/stats.ts'

// helpers

// parse a numeric passive parameter, stripping percent signs when present
function parseParam(value: string): number {
  return parseFloat(value.replace('%', ''))
}

// parse grouped weapon passive params into numeric tables
function parseParams(params: string[][]): number[][] {
  return params.map((group) => group.map(parseParam))
}

// build a rank-scaled lookup table formula for a given passive param index
function rankTable(parsed: number[][], paramIndex: number): FormulaExpression {
  const values = parsed[paramIndex]
  if (!values || values.length === 0) {
    return { type: 'const', value: 0 }
  }

  return {
    type: 'table',
    from: 'sourceRuntime',
    path: 'build.weapon.rank',
    values,
    minIndex: 1,
  }
}

// multiply two formula expressions
function mulFormula(a: FormulaExpression, b: FormulaExpression): FormulaExpression {
  return { type: 'mul', values: [a, b] }
}

// read a weapon passive control from source runtime controls
function readControl(controlKey: string): FormulaExpression {
  return {
    type: 'read',
    from: 'sourceRuntime',
    path: `state.controls.${controlKey}`,
    default: 0,
  }
}

// require a weapon passive control to be truthy
function truthyCondition(controlKey: string): ConditionExpression {
  return {
    type: 'truthy',
    from: 'sourceRuntime',
    path: `state.controls.${controlKey}`,
  }
}

// combine multiple conditions with logical and
function andCondition(...values: ConditionExpression[]): ConditionExpression {
  return { type: 'and', values }
}

// operation builders

// create a base stat add operation
function addBaseStat(
    stat: BaseStatKey,
    field: BaseStatField,
    value: FormulaExpression,
): EffectOperation {
  return { type: 'add_base_stat', stat, field, value }
}

// create a top-level stat add operation
function addTopStat(stat: TopBuffStatKey, value: FormulaExpression): EffectOperation {
  return { type: 'add_top_stat', stat, value }
}

// create an attribute modifier add operation
function addAttributeMod(
    attribute: (AttributeKey | 'all') | (AttributeKey | 'all')[],
    mod: string,
    value: FormulaExpression,
): EffectOperation {
  return { type: 'add_attribute_mod', attribute, mod, value } as EffectOperation
}

// create a skill-type modifier add operation
function addSkilltypeMod(
    skillType: SkillTypeKey | SkillTypeKey[],
    mod: string,
    value: FormulaExpression,
): EffectOperation {
  return { type: 'add_skilltype_mod', skillType, mod, value } as EffectOperation
}

// source builders

interface WeaponEffectBuilder {
  owners: SourceOwnerDefinition[]
  states: SourceStateDefinition[]
  effects: EffectDefinition[]
}

// build a weapon source reference
function makeSource(id: string): DataSourceRef {
  return { type: 'weapon', id }
}

// build the shared weapon passive owner definition
function makeOwner(id: string, name: string, desc?: string): SourceOwnerDefinition {
  const ownerKey = `weapon:${id}:passive`

  return {
    id: 'passive',
    label: name,
    source: makeSource(id),
    scope: 'weapon',
    kind: 'weaponPassive',
    ownerKey,
    description: desc,
  }
}

// build a toggle state definition for a weapon passive control
function makeToggle(
    id: string,
    stateId: string,
    label: string,
    description?: string,
): SourceStateDefinition {
  const ownerKey = `weapon:${id}:passive`
  const controlKey = `${ownerKey}:${stateId}`

  return {
    id: stateId,
    label,
    source: makeSource(id),
    ownerKey,
    controlKey,
    path: `runtime.state.controls.${controlKey}`,
    kind: 'toggle',
    defaultValue: false,
    ...(description ? { description } : {}),
  }
}

// build a stack state definition for a weapon passive control
function makeStack(
    id: string,
    stateId: string,
    label: string,
    max: number,
    min = 0,
    description?: string,
): SourceStateDefinition {
  const ownerKey = `weapon:${id}:passive`
  const controlKey = `${ownerKey}:${stateId}`

  return {
    id: stateId,
    label,
    source: makeSource(id),
    ownerKey,
    controlKey,
    path: `runtime.state.controls.${controlKey}`,
    kind: 'stack',
    defaultValue: 0,
    min,
    max,
    ...(description ? { description } : {}),
  }
}

// build a numeric state definition for a weapon passive control
function makeNumber(
    id: string,
    stateId: string,
    label: string,
    max: number,
    min = 0,
    description?: string,
): SourceStateDefinition {
  const ownerKey = `weapon:${id}:passive`
  const controlKey = `${ownerKey}:${stateId}`

  return {
    id: stateId,
    label,
    source: makeSource(id),
    ownerKey,
    controlKey,
    path: `runtime.state.controls.${controlKey}`,
    kind: 'number',
    defaultValue: 0,
    min,
    max,
    ...(description ? { description } : {}),
  }
}

// build a runtime effect definition for a weapon passive
function makeEffect(
    id: string,
    effectId: string,
    label: string,
    operations: EffectOperation[],
    condition?: ConditionExpression,
    targetScope: EffectDefinition['targetScope'] = 'self',
): EffectDefinition {
  return {
    id: `weapon:${id}:${effectId}`,
    label,
    source: makeSource(id),
    ownerKey: `weapon:${id}:passive`,
    trigger: 'runtime',
    targetScope,
    ...(condition ? { condition } : {}),
    operations,
  }
}

// weapon definition builder signature
type WeaponDefiner = (id: string, p: number[][]) => WeaponEffectBuilder

// actual effects
const weaponDefiners: Record<string, WeaponDefiner> = {
  // --- Broadblades ---

  // Broadblade#41 (21010011): ATK% unconditional
  '21010011': (id, p) => ({
    owners: [makeOwner(id, 'Passive', `Increases ATK by {0}.`)],
    states: [],
    effects: [makeEffect(id, 'atk', 'ATK%', [addBaseStat('atk', 'percent', rankTable(p, 0))])],
  }),

  // Broadblade#41 (21010012): ATK% unconditional
  '21010012': (id, p) => ({
    owners: [makeOwner(id, 'Passive', `Increases ATK by {0}.`)],
    states: [],
    effects: [makeEffect(id, 'atk', 'ATK%', [addBaseStat('atk', 'percent', rankTable(p, 0))])],
  }),

  // Broadblade (21010013): toggle firstP -> ATK%
  '21010013': (id, p) => ({
    owners: [makeOwner(id, 'Passive')],
    states: [makeToggle(id, 'active', 'ATK Buff',
      `When Intro Skill is cast, increases ATK by {0}, lasting for {1}s.`)],
    effects: [
      makeEffect(id, 'atk', 'ATK%', [addBaseStat('atk', 'percent', rankTable(p, 1))],
        truthyCondition(`weapon:${id}:passive:active`)),
    ],
  }),

  // Broadblade (21010015): energyRegen + stacks -> ult dmgBonus
  '21010015': (id, p) => ({
    owners: [makeOwner(id, 'Passive', `Increases Energy Regen by {0}.`)],
    states: [makeStack(id, 'stacks', 'Stacks', 3, 0,
      `When Resonance Skill is cast, Resonance Liberation DMG Bonus is increased by {1}, stacking up to {2} times. This effect lasts for {3}s.`)],
    effects: [
      makeEffect(id, 'energy', 'Energy Regen', [addTopStat('energyRegen', rankTable(p, 0))]),
      makeEffect(id, 'ult', 'Res. Liberation DMG',
        [addSkilltypeMod('resonanceLiberation', 'dmgBonus', mulFormula(readControl(`weapon:${id}:passive:stacks`), rankTable(p, 1)))]),
    ],
  }),

  // Broadblade (21010016): all dmgBonus + stacks -> heavyAtk dmgBonus
  '21010016': (id, p) => ({
    owners: [makeOwner(id, 'Passive', `Increases Attribute DMG Bonus by {0}.`)],
    states: [makeStack(id, 'stacks', 'Stacks', 2, 0,
      `Every time Intro Skill or Resonance Liberation is cast, increases Heavy Attack DMG Bonus by {1}, stacking up to {2} time(s). This effect lasts for {3}s.`)],
    effects: [
      makeEffect(id, 'dmg', 'All DMG Bonus', [addAttributeMod('all', 'dmgBonus', rankTable(p, 0))]),
      makeEffect(id, 'heavy', 'Heavy ATK DMG',
        [addSkilltypeMod('heavyAtk', 'dmgBonus', mulFormula(readControl(`weapon:${id}:passive:stacks`), rankTable(p, 1)))]),
    ],
  }),

  // Broadblade (21010026): all dmgBonus + 2 toggles -> resonanceSkill dmgBonus
  '21010026': (id, p) => ({
    owners: [makeOwner(id, 'Passive', `Grants {0} Attribute DMG Bonus.`)],
    states: [
      makeToggle(id, 'ageless', 'Ageless',
        `Casting Intro Skill gives the equipper Ageless Marking, which grants {1} Resonance Skill DMG Bonus for {2}s.`),
      makeToggle(id, 'ethereal', 'Ethereal',
        `Casting Resonance Skill gives the equipper Ethereal Endowment, which grants {1} Resonance Skill DMG Bonus for {4}s.`),
    ],
    effects: [
      makeEffect(id, 'dmg', 'All DMG Bonus', [addAttributeMod('all', 'dmgBonus', rankTable(p, 0))]),
      makeEffect(id, 'skill_ageless', 'Res. Skill DMG (Ageless)',
        [addSkilltypeMod('resonanceSkill', 'dmgBonus', rankTable(p, 1))],
        truthyCondition(`weapon:${id}:passive:ageless`)),
      makeEffect(id, 'skill_ethereal', 'Res. Skill DMG (Ethereal)',
        [addSkilltypeMod('resonanceSkill', 'dmgBonus', rankTable(p, 1))],
        truthyCondition(`weapon:${id}:passive:ethereal`)),
    ],
  }),

  // Broadblade (21010034): toggle -> ATK%
  '21010034': (id, p) => ({
    owners: [makeOwner(id, 'Passive')],
    states: [makeToggle(id, 'active', 'ATK Buff',
      `When the Resonator's HP is above {0}, increases ATK by {1}.`)],
    effects: [
      makeEffect(id, 'atk', 'ATK%', [addBaseStat('atk', 'percent', rankTable(p, 1))],
        truthyCondition(`weapon:${id}:passive:active`)),
    ],
  }),

  // Broadblade (21010036): ATK% + toggle firstP -> ult dmg + toggle secondP -> fusion dmg
  '21010036': (id, p) => ({
    owners: [makeOwner(id, 'Passive', `Increases ATK by {0}.`)],
    states: [
      makeToggle(id, 'ult_buff', 'Res. Liberation DMG',
        `Performing Intro Skill or Resonance Liberation increases Resonance Liberation DMG by {1} for {2}s.`),
      makeToggle(id, 'fusion_buff', 'Fusion DMG',
        `Dealing Heavy Attack DMG extends this effect by {3}s, up to {4} time. Each successful extension gives {5} Fusion DMG Bonus to all Resonators in the team for {6}s. Effects of the same name cannot be stacked.`),
    ],
    effects: [
      makeEffect(id, 'atk', 'ATK%', [addBaseStat('atk', 'percent', rankTable(p, 0))]),
      makeEffect(id, 'ult', 'Res. Liberation DMG',
        [addSkilltypeMod('resonanceLiberation', 'dmgBonus', rankTable(p, 1))],
        truthyCondition(`weapon:${id}:passive:ult_buff`)),
      makeEffect(id, 'fusion', 'Fusion DMG',
        [addAttributeMod('fusion', 'dmgBonus', rankTable(p, 5))],
        truthyCondition(`weapon:${id}:passive:fusion_buff`), 'teamWide'),
    ],
  }),

  // Broadblade (21010044): toggle -> ATK%
  '21010044': (id, p) => ({
    owners: [makeOwner(id, 'Passive')],
    states: [makeToggle(id, 'active', 'ATK Buff',
      `When Intro Skill is cast, increases ATK by {0} and DEF by {1}, lasting for {2}s.`)],
    effects: [
      makeEffect(id, 'atk', 'ATK%', [addBaseStat('atk', 'percent', rankTable(p, 0))],
        truthyCondition(`weapon:${id}:passive:active`)),
    ],
  }),

  // Broadblade (21010045): ATK% + toggle -> ult dmgBonus
  '21010045': (id, p) => ({
    owners: [makeOwner(id, 'Passive', `Increases ATK by {0}.`)],
    states: [makeToggle(id, 'active', 'Res. Liberation DMG',
      `Dealing damage to targets under Tune Strain - Interfered grants {1} Resonance Liberation Bonus for {2}s. Retriggering the effect resets its duration.`)],
    effects: [
      makeEffect(id, 'atk', 'ATK%', [addBaseStat('atk', 'percent', rankTable(p, 0))]),
      makeEffect(id, 'ult', 'Res. Liberation DMG',
        [addSkilltypeMod('resonanceLiberation', 'dmgBonus', rankTable(p, 1))],
        truthyCondition(`weapon:${id}:passive:active`)),
    ],
  }),

  // Broadblade (21010046): ATK% + toggle -> heavyAtk dmg + stacks -> heavyAtk defIgnore
  '21010046': (id, p) => ({
    owners: [makeOwner(id, 'Passive', `Increases ATK by {0}.`)],
    states: [
      makeToggle(id, 'active', 'Heavy ATK DMG',
        `Casting Intro Skill or Resonance Skill increases Heavy Attack DMG by {1} for {2}s.`),
      makeStack(id, 'stacks', 'DEF Ignore Stacks', 5, 0,
        `Obtaining Shield allows Heavy Attack DMG to ignore {3} of the target's DEF for {4}s, stacking up to {5} times. This effect is triggered once every 0.5s.`),
    ],
    effects: [
      makeEffect(id, 'atk', 'ATK%', [addBaseStat('atk', 'percent', rankTable(p, 0))]),
      makeEffect(id, 'heavy', 'Heavy ATK DMG',
        [addSkilltypeMod('heavyAtk', 'dmgBonus', rankTable(p, 1))],
        truthyCondition(`weapon:${id}:passive:active`)),
      makeEffect(id, 'defignore', 'Heavy ATK DEF Ignore',
        [addSkilltypeMod('heavyAtk', 'defIgnore', mulFormula(readControl(`weapon:${id}:passive:stacks`), rankTable(p, 3)))]),
    ],
  }),

  // Broadblade (21010053): basicAtk + heavyAtk dmgBonus
  '21010053': (id, p) => ({
    owners: [makeOwner(id, 'Passive', `Increases Basic Attack DMG Bonus and Heavy Attack DMG Bonus by {0}.`)],
    states: [],
    effects: [
      makeEffect(id, 'dmg', 'Basic/Heavy ATK DMG', [
        addSkilltypeMod('basicAtk', 'dmgBonus', rankTable(p, 0)),
        addSkilltypeMod('heavyAtk', 'dmgBonus', rankTable(p, 0)),
      ]),
    ],
  }),

  // Broadblade (21010056): ATK% + toggle -> all dmgBonus + stacks -> ult dmgBonus
  '21010056': (id, p) => ({
    owners: [makeOwner(id, 'Passive', `ATK is increased by {0}.`)],
    states: [
      makeStack(id, 'stacks', 'Res. Liberation Stacks', 3, 0,
        `When the wielder casts Intro Skill or inflicts Negative Statuses, they gain {1} Resonance Liberation DMG Bonus, stacking up to {2} times for {3}s.`),
      makeToggle(id, 'active', 'All DMG Bonus',
        `At max stacks, when Resonators in the team inflict Negative Statuses, they gain {4} All-Attribute DMG Bonus for {5}s. Effects of the same name cannot be stacked.`),
    ],
    effects: [
      makeEffect(id, 'atk', 'ATK%', [addBaseStat('atk', 'percent', rankTable(p, 0))]),
      makeEffect(id, 'dmg', 'All DMG Bonus',
        [addAttributeMod('all', 'dmgBonus', rankTable(p, 4))],
        truthyCondition(`weapon:${id}:passive:active`), 'teamWide'),
      makeEffect(id, 'ult', 'Res. Liberation DMG',
        [addSkilltypeMod('resonanceLiberation', 'dmgBonus', mulFormula(readControl(`weapon:${id}:passive:stacks`), rankTable(p, 1)))]),
    ],
  }),

  // Broadblade (21010064): stacks -> ATK%
  '21010064': (id, p) => ({
    owners: [makeOwner(id, 'Passive')],
    states: [makeStack(id, 'stacks', 'Stacks', 4, 0,
      `Within {0}s after Resonance Skill is cast, increases ATK by {1} every {2}s, stacking up to {3} time(s). This effect can be triggered {4} time(s) every {5}s. When the number of stacks reaches {6}, all stacks will be reset within {7}s.`)],
    effects: [
      makeEffect(id, 'atk', 'ATK%',
        [addBaseStat('atk', 'percent', mulFormula(readControl(`weapon:${id}:passive:stacks`), rankTable(p, 2)))]),
    ],
  }),

  // Broadblade (21010066): DEF% + toggle -> critDmg
  '21010066': (id, p) => ({
    owners: [makeOwner(id, 'Passive', `Increases DEF by {0}. Casting Resonance Liberation restores {1} points of Concerto Energy. This effect can be triggered {2} time(s) every {3}s.`)],
    states: [makeToggle(id, 'active', 'Crit. DMG',
      `When the wielder heals Resonators, increases Crit. DMG of all nearby Resonators in the team by {4} for {5}s. Effects of the same name cannot be stacked.`)],
    effects: [
      makeEffect(id, 'def', 'DEF%', [addBaseStat('def', 'percent', rankTable(p, 0))]),
      makeEffect(id, 'critdmg', 'Crit. DMG',
        [addTopStat('critDmg', rankTable(p, 4))],
        truthyCondition(`weapon:${id}:passive:active`), 'teamWide'),
    ],
  }),

  // Broadblade (21010074): stacks -> ATK%
  '21010074': (id, p) => ({
    owners: [makeOwner(id, 'Passive')],
    states: [makeStack(id, 'stacks', 'Stacks', 5, 0,
      `Increases ATK by {0} upon dealing Basic Attack DMG or Heavy Attack DMG, stacking up to {1} time(s). This effect lasts for {2}s and can be triggered {3} time(s) every {4}s.`)],
    effects: [
      makeEffect(id, 'atk', 'ATK%',
        [addBaseStat('atk', 'percent', mulFormula(readControl(`weapon:${id}:passive:stacks`), rankTable(p, 0)))]),
    ],
  }),

  // Broadblade (21010084): toggle -> ATK%
  '21010084': (id, p) => ({
    owners: [makeOwner(id, 'Passive')],
    states: [makeToggle(id, 'active', 'ATK Buff',
      `Casting the Resonance Skill grants {0} Resonance Energy and increases ATK by {1}, lasting for {2}s. This effect can be triggered once every {3}s.`)],
    effects: [
      makeEffect(id, 'atk', 'ATK%', [addBaseStat('atk', 'percent', rankTable(p, 1))],
        truthyCondition(`weapon:${id}:passive:active`)),
    ],
  }),

  // Broadblade (21010094): stacks -> ATK% (toggle-gated)
  '21010094': (id, p) => ({
    owners: [makeOwner(id, 'Passive')],
    states: [
      makeToggle(id, 'active', 'Active',
        `Dealing DMG to enemies with Negative Statuses increases the wielder's ATK by {0} for {1}s.`),
      makeStack(id, 'stacks', 'Stacks', 4, 0,
        `This effect can be triggered 1 time per second, stackable up to {2} times.`),
    ],
    effects: [
      makeEffect(id, 'atk', 'ATK%',
        [addBaseStat('atk', 'percent', mulFormula(readControl(`weapon:${id}:passive:stacks`), rankTable(p, 0)))],
        truthyCondition(`weapon:${id}:passive:active`)),
    ],
  }),

  // Broadblade (21010104): toggle -> ATK% + heavyAtk dmgBonus
  '21010104': (id, p) => ({
    owners: [makeOwner(id, 'Passive')],
    states: [makeToggle(id, 'active', 'Active',
      `Casting Resonance Liberation increases ATK by {0} and grants {1} Heavy Attack DMG Bonus for {2}s.`)],
    effects: [
      makeEffect(id, 'atk', 'ATK% + Heavy DMG', [
        addBaseStat('atk', 'percent', rankTable(p, 0)),
        addSkilltypeMod('heavyAtk', 'dmgBonus', rankTable(p, 1)),
      ], truthyCondition(`weapon:${id}:passive:active`)),
    ],
  }),

  // --- Swords ---

  // Sword (21020011): ATK%
  '21020011': (id, p) => ({
    owners: [makeOwner(id, 'Passive', `Increases ATK by {0}.`)],
    states: [],
    effects: [makeEffect(id, 'atk', 'ATK%', [addBaseStat('atk', 'percent', rankTable(p, 0))])],
  }),

  // Sword (21020012): ATK%
  '21020012': (id, p) => ({
    owners: [makeOwner(id, 'Passive', `Increases ATK by {0}.`)],
    states: [],
    effects: [makeEffect(id, 'atk', 'ATK%', [addBaseStat('atk', 'percent', rankTable(p, 0))])],
  }),

  // Sword (21020013): toggle -> ATK%
  '21020013': (id, p) => ({
    owners: [makeOwner(id, 'Passive')],
    states: [makeToggle(id, 'active', 'ATK Buff',
      `When Intro Skill is cast, increases ATK by {0}, lasting for {1}s.`)],
    effects: [
      makeEffect(id, 'atk', 'ATK%', [addBaseStat('atk', 'percent', rankTable(p, 1))],
        truthyCondition(`weapon:${id}:passive:active`)),
    ],
  }),

  // Sword (21020015): energyRegen + stacks -> ATK%
  '21020015': (id, p) => ({
    owners: [makeOwner(id, 'Passive', `Increases Energy Regen by {0}.`)],
    states: [makeStack(id, 'stacks', 'Stacks', 2, 0,
      `When Resonance Skill is cast, increases ATK by {1}, stacking up to {2} time(s). This effect lasts for {3}s.`)],
    effects: [
      makeEffect(id, 'energy', 'Energy Regen', [addTopStat('energyRegen', rankTable(p, 0))]),
      makeEffect(id, 'atk', 'ATK%',
        [addBaseStat('atk', 'percent', mulFormula(readControl(`weapon:${id}:passive:stacks`), rankTable(p, 1)))]),
    ],
  }),

  // Sword (21020016): ATK% + stacks(0-14) -> resonanceSkill dmgBonus
  '21020016': (id, p) => ({
    owners: [makeOwner(id, 'Passive', `ATK increased by {0}.`)],
    states: [makeNumber(id, 'stacks', 'Stacks', 14, 0,
      `The wielder gains 1 stack of Searing Feather upon dealing damage, which can be triggered once every 0.5s, and gains 5 stacks of the same effect upon casting Resonance Skill. Each stack of Searing Feather gives {1} additional Resonance Skill DMG Bonus for up to 14 stacks. After reaching the max stacks, all stacks will be removed in {2}s.`)],
    effects: [
      makeEffect(id, 'atk', 'ATK%', [addBaseStat('atk', 'percent', rankTable(p, 0))]),
      makeEffect(id, 'skill', 'Res. Skill DMG',
        [addSkilltypeMod('resonanceSkill', 'dmgBonus', mulFormula(readControl(`weapon:${id}:passive:stacks`), rankTable(p, 1)))]),
    ],
  }),

  // Sword (21020017): stacks(0-10) -> ATK%, at 10 stacks also critRate
  '21020017': (id, p) => ({
    owners: [makeOwner(id, 'Passive')],
    states: [makeStack(id, 'stacks', 'Stacks', 10, 0,
      `Gain {0} stack of Hiss when dealing damage to the target, with {1} stack generated every {2}s. Hiss: each stack increases the wielder's ATK by {3} for {4}s, stacking up to {5} times. Switching off the wielder clears all stacks. Gaining {6} stacks increases the wielder's Crit. Rate by {7}.`)],
    effects: [
      makeEffect(id, 'atk', 'ATK%',
        [addBaseStat('atk', 'percent', mulFormula(readControl(`weapon:${id}:passive:stacks`), rankTable(p, 3)))]),
      makeEffect(id, 'crit', 'Crit. Rate',
        [addTopStat('critRate', rankTable(p, 7))],
        { type: 'gte', from: 'sourceRuntime', path: `state.controls.weapon:${id}:passive:stacks`, value: 10 }),
    ],
  }),

  // Sword (21020026): ATK% + stacks(0-3) -> basicAtk dmg (raw 10) + toggle -> basicAtk dmg
  '21020026': (id, p) => ({
    owners: [makeOwner(id, 'Passive', `Increase ATK by {0}.`)],
    states: [
      makeStack(id, 'stacks', 'Stacks', 3, 0,
        `When dealing Basic Attack DMG, the wielder gains {1} Basic Attack DMG Bonus for {2}s. This effect can be triggered once per second, stacking up to {3} times.`),
      makeToggle(id, 'active', 'Basic ATK DMG',
        `When the wielder's Concerto Energy is consumed, gain {4} Basic DMG Bonus for {5}. This effect can be triggered once per second and ends when the wielder is switched off the field.`),
    ],
    effects: [
      makeEffect(id, 'atk', 'ATK%', [addBaseStat('atk', 'percent', rankTable(p, 0))]),
      makeEffect(id, 'basic_stacks', 'Basic ATK DMG (Stacks)',
        [addSkilltypeMod('basicAtk', 'dmgBonus', mulFormula(readControl(`weapon:${id}:passive:stacks`), { type: 'const', value: 10 }))]),
      makeEffect(id, 'basic_toggle', 'Basic ATK DMG',
        [addSkilltypeMod('basicAtk', 'dmgBonus', rankTable(p, 4))],
        truthyCondition(`weapon:${id}:passive:active`)),
    ],
  }),

  // Sword (21020034): toggle -> heavyAtk dmgBonus
  '21020034': (id, p) => ({
    owners: [makeOwner(id, 'Passive')],
    states: [makeToggle(id, 'active', 'Heavy ATK DMG',
      `When the Resonator's HP drops below {0}, increases Heavy Attack DMG Bonus by {1} and gives {2} healing when dealing Heavy Attack DMG. This effect can be triggered {3} time(s) every {4}s.`)],
    effects: [
      makeEffect(id, 'heavy', 'Heavy ATK DMG',
        [addSkilltypeMod('heavyAtk', 'dmgBonus', rankTable(p, 1))],
        truthyCondition(`weapon:${id}:passive:active`)),
    ],
  }),

  // Sword (21020036): critRate + 2 toggles -> basicAtk dmgBonus
  '21020036': (id, p) => ({
    owners: [makeOwner(id, 'Passive', `Increase Crit. Rate by {0}.`)],
    states: [
      makeToggle(id, 'first', 'Basic ATK DMG (1)',
        `Casting Resonance Liberation gives {1} Basic Attack DMG Bonus for {2}s.`),
      makeToggle(id, 'second', 'Basic ATK DMG (2)',
        `Dealing Basic Attack DMG gives {3} Basic Attack DMG Bonus for {4}s.`),
    ],
    effects: [
      makeEffect(id, 'crit', 'Crit. Rate', [addTopStat('critRate', rankTable(p, 0))]),
      makeEffect(id, 'basic1', 'Basic ATK DMG (1)',
        [addSkilltypeMod('basicAtk', 'dmgBonus', rankTable(p, 1))],
        truthyCondition(`weapon:${id}:passive:first`)),
      makeEffect(id, 'basic2', 'Basic ATK DMG (2)',
        [addSkilltypeMod('basicAtk', 'dmgBonus', rankTable(p, 3))],
        truthyCondition(`weapon:${id}:passive:second`)),
    ],
  }),

  // Sword (21020044): toggle -> ATK%
  '21020044': (id, p) => ({
    owners: [makeOwner(id, 'Passive')],
    states: [makeToggle(id, 'active', 'ATK Buff',
      `When Intro Skill is cast, increases ATK by {0}, lasting for {1}s.`)],
    effects: [
      makeEffect(id, 'atk', 'ATK%', [addBaseStat('atk', 'percent', rankTable(p, 0))],
        truthyCondition(`weapon:${id}:passive:active`)),
    ],
  }),

  // Sword (21020045): ATK% + toggle -> resonanceSkill dmgBonus
  '21020045': (id, p) => ({
    owners: [makeOwner(id, 'Passive', `Increases ATK by {0}.`)],
    states: [makeToggle(id, 'active', 'Res. Skill DMG',
      `Dealing damage to targets under Tune Strain - Interfered grants {1} Resonance Skill Bonus for {2}s. Retriggering the effect resets its duration.`)],
    effects: [
      makeEffect(id, 'atk', 'ATK%', [addBaseStat('atk', 'percent', rankTable(p, 0))]),
      makeEffect(id, 'skill', 'Res. Skill DMG',
        [addSkilltypeMod('resonanceSkill', 'dmgBonus', rankTable(p, 1))],
        truthyCondition(`weapon:${id}:passive:active`)),
    ],
  }),

  // Sword (21020046): 2 toggles -> resonanceSkill dmg, aero amplify
  '21020046': (id, p) => ({
    owners: [makeOwner(id, 'Passive')],
    states: [
      makeToggle(id, 'skill', 'Res. Skill DMG',
        `Providing Healing increases Resonance Skill DMG by {0} for {1}s.`),
      makeToggle(id, 'amplify', 'Aero Amplify',
        `When Rover: Aero casts Resonance Skill Unbound Flow, Aero DMG dealt by nearby Resonators on the field is Amplified by {2} for {3}s.`),
    ],
    effects: [
      makeEffect(id, 'skill', 'Res. Skill DMG',
        [addSkilltypeMod('resonanceSkill', 'dmgBonus', rankTable(p, 0))],
        truthyCondition(`weapon:${id}:passive:skill`)),
      makeEffect(id, 'aero', 'Aero Amplify',
        [addAttributeMod('aero', 'amplify', rankTable(p, 2))],
        truthyCondition(`weapon:${id}:passive:amplify`), 'teamWide'),
    ],
  }),

  // Sword (21020053): resonanceSkill dmgBonus
  '21020053': (id, p) => ({
    owners: [makeOwner(id, 'Passive', `Resonance Skill DMG Bonus is increased by {0}.`)],
    states: [],
    effects: [makeEffect(id, 'skill', 'Res. Skill DMG', [addSkilltypeMod('resonanceSkill', 'dmgBonus', rankTable(p, 0))])],
  }),

  // Sword (21020056): HP% + toggle -> all defIgnore + toggle -> all amplify
  '21020056': (id, p) => ({
    owners: [makeOwner(id, 'Passive', `Max HP is increased by {0}.`)],
    states: [
      makeToggle(id, 'defignore', 'DEF Ignore',
        `{1}s after casting Intro Skill or Basic Attacks, ignore {2} of the target's DEF when dealing damage.`),
      makeToggle(id, 'amplify', 'Amplify',
        `If the target has at least 1 stack of Aero Erosion, the DMG taken by the target is Amplified by {3}.`),
    ],
    effects: [
      makeEffect(id, 'hp', 'HP%', [addBaseStat('hp', 'percent', rankTable(p, 0))]),
      makeEffect(id, 'defignore', 'DEF Ignore',
        [addAttributeMod('all', 'defIgnore', rankTable(p, 1))],
        truthyCondition(`weapon:${id}:passive:defignore`)),
      makeEffect(id, 'amplify', 'Amplify',
        [addAttributeMod('all', 'amplify', rankTable(p, 2))],
        truthyCondition(`weapon:${id}:passive:amplify`)),
    ],
  }),

  // Sword (21020064): stacks -> ATK%
  '21020064': (id, p) => ({
    owners: [makeOwner(id, 'Passive')],
    states: [makeStack(id, 'stacks', 'Stacks', 6, 0,
      `Equipped Resonator gains {0} stack(s) of Oath upon entering the battlefield. Each stack increases ATK by {1}, up to {2} stacks. This effect can be triggered {3} time(s) every {4}s. The equipped Resonator loses {5} stack(s) of Oath every {6}s, and gains {7} stack(s) upon defeating an enemy.`)],
    effects: [
      makeEffect(id, 'atk', 'ATK%',
        [addBaseStat('atk', 'percent', mulFormula(readControl(`weapon:${id}:passive:stacks`), rankTable(p, 1)))]),
    ],
  }),

  // Sword (21020066): ATK% + stacks -> heavyAtk dmg + toggle -> echoSkill dmg
  '21020066': (id, p) => ({
    owners: [makeOwner(id, 'Passive', `ATK is increased by {0}.`)],
    states: [
      makeStack(id, 'stacks', 'Heavy ATK Stacks', 2, 0,
        `Casting Echo Skill within {1}s after casting Intro Skill or Basic Attack grants 1 stack of Bamboo Cleaver, which grants {2}% Heavy Attack DMG Bonus to the wielder. This effect can be triggered by Echoes of the same name once only, stacking up to 2 times, lasting for {3}s. Casting Echo Skill at max stacks does not reset the duration. This effect can be triggered once every {4}s and ends early if the wielder is switched off the field.`),
      makeToggle(id, 'active', 'Echo Skill DMG',
        `Casting Intro Skill grants {5} Echo Skill DMG Bonus to all Resonators in the team for {6}s. Effects of the same name cannot be stacked.`),
    ],
    effects: [
      makeEffect(id, 'atk', 'ATK%', [addBaseStat('atk', 'percent', rankTable(p, 0))]),
      makeEffect(id, 'heavy', 'Heavy ATK DMG',
        [addSkilltypeMod('heavyAtk', 'dmgBonus', mulFormula(readControl(`weapon:${id}:passive:stacks`), rankTable(p, 2)))]),
      makeEffect(id, 'echo', 'Echo Skill DMG',
        [addSkilltypeMod('echoSkill', 'dmgBonus', rankTable(p, 5))],
        truthyCondition(`weapon:${id}:passive:active`),
        'teamWide'),
    ],
  }),

  // Sword (21020074): stacks(0-1) -> heavyAtk + basicAtk dmgBonus
  '21020074': (id, p) => ({
    owners: [makeOwner(id, 'Passive')],
    states: [makeStack(id, 'stacks', 'Active', 1, 0,
      `When Resonance Skill is cast, increases Basic Attack DMG Bonus and Heavy Attack DMG Bonus by {0}, stacking up to {1} time(s). This effect lasts for {2}s and can be triggered {3} time(s) every {4}s.`)],
    effects: [
      makeEffect(id, 'dmg', 'Heavy/Basic ATK DMG', [
        addSkilltypeMod('heavyAtk', 'dmgBonus', mulFormula(readControl(`weapon:${id}:passive:stacks`), rankTable(p, 0))),
        addSkilltypeMod('basicAtk', 'dmgBonus', mulFormula(readControl(`weapon:${id}:passive:stacks`), rankTable(p, 0))),
      ]),
    ],
  }),

  // Sword (21020076): all dmgBonus + toggle -> ult defIgnore (updateSkillMeta handled separately)
  '21020076': (id, p) => ({
    owners: [makeOwner(id, 'Passive', `Increases All-Attribute DMG Bonus by {0}.`)],
    states: [makeToggle(id, 'active', 'Res. Liberation DEF Ignore',
      `When inflicting Tune Rupture - Shifting or Fusion Burst, the wielder's Resonance Liberation DMG ignores {1} DEF and {2} Fusion RES on targets for {3}s.`)],
    effects: [
      makeEffect(id, 'dmg', 'All DMG Bonus', [addAttributeMod('all', 'dmgBonus', rankTable(p, 0))]),
      makeEffect(id, 'defignore', 'Res. Liberation DEF Ignore',
        [addSkilltypeMod('resonanceLiberation', 'defIgnore', rankTable(p, 1))],
        truthyCondition(`weapon:${id}:passive:active`)),
    ],
  }),

  // Sword (21020084): toggle -> ATK%
  '21020084': (id, p) => ({
    owners: [makeOwner(id, 'Passive')],
    states: [makeToggle(id, 'active', 'ATK Buff',
      `Casting the Resonance Skill grants {0} Resonance Energy and increases ATK by {1}, lasting for {2}s. This effect can be triggered once every {3}s.`)],
    effects: [
      makeEffect(id, 'atk', 'ATK%', [addBaseStat('atk', 'percent', rankTable(p, 1))],
        truthyCondition(`weapon:${id}:passive:active`)),
    ],
  }),

  // Sword (21020086): ATK% + toggle -> glacio amplify + liberation defIgnore + toggle -> glacio chafe amplify
  '21020086': (id, p) => ({
    owners: [makeOwner(id, 'Passive', `ATK is increased by {0}.`)],
    states: [
      makeToggle(id, 'active', 'Glacio Amp + Res. Liberation DEF Ignore',
        `After the wielder applies Glacio Chafe, Glacio DMG is Amplified by {1}, and Resonance Liberation DMG ignores {2} of the target's DEF.`),
      makeToggle(id, 'glacio_chafe', 'Glacio Chafe DMG',
        `If the wielder is the active Resonator in the team, Glacio Chafe DMG dealt to all targets within a certain range is Amplified by {3} for {4}s.`),
    ],
    effects: [
      makeEffect(id, 'atk', 'ATK%', [addBaseStat('atk', 'percent', rankTable(p, 0))]),
      makeEffect(id, 'active', 'Glacio Amp + Res. Liberation DEF Ignore', [
        addAttributeMod('glacio', 'amplify', rankTable(p, 1)),
        addSkilltypeMod('resonanceLiberation', 'defIgnore', rankTable(p, 2)),
      ], truthyCondition(`weapon:${id}:passive:active`)),
      makeEffect(id, 'glacio-chafe', 'Glacio Chafe DMG',
        [addSkilltypeMod('glacioChafe', 'amplify', rankTable(p, 3))],
        truthyCondition(`weapon:${id}:passive:glacio_chafe`)),
    ],
  }),

  // Sword (21020094): toggle + stacks -> ATK%
  '21020094': (id, p) => ({
    owners: [makeOwner(id, 'Passive')],
    states: [
      makeToggle(id, 'active', 'Active',
        `Dealing DMG to enemies with Negative Statuses increases the wielder's ATK by {0} for {1}s.`),
      makeStack(id, 'stacks', 'Stacks', 4, 0,
        `This effect can be triggered 1 time per second, stackable up to {2} times.`),
    ],
    effects: [
      makeEffect(id, 'atk', 'ATK%',
        [addBaseStat('atk', 'percent', mulFormula(readControl(`weapon:${id}:passive:stacks`), rankTable(p, 0)))],
        truthyCondition(`weapon:${id}:passive:active`)),
    ],
  }),

  // Sword (21020104): toggle -> ATK% + ult dmg
  '21020104': (id, p) => ({
    owners: [makeOwner(id, 'Passive')],
    states: [makeToggle(id, 'active', 'Active',
      `Casting Resonance Liberation increases ATK by {0} and grants {1} Resonance Liberation DMG Bonus for {2}s.`)],
    effects: [
      makeEffect(id, 'buffs', 'ATK% + Res. Liberation DMG', [
        addBaseStat('atk', 'percent', rankTable(p, 0)),
        addSkilltypeMod('resonanceLiberation', 'dmgBonus', rankTable(p, 1)),
      ], truthyCondition(`weapon:${id}:passive:active`)),
    ],
  }),

  // --- Pistols ---

  // Pistol (21030011): ATK%
  '21030011': (id, p) => ({
    owners: [makeOwner(id, 'Passive', `Increases ATK by {0}.`)],
    states: [],
    effects: [makeEffect(id, 'atk', 'ATK%', [addBaseStat('atk', 'percent', rankTable(p, 0))])],
  }),

  // Pistol (21030012): ATK%
  '21030012': (id, p) => ({
    owners: [makeOwner(id, 'Passive', `Increases ATK by {0}.`)],
    states: [],
    effects: [makeEffect(id, 'atk', 'ATK%', [addBaseStat('atk', 'percent', rankTable(p, 0))])],
  }),

  // Pistol (21030013): toggle -> ATK%
  '21030013': (id, p) => ({
    owners: [makeOwner(id, 'Passive')],
    states: [makeToggle(id, 'active', 'ATK Buff',
      `When Intro Skill is cast, increases ATK by {0}, lasting for {1}s.`)],
    effects: [
      makeEffect(id, 'atk', 'ATK%', [addBaseStat('atk', 'percent', rankTable(p, 1))],
        truthyCondition(`weapon:${id}:passive:active`)),
    ],
  }),

  // Pistol (21030015): energyRegen only
  '21030015': (id, p) => ({
    owners: [makeOwner(id, 'Passive', `Increases Energy Regen by {0}. Incoming Resonator's ATK is increased by {1} for {2}s, stackable for up to {3} times after the wielder casts Outro Skill.`)],
    states: [makeToggle(id, 'active', 'ATK Buff',
        `Incoming Resonator's ATK is increased by {1} for {3}, stackable for up to {2} times after the wielder casts Outro Skill.`)],
    effects: [
      makeEffect(id, 'energy', 'Energy Regen', [addTopStat('energyRegen', rankTable(p, 0))]),
      makeEffect(id, 'atk', 'ATK%', [addBaseStat('atk', 'percent', rankTable(p, 1))],
          truthyCondition(`weapon:${id}:passive:active`), 'activeOther'),
    ],
  }),

  // Pistol (21030016): ATK% + toggle -> resonanceSkill dmg
  '21030016': (id, p) => ({
    owners: [makeOwner(id, 'Passive', `Increases ATK by {0}.`)],
    states: [makeToggle(id, 'active', 'Res. Skill DMG',
      `Every time Intro Skill or Resonance Liberation is cast, Resonance Skill DMG Bonus increases by {1} for {2}s.`)],
    effects: [
      makeEffect(id, 'atk', 'ATK%', [addBaseStat('atk', 'percent', rankTable(p, 0))]),
      makeEffect(id, 'skill', 'Res. Skill DMG',
        [addSkilltypeMod('resonanceSkill', 'dmgBonus', rankTable(p, 1))],
        truthyCondition(`weapon:${id}:passive:active`)),
    ],
  }),

  // Pistol (21030026): ATK% + toggle -> aero dmg + toggle -> aero resShred
  '21030026': (id, p) => ({
    owners: [makeOwner(id, 'Passive', `ATK is increased by {0}.`)],
    states: [
      makeToggle(id, 'aero_dmg', 'Aero DMG',
        `Inflicting Aero Erosion on the target gives {1} Aero DMG Bonus for {2}s.`),
      makeToggle(id, 'aero_shred', 'Aero RES Shred',
        `Hitting targets with Aero Erosion reduces their Aero RES by {3} for {4}s. Effects of the same name cannot be stacked.`),
    ],
    effects: [
      makeEffect(id, 'atk', 'ATK%', [addBaseStat('atk', 'percent', rankTable(p, 0))]),
      makeEffect(id, 'aero', 'Aero DMG',
        [addAttributeMod('aero', 'dmgBonus', rankTable(p, 1))],
        truthyCondition(`weapon:${id}:passive:aero_dmg`)),
      makeEffect(id, 'shred', 'Aero RES Shred',
        [addAttributeMod('aero', 'resShred', rankTable(p, 3))],
        // todo: needs aero erosion check
        truthyCondition(`weapon:${id}:passive:aero_shred`), 'teamWide'),
    ],
  }),

  // Pistol (21030034): stacks -> ATK%
  '21030034': (id, p) => ({
    owners: [makeOwner(id, 'Passive')],
    states: [makeStack(id, 'stacks', 'Stacks', 2, 0,
      `When the Resonator takes no damage, increases ATK by {0} every {1}s, stacking up to {2} time(s). This effect lasts for {3}s. When the Resonator takes damage, loses {4} stacks and heals {5} of their Max HP.`)],
    effects: [
      makeEffect(id, 'atk', 'ATK%',
        [addBaseStat('atk', 'percent', mulFormula(readControl(`weapon:${id}:passive:stacks`), rankTable(p, 0)))]),
    ],
  }),

  // Pistol (21030036): ATK% + 2 toggles -> heavy/echo amplify + both -> defIgnore
  '21030036': (id, p) => ({
    owners: [makeOwner(id, 'Passive', `ATK is increased by {0}.`)],
    states: [
      makeToggle(id, 'heavy', 'Heavy ATK Amplify',
        `Upon dealing Echo Skill DMG, gain {1} Heavy Attack DMG Amplification for {2}s.`),
      makeToggle(id, 'echo', 'Echo Skill Amplify',
        `Upon dealing Heavy Attack DMG, gain {3} Echo Skill DMG Amplification for {4}s. While both effects are active, dealing damage ignores {6} of the target's DEF.`),
    ],
    effects: [
      makeEffect(id, 'atk', 'ATK%', [addBaseStat('atk', 'percent', rankTable(p, 0))]),
      makeEffect(id, 'heavy', 'Heavy ATK Amplify',
        [addSkilltypeMod('heavyAtk', 'amplify', rankTable(p, 1))],
        truthyCondition(`weapon:${id}:passive:heavy`)),
      makeEffect(id, 'echo', 'Echo Skill Amplify',
        [addSkilltypeMod('echoSkill', 'amplify', rankTable(p, 1))],
        truthyCondition(`weapon:${id}:passive:echo`)),
      makeEffect(id, 'defignore', 'DEF Ignore',
        [addTopStat('defIgnore', rankTable(p, 6))],
        andCondition(
          truthyCondition(`weapon:${id}:passive:heavy`),
          truthyCondition(`weapon:${id}:passive:echo`),
        )),
    ],
  }),

  // Pistol (21030044): toggle -> resonanceSkill dmg
  '21030044': (id, p) => ({
    owners: [makeOwner(id, 'Passive')],
    states: [makeToggle(id, 'active', 'Res. Skill DMG',
      `When Intro Skill is cast, increases Resonance Skill DMG Bonus by {0} for {1}s.`)],
    effects: [
      makeEffect(id, 'skill', 'Res. Skill DMG',
        [addSkilltypeMod('resonanceSkill', 'dmgBonus', rankTable(p, 0))],
        truthyCondition(`weapon:${id}:passive:active`)),
    ],
  }),

  // Pistol (21030045): ATK% + toggle -> all dmgBonus
  '21030045': (id, p) => ({
    owners: [makeOwner(id, 'Passive', `Increases ATK by {0}.`)],
    states: [makeToggle(id, 'active', 'All DMG Bonus',
      `After a Resonator in the team casts a Tune Break skill, it grants {1} All-Attribute DMG Bonus to the wielder for {2}s.`)],
    effects: [
      makeEffect(id, 'atk', 'ATK%', [addBaseStat('atk', 'percent', rankTable(p, 0))]),
      makeEffect(id, 'dmg', 'All DMG Bonus',
        [addAttributeMod('all', 'dmgBonus', rankTable(p, 1))],
        truthyCondition(`weapon:${id}:passive:active`)),
    ],
  }),

  // Pistol (21030046): ATK% + toggle -> basicAtk dmg + stacks -> dmgBonus
  '21030046': (id, p) => ({
    owners: [makeOwner(id, 'Passive', `Increases ATK by {0}.`)],
    states: [
      makeToggle(id, 'active', 'Basic ATK DMG',
        `Casting Intro Skill or dealing Basic Attack DMG to targets increases the wielder's Basic Attack DMG Bonus by {1} for {2}s.`),
      makeStack(id, 'stacks', 'DMG Bonus Stacks', 3, 0,
        `Each time the wielder inflicts Tune Rupture - Shifting or Tune Strain - Shifting during Basic Attacks, all DMG dealt by Resonators in the team is increased by {3} for {4}s, up to {5} stacks. Effects of the same name cannot be stacked.`),
    ],
    effects: [
      makeEffect(id, 'atk', 'ATK%', [addBaseStat('atk', 'percent', rankTable(p, 0))]),
      makeEffect(id, 'basic', 'Basic ATK DMG',
        [addSkilltypeMod('basicAtk', 'dmgBonus', rankTable(p, 1))],
        truthyCondition(`weapon:${id}:passive:active`)),
      makeEffect(id, 'dmg', 'DMG Bonus',
        [addTopStat('dmgBonus', mulFormula(readControl(`weapon:${id}:passive:stacks`), rankTable(p, 3)))],
          undefined, 'teamWide')
    ],
  }),

  // Pistol (21030053): resonanceSkill dmgBonus
  '21030053': (id, p) => ({
    owners: [makeOwner(id, 'Passive', `Resonance Skill DMG Bonus is increased by {0}.`)],
    states: [],
    effects: [makeEffect(id, 'skill', 'Res. Skill DMG', [addSkilltypeMod('resonanceSkill', 'dmgBonus', rankTable(p, 0))])],
  }),

  // Pistol (21030064): stacks -> ATK%
  '21030064': (id, p) => ({
    owners: [makeOwner(id, 'Passive')],
    states: [makeStack(id, 'stacks', 'Stacks', 3, 0,
      `When the Resonator dashes or dodges, increases ATK by {0}, stacking up to {1} time(s). This effect lasts for {2}s.`)],
    effects: [
      makeEffect(id, 'atk', 'ATK%',
        [addBaseStat('atk', 'percent', mulFormula(readControl(`weapon:${id}:passive:stacks`), rankTable(p, 0)))]),
    ],
  }),

  // Pistol (21030074): stacks -> resonanceSkill dmg
  '21030074': (id, p) => ({
    owners: [makeOwner(id, 'Passive')],
    states: [makeStack(id, 'stacks', 'Stacks', 3, 0,
      `When hitting a target with Basic Attacks or Heavy Attacks, increases Resonance Skill DMG Bonus by {0}, stacking up to {1} time(s). This effect lasts for {2}s and can be triggered {3} time(s) every {4}s.`)],
    effects: [
      makeEffect(id, 'skill', 'Res. Skill DMG',
        [addSkilltypeMod('resonanceSkill', 'dmgBonus', mulFormula(readControl(`weapon:${id}:passive:stacks`), rankTable(p, 0)))]),
    ],
  }),

  // Pistol (21030084): toggle -> ATK%
  '21030084': (id, p) => ({
    owners: [makeOwner(id, 'Passive')],
    states: [makeToggle(id, 'active', 'ATK Buff',
      `Casting the Resonance Skill grants {0} Resonance Energy and increases ATK by {1}, lasting for {2}s. This effect can be triggered once every {3}s.`)],
    effects: [
      makeEffect(id, 'atk', 'ATK%', [addBaseStat('atk', 'percent', rankTable(p, 1))],
        truthyCondition(`weapon:${id}:passive:active`)),
    ],
  }),

  // Pistol (21030094): toggle + stacks -> ATK%
  '21030094': (id, p) => ({
    owners: [makeOwner(id, 'Passive')],
    states: [
      makeToggle(id, 'active', 'Active',
        `Dealing DMG to enemies with Negative Statuses increases the wielder's ATK by {0} for {1}s.`),
      makeStack(id, 'stacks', 'Stacks', 4, 0,
        `This effect can be triggered 1 time per second, stackable up to {2} times.`),
    ],
    effects: [
      makeEffect(id, 'atk', 'ATK%',
        [addBaseStat('atk', 'percent', mulFormula(readControl(`weapon:${id}:passive:stacks`), rankTable(p, 0)))],
        truthyCondition(`weapon:${id}:passive:active`)),
    ],
  }),

  // Pistol (21030104): stacks -> heavyAtk dmg + ATK%
  '21030104': (id, p) => ({
    owners: [makeOwner(id, 'Passive')],
    states: [makeStack(id, 'stacks', 'Stacks', 4, 0,
      `Dealing Basic Attack or Heavy Attack DMG increases ATK by {0} and grants {1} Heavy Attack DMG Bonus for {2}s, stacking up to {3} times. This effect can be triggered {4} time(s) every {5}s.`)],
    effects: [
      makeEffect(id, 'buffs', 'Heavy ATK DMG + ATK%', [
        addSkilltypeMod('heavyAtk', 'dmgBonus', mulFormula(readControl(`weapon:${id}:passive:stacks`), rankTable(p, 0))),
        addBaseStat('atk', 'percent', mulFormula(readControl(`weapon:${id}:passive:stacks`), rankTable(p, 0))),
      ]),
    ],
  }),

  // --- Gauntlets ---

  // Gauntlet (21040011): ATK%
  '21040011': (id, p) => ({
    owners: [makeOwner(id, 'Passive', `Increases ATK by {0}.`)],
    states: [],
    effects: [makeEffect(id, 'atk', 'ATK%', [addBaseStat('atk', 'percent', rankTable(p, 0))])],
  }),

  // Gauntlet (21040012): ATK%
  '21040012': (id, p) => ({
    owners: [makeOwner(id, 'Passive', `Increases ATK by {0}.`)],
    states: [],
    effects: [makeEffect(id, 'atk', 'ATK%', [addBaseStat('atk', 'percent', rankTable(p, 0))])],
  }),

  // Gauntlet (21040013): toggle -> ATK%
  '21040013': (id, p) => ({
    owners: [makeOwner(id, 'Passive')],
    states: [makeToggle(id, 'active', 'ATK Buff',
      `When Intro Skill is cast, increases ATK by {0}, lasting for {1}s.`)],
    effects: [
      makeEffect(id, 'atk', 'ATK%', [addBaseStat('atk', 'percent', rankTable(p, 1))],
        truthyCondition(`weapon:${id}:passive:active`)),
    ],
  }),

  // Gauntlet (21040015): energyRegen + 2 toggles -> basicAtk dmg, resonanceSkill dmg
  '21040015': (id, p) => ({
    owners: [makeOwner(id, 'Passive', `Increases Energy Regen by {0}.`)],
    states: [
      makeToggle(id, 'basic', 'Basic ATK DMG',
        `When hitting a target with Resonance Skill, increases Basic Attack DMG Bonus by {1}, lasting for {2}s.`),
      makeToggle(id, 'skill', 'Res. Skill DMG',
        `When hitting a target with Basic Attacks, increases Resonance Skill DMG Bonus by {3}, lasting for {4}s.`),
    ],
    effects: [
      makeEffect(id, 'energy', 'Energy Regen', [addTopStat('energyRegen', rankTable(p, 0))]),
      makeEffect(id, 'basic', 'Basic ATK DMG',
        [addSkilltypeMod('basicAtk', 'dmgBonus', rankTable(p, 1))],
        truthyCondition(`weapon:${id}:passive:basic`)),
      makeEffect(id, 'skill', 'Res. Skill DMG',
        [addSkilltypeMod('resonanceSkill', 'dmgBonus', rankTable(p, 3))],
        truthyCondition(`weapon:${id}:passive:skill`)),
    ],
  }),

  // Gauntlet (21040016): all elements dmgBonus + toggle -> ult dmg
  '21040016': (id, p) => ({
    owners: [makeOwner(id, 'Passive', `Gain {0} Attribute DMG Bonus.`)],
    states: [makeToggle(id, 'active', 'Res. Liberation DMG',
      `When using Resonance Liberation, the wielder gains {1} Resonance Liberation DMG Bonus for {2}s. This effect can be extended by {3}s each time Resonance Skills are cast, up to {4} times.`)],
    effects: [
      makeEffect(id, 'dmg', 'All DMG Bonus', [addAttributeMod('all', 'dmgBonus', rankTable(p, 0))]),
      makeEffect(id, 'ult', 'Res. Liberation DMG',
        [addSkilltypeMod('resonanceLiberation', 'dmgBonus', rankTable(p, 1))],
        truthyCondition(`weapon:${id}:passive:active`)),
    ],
  }),

  // Gauntlet (21040026): ATK% + toggle -> heavyAtk dmg
  '21040026': (id, p) => ({
    owners: [makeOwner(id, 'Passive', `Increases ATK by {0}.`)],
    states: [makeToggle(id, 'active', 'Heavy ATK DMG',
      `Every time Basic Attack or Intro Skill is cast, Heavy Attack DMG Bonus increases by {1} for {2}s.`)],
    effects: [
      makeEffect(id, 'atk', 'ATK%', [addBaseStat('atk', 'percent', rankTable(p, 0))]),
      makeEffect(id, 'heavy', 'Heavy ATK DMG',
        [addSkilltypeMod('heavyAtk', 'dmgBonus', rankTable(p, 1))],
        truthyCondition(`weapon:${id}:passive:active`)),
    ],
  }),

  // Gauntlet (21040034): toggle -> ATK%
  '21040034': (id, p) => ({
    owners: [makeOwner(id, 'Passive')],
    states: [makeToggle(id, 'active', 'ATK Buff',
      `When the Resonator dashes or dodges, increases ATK by {0}. Increases Dodge Counter DMG by {1}, lasting for {2}s.`)],
    effects: [
      makeEffect(id, 'atk', 'ATK%', [addBaseStat('atk', 'percent', rankTable(p, 0))],
        truthyCondition(`weapon:${id}:passive:active`)),
    ],
  }),

  // Gauntlet (21040036): Blazing Justice — ATK% + toggle -> DEF ignore + spectroFrazzle amplify
  '21040036': (id, p) => ({
    owners: [makeOwner(id, 'Passive', `Increases ATK by {0}.`)],
    states: [makeToggle(id, 'active', 'Darkness Breaker',
      `Casting Basic Attack grants the following effects: Dealing damage ignores {1} of the target's DEF and Amplifies Spectro Frazzle DMG dealt by {2} for {3}s. Retriggering the effect resets its duration.`)],
    effects: [
      makeEffect(id, 'atk', 'ATK%', [addBaseStat('atk', 'percent', rankTable(p, 0))]),
      makeEffect(id, 'frazzle', 'Spectro Frazzle Amplify',
        [addSkilltypeMod('spectroFrazzle', 'amplify', rankTable(p, 2)),
          addTopStat('defIgnore', rankTable(p, 1))],
        truthyCondition(`weapon:${id}:passive:active`)),
    ],
  }),

  // Gauntlet (21040044): toggle -> ult dmg
  '21040044': (id, p) => ({
    owners: [makeOwner(id, 'Passive')],
    states: [makeToggle(id, 'active', 'Res. Liberation DMG',
      `When Intro Skill is cast, increases Resonance Liberation DMG Bonus by {0}, lasting for {1}s.`)],
    effects: [
      makeEffect(id, 'ult', 'Res. Liberation DMG',
        [addSkilltypeMod('resonanceLiberation', 'dmgBonus', rankTable(p, 0))],
        truthyCondition(`weapon:${id}:passive:active`)),
    ],
  }),

  // Gauntlet (21040045): ATK% + stacks -> basicAtk dmg
  '21040045': (id, p) => ({
    owners: [makeOwner(id, 'Passive', `Increases ATK by {0}.`)],
    states: [makeStack(id, 'stacks', 'Stacks', 4, 0,
      `Dealing damage to targets under Tune Strain - Interfered grants {1} Basic Attack DMG Bonus for {2}s, stacking up to {3} times. This effect can be triggered {4} time(s) every {5}s. Retriggering the effect resets its duration.`)],
    effects: [
      makeEffect(id, 'atk', 'ATK%', [addBaseStat('atk', 'percent', rankTable(p, 0))]),
      makeEffect(id, 'basic', 'Basic ATK DMG',
        [addSkilltypeMod('basicAtk', 'dmgBonus', mulFormula(readControl(`weapon:${id}:passive:stacks`), rankTable(p, 1)))]),
    ],
  }),

  // Gauntlet (21040046): ATK% + toggle -> ult dmg + stacks -> ult defIgnore (via updateSkillMeta)
  '21040046': (id, p) => ({
    owners: [makeOwner(id, 'Passive', `Increases ATK by {0}.`)],
    states: [
      makeToggle(id, 'active', 'Res. Liberation DMG',
        `Casting Intro Skill or Resonance Liberation increases Resonance Liberation DMG by {1} for {2}s.`),
      makeStack(id, 'stacks', 'DEF Ignore Stacks', 5, 0,
        `Obtaining Shield allows Resonance Liberation DMG to ignore {3} of the target's DEF for {4}s, stacking up to {5} times. This effect is triggered once every {6}s. Upon casting Intro Skill, this effect reaches max stacks immediately, lasting for {7}s.`),
    ],
    effects: [
      makeEffect(id, 'atk', 'ATK%', [addBaseStat('atk', 'percent', rankTable(p, 0))]),
      makeEffect(id, 'ult', 'Res. Liberation DMG',
        [addSkilltypeMod('resonanceLiberation', 'dmgBonus', rankTable(p, 1))],
        truthyCondition(`weapon:${id}:passive:active`)),
      makeEffect(id, 'defignore', 'Res. Liberation DEF Ignore',
        [addSkilltypeMod('resonanceLiberation', 'defIgnore', mulFormula(readControl(`weapon:${id}:passive:stacks`), rankTable(p, 3)))]),
    ],
  }),

  // Gauntlet (21040053): ult dmgBonus
  '21040053': (id, p) => ({
    owners: [makeOwner(id, 'Passive', `Increases Resonance Liberation DMG Bonus by {0}.`)],
    states: [],
    effects: [makeEffect(id, 'ult', 'Res. Liberation DMG', [addSkilltypeMod('resonanceLiberation', 'dmgBonus', rankTable(p, 0))])],
  }),

  // Gauntlet (21040056): ATK% + toggle -> basicAtk amplify + toggle -> spectro dmg + all defIgnore
  '21040056': (id, p) => ({
    owners: [makeOwner(id, 'Passive', `Increases ATK by {0}.`)],
    states: [
      makeToggle(id, 'spectro', 'Spectro DMG Bonus',
        `After dealing Basic Attack DMG, the wielder gains {1} Spectro DMG Bonus for {2}s.`),
      makeToggle(id, 'basic', 'Basic Attack Amp + DEF Ignore',
        `Each time after the wielder inflicts Tune Strain - Shifting on the target, they gain {3} Basic Attack DMG Amplification and their Basic Attack DMG ignores {4} of the target's DEF for {5}s.`),
    ],
    effects: [
      makeEffect(id, 'atk', 'ATK%', [addBaseStat('atk', 'percent', rankTable(p, 0))]),
      makeEffect(id, 'spectro', 'Spectro DMG Bonus',
        [addAttributeMod('spectro', 'dmgBonus', rankTable(p, 1))],
        truthyCondition(`weapon:${id}:passive:spectro`)),
      makeEffect(id, 'basicAtk', 'Basic Attack Amp + DEF Ignore', [
        addSkilltypeMod('basicAtk', 'amplify', rankTable(p, 3)),
        addTopStat('defIgnore', rankTable(p, 4)),
      ], truthyCondition(`weapon:${id}:passive:basic`)),
    ],
  }),

  // Gauntlet (21040064): stacks -> ATK% + DEF%
  '21040064': (id, p) => ({
    owners: [makeOwner(id, 'Passive')],
    states: [makeStack(id, 'stacks', 'Stacks', 3, 0,
      `When Resonance Liberation is cast, grants {0} stack(s) of Iron Armor. Each stack increases ATK and DEF by {1}, stacking up to {2} time(s). When the Resonator takes damage, reduces the number of stacks by {3}.`)],
    effects: [
      makeEffect(id, 'buffs', 'ATK% + DEF%', [
        addBaseStat('atk', 'percent', mulFormula(readControl(`weapon:${id}:passive:stacks`), rankTable(p, 1))),
        addBaseStat('def', 'percent', mulFormula(readControl(`weapon:${id}:passive:stacks`), rankTable(p, 1))),
      ]),
    ],
  }),

  // Gauntlet (21040066): ATK% + toggle -> echoSkill amplify + toggle -> aero defIgnore
  '21040066': (id, p) => ({
    owners: [makeOwner(id, 'Passive', `Increases ATK by {0}.`)],
    states: [
      makeToggle(id, 'echo', 'Echo Skill Amplify',
        `Casting Intro Skill or Echo Skill grants {1} Echo Skill DMG Amplification for {2}s.`),
      makeToggle(id, 'aero', 'Aero DEF Ignore',
        `When dealing Echo Skill DMG, Aero DMG ignores {3} of the target's DEF for {4}s.`),
    ],
    effects: [
      makeEffect(id, 'atk', 'ATK%', [addBaseStat('atk', 'percent', rankTable(p, 0))]),
      makeEffect(id, 'echo', 'Echo Skill Amplify',
        [addSkilltypeMod('echoSkill', 'amplify', rankTable(p, 1))],
        truthyCondition(`weapon:${id}:passive:echo`)),
      makeEffect(id, 'aero', 'Aero DEF Ignore',
        [addAttributeMod('aero', 'defIgnore', rankTable(p, 3))],
        truthyCondition(`weapon:${id}:passive:aero`)),
    ],
  }),

  // Gauntlet (21040074): toggle -> ult dmg
  '21040074': (id, p) => ({
    owners: [makeOwner(id, 'Passive')],
    states: [makeToggle(id, 'active', 'Res. Liberation DMG',
      `Casting Resonance Skill increases the wielder's Resonance Liberation DMG Bonus by {0}, lasting for {1}s.`)],
    effects: [
      makeEffect(id, 'ult', 'Res. Liberation DMG',
        [addSkilltypeMod('resonanceLiberation', 'dmgBonus', rankTable(p, 0))],
        truthyCondition(`weapon:${id}:passive:active`)),
    ],
  }),

  // Gauntlet (21040084): toggle -> ATK%
  '21040084': (id, p) => ({
    owners: [makeOwner(id, 'Passive')],
    states: [makeToggle(id, 'active', 'ATK Buff',
      `Casting the Resonance Skill grants {0} Resonance Energy and increases ATK by {1}, lasting for {2}s. This effect can be triggered once every {3}s.`)],
    effects: [
      makeEffect(id, 'atk', 'ATK%', [addBaseStat('atk', 'percent', rankTable(p, 1))],
        truthyCondition(`weapon:${id}:passive:active`)),
    ],
  }),

  // Gauntlet (21040094): toggle + stacks -> ATK%
  '21040094': (id, p) => ({
    owners: [makeOwner(id, 'Passive')],
    states: [
      makeToggle(id, 'active', 'Active',
        `Dealing DMG to enemies with Negative Statuses increases the wielder's ATK by {0} for {1}s.`),
      makeStack(id, 'stacks', 'Stacks', 4, 0,
        `This effect can be triggered 1 time per second, stackable up to {2} times.`),
    ],
    effects: [
      makeEffect(id, 'atk', 'ATK%',
        [addBaseStat('atk', 'percent', mulFormula(readControl(`weapon:${id}:passive:stacks`), rankTable(p, 0)))],
        truthyCondition(`weapon:${id}:passive:active`)),
    ],
  }),

  // Gauntlet (21040104): toggle -> ATK% + ult dmg
  '21040104': (id, p) => ({
    owners: [makeOwner(id, 'Passive')],
    states: [makeToggle(id, 'active', 'Active',
      `Casting Resonance Liberation increases ATK by {0} and grants {1} Resonance Liberation DMG Bonus for {2}s.`)],
    effects: [
      makeEffect(id, 'buffs', 'ATK% + Res. Liberation DMG', [
        addBaseStat('atk', 'percent', rankTable(p, 0)),
        addSkilltypeMod('resonanceLiberation', 'dmgBonus', rankTable(p, 1)),
      ], truthyCondition(`weapon:${id}:passive:active`)),
    ],
  }),

  // --- Rectifiers ---

  // Rectifier (21050011): ATK%
  '21050011': (id, p) => ({
    owners: [makeOwner(id, 'Passive', `Increases ATK by {0}.`)],
    states: [],
    effects: [makeEffect(id, 'atk', 'ATK%', [addBaseStat('atk', 'percent', rankTable(p, 0))])],
  }),

  // Rectifier (21050012): ATK%
  '21050012': (id, p) => ({
    owners: [makeOwner(id, 'Passive', `Increases ATK by {0}.`)],
    states: [],
    effects: [makeEffect(id, 'atk', 'ATK%', [addBaseStat('atk', 'percent', rankTable(p, 0))])],
  }),

  // Rectifier (21050013): toggle -> ATK%
  '21050013': (id, p) => ({
    owners: [makeOwner(id, 'Passive')],
    states: [makeToggle(id, 'active', 'ATK Buff',
      `When Intro Skill is cast, increases ATK by {0}, lasting for {1}s.`)],
    effects: [
      makeEffect(id, 'atk', 'ATK%', [addBaseStat('atk', 'percent', rankTable(p, 1))],
        truthyCondition(`weapon:${id}:passive:active`)),
    ],
  }),

  // Rectifier (21050015): energyRegen + stacks -> basicAtk dmg
  '21050015': (id, p) => ({
    owners: [makeOwner(id, 'Passive', `Increases Energy Regen by {0}.`)],
    states: [makeStack(id, 'stacks', 'Stacks', 5, 0,
      `When dealing Basic Attack DMG, increases Basic Attack DMG Bonus by {1}, stacking up to {2} time(s). This effect lasts for {3}s and can be triggered {4} time(s) every {5}s.`)],
    effects: [
      makeEffect(id, 'energy', 'Energy Regen', [addTopStat('energyRegen', rankTable(p, 0))]),
      makeEffect(id, 'basic', 'Basic ATK DMG',
        [addSkilltypeMod('basicAtk', 'dmgBonus', mulFormula(readControl(`weapon:${id}:passive:stacks`), rankTable(p, 1)))]),
    ],
  }),

  // Rectifier (21050016): all dmgBonus + toggle -> ATK% + stacks -> ATK%
  '21050016': (id, p) => ({
    owners: [makeOwner(id, 'Passive', `Grants {0} Attribute DMG Bonus.`)],
    states: [
      makeStack(id, 'stacks', 'ATK Stacks', 2, 0,
        `When dealing Resonance Skill DMG, increases ATK by {1}, stacking up to {2} times. This effect lasts for {3}s.`),
      makeToggle(id, 'active', 'ATK Buff',
        `When the wielder is not on the field, increases their ATK by an additional {4}.`),
    ],
    effects: [
      makeEffect(id, 'dmg', 'All DMG Bonus', [addAttributeMod('all', 'dmgBonus', rankTable(p, 0))]),
      makeEffect(id, 'atk_stacks', 'ATK% (Stacks)',
        [addBaseStat('atk', 'percent', mulFormula(readControl(`weapon:${id}:passive:stacks`), rankTable(p, 1)))]),
      makeEffect(id, 'atk_toggle', 'ATK%',
        [addBaseStat('atk', 'percent', rankTable(p, 4))],
        truthyCondition(`weapon:${id}:passive:active`)),
    ],
  }),

  // Rectifier (21050017): toggle -> healingBonus
  '21050017': (id, p) => ({
    owners: [makeOwner(id, 'Passive')],
    states: [makeToggle(id, 'active', 'Healing Bonus',
      `Casting Resonance Liberation increases the Resonator's Healing Bonus by {0} for {1}s.`)],
    effects: [
      makeEffect(id, 'heal', 'Healing Bonus',
        [addTopStat('healingBonus', rankTable(p, 0))],
        truthyCondition(`weapon:${id}:passive:active`)),
    ],
  }),

  // Rectifier (21050026): ATK% + stacks -> basicAtk dmg + toggle -> basicAtk dmg
  '21050026': (id, p) => ({
    owners: [makeOwner(id, 'Passive', `Increase ATK by {0}.`)],
    states: [
      makeStack(id, 'stacks', 'Basic ATK Stacks', 3, 0,
        `While the wielder is on the field, using Resonance Skill grants {1} Basic Attack DMG Bonus, stacking up to {2} times for {3}s.`),
      makeToggle(id, 'active', 'Basic ATK DMG',
        `At {4} stacks or above, casting Outro Skill consumes all stacks of this effect and grants the wielder {5} Basic Attack DMG Bonus for {6}s, effective when the wielder is off the field.`),
    ],
    effects: [
      makeEffect(id, 'atk', 'ATK%', [addBaseStat('atk', 'percent', rankTable(p, 0))]),
      makeEffect(id, 'basic_stacks', 'Basic ATK DMG (Stacks)',
        [addSkilltypeMod('basicAtk', 'dmgBonus', mulFormula(readControl(`weapon:${id}:passive:stacks`), rankTable(p, 1)))]),
      makeEffect(id, 'basic_toggle', 'Basic ATK DMG',
        [addSkilltypeMod('basicAtk', 'dmgBonus', rankTable(p, 5))],
        truthyCondition(`weapon:${id}:passive:active`)),
    ],
  }),

  // Rectifier (21050027): toggle + stacks -> spectro dmg
  '21050027': (id, p) => ({
    owners: [makeOwner(id, 'Passive')],
    states: [
      makeToggle(id, 'active', 'Active',
        `Dealing DMG to enemies with Spectro Frazzle increases the wielder's Spectro DMG by {0}, gaining 1 stack per second for 6s, stacking up to 4 times.`),
      makeStack(id, 'stacks', 'Stacks', 4),
    ],
    effects: [
      makeEffect(id, 'spectro', 'Spectro DMG',
        [addAttributeMod('spectro', 'dmgBonus', mulFormula(readControl(`weapon:${id}:passive:stacks`), rankTable(p, 0)))],
        truthyCondition(`weapon:${id}:passive:active`)),
    ],
  }),

  // Rectifier (21050034): toggle -> ATK%
  '21050034': (id, p) => ({
    owners: [makeOwner(id, 'Passive')],
    states: [makeToggle(id, 'active', 'ATK Buff',
      `If the Resonator's HP is above {4}, increases ATK by {5}, lasting for {6}s.`)],
    effects: [
      makeEffect(id, 'atk', 'ATK%', [addBaseStat('atk', 'percent', rankTable(p, 5))],
        truthyCondition(`weapon:${id}:passive:active`)),
    ],
  }),

  // Rectifier (21050036): HP% + toggle -> ATK%
  '21050036': (id, p) => ({
    owners: [makeOwner(id, 'Passive', `Increase HP by {0}.`)],
    states: [makeToggle(id, 'active', 'ATK Buff',
      `When casting Resonance Skill that heals, increase nearby party members' ATK by {4} for {5}s. Effects of the same name cannot be stacked.`)],
    effects: [
      makeEffect(id, 'hp', 'HP%', [addBaseStat('hp', 'percent', rankTable(p, 0))]),
      makeEffect(id, 'atk', 'ATK%',
        [addBaseStat('atk', 'percent', rankTable(p, 4))],
        truthyCondition(`weapon:${id}:passive:active`), 'teamWide'),
    ],
  }),

  // Rectifier (21050044): toggle -> ATK% + HP%
  '21050044': (id, p) => ({
    owners: [makeOwner(id, 'Passive')],
    states: [makeToggle(id, 'active', 'Active',
      `Casting Intro Skill increases the wielder's ATK by {0} and HP by {1}, lasting for {2}s.`)],
    effects: [
      makeEffect(id, 'buffs', 'ATK% + HP%', [
        addBaseStat('atk', 'percent', rankTable(p, 0)),
        addBaseStat('hp', 'percent', rankTable(p, 1)),
      ], truthyCondition(`weapon:${id}:passive:active`)),
    ],
  }),

  // Rectifier (21050045): ATK% + toggle -> ATK% + basicAtk dmg
  '21050045': (id, p) => ({
    owners: [makeOwner(id, 'Passive', `Increases ATK by {0}.`)],
    states: [makeToggle(id, 'active', 'Active',
      `After a Resonator in the team casts a Tune Break skill, it grants a {1} ATK increase and {2} Basic Attack DMG Bonus to the wielder for {3}s.`)],
    effects: [
      makeEffect(id, 'atk', 'ATK%', [addBaseStat('atk', 'percent', rankTable(p, 0))]),
      makeEffect(id, 'buffs', 'ATK% + Basic ATK DMG', [
        addBaseStat('atk', 'percent', rankTable(p, 1)),
        addSkilltypeMod('basicAtk', 'dmgBonus', rankTable(p, 2)),
      ], truthyCondition(`weapon:${id}:passive:active`)),
    ],
  }),

  // Rectifier (21050046): ATK% + toggle -> spectroFrazzle amplify + stacks -> basic/heavy dmg (toggle-gated)
  '21050046': (id, p) => ({
    owners: [makeOwner(id, 'Passive', `Increase ATK by {0}.`)],
    states: [
      makeToggle(id, 'active', 'Spectro Frazzle Active',
        `Dealing DMG to targets with Spectro Frazzle grants the wielder {1} Basic Attack DMG Bonus and {2} Heavy Attack DMG Bonus, stacking up to {3} time(s) for {4}s. Casting Outro Skill Amplifies the Spectro Frazzle DMG on targets around the active Resonator by {5} for {6}s. Effects of the same name cannot be stacked.`),
      makeStack(id, 'stacks', 'Stacks', 3),
    ],
    effects: [
      makeEffect(id, 'atk', 'ATK%', [addBaseStat('atk', 'percent', rankTable(p, 0))]),
      makeEffect(id, 'frazzle', 'Spectro Frazzle Amplify',
        [addSkilltypeMod('spectroFrazzle', 'amplify', rankTable(p, 4))],
        truthyCondition(`weapon:${id}:passive:active`), 'active'),
      makeEffect(id, 'dmg', 'Basic/Heavy ATK DMG', [
        addSkilltypeMod('basicAtk', 'dmgBonus', mulFormula(readControl(`weapon:${id}:passive:stacks`), rankTable(p, 1))),
        addSkilltypeMod('heavyAtk', 'dmgBonus', mulFormula(readControl(`weapon:${id}:passive:stacks`), rankTable(p, 1))),
      ], truthyCondition(`weapon:${id}:passive:active`)),
    ],
  }),

  // Rectifier (21050053): basicAtk + heavyAtk dmg
  '21050053': (id, p) => ({
    owners: [makeOwner(id, 'Passive', `Increases Basic Attack and Heavy Attack DMG Bonus by {0}.`)],
    states: [],
    effects: [
      makeEffect(id, 'dmg', 'Basic/Heavy ATK DMG', [
        addSkilltypeMod('basicAtk', 'dmgBonus', rankTable(p, 0)),
        addSkilltypeMod('heavyAtk', 'dmgBonus', rankTable(p, 0)),
      ]),
    ],
  }),

  // Rectifier (21050056): ATK% + stacks(0-2) -> basicAtk dmg (at 1+) + havoc resShred (at 2)
  '21050056': (id, p) => ({
    owners: [makeOwner(id, 'Passive', `Increases ATK by {0}.`)],
    states: [makeStack(id, 'stacks', 'Stacks', 2, 0,
      `Casting Echo Skill within {1}s after casting Intro Skill or Basic Attacks grants {2} stacks of Gentle Dream. With {5} stacks: Grants {6} Basic Attack DMG Bonus. With {7} stacks: Ignores {8} of the target's Havoc RES.`)],
    effects: [
      makeEffect(id, 'atk', 'ATK%', [addBaseStat('atk', 'percent', rankTable(p, 0))]),
      makeEffect(id, 'basic', 'Basic ATK DMG',
        [addSkilltypeMod('basicAtk', 'dmgBonus', rankTable(p, 6))],
        { type: 'gte', from: 'sourceRuntime', path: `state.controls.weapon:${id}:passive:stacks`, value: 1 }),
      makeEffect(id, 'shred', 'Havoc RES Shred',
        [addAttributeMod('havoc', 'resShred', rankTable(p, 8))],
        { type: 'gte', from: 'sourceRuntime', path: `state.controls.weapon:${id}:passive:stacks`, value: 2 }),
    ],
  }),

  // Rectifier (21050064): stacks -> healingBonus
  '21050064': (id, p) => ({
    owners: [makeOwner(id, 'Passive')],
    states: [makeStack(id, 'stacks', 'Stacks', 3, 0,
      `When dealing Basic Attack DMG or Heavy Attack DMG, increases Healing Bonus by {0}, stacking up to {1} time(s). This effect lasts for {2}s and can be triggered {3} time(s) every {4}s.`)],
    effects: [
      makeEffect(id, 'heal', 'Healing Bonus',
        [addTopStat('healingBonus', mulFormula(readControl(`weapon:${id}:passive:stacks`), rankTable(p, 0)))]),
    ],
  }),

  // Rectifier (21050066): ATK% + toggle -> resonanceSkill dmg + echoSkill amplify + all defIgnore
  '21050066': (id, p) => ({
    owners: [makeOwner(id, 'Passive', `ATK is increased by {0}.`)],
    states: [makeToggle(id, 'active', 'Active',
      `Within {1}s after dealing Echo Skill DMG, gain {2} Resonance Skill DMG Bonus and {3} Echo Skill DMG Amplification, and ignore {4} of the target's DEF when dealing damage.`)],
    effects: [
      makeEffect(id, 'atk', 'ATK%', [addBaseStat('atk', 'percent', rankTable(p, 0))]),
      makeEffect(id, 'buffs', 'Res. Skill DMG + Echo Amplify + DEF Ignore', [
        addSkilltypeMod('resonanceSkill', 'dmgBonus', rankTable(p, 2)),
        addSkilltypeMod('echoSkill', 'amplify', rankTable(p, 2)),
        addSkilltypeMod('all', 'defIgnore', rankTable(p, 4)),
      ], truthyCondition(`weapon:${id}:passive:active`)),
    ],
  }),

  // Rectifier (21050074): toggle -> ATK%
  '21050074': (id, p) => ({
    owners: [makeOwner(id, 'Passive')],
    states: [makeToggle(id, 'active', 'ATK Buff',
      `Casting Resonance Liberation increases the wielder's ATK by {0}, lasting for {1}s.`)],
    effects: [
      makeEffect(id, 'atk', 'ATK%', [addBaseStat('atk', 'percent', rankTable(p, 0))],
        truthyCondition(`weapon:${id}:passive:active`)),
    ],
  }),

  // Rectifier (21050076): ATK% + toggle -> liberation dmg + toggle -> team ATK%
  '21050076': (id, p) => ({
    owners: [makeOwner(id, 'Passive', `Increases ATK by {0}.`)],
    states: [
      makeToggle(id, 'ult', 'Res. Liberation DMG',
        `After the wielder inflicts Fusion Burst or Tune Strain - Shifting on the target, their Resonance Liberation DMG Bonus is increased by {1} for {2}s.`),
      makeToggle(id, 'team_atk', 'Team ATK',
        `While this effect lasts, after Resonators in the team inflict Fusion Burst Effect or Tune Strain - Shifting, their ATK is increased by {3} for {4}s. Effects of the same name cannot be stacked.`),
    ],
    effects: [
      makeEffect(id, 'atk', 'ATK%', [addBaseStat('atk', 'percent', rankTable(p, 0))]),
      makeEffect(id, 'ult', 'Res. Liberation DMG',
        [addSkilltypeMod('resonanceLiberation', 'dmgBonus', rankTable(p, 1))],
        truthyCondition(`weapon:${id}:passive:ult`)),
      makeEffect(id, 'team-atk', 'Team ATK',
        [addBaseStat('atk', 'percent', rankTable(p, 3))],
        truthyCondition(`weapon:${id}:passive:team_atk`), 'teamWide'),
    ],
  }),

  // Rectifier (21050084): toggle -> ATK%
  '21050084': (id, p) => ({
    owners: [makeOwner(id, 'Passive')],
    states: [makeToggle(id, 'active', 'ATK Buff',
      `Casting the Resonance Skill grants {0} Resonance Energy and increases ATK by {1}, lasting for {2}s. This effect can be triggered once every {3}s.`)],
    effects: [
      makeEffect(id, 'atk', 'ATK%', [addBaseStat('atk', 'percent', rankTable(p, 1))],
        truthyCondition(`weapon:${id}:passive:active`)),
    ],
  }),

  // Rectifier (21050094): toggle + stacks -> ATK%
  '21050094': (id, p) => ({
    owners: [makeOwner(id, 'Passive')],
    states: [
      makeToggle(id, 'active', 'Active',
        `Dealing DMG to enemies with Negative Statuses increases the wielder's ATK by {0} for {1}s.`),
      makeStack(id, 'stacks', 'Stacks', 4, 0,
        `This effect can be triggered 1 time per second, stackable up to {2} times.`),
    ],
    effects: [
      makeEffect(id, 'atk', 'ATK%',
        [addBaseStat('atk', 'percent', mulFormula(readControl(`weapon:${id}:passive:stacks`), rankTable(p, 0)))],
        truthyCondition(`weapon:${id}:passive:active`)),
    ],
  }),

  // Rectifier (21050104): toggle -> ATK% + basicAtk dmg
  '21050104': (id, p) => ({
    owners: [makeOwner(id, 'Passive')],
    states: [makeToggle(id, 'active', 'Active',
      `Casting Resonance Skill increases ATK by {0} and grants {1} Basic Attack DMG Bonus for {2}s.`)],
    effects: [
      makeEffect(id, 'buffs', 'ATK% + Basic ATK DMG', [
        addBaseStat('atk', 'percent', rankTable(p, 0)),
        addSkilltypeMod('basicAtk', 'dmgBonus', rankTable(p, 0)),
      ], truthyCondition(`weapon:${id}:passive:active`)),
    ],
  }),
}

// build weapon source packages from provided weapon data
export function buildWeaponSources(weapons: GeneratedWeapon[]): SourcePackage[] {
  const weaponsById = Object.fromEntries(weapons.map((w) => [w.id, w]))
  return Object.entries(weaponDefiners).reduce<SourcePackage[]>((acc, [id, definer]) => {
    const weapon = weaponsById[id]
    if (!weapon) return acc
    const parsed = parseParams(weapon.passive.params)
    const built = definer(id, parsed)
    acc.push({
      source: makeSource(id),
      owners: built.owners,
      states: built.states,
      effects: built.effects,
    })
    return acc
  }, [])
}
