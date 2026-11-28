/*
  Author: Runor Ewhro
  description: encodes optimizer echo rows and builds per-echo main-echo
               bonus rows by evaluating echo runtime effects against either
               a selected target skill or a generic skill-type/element map.
*/

import { ECHO_STAT, MAIN_BUFF } from '@/engine/search/layout/echoLayout'
import { optimizerFloats } from '@/engine/search/layout/buffers'
import { getGameData } from '@/data/gameData'
import { makeTeamComp } from '@/engine/gameData/teamComposition.ts'
import { listEffects, listSrcStts } from '@/data/gameData/registry.ts'
import type { EffectScope, EffectOp } from '@/domain/gameData/contracts.ts'
import type { EchoInstance, ResRuntime } from '@/domain/entities/runtime.ts'
import type { AttributeKey, FinalStats, ResBaseStats, SkillTypeKey } from '@/domain/entities/stats.ts'
import { getEchoById } from '@/data/catalog/echoCatalogService.ts'
import { getEchoSetDe } from '@/data/gameData/echoSets/effects'
import { evalCond, evalForm } from '@/engine/effects/evaluator.ts'
import { countEchoSets } from '@/engine/pipeline/buildCombatContext.ts'
import { ECHO_STAT_STRIDE, MAIN_BUFF_LEN } from '@/engine/search/layout/constants.ts'
import type { OptTargetSkill } from '@/engine/search/context/selectedSkill.ts'

export type TgtScpMode = 'self' | 'ally'

// compact main-echo rows are added to the searched resonator's own damage; team-scoped effects for other recipients
// are evaluated by the full rotation damage plan, which resolves active/activeOther routes at each damage event
function targetsSearchedRuntime(targetScope: string | undefined): boolean {
  return !targetScope
    || targetScope === 'self'
    || targetScope === 'active'
    || targetScope === 'teamWide'
}

export interface EncEchoRows {
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

type MainStatVctr = Float32Array


// assign a stable "kind" id per echo id so duplicate echoes can be identified cheaply
// two rows with the same echo id get the same kind id
function buildKindIds(echoes: EchoInstance[]): Uint16Array {
  const out = new Uint16Array(echoes.length)
  const byEchoId = new Map<string, number>()
  const nextKind = new Map<number, number>()

  for (let index = 0; index < echoes.length; index += 1) {
    const echoId = echoes[index]?.id ?? ''
    const set = echoes[index]?.set ?? 0
    const key = `${set}:${echoId}`
    let kind = byEchoId.get(key)

    // kinds are numbered within their set: the cpu counts set pieces with a
    // 32-bit kind mask per set, so inventory-wide ids would alias past 31
    if (kind == null) {
      kind = nextKind.get(set) ?? 0
      nextKind.set(set, kind + 1)
      byEchoId.set(key, kind)
    }

    out[index] = kind
  }

  return out
}

// add one main stat or substat into the encoded per-echo stat vector
// only keys used by the optimizer vector layout are recognized here
export function addEchoStat(vector: Float32Array, statKey: string, value: number): void {
  if (!value || !Object.hasOwn(ECHO_STAT, statKey)) return
  vector[ECHO_STAT[statKey as keyof typeof ECHO_STAT]]! += value
}

// check whether an attribute-scoped effect can apply to the selected skill
// 'all' always matches, otherwise the effect attribute must match the selected element
function ttrbMtchSel(
    selectedSkill: OptTargetSkill,
    attribute: AttributeKey | 'all' | Array<AttributeKey | 'all'>,
): boolean {
  const list = Array.isArray(attribute) ? attribute : [attribute]
  return list.includes('all') || list.includes(selectedSkill.element)
}

// check whether a skill-type-scoped effect can apply to the selected skill
// 'all' matches any selected skill type
function skllTypeMtch(
    selectedSkill: OptTargetSkill,
    skillType: SkillTypeKey | SkillTypeKey[],
): boolean {
  const list = Array.isArray(skillType) ? skillType : [skillType]
  return list.some((type) => type === 'all' || selectedSkill.skillType.includes(type))
}

// enforce skill id / skill type / tab matching for skill-specific effect operations
// if no match block exists, the operation is considered globally applicable
function opMtchSkll(operation: EffectOp, selectedSkill: OptTargetSkill): boolean {
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

  if (operation.match.elements && !operation.match.elements.includes(selectedSkill.element)) {
    return false
  }

  if (
      operation.match.labelIncludes &&
      !operation.match.labelIncludes.some((label) => selectedSkill.label.includes(label))
  ) {
    return false
  }

  return true
}

// convert one evaluated effect operation into the selected-skill-specific main bonus vector
// only bonuses that affect the chosen target skill are written
function addMainOp(
    vector: Float32Array,
    operation: EffectOp,
    value: number,
    selectedSkill: OptTargetSkill,
): void {
  if (!value) {
    return
  }

  // only atk base-stat contributions apply from add_base_stat
  // the main-Echo row format excludes hp and def
  if (operation.type === 'add_base_stat') {
    if (operation.stat === 'atk' && operation.field === 'percent') {
      vector[MAIN_BUFF.atkPercent] += value
    } else if (operation.stat === 'atk' && operation.field === 'flat') {
      vector[MAIN_BUFF.atkFlat] += value
    }
    return
  }

  // apply every supported top stat to the main buff vector, including cr/cd, dmgBonus, and energyRegen
  if (operation.type === 'add_top_stat') {
    if (operation.stat === 'energyRegen') {
      vector[MAIN_BUFF.energyRegen] += value
    } else if (operation.stat === 'critRate') {
      vector[MAIN_BUFF.critRate] += value
    } else if (operation.stat === 'critDmg') {
      vector[MAIN_BUFF.critDmg] += value
    } else if (operation.stat === 'dmgBonus') {
      vector[MAIN_BUFF.dmgBonus] += value
    }
    return
  }

  // attribute dmg bonus only applies if the selected skill matches the attribute
  if (operation.type === 'add_attribute_mod') {
    if (!ttrbMtchSel(selectedSkill, operation.attribute) || operation.mod !== 'dmgBonus') {
      return
    }

    switch (selectedSkill.element) {
      case 'aero':
        vector[MAIN_BUFF.aero] += value
        return
      case 'glacio':
        vector[MAIN_BUFF.glacio] += value
        return
      case 'fusion':
        vector[MAIN_BUFF.fusion] += value
        return
      case 'spectro':
        vector[MAIN_BUFF.spectro] += value
        return
      case 'havoc':
        vector[MAIN_BUFF.havoc] += value
        return
      case 'electro':
        vector[MAIN_BUFF.electro] += value
        return
      default:
        return
    }
  }

  // skill-type dmg bonus only contributes to matching buckets
  // one operation contributes to several buckets when it names several skill types
  if (operation.type === 'add_skilltype_mod') {
    if (!skllTypeMtch(selectedSkill, operation.skillType) || operation.mod !== 'dmgBonus') {
      return
    }

    const list = Array.isArray(operation.skillType) ? operation.skillType : [operation.skillType]
    for (const type of list) {
      switch (type) {
        case 'basicAtk':
          if (selectedSkill.skillType.includes(type)) vector[MAIN_BUFF.basicAtk] += value
          break
        case 'heavyAtk':
          if (selectedSkill.skillType.includes(type)) vector[MAIN_BUFF.heavyAtk] += value
          break
        case 'resonanceSkill':
          if (selectedSkill.skillType.includes(type)) vector[MAIN_BUFF.resonanceSkill] += value
          break
        case 'resonanceLiberation':
          if (selectedSkill.skillType.includes(type)) vector[MAIN_BUFF.resonanceLiberation] += value
          break
        case 'echoSkill':
          if (selectedSkill.skillType.includes(type)) vector[MAIN_BUFF.echoSkill] += value
          break
        case 'coord':
          if (selectedSkill.skillType.includes(type)) vector[MAIN_BUFF.coord] += value
          break
        default:
          break
      }
    }
    return
  }

  // skill-scoped dmg bonus fans out into the actual selected skill's buckets
  // used when the effect gives a dmg bonus to a matching skill
  if (operation.type === 'add_skill_mod') {
    if (!opMtchSkll(operation, selectedSkill) || operation.mod !== 'dmgBonus') {
      return
    }

    if (selectedSkill.skillType.includes('basicAtk')) vector[MAIN_BUFF.basicAtk] += value
    if (selectedSkill.skillType.includes('heavyAtk')) vector[MAIN_BUFF.heavyAtk] += value
    if (selectedSkill.skillType.includes('resonanceSkill')) vector[MAIN_BUFF.resonanceSkill] += value
    if (selectedSkill.skillType.includes('resonanceLiberation')) vector[MAIN_BUFF.resonanceLiberation] += value
    if (selectedSkill.skillType.includes('echoSkill')) vector[MAIN_BUFF.echoSkill] += value
    if (selectedSkill.skillType.includes('coord')) vector[MAIN_BUFF.coord] += value
  }
}

// add a generic attribute bucket when no single specific skill is targeted
// broader than addMainOperation because it does not filter to one selected element
function addMainElemV(vector: MainStatVctr, attribute: AttributeKey | 'all', value: number): void {
  switch (attribute) {
    case 'all':
      vector[MAIN_BUFF.aero] += value
      vector[MAIN_BUFF.glacio] += value
      vector[MAIN_BUFF.fusion] += value
      vector[MAIN_BUFF.spectro] += value
      vector[MAIN_BUFF.havoc] += value
      vector[MAIN_BUFF.electro] += value
      return
    case 'aero':
      vector[MAIN_BUFF.aero] += value
      return
    case 'glacio':
      vector[MAIN_BUFF.glacio] += value
      return
    case 'fusion':
      vector[MAIN_BUFF.fusion] += value
      return
    case 'spectro':
      vector[MAIN_BUFF.spectro] += value
      return
    case 'havoc':
      vector[MAIN_BUFF.havoc] += value
      return
    case 'electro':
      vector[MAIN_BUFF.electro] += value
      return
    default:
      return
  }
}

// add a generic skill-type bucket when no single specific skill is targeted
// 'all' duplicates the bonus into every supported skill bucket
function addMainSkllT(vector: MainStatVctr, type: SkillTypeKey | 'all', value: number): void {
  switch (type) {
    case 'all':
      vector[MAIN_BUFF.basicAtk] += value
      vector[MAIN_BUFF.heavyAtk] += value
      vector[MAIN_BUFF.resonanceSkill] += value
      vector[MAIN_BUFF.resonanceLiberation] += value
      vector[MAIN_BUFF.echoSkill] += value
      vector[MAIN_BUFF.coord] += value
      return
    case 'basicAtk':
      vector[MAIN_BUFF.basicAtk] += value
      return
    case 'heavyAtk':
      vector[MAIN_BUFF.heavyAtk] += value
      return
    case 'resonanceSkill':
      vector[MAIN_BUFF.resonanceSkill] += value
      return
    case 'resonanceLiberation':
      vector[MAIN_BUFF.resonanceLiberation] += value
      return
    case 'echoSkill':
      vector[MAIN_BUFF.echoSkill] += value
      return
    case 'coord':
      vector[MAIN_BUFF.coord] += value
      return
    default:
      return
  }
}

// infer affected generic skill-type buckets from skill match metadata
// used by the generic builder when there is no concrete selected skill
function inferGnrcSkl(operation: EffectOp): Array<SkillTypeKey | 'all'> {
  const inferred = new Set<SkillTypeKey | 'all'>()

  // direct skillTypes match block is the strongest hint
  if ('match' in operation && operation.match?.skillTypes) {
    for (const type of operation.match.skillTypes) {
      inferred.add(type)
    }
  }

  // tabs can map into optimizer skill buckets
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

  // echo:* skill ids are the fallback hint
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
function addGnrcMainO(
    vector: MainStatVctr,
    operation: EffectOp,
    value: number,
): void {
  if (!value) {
    return
  }

  // generic rows model only atk-related base-stat additions
  if (operation.type === 'add_base_stat') {
    if (operation.stat === 'atk' && operation.field === 'percent') {
      vector[MAIN_BUFF.atkPercent] += value
    } else if (operation.stat === 'atk' && operation.field === 'flat') {
      vector[MAIN_BUFF.atkFlat] += value
    }
    return
  }

  // generic counterpart of the targeted-skill top-stat router above, with the same slot types
  if (operation.type === 'add_top_stat') {
    if (operation.stat === 'energyRegen') {
      vector[MAIN_BUFF.energyRegen] += value
    } else if (operation.stat === 'critRate') {
      vector[MAIN_BUFF.critRate] += value
    } else if (operation.stat === 'critDmg') {
      vector[MAIN_BUFF.critDmg] += value
    } else if (operation.stat === 'dmgBonus') {
      vector[MAIN_BUFF.dmgBonus] += value
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
      addMainElemV(vector, attribute, value)
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
      addMainSkllT(vector, type, value)
    }
    return
  }

  // for skill-level dmgBonus, infer likely affected buckets
  if (operation.type === 'add_skill_mod' && operation.mod === 'dmgBonus') {
    for (const type of inferGnrcSkl(operation)) {
      addMainSkllT(vector, type, value)
    }
  }
}

// build a temporary runtime where this echo is equipped as the sole main echo
// and its states are on/maxed, so effect evaluation reflects "main echo active"
// and the echo's own data-driven passive effects are evaluated in isolation
function mkMainEchoRt(runtime: ResRuntime, echo: EchoInstance): ResRuntime {
  const gameData = getGameData()
  const controls = { ...runtime.state.controls }

  for (const state of listSrcStts(gameData, { type: 'echo', id: echo.id })) {
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
// only self mode injects stats because ally mode is for bonus-only contexts
// sets, costs, and kinds are recorded in both modes
export function encEchoRows(
    echoes: EchoInstance[],
    _slct: OptTargetSkill,
    mode: TgtScpMode = 'self',
): EncEchoRows {
  const stats = optimizerFloats(echoes.length * ECHO_STAT_STRIDE)
  const sets = new Uint8Array(echoes.length)
  const costs = new Uint8Array(echoes.length)

  for (let index = 0; index < echoes.length; index += 1) {
    const echo = echoes[index]
    const vector = stats.subarray(index * ECHO_STAT_STRIDE, (index + 1) * ECHO_STAT_STRIDE)

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
    // unknown sets contribute no effects, and an unknown id is never truncated into a supported Sonata's byte
    sets[index] = getEchoSetDe(echo.set) && echo.set > 0 && echo.set <= 255 ? echo.set : 0
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
// row i corresponds to echo i in the input array
export function mkMainEchoRo(options: {
  echoes: EchoInstance[]
  runtime: ResRuntime
  sourceBaseStats: ResBaseStats
  sourceFinals: FinalStats
  selectedSkill: OptTargetSkill
}): Float32Array {
  const { echoes, runtime, sourceBaseStats: srcBaseStats, sourceFinals: srcFnlStats, selectedSkill: selectedSkill } = options
  const out = optimizerFloats(echoes.length * MAIN_BUFF_LEN)
  const gameData = getGameData()

  // build team context once and reuse it for every echo row
  const teamMemIds = Array.from(new Set([runtime.id, ...runtime.build.team.filter((id): id is string => Boolean(id))]))
  const team = makeTeamComp(teamMemIds)

  for (let index = 0; index < echoes.length; index += 1) {
    const echo = echoes[index]

    // simulate this echo being equipped as the current main echo
    const srcRt = mkMainEchoRt(runtime, echo)
    const echoSetCounts = countEchoSets(srcRt.build.echoes)

    // only runtime-triggered echo effects can affect main-echo rows here
    const effects = listEffects(gameData, { type: 'echo', id: echo.id }, 'runtime')
    if (effects.length === 0) {
      continue
    }

    // this scope mirrors the data-driven effect evaluation environment
    const scopeBase: EffectScope = {
      sourceRuntime: srcRt,
      targetRuntime: srcRt,
      activeRuntime: runtime,
      context: {
        source: { type: 'echo', id: echo.id },
        sourceRuntime: srcRt,
        targetRuntime: srcRt,
        activeRuntime: runtime,
        targetRuntimeId: srcRt.id,
        activeResonatorId: runtime.id,
        teamMemberIds: teamMemIds,
        team,
        echoSetCounts,
        baseStats: srcBaseStats,
        finalStats: srcFnlStats,
        sourceFinalStats: srcFnlStats,
        enemy: undefined,
      },
      baseStats: srcBaseStats,
      finalStats: srcFnlStats,
      sourceFinalStats: srcFnlStats,
    }

    const vector = out.subarray(index * MAIN_BUFF_LEN, (index + 1) * MAIN_BUFF_LEN)

    for (const effect of effects) {
      if (!targetsSearchedRuntime(effect.targetScope)) {
        continue
      }

      // skip effects whose runtime condition is not satisfied
      if (!evalCond(effect.condition, scopeBase)) {
        continue
      }

      // evaluate every operation and project its contribution into the compact main row
      for (const operation of effect.operations) {
        if (operation.type === 'add_immunity') {
          continue
        }
        const value = evalForm(operation.value, scopeBase)
        addMainOp(vector, operation, value, selectedSkill)
      }
    }
  }

  return out
}

// build generic main echo rows used when the optimizer is not tied to one exact skill shape
// broader and more approximate than buildMainEchoRows because it does not filter through one selected skill identity
export function mkGnrcMainEc(options: {
  echoes: EchoInstance[]
  runtime: ResRuntime
  sourceBaseStats: ResBaseStats
  sourceFinals: FinalStats
}): Float32Array {
  const { echoes, runtime, sourceBaseStats: srcBaseStats, sourceFinals: srcFnlStats } = options
  const out = optimizerFloats(echoes.length * MAIN_BUFF_LEN)
  const gameData = getGameData()

  // shared team metadata reused across all rows
  const teamMemIds = Array.from(new Set([runtime.id, ...runtime.build.team.filter((id): id is string => Boolean(id))]))
  const team = makeTeamComp(teamMemIds)

  for (let index = 0; index < echoes.length; index += 1) {
    const echo = echoes[index]
    const srcRt = mkMainEchoRt(runtime, echo)
    const echoSetCounts = countEchoSets(srcRt.build.echoes)
    const effects = listEffects(gameData, { type: 'echo', id: echo.id }, 'runtime')

    if (effects.length === 0) {
      continue
    }

    const scopeBase: EffectScope = {
      sourceRuntime: srcRt,
      targetRuntime: srcRt,
      activeRuntime: runtime,
      context: {
        source: { type: 'echo', id: echo.id },
        sourceRuntime: srcRt,
        targetRuntime: srcRt,
        activeRuntime: runtime,
        targetRuntimeId: srcRt.id,
        activeResonatorId: runtime.id,
        teamMemberIds: teamMemIds,
        team,
        echoSetCounts,
        baseStats: srcBaseStats,
        finalStats: srcFnlStats,
        sourceFinalStats: srcFnlStats,
        enemy: undefined,
      },
      baseStats: srcBaseStats,
      finalStats: srcFnlStats,
      sourceFinalStats: srcFnlStats,
    }

    const vector = out.subarray(index * MAIN_BUFF_LEN, (index + 1) * MAIN_BUFF_LEN)

    for (const effect of effects) {
      if (!targetsSearchedRuntime(effect.targetScope)) {
        continue
      }

      if (!evalCond(effect.condition, scopeBase)) {
        continue
      }

      // generic builder writes to broader buckets without one exact selected skill
      for (const operation of effect.operations) {
        if (operation.type === 'add_immunity') {
          continue
        }
        const value = evalForm(operation.value, scopeBase)
        addGnrcMainO(vector, operation, value)
      }
    }
  }

  return out
}
