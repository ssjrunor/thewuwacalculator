/*
  Author: Runor Ewhro
  Description: builds the optimizer's precomputed set lookup table and
               resolves encoded set effects from compact set counts during
               optimizer evaluation.
*/

import { ECHO_SET_DEFS } from '@/data/gameData/echoSets/effects'
import {
  getCompactSonataSetPart,
  isCompactSonataSetConditionals,
  type SonataSetConditionals,
} from '@/domain/entities/sonataSetConditionals.ts'
import type { ResonatorRuntimeState } from '@/domain/entities/runtime.ts'

// hard limit for set ids that can be encoded in optimizer buffers
export const SET_CONST_LUT_SET_SLOTS = 32

// number of piece-count buckets stored per set:
// 0-piece, 2-piece, 3-piece, and 5-piece style buckets
export const SET_CONST_LUT_COUNT_BUCKETS = 4

// bucket thresholds by bucket index
// bucket 0 -> 0 pieces
// bucket 1 -> 2+ pieces
// bucket 2 -> 3+ pieces
// bucket 3 -> 5+ pieces
export const SET_CONST_LUT_BUCKET_THRESHOLDS = Object.freeze([0, 2, 3, 5])

// flattened stat layout for one set-lut row
// each row stores the accumulated contribution of one set for one bucket
export const SET_CONST_LUT_STATS = Object.freeze([
  'atkP',
  'atkF',
  'hpP',
  'hpF',
  'defP',
  'defF',
  'critRate',
  'critDmg',
  'er',
  'basic',
  'heavy',
  'skill',
  'lib',
  'aero',
  'spectro',
  'fusion',
  'glacio',
  'havoc',
  'electro',
  'echoSkill',
  'coord',
  'bonusBase',
  'erSetBonus',
])

// number of floats in one row
export const SET_CONST_LUT_ROW_STRIDE = SET_CONST_LUT_STATS.length

// total size of the flattened lookup table
export const SET_CONST_LUT_SIZE =
    SET_CONST_LUT_SET_SLOTS * SET_CONST_LUT_COUNT_BUCKETS * SET_CONST_LUT_ROW_STRIDE

// reverse lookup from stat name to column index inside one lut row
const STAT_INDEX = Object.fromEntries(
    SET_CONST_LUT_STATS.map((stat, index) => [stat, index]),
) as Record<string, number>

// map effect-operation paths into optimizer lut stat columns
// only paths present here are encoded into the lut
const LUT_PATH_TO_STAT: Record<string, string> = Object.freeze({
  'atk|percent': 'atkP',
  'atk|flat': 'atkF',
  'hp|percent': 'hpP',
  'hp|flat': 'hpF',
  'def|percent': 'defP',
  'def|flat': 'defF',
  critRate: 'critRate',
  critDmg: 'critDmg',
  energyRegen: 'erSetBonus',
  'skillType|basicAtk|dmgBonus': 'basic',
  'skillType|heavyAtk|dmgBonus': 'heavy',
  'skillType|resonanceSkill|dmgBonus': 'skill',
  'skillType|resonanceLiberation|dmgBonus': 'lib',
  'skillType|echoSkill|dmgBonus': 'echoSkill',
  'skillType|coord|dmgBonus': 'coord',
  'attribute|aero|dmgBonus': 'aero',
  'attribute|spectro|dmgBonus': 'spectro',
  'attribute|fusion|dmgBonus': 'fusion',
  'attribute|glacio|dmgBonus': 'glacio',
  'attribute|havoc|dmgBonus': 'havoc',
  'attribute|electro|dmgBonus': 'electro',
})

// runtime toggle bits for special stateful set effects that cannot be
// represented purely as static piece-count rows
export const SET_RUNTIME_TOGGLE_SET14_FIVE = 1 << 0
export const SET_RUNTIME_TOGGLE_SET22_P1 = 1 << 1
export const SET_RUNTIME_TOGGLE_SET22_P2 = 1 << 2
export const SET_RUNTIME_TOGGLE_SET29_FIVE = 1 << 3

// convenience mask containing every supported runtime toggle bit
export const SET_RUNTIME_TOGGLE_ALL =
    SET_RUNTIME_TOGGLE_SET14_FIVE |
    SET_RUNTIME_TOGGLE_SET22_P1 |
    SET_RUNTIME_TOGGLE_SET22_P2 |
    SET_RUNTIME_TOGGLE_SET29_FIVE

// normalized rule extracted from set definitions or override data
type SetRule = {
  minPieces: number
  partKey?: string
} & Record<string, number | string | undefined>

type SetDef = (typeof ECHO_SET_DEFS)[number]

// manual overrides for set definitions whose runtime behavior cannot be
// taken directly from the generic builder logic
const SET_CONST_RULE_OVERRIDES: Record<number, readonly SetRule[]> = Object.freeze({
  22: Object.freeze([
    Object.freeze({ minPieces: 3, partKey: 'flamewingsShadow2pcP1', fusion: 16 }),
  ]),
  23: Object.freeze([
    Object.freeze({ minPieces: 3, partKey: 'threadOfSeveredFate3pc', atkP: 20, lib: 30 }),
  ]),
})

// cached derived rules so the lut does not need to be rebuilt from definitions every time
let cachedRulesBySet: SetRule[][] | null = null

type SetDataLookup =
  | {
    mode: 'compact'
    compact: SonataSetConditionals
  }
  | {
    mode: 'none'
  }

// only include target scopes that matter for optimizer self-side packed set rows
function shouldIncludeEntryTargetScope(targetScope?: string): boolean {
  return !targetScope || targetScope === 'self' || targetScope === 'teamWide' || targetScope === 'active'
}

// convert a data-definition path array into a lut stat key
function getLutStatForPath(path: string[]): string | null {
  return LUT_PATH_TO_STAT[path.join('|')] ?? null
}

// determine the piece requirement for one set definition part
function getPartMinPieces(def: SetDef, partKey: string): number {
  if (partKey === 'twoPiece') return 2
  if (partKey === 'fivePiece') return 5

  // custom state parts use the set's max-piece trigger convention
  return def.setMax === 3 ? 3 : 5
}

// fetch the raw entries associated with one set part
// this abstracts over twoPiece, fivePiece, and state-backed parts
function getPartEntries(def: SetDef, partKey: string) {
  if (partKey === 'twoPiece') {
    return Array.isArray(def.twoPiece) ? def.twoPiece : []
  }

  if (partKey === 'fivePiece') {
    return Array.isArray(def.fivePiece) ? def.fivePiece : []
  }

  const state = def.states?.[partKey as keyof typeof def.states]
  if (!state) {
    return []
  }

  // prefer max values if present because optimizer rows want the final triggered contribution
  if (Array.isArray(state.max) && state.max.length > 0) {
    return state.max
  }

  if (Array.isArray(state.perStack) && state.perStack.length > 0) {
    return state.perStack
  }

  return []
}

// derive one optimizer rule from a named set part
function buildRuleFromPart(def: SetDef, partKey: string): SetRule | null {
  const entries = getPartEntries(def, partKey)
  if (!entries.length) {
    return null
  }

  const rule: SetRule = {
    minPieces: getPartMinPieces(def, partKey),
    partKey,
  }

  let hasMappedStat = false

  for (const entry of entries) {
    // ignore ally-only or unsupported target scopes
    if (!shouldIncludeEntryTargetScope(entry.targetScope)) {
      continue
    }

    // only pack entries whose paths are supported by LUT_PATH_TO_STAT
    const stat = getLutStatForPath(entry.path)
    if (!stat) {
      continue
    }

    const value = Number(entry.value)
    if (!Number.isFinite(value)) {
      continue
    }

    // multiple entries can accumulate into the same packed stat
    rule[stat] = Number(rule[stat] ?? 0) + value
    hasMappedStat = true
  }

  return hasMappedStat ? Object.freeze(rule) : null
}

// merge auto-derived rules with any manual overrides
// override partKey replaces existing rule with same partKey, otherwise it is appended
function mergeRulesWithOverrides(derivedRules: SetRule[], overrideRules?: readonly SetRule[]): SetRule[] {
  if (!overrideRules || overrideRules.length === 0) {
    return derivedRules
  }

  const merged = [...derivedRules]

  for (const override of overrideRules) {
    const existingIndex = merged.findIndex((rule) => rule.partKey === override.partKey)
    if (existingIndex >= 0) {
      merged[existingIndex] = override
    } else {
      merged.push(override)
    }
  }

  return merged
}

function createSetDataLookup(setData?: SonataSetConditionals): SetDataLookup {
  if (!setData || !isCompactSonataSetConditionals(setData)) {
    return { mode: 'none' }
  }

  return {
    mode: 'compact',
    compact: setData,
  }
}

function isSetPartEnabled(setDataLookup: SetDataLookup, setId: number, partKey?: string): boolean {
  if (!partKey || setDataLookup.mode === 'none') {
    return true
  }

  return getCompactSonataSetPart(setDataLookup.compact, setId, partKey, false)
}

// derive rule lists for every set id once and cache them
function buildRulesBySet(): SetRule[][] {
  if (cachedRulesBySet) {
    return cachedRulesBySet
  }

  const rulesBySet = Array.from({ length: SET_CONST_LUT_SET_SLOTS }, () => [] as SetRule[])

  for (const def of ECHO_SET_DEFS) {
    const derivedRules: SetRule[] = []

    // standard 2-piece rule
    if (Array.isArray(def.twoPiece) && def.twoPiece.length > 0) {
      const rule = buildRuleFromPart(def, 'twoPiece')
      if (rule) derivedRules.push(rule)
    }

    // standard 5-piece rule
    if (Array.isArray(def.fivePiece) && def.fivePiece.length > 0) {
      const rule = buildRuleFromPart(def, 'fivePiece')
      if (rule) derivedRules.push(rule)
    }

    // stateful parts from def.states
    for (const stateId of Object.keys(def.states ?? {})) {
      const rule = buildRuleFromPart(def, stateId)
      if (rule) derivedRules.push(rule)
    }

    // final per-set rule list = derived rules + manual corrections
    rulesBySet[def.id] = mergeRulesWithOverrides(derivedRules, SET_CONST_RULE_OVERRIDES[def.id])
  }

  cachedRulesBySet = rulesBySet
  return rulesBySet
}

// build runtime mask used by the optimizer evaluator
export function buildSetRuntimeMask(
    _runtime: ResonatorRuntimeState,
    setConditionals?: SonataSetConditionals,
): number {
  void _runtime
  const setDataLookup = createSetDataLookup(setConditionals)
  let mask = 0

  if (isSetPartEnabled(setDataLookup, 14, 'fivePiece')) {
    mask |= SET_RUNTIME_TOGGLE_SET14_FIVE
  }
  if (isSetPartEnabled(setDataLookup, 22, 'flamewingsShadow2pcP1')) {
    mask |= SET_RUNTIME_TOGGLE_SET22_P1
  }
  if (isSetPartEnabled(setDataLookup, 22, 'flamewingsShadow2pcP2')) {
    mask |= SET_RUNTIME_TOGGLE_SET22_P2
  }
  if (isSetPartEnabled(setDataLookup, 29, 'soundOfTrueName5pc')) {
    mask |= SET_RUNTIME_TOGGLE_SET29_FIVE
  }

  return mask >>> 0
}

// map a raw piece count into one of the four lut buckets
// returns:
// 0 for <2
// 1 for 2+
// 2 for 3+
// 3 for 5+
export function getSetCountBucket(count: number): number {
  return ((count >= 2) ? 1 : 0) + ((count >= 3) ? 1 : 0) + ((count >= 5) ? 1 : 0)
}

// compute the flattened lut offset for one (set id, count bucket) pair
export function getSetRowOffset(setId: number, countBucket: number): number {
  return ((setId * SET_CONST_LUT_COUNT_BUCKETS + countBucket) * SET_CONST_LUT_ROW_STRIDE)
}

// build the full static set lookup table for optimizer use
// each row already includes the cumulative contribution of all rules whose minPieces
// requirement is satisfied by that bucket threshold.
export function buildSetRows(
    _runtime: ResonatorRuntimeState,
    setConditionals?: SonataSetConditionals,
): Float32Array {
  void _runtime
  const rulesBySet = buildRulesBySet()
  const setDataLookup = createSetDataLookup(setConditionals)
  const lut = new Float32Array(SET_CONST_LUT_SIZE)

  for (let setId = 0; setId < SET_CONST_LUT_SET_SLOTS; setId += 1) {
    const setRules = rulesBySet[setId]
    if (!Array.isArray(setRules) || setRules.length === 0) {
      continue
    }

    // bucket 0 intentionally stays empty because it represents "not enough pieces"
    for (let bucket = 1; bucket < SET_CONST_LUT_COUNT_BUCKETS; bucket += 1) {
      const thresholdCount = SET_CONST_LUT_BUCKET_THRESHOLDS[bucket]
      const base = getSetRowOffset(setId, bucket)

      for (const rule of setRules) {
        const minPieces = Number(rule.minPieces ?? 0)

        // if the current bucket does not satisfy this rule's trigger requirement, skip it
        if (thresholdCount < minPieces) {
          continue
        }

        if (!isSetPartEnabled(setDataLookup, setId, rule.partKey)) {
          continue
        }

        // accumulate every mapped stat column for this rule into the bucket row
        for (const [stat, rawValue] of Object.entries(rule)) {
          if (stat === 'minPieces' || stat === 'partKey') {
            continue
          }

          const statIndex = STAT_INDEX[stat]
          if (statIndex == null) {
            continue
          }

          const value = Number(rawValue)
          if (!Number.isFinite(value)) {
            continue
          }

          lut[base + statIndex] += value
        }
      }
    }
  }

  return lut
}

// resolve packed set effects at runtime from actual set counts and a skill mask
// this is used by the non-vectorized evaluator path where the result is needed
// as named fields rather than as a raw row vector.
export function applySetEffectsEncoded(
    setCount: Uint8Array,
    skillMask: number,
    setConstLut: Float32Array,
    setRuntimeMask: number,
): {
  atkP: number
  atkF: number
  hpP: number
  hpF: number
  defP: number
  defF: number
  critRate: number
  critDmg: number
  er: number
  erSetBonus: number
  basic: number
  heavy: number
  skill: number
  lib: number
  aero: number
  spectro: number
  fusion: number
  glacio: number
  havoc: number
  electro: number
  echoSkill: number
  coord: number
  bonusBase: number
} {
  // initialize all accumulated outputs
  let atkP = 0
  let atkF = 0
  let hpP = 0
  let hpF = 0
  let defP = 0
  let defF = 0
  let critRate = 0
  let critDmg = 0
  let er = 0
  let erSetBonus = 0
  let basic = 0
  let heavy = 0
  let skill = 0
  let lib = 0
  let aero = 0
  let spectro = 0
  let fusion = 0
  let glacio = 0
  let havoc = 0
  let electro = 0
  let echoSkill = 0
  let coord = 0
  let bonusBase = 0

  for (let setId = 0; setId < SET_CONST_LUT_SET_SLOTS; setId += 1) {
    const pieces = setCount[setId] | 0
    if (pieces < 2) {
      continue
    }

    const bucket = getSetCountBucket(pieces)
    if (bucket === 0) {
      continue
    }

    // fetch the precomputed row for this set and achieved bucket
    const base = getSetRowOffset(setId, bucket)

    // add every packed stat in-order
    atkP += setConstLut[base]
    atkF += setConstLut[base + 1]
    hpP += setConstLut[base + 2]
    hpF += setConstLut[base + 3]
    defP += setConstLut[base + 4]
    defF += setConstLut[base + 5]
    critRate += setConstLut[base + 6]
    critDmg += setConstLut[base + 7]
    er += setConstLut[base + 8]
    basic += setConstLut[base + 9]
    heavy += setConstLut[base + 10]
    skill += setConstLut[base + 11]
    lib += setConstLut[base + 12]
    aero += setConstLut[base + 13]
    spectro += setConstLut[base + 14]
    fusion += setConstLut[base + 15]
    glacio += setConstLut[base + 16]
    havoc += setConstLut[base + 17]
    electro += setConstLut[base + 18]
    echoSkill += setConstLut[base + 19]
    coord += setConstLut[base + 20]
    bonusBase += setConstLut[base + 21]
    erSetBonus += setConstLut[base + 22]
  }

  // decode skill-category flags from the supplied skill mask
  // bit usage here is specific to the optimizer's skill-mask convention
  const heavyTriggered = (skillMask & (1 << 1)) !== 0
  const echoTriggered = (skillMask & (1 << 6)) !== 0

  // set 22 has two conditional subparts depending on whether heavy or echo skill is being evaluated
  const set22EnabledForSkill =
      (heavyTriggered && ((setRuntimeMask & SET_RUNTIME_TOGGLE_SET22_P1) !== 0)) ||
      (echoTriggered && ((setRuntimeMask & SET_RUNTIME_TOGGLE_SET22_P2) !== 0))

  // set 29 bonus only applies for echo-skill evaluation when enabled by runtime mask
  const set29EnabledForSkill =
      echoTriggered && ((setRuntimeMask & SET_RUNTIME_TOGGLE_SET29_FIVE) !== 0)

  // apply runtime-gated bonuses that are not represented purely by static row accumulation
  if (setCount[22] >= 3 && set22EnabledForSkill) {
    critRate += 20
  }

  if (setCount[29] >= 5 && set29EnabledForSkill) {
    critRate += 20
  }

  return {
    atkP,
    atkF,
    hpP,
    hpF,
    defP,
    defF,
    critRate,
    critDmg,
    er,
    erSetBonus,
    basic,
    heavy,
    skill,
    lib,
    aero,
    spectro,
    fusion,
    glacio,
    havoc,
    electro,
    echoSkill,
    coord,
    bonusBase,
  }
}
