/*
  Author: Runor Ewhro
  Description: encodes optimizer echo rows and builds per-echo main-echo
               bonus rows by evaluating echo runtime effects against either
               a selected target skill or a generic skill-type/element map.
*/

import { getGameData } from '@/data/gameData'
import { buildTeamCompositionInfo } from '@/domain/gameData/teamComposition'
import { listSourceEffects, listSourceStates } from '@/domain/gameData/registry'
import type { EffectEvalScope, EffectOperation } from '@/domain/gameData/contracts'
import type { EchoInstance, ResonatorRuntimeState } from '@/domain/entities/runtime'
import type { AttributeKey, FinalStats, ResonatorBaseStats, SkillTypeKey } from '@/domain/entities/stats'
import { getEchoById } from '@/domain/services/echoCatalogService'
import { evaluateCondition, evaluateFormula } from '@/engine/effects/evaluator'
import type { OptimizerTargetSkill } from '@/engine/optimizer/rebuild/target/selectedSkill'

export type TargetScopeMode = 'self' | 'ally'

export interface EncodedEchoRows {
  // flattened per-echo stat vectors
  stats: Float32Array

  // set id for each echo row
  sets: Uint8Array

  // echo cost for each row
  costs: Uint8Array

  // stable "kind" ids, mainly used to detect duplicate copies of the same echo
  kinds: Uint16Array

  // total number of encoded rows
  count: number
}

type MainStatVector = Float32Array

// packed row sizes
// STATS_PER_ECHO is the raw stat vector length used during optimizer search
// MAIN_BUFFS_PER_ECHO is the per-main-echo bonus row length
const STATS_PER_ECHO = 20
const MAIN_BUFFS_PER_ECHO = 15

// main-echo bonus vector offsets
// these are not full stat vectors. they only represent the subset of bonuses
// that can come specifically from choosing an echo as the active main echo.
const MAIN_ATK_PERCENT = 0
const MAIN_ATK_FLAT = 1
const MAIN_BASIC = 2
const MAIN_HEAVY = 3
const MAIN_SKILL = 4
const MAIN_LIB = 5
const MAIN_AERO = 6
const MAIN_GLACIO = 7
const MAIN_FUSION = 8
const MAIN_SPECTRO = 9
const MAIN_HAVOC = 10
const MAIN_ELECTRO = 11
const MAIN_ER = 12
const MAIN_ECHO_SKILL = 13
const MAIN_COORD = 14

// encoded echo stat vector offsets
// this is the layout used when regular equipped echoes are packed into rows.
const STAT_ATK_PERCENT = 0
const STAT_ATK_FLAT = 1
const STAT_HP_PERCENT = 2
const STAT_HP_FLAT = 3
const STAT_DEF_PERCENT = 4
const STAT_DEF_FLAT = 5
const STAT_CRIT_RATE = 6
const STAT_CRIT_DMG = 7
const STAT_ER = 8
const STAT_HEALING_BONUS = 9
const STAT_BASIC = 10
const STAT_HEAVY = 11
const STAT_SKILL = 12
const STAT_LIB = 13
const STAT_AERO = 14
const STAT_SPECTRO = 15
const STAT_FUSION = 16
const STAT_GLACIO = 17
const STAT_HAVOC = 18
const STAT_ELECTRO = 19

// decide whether an effect should contribute for the chosen optimizer scope mode
// self mode allows self/active/team-wide effects
// ally mode only keeps effects that would apply to other targets
function shouldApplyToTargetScope(targetScope: string | undefined, mode: TargetScopeMode): boolean {
  if (mode === 'ally') {
    return targetScope === 'teamWide' || targetScope === 'activeOther'
  }

  return !targetScope || targetScope === 'self' || targetScope === 'teamWide' || targetScope === 'active'
}

// assign a stable "kind" id per echo id so duplicate echoes can be identified cheaply
// two rows with the same echo id will get the same kind id
function buildKindIds(echoes: EchoInstance[]): Uint16Array {
  const out = new Uint16Array(echoes.length)
  const byEchoId = new Map<string, number>()
  let nextKind = 0

  for (let index = 0; index < echoes.length; index += 1) {
    const echoId = echoes[index]?.id ?? ''
    let kind = byEchoId.get(echoId)

    if (kind == null) {
      kind = nextKind
      nextKind += 1
      byEchoId.set(echoId, kind)
    }

    out[index] = kind
  }

  return out
}

// add one main stat or substat into the encoded per-echo stat vector
// only keys used by the optimizer vector layout are recognized here
function addEchoStat(vector: Float32Array, statKey: string, value: number): void {
  if (!value) {
    return
  }

  switch (statKey) {
    case 'atkPercent':
      vector[STAT_ATK_PERCENT] += value
      return
    case 'atkFlat':
      vector[STAT_ATK_FLAT] += value
      return
    case 'hpPercent':
      vector[STAT_HP_PERCENT] += value
      return
    case 'hpFlat':
      vector[STAT_HP_FLAT] += value
      return
    case 'defPercent':
      vector[STAT_DEF_PERCENT] += value
      return
    case 'defFlat':
      vector[STAT_DEF_FLAT] += value
      return
    case 'critRate':
      vector[STAT_CRIT_RATE] += value
      return
    case 'critDmg':
      vector[STAT_CRIT_DMG] += value
      return
    case 'energyRegen':
      vector[STAT_ER] += value
      return
    case 'healingBonus':
      vector[STAT_HEALING_BONUS] += value
      return
    case 'basicAtk':
      vector[STAT_BASIC] += value
      return
    case 'heavyAtk':
      vector[STAT_HEAVY] += value
      return
    case 'resonanceSkill':
      vector[STAT_SKILL] += value
      return
    case 'resonanceLiberation':
      vector[STAT_LIB] += value
      return
    case 'aero':
      vector[STAT_AERO] += value
      return
    case 'spectro':
      vector[STAT_SPECTRO] += value
      return
    case 'fusion':
      vector[STAT_FUSION] += value
      return
    case 'glacio':
      vector[STAT_GLACIO] += value
      return
    case 'havoc':
      vector[STAT_HAVOC] += value
      return
    case 'electro':
      vector[STAT_ELECTRO] += value
      return
    default:
      // ignore unsupported stats instead of throwing
      return
  }
}

// check whether an attribute-scoped effect can apply to the selected skill
// 'all' always matches, otherwise the effect attribute must match the selected element
function attributeMatchesSelected(
    selectedSkill: OptimizerTargetSkill,
    attribute: AttributeKey | 'all' | Array<AttributeKey | 'all'>,
): boolean {
  const list = Array.isArray(attribute) ? attribute : [attribute]
  return list.includes('all') || list.includes(selectedSkill.element)
}

// check whether a skill-type-scoped effect can apply to the selected skill
// 'all' matches any selected skill type
function skillTypeMatchesSelected(
    selectedSkill: OptimizerTargetSkill,
    skillType: SkillTypeKey | SkillTypeKey[],
): boolean {
  const list = Array.isArray(skillType) ? skillType : [skillType]
  return list.some((type) => type === 'all' || selectedSkill.skillType.includes(type))
}

// enforce skill id / skill type / tab matching for skill-specific effect operations
// if no match block exists, the operation is considered globally applicable
function operationMatchesSkill(operation: EffectOperation, selectedSkill: OptimizerTargetSkill): boolean {
  if (!('match' in operation) || !operation.match) {
    return true
  }

  if (operation.match.skillIds && !operation.match.skillIds.includes(selectedSkill.id)) {
    return false
  }

  if (operation.match.skillTypes && !operation.match.skillTypes.some((type) => selectedSkill.skillType.includes(type))) {
    return false
  }

  if (operation.match.tabs && !operation.match.tabs.includes(selectedSkill.tab)) {
    return false
  }

  return true
}

// convert one evaluated effect operation into the selected-skill-specific main bonus vector
// this version is precise: it only writes bonuses that really affect the chosen target skill
function addMainOperation(
    vector: Float32Array,
    operation: EffectOperation,
    value: number,
    selectedSkill: OptimizerTargetSkill,
): void {
  if (!value) {
    return
  }

  // only atk base-stat contributions matter here from add_base_stat
  // hp/def do not currently belong in the main-echo row format
  if (operation.type === 'add_base_stat') {
    if (operation.stat === 'atk' && operation.field === 'percent') {
      vector[MAIN_ATK_PERCENT] += value
    } else if (operation.stat === 'atk' && operation.field === 'flat') {
      vector[MAIN_ATK_FLAT] += value
    }
    return
  }

  // currently only er top-stat contributions are needed for main-echo rows
  if (operation.type === 'add_top_stat') {
    if (operation.stat === 'energyRegen') {
      vector[MAIN_ER] += value
    }
    return
  }

  // attribute dmg bonus only applies if the selected skill matches the attribute
  if (operation.type === 'add_attribute_mod') {
    if (!attributeMatchesSelected(selectedSkill, operation.attribute) || operation.mod !== 'dmgBonus') {
      return
    }

    switch (selectedSkill.element) {
      case 'aero':
        vector[MAIN_AERO] += value
        return
      case 'glacio':
        vector[MAIN_GLACIO] += value
        return
      case 'fusion':
        vector[MAIN_FUSION] += value
        return
      case 'spectro':
        vector[MAIN_SPECTRO] += value
        return
      case 'havoc':
        vector[MAIN_HAVOC] += value
        return
      case 'electro':
        vector[MAIN_ELECTRO] += value
        return
      default:
        return
    }
  }

  // skill-type dmg bonus only contributes to matching buckets
  // this lets one operation contribute to several buckets if it names several skill types
  if (operation.type === 'add_skilltype_mod') {
    if (!skillTypeMatchesSelected(selectedSkill, operation.skillType) || operation.mod !== 'dmgBonus') {
      return
    }

    const list = Array.isArray(operation.skillType) ? operation.skillType : [operation.skillType]
    for (const type of list) {
      switch (type) {
        case 'basicAtk':
          if (selectedSkill.skillType.includes(type)) vector[MAIN_BASIC] += value
          break
        case 'heavyAtk':
          if (selectedSkill.skillType.includes(type)) vector[MAIN_HEAVY] += value
          break
        case 'resonanceSkill':
          if (selectedSkill.skillType.includes(type)) vector[MAIN_SKILL] += value
          break
        case 'resonanceLiberation':
          if (selectedSkill.skillType.includes(type)) vector[MAIN_LIB] += value
          break
        case 'echoSkill':
          if (selectedSkill.skillType.includes(type)) vector[MAIN_ECHO_SKILL] += value
          break
        case 'coord':
          if (selectedSkill.skillType.includes(type)) vector[MAIN_COORD] += value
          break
        default:
          break
      }
    }
    return
  }

  // skill-scoped dmg bonus fans out into the actual selected skill's buckets
  // this is used when the effect says "matching skill gets dmg bonus"
  if (operation.type === 'add_skill_mod') {
    if (!operationMatchesSkill(operation, selectedSkill) || operation.mod !== 'dmgBonus') {
      return
    }

    if (selectedSkill.skillType.includes('basicAtk')) vector[MAIN_BASIC] += value
    if (selectedSkill.skillType.includes('heavyAtk')) vector[MAIN_HEAVY] += value
    if (selectedSkill.skillType.includes('resonanceSkill')) vector[MAIN_SKILL] += value
    if (selectedSkill.skillType.includes('resonanceLiberation')) vector[MAIN_LIB] += value
    if (selectedSkill.skillType.includes('echoSkill')) vector[MAIN_ECHO_SKILL] += value
    if (selectedSkill.skillType.includes('coord')) vector[MAIN_COORD] += value
  }
}

// add a generic attribute bucket when we are not targeting a single specific skill
// this is broader than addMainOperation because it does not filter to one selected element
function addMainElementValue(vector: MainStatVector, attribute: AttributeKey | 'all', value: number): void {
  switch (attribute) {
    case 'all':
      vector[MAIN_AERO] += value
      vector[MAIN_GLACIO] += value
      vector[MAIN_FUSION] += value
      vector[MAIN_SPECTRO] += value
      vector[MAIN_HAVOC] += value
      vector[MAIN_ELECTRO] += value
      return
    case 'aero':
      vector[MAIN_AERO] += value
      return
    case 'glacio':
      vector[MAIN_GLACIO] += value
      return
    case 'fusion':
      vector[MAIN_FUSION] += value
      return
    case 'spectro':
      vector[MAIN_SPECTRO] += value
      return
    case 'havoc':
      vector[MAIN_HAVOC] += value
      return
    case 'electro':
      vector[MAIN_ELECTRO] += value
      return
    default:
      return
  }
}

// add a generic skill-type bucket when we are not targeting a single specific skill
// 'all' means the bonus is duplicated into every supported skill bucket
function addMainSkillTypeValue(vector: MainStatVector, type: SkillTypeKey | 'all', value: number): void {
  switch (type) {
    case 'all':
      vector[MAIN_BASIC] += value
      vector[MAIN_HEAVY] += value
      vector[MAIN_SKILL] += value
      vector[MAIN_LIB] += value
      vector[MAIN_ECHO_SKILL] += value
      vector[MAIN_COORD] += value
      return
    case 'basicAtk':
      vector[MAIN_BASIC] += value
      return
    case 'heavyAtk':
      vector[MAIN_HEAVY] += value
      return
    case 'resonanceSkill':
      vector[MAIN_SKILL] += value
      return
    case 'resonanceLiberation':
      vector[MAIN_LIB] += value
      return
    case 'echoSkill':
      vector[MAIN_ECHO_SKILL] += value
      return
    case 'coord':
      vector[MAIN_COORD] += value
      return
    default:
      return
  }
}

// try to infer affected generic skill-type buckets from skill match metadata
// this is used by the generic builder when there is no concrete selected skill
function inferGenericSkillTypes(operation: EffectOperation): Array<SkillTypeKey | 'all'> {
  const inferred = new Set<SkillTypeKey | 'all'>()

  // direct skillTypes match block is the strongest hint
  if ('match' in operation && operation.match?.skillTypes) {
    for (const type of operation.match.skillTypes) {
      inferred.add(type)
    }
  }

  // tabs can sometimes be mapped into optimizer skill buckets
  if ('match' in operation && operation.match?.tabs) {
    for (const tab of operation.match.tabs) {
      switch (tab) {
        case 'echoAttacks':
          inferred.add('echoSkill')
          break
        case 'normalAttack':
          inferred.add('basicAtk')
          break
        case 'resonanceSkill':
          inferred.add('resonanceSkill')
          break
        case 'resonanceLiberation':
          inferred.add('resonanceLiberation')
          break
        default:
          break
      }
    }
  }

  // echo:* skill ids are a useful fallback hint
  if ('match' in operation && operation.match?.skillIds) {
    for (const skillId of operation.match.skillIds) {
      if (skillId.startsWith('echo:')) {
        inferred.add('echoSkill')
      }
    }
  }

  // if nothing can be inferred, treat it as broadly applicable
  if (inferred.size === 0) {
    inferred.add('all')
  }

  return [...inferred]
}

// generic variant used when building rotation/display-friendly main echo rows
// unlike addMainOperation, this does not require one chosen skill
function addGenericMainOperation(
    vector: MainStatVector,
    operation: EffectOperation,
    value: number,
): void {
  if (!value) {
    return
  }

  // generic rows still only model atk-related base-stat additions here
  if (operation.type === 'add_base_stat') {
    if (operation.stat === 'atk' && operation.field === 'percent') {
      vector[MAIN_ATK_PERCENT] += value
    } else if (operation.stat === 'atk' && operation.field === 'flat') {
      vector[MAIN_ATK_FLAT] += value
    }
    return
  }

  // generic rows currently keep only energy regen among top-level scalar stats
  if (operation.type === 'add_top_stat') {
    if (operation.stat === 'energyRegen') {
      vector[MAIN_ER] += value
    }
    return
  }

  // attribute dmg bonus gets spread into whichever attribute buckets are named
  if (operation.type === 'add_attribute_mod') {
    if (operation.mod !== 'dmgBonus') {
      return
    }

    const attributes = Array.isArray(operation.attribute)
        ? operation.attribute
        : [operation.attribute]

    for (const attribute of attributes) {
      addMainElementValue(vector, attribute, value)
    }
    return
  }

  // skill-type dmg bonus gets spread into whichever skill buckets are named
  if (operation.type === 'add_skilltype_mod') {
    if (operation.mod !== 'dmgBonus') {
      return
    }

    const skillTypes = Array.isArray(operation.skillType)
        ? operation.skillType
        : [operation.skillType]

    for (const type of skillTypes) {
      addMainSkillTypeValue(vector, type, value)
    }
    return
  }

  // for skill-level dmgBonus, infer likely affected buckets
  if (operation.type === 'add_skill_mod' && operation.mod === 'dmgBonus') {
    for (const type of inferGenericSkillTypes(operation)) {
      addMainSkillTypeValue(vector, type, value)
    }
  }
}

// build a temporary runtime where this echo is equipped as the sole main echo
// and its states are forced on/maxed so effect evaluation reflects "main echo active"
// this lets us evaluate the echo's own data-driven passive effects in isolation.
function buildMainEchoRuntime(runtime: ResonatorRuntimeState, echo: EchoInstance): ResonatorRuntimeState {
  const gameData = getGameData()
  const controls = { ...runtime.state.controls }

  for (const state of listSourceStates(gameData, { type: 'echo', id: echo.id })) {
    if (state.kind === 'toggle') {
      // toggle effects are treated as enabled when the echo is selected as main
      controls[state.controlKey] = true
    } else if (state.kind === 'stack' || state.kind === 'number') {
      // stack/number controls are pushed to max so main-echo rows represent full effect contribution
      if (typeof state.max === 'number') {
        controls[state.controlKey] = state.max
      }
    } else if (state.kind === 'select') {
      // select controls use default option if present, otherwise first option
      const value = state.defaultValue ?? state.options?.[0]?.id
      if (value != null) {
        controls[state.controlKey] = value
      }
    }
  }

  return {
    ...runtime,
    build: {
      ...runtime.build,
      // keep only this echo in slot 0 and mark it as the main echo
      echoes: [{ ...echo, mainEcho: true }, null, null, null, null],
    },
    state: {
      ...runtime.state,
      controls,
    },
  }
}

// encode raw inventory echo rows for optimizer search
// only self mode currently injects stats because ally mode is for bonus-only contexts
// sets, costs, and kinds are still recorded in both modes.
export function encodeEchoRows(
    echoes: EchoInstance[],
    _selectedSkill: OptimizerTargetSkill,
    mode: TargetScopeMode = 'self',
): EncodedEchoRows {
  const stats = new Float32Array(echoes.length * STATS_PER_ECHO)
  const sets = new Uint8Array(echoes.length)
  const costs = new Uint8Array(echoes.length)

  for (let index = 0; index < echoes.length; index += 1) {
    const echo = echoes[index]
    const vector = stats.subarray(index * STATS_PER_ECHO, (index + 1) * STATS_PER_ECHO)

    if (mode === 'self') {
      // primary and secondary main stats are treated like normal row stats
      addEchoStat(vector, echo.mainStats.primary.key, echo.mainStats.primary.value)
      addEchoStat(vector, echo.mainStats.secondary.key, echo.mainStats.secondary.value)

      // all recognized substats are accumulated into the same vector
      for (const [key, value] of Object.entries(echo.substats)) {
        addEchoStat(vector, key, value)
      }
    }

    // set/cost metadata is always kept because combo generation and set logic need it
    sets[index] = echo.set
    costs[index] = getEchoById(echo.id)?.cost ?? 0
  }

  return {
    stats,
    sets,
    costs,
    kinds: buildKindIds(echoes),
    count: echoes.length,
  }
}

// build selected-skill-specific main echo bonus rows
// each row describes what choosing that echo as the main echo adds for that target skill
// row i corresponds to echo i in the input array.
export function buildMainEchoRows(options: {
  echoes: EchoInstance[]
  runtime: ResonatorRuntimeState
  sourceBaseStats: ResonatorBaseStats
  sourceFinalStats: FinalStats
  selectedSkill: OptimizerTargetSkill
  mode?: TargetScopeMode
}): Float32Array {
  const { echoes, runtime, sourceBaseStats, sourceFinalStats, selectedSkill, mode = 'self' } = options
  const out = new Float32Array(echoes.length * MAIN_BUFFS_PER_ECHO)
  const gameData = getGameData()

  // build team context once and reuse it for every echo row
  const teamMemberIds = Array.from(new Set([runtime.id, ...runtime.build.team.filter((id): id is string => Boolean(id))]))
  const team = buildTeamCompositionInfo(teamMemberIds)

  for (let index = 0; index < echoes.length; index += 1) {
    const echo = echoes[index]

    // simulate this echo being equipped as the current main echo
    const sourceRuntime = buildMainEchoRuntime(runtime, echo)

    // only runtime-triggered echo effects can affect main-echo rows here
    const effects = listSourceEffects(gameData, { type: 'echo', id: echo.id }, 'runtime')
    if (effects.length === 0) {
      continue
    }

    // this scope mirrors the data-driven effect evaluation environment
    const scopeBase: EffectEvalScope = {
      sourceRuntime,
      targetRuntime: sourceRuntime,
      activeRuntime: runtime,
      context: {
        source: { type: 'echo', id: echo.id },
        sourceRuntime,
        targetRuntime: sourceRuntime,
        activeRuntime: runtime,
        targetRuntimeId: sourceRuntime.id,
        activeResonatorId: runtime.id,
        teamMemberIds,
        team,
        echoSetCounts: {},
        baseStats: sourceBaseStats,
        finalStats: sourceFinalStats,
        sourceFinalStats,
        enemy: undefined,
      },
      baseStats: sourceBaseStats,
      finalStats: sourceFinalStats,
      sourceFinalStats,
    }

    const vector = out.subarray(index * MAIN_BUFFS_PER_ECHO, (index + 1) * MAIN_BUFFS_PER_ECHO)

    for (const effect of effects) {
      // skip effects that do not target the requested optimizer scope
      if (!shouldApplyToTargetScope(effect.targetScope, mode)) {
        continue
      }

      // skip effects whose runtime condition is not satisfied
      if (!evaluateCondition(effect.condition, scopeBase)) {
        continue
      }

      // evaluate every operation and project its contribution into the compact main row
      for (const operation of effect.operations) {
        const value = evaluateFormula(operation.value, scopeBase)
        addMainOperation(vector, operation, value, selectedSkill)
      }
    }
  }

  return out
}

// build generic main echo rows used when the optimizer is not tied to one exact skill shape
// this is broader and more approximate than buildMainEchoRows because it does not filter
// through one selected skill identity.
export function buildGenericMainEchoRows(options: {
  echoes: EchoInstance[]
  runtime: ResonatorRuntimeState
  sourceBaseStats: ResonatorBaseStats
  sourceFinalStats: FinalStats
  mode?: TargetScopeMode
}): Float32Array {
  const { echoes, runtime, sourceBaseStats, sourceFinalStats, mode = 'self' } = options
  const out = new Float32Array(echoes.length * MAIN_BUFFS_PER_ECHO)
  const gameData = getGameData()

  // shared team metadata reused across all rows
  const teamMemberIds = Array.from(new Set([runtime.id, ...runtime.build.team.filter((id): id is string => Boolean(id))]))
  const team = buildTeamCompositionInfo(teamMemberIds)

  for (let index = 0; index < echoes.length; index += 1) {
    const echo = echoes[index]
    const sourceRuntime = buildMainEchoRuntime(runtime, echo)
    const effects = listSourceEffects(gameData, { type: 'echo', id: echo.id }, 'runtime')

    if (effects.length === 0) {
      continue
    }

    const scopeBase: EffectEvalScope = {
      sourceRuntime,
      targetRuntime: sourceRuntime,
      activeRuntime: runtime,
      context: {
        source: { type: 'echo', id: echo.id },
        sourceRuntime,
        targetRuntime: sourceRuntime,
        activeRuntime: runtime,
        targetRuntimeId: sourceRuntime.id,
        activeResonatorId: runtime.id,
        teamMemberIds,
        team,
        echoSetCounts: {},
        baseStats: sourceBaseStats,
        finalStats: sourceFinalStats,
        sourceFinalStats,
        enemy: undefined,
      },
      baseStats: sourceBaseStats,
      finalStats: sourceFinalStats,
      sourceFinalStats,
    }

    const vector = out.subarray(index * MAIN_BUFFS_PER_ECHO, (index + 1) * MAIN_BUFFS_PER_ECHO)

    for (const effect of effects) {
      if (!shouldApplyToTargetScope(effect.targetScope, mode)) {
        continue
      }

      if (!evaluateCondition(effect.condition, scopeBase)) {
        continue
      }

      // generic builder writes to broader buckets without one exact selected skill
      for (const operation of effect.operations) {
        const value = evaluateFormula(operation.value, scopeBase)
        addGenericMainOperation(vector, operation, value)
      }
    }
  }

  return out
}