/*
  Author: Runor Ewhro
  Description: builds the optimizer's precomputed set lookup table and
               resolves encoded set effects from compact set counts during
               optimizer evaluation.
*/

import { ECHO_SET_DEFS, getEchoSetCn } from '@/data/gameData/echoSets/effects'
import {
  getSntSetOn,
  isSntSetCon,
  type SntSetConds,
} from '@/domain/entities/sonataSetConditionals.ts'
import type { ResRuntime } from '@/domain/entities/runtime.ts'

// hard limit for set ids that can be encoded in optimizer buffers
// must stay equal to SET_SLOT_COUNT and the shaders' SET_SLOTS (covers ids 0..35)
export const SETCNSTLUTSE = 36

// number of piece-count buckets stored per set:
// 0-piece, 1-piece, 2-piece, 3-piece, and 5-piece style buckets
export const SETCNSTLUTCN = 5

// bucket thresholds by bucket index
// bucket 0 -> 0 pieces
// bucket 1 -> 1+ pieces
// bucket 2 -> 2+ pieces
// bucket 3 -> 3+ pieces
// bucket 4 -> 5+ pieces
export const SETCNSTLUTBK = Object.freeze([0, 1, 2, 3, 5])

// flattened stat layout for one set-lut row
// each row stores the accumulated contribution of one set for one bucket
export const SETCNSTLUTST = Object.freeze([
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
export const SETCNSTLUTRO = SETCNSTLUTST.length

// total size of the flattened lookup table
export const SETCNSTLUTSI =
    SETCNSTLUTSE * SETCNSTLUTCN * SETCNSTLUTRO

// reverse lookup from stat name to column index inside one lut row
const STAT_INDEX = Object.fromEntries(
    SETCNSTLUTST.map((stat, index) => [stat, index]),
) as Record<string, number>

// map effect-operation paths into optimizer lut stat columns
// only paths present here are encoded into the lut
const LUTPATHTOSTA: Record<string, string> = Object.freeze({
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
export const SETRTTGLST14 = 1 << 0
export const SETRTTGLST22 = 1 << 1
export const SET_ROT_TOGGLES = 1 << 2
export const SETRTTGLST29 = 1 << 3
export const SETRTTGLST33 = 1 << 4

// convenience mask containing every supported runtime toggle bit
export const SETRTTGLALL =
    SETRTTGLST14 |
    SETRTTGLST22 |
    SET_ROT_TOGGLES |
    SETRTTGLST29 |
    SETRTTGLST33

// rule extracted from set definitions or override data
type SetRule = {
  minPieces: number
  partKey?: string
} & Record<string, number | string | undefined>

type SetDef = (typeof ECHO_SET_DEFS)[number]

export type DynamicSetStatePart = {
  setId: number
  partKey: string
}

export type BuildSetRowsOptions = {
  dynamicStateParts?: readonly DynamicSetStatePart[]
}

const ECHO_SET_STATE_CONTROL_RE = /^echoSet:(\d+):bonus:(.+)$/

// Runtime set controls are user-editable stateful set effects. The optimizer
// proper keeps using static maxed rows; callers that render live previews can
// opt into these parts so display-only damage reflects the current toggle.
export function listDynamicSetStateParts(runtime: ResRuntime): DynamicSetStatePart[] {
  const parts: DynamicSetStatePart[] = []

  for (const controlKey of Object.keys(runtime.state.controls)) {
    const match = ECHO_SET_STATE_CONTROL_RE.exec(controlKey)
    if (!match) {
      continue
    }

    const setId = Number(match[1])
    const partKey = match[2]
    if (!Number.isFinite(setId) || !partKey) {
      continue
    }

    const def = ECHO_SET_DEFS.find((entry) => entry.id === setId)
    if (!def?.states?.[partKey as keyof typeof def.states]) {
      continue
    }

    parts.push({ setId, partKey })
  }

  return parts
}

// manual overrides for set definitions whose runtime behavior cannot be
// taken directly from the generic builder logic
const SETCNSTRULEV: Record<number, readonly SetRule[]> = Object.freeze({
  22: Object.freeze([
    Object.freeze({ minPieces: 3, partKey: 'flamewingsShadow2pcP1', fusion: 16 }),
  ]),
  23: Object.freeze([
    Object.freeze({ minPieces: 3, partKey: 'threadOfSeveredFate3pc', atkP: 20, lib: 30 }),
  ]),
})

// cached derived rules so the lut does not need to be rebuilt from definitions every time
let cchdRlsBySet: SetRule[][] | null = null

type SetDataLkp =
  | {
    mode: 'conds'
    conds: SntSetConds
  }
  | {
    mode: 'none'
  }

// only include target scopes that matter for optimizer self-side packed set rows
function shldNcldEntT(targetScope?: string): boolean {
  return !targetScope || targetScope === 'self' || targetScope === 'teamWide' || targetScope === 'active'
}

// convert a data-definition path array into a lut stat key
function getLutStatFo(path: string[]): string | null {
  return LUTPATHTOSTA[path.join('|')] ?? null
}

function maxStateEntries(state: SetDef['states'][string]) {
  return [
    ...(Array.isArray(state.max) ? state.max : []),
    ...(Array.isArray(state.atMax) ? state.atMax : []),
  ]
}

// determine the piece requirement for one set definition part
function getPartMinPc(def: SetDef, partKey: string): number {
  if (partKey === 'onePiece') return 1
  if (partKey === 'twoPiece') return 2
  if (partKey === 'fivePiece') return 5

  // custom state parts use the set's max-piece trigger convention
  return def.setMax === 1 ? 1 : def.setMax === 3 ? 3 : 5
}

// fetch the raw entries associated with one set part
// this abstracts over twoPiece, fivePiece, and state-backed parts
function getPartEnts(def: SetDef, partKey: string) {
  if (partKey === 'onePiece') {
    return Array.isArray(def.onePiece) ? def.onePiece : []
  }

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

  // prefer max values because normal optimizer rows assume triggered set states
  // are maxed. Max-only bonuses are part of that static maxed contribution.
  const maxedEntries = maxStateEntries(state)
  if (maxedEntries.length > 0) {
    return maxedEntries
  }

  if (Array.isArray(state.perStep) && state.perStep.length > 0) {
    return state.perStep
  }

  if (Array.isArray(state.perStack) && state.perStack.length > 0) {
    return state.perStack
  }

  return []
}

function mkRuleFromEntries(
    def: SetDef,
    partKey: string,
    entries: Array<{ value: number; path: string[]; targetScope?: string }>,
): SetRule | null {
  if (!entries.length) {
    return null
  }

  const rule: SetRule = {
    minPieces: getPartMinPc(def, partKey),
    partKey,
  }

  let hasMppdStat = false

  for (const entry of entries) {
    // ignore ally-only or unsupported target scopes
    if (!shldNcldEntT(entry.targetScope)) {
      continue
    }

    // only pack entries whose paths are supported by LUT_PATH_TO_STAT
    const stat = getLutStatFo(entry.path)
    if (!stat) {
      continue
    }

    const value = Number(entry.value)
    if (!Number.isFinite(value)) {
      continue
    }

    // multiple entries can accumulate into the same packed stat
    rule[stat] = Number(rule[stat] ?? 0) + value
    hasMppdStat = true
  }

  return hasMppdStat ? Object.freeze(rule) : null
}

// derive one optimizer rule from a named set part
function mkRuleFromPa(def: SetDef, partKey: string): SetRule | null {
  return mkRuleFromEntries(def, partKey, getPartEnts(def, partKey))
}

function isSetCtrlOn(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) && value > 0
  if (typeof value === 'string') return value.length > 0
  return false
}

function setStateMaxVal(state: SetDef['states'][string]): number | boolean {
  const perStep = state.perStep ?? state.perStack ?? state.max
  const isToggle = perStep.every((step, index) => step.value === state.max[index].value)

  if (isToggle) {
    return true
  }

  return Math.round(
    Math.max(...perStep.map((step, index) => state.max[index].value / step.value)),
  )
}

function reqStateMet(
    def: SetDef,
    state: SetDef['states'][string],
    controls: ResRuntime['state']['controls'],
): boolean {
  if (!state.requiresMax) {
    return true
  }

  const required = def.states[state.requiresMax]
  if (!required) {
    return false
  }

  return controls[getEchoSetCn(def.id, state.requiresMax)] === setStateMaxVal(required)
}

function mkRuleFromStateCtrl(
    def: SetDef,
    partKey: string,
    controls: ResRuntime['state']['controls'],
): SetRule | null {
  const state = def.states?.[partKey as keyof typeof def.states]
  if (!state || !reqStateMet(def, state, controls)) {
    return null
  }

  const value = controls[getEchoSetCn(def.id, partKey)]
  if (!isSetCtrlOn(value)) {
    return null
  }

  const perStep = state.perStep ?? state.perStack ?? state.max
  const isToggle = perStep.every((step, index) => step.value === state.max[index].value)
  const stacks = typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, value)
    : 1
  const entries = isToggle
    ? state.max
    : perStep.map((step, index) => {
      const max = state.max[index]
      return {
        value: Math.min(step.value * stacks, max.value),
        path: step.path,
        targetScope: step.targetScope ?? max.targetScope,
      }
    })
  const maxValue = setStateMaxVal(state)
  const maxOnlyEntries = value === maxValue && Array.isArray(state.atMax)
    ? state.atMax
    : []

  return mkRuleFromEntries(def, partKey, [...entries, ...maxOnlyEntries])
}

// merge auto-derived rules with any manual overrides
// override partKey replaces existing rule with same partKey, otherwise it is appended
function mrgRlsWithVr(derivedRules: SetRule[], vrrdRls?: readonly SetRule[]): SetRule[] {
  if (!vrrdRls || vrrdRls.length === 0) {
    return derivedRules
  }

  const merged = [...derivedRules]

  for (const override of vrrdRls) {
    const xstnNdx = merged.findIndex((rule) => rule.partKey === override.partKey)
    if (xstnNdx >= 0) {
      merged[xstnNdx] = override
    } else {
      merged.push(override)
    }
  }

  return merged
}

function mkSetDataLkp(setData?: SntSetConds): SetDataLkp {
  if (!setData || !isSntSetCon(setData)) {
    return { mode: 'none' }
  }

  return {
    mode: 'conds',
    conds: setData,
  }
}

function isSetPartOn(setDataLkp: SetDataLkp, setId: number, partKey?: string): boolean {
  if (!partKey || setDataLkp.mode === 'none') {
    return true
  }

  return getSntSetOn(setDataLkp.conds, setId, partKey)
}

function isDynamicPart(
    dynamicParts: ReadonlySet<string> | undefined,
    setId: number,
    partKey: string,
): boolean {
  return !!dynamicParts?.has(`${setId}:${partKey}`)
}

function isRuntimeSetPartOn(
    runtime: ResRuntime,
    setId: number,
    partKey: string,
): boolean {
  return isSetCtrlOn(runtime.state.controls[getEchoSetCn(setId, partKey)])
}

// derive rule lists for every set id once and cache them
function mkRlsBySet(): SetRule[][] {
  if (cchdRlsBySet) {
    return cchdRlsBySet
  }

  const rulesBySet = Array.from({ length: SETCNSTLUTSE }, () => [] as SetRule[])

  for (const def of ECHO_SET_DEFS) {
    const derivedRules: SetRule[] = []

    // standard 1-piece rule
    if ('onePiece' in def && Array.isArray(def.onePiece) && def.onePiece.length > 0) {
      const rule = mkRuleFromPa(def, 'onePiece')
      if (rule) derivedRules.push(rule)
    }

    // standard 2-piece rule
    if (Array.isArray(def.twoPiece) && def.twoPiece.length > 0) {
      const rule = mkRuleFromPa(def, 'twoPiece')
      if (rule) derivedRules.push(rule)
    }

    // standard 5-piece rule
    if (Array.isArray(def.fivePiece) && def.fivePiece.length > 0) {
      const rule = mkRuleFromPa(def, 'fivePiece')
      if (rule) derivedRules.push(rule)
    }

    // stateful parts from def.states
    for (const stateId of Object.keys(def.states ?? {})) {
      const rule = mkRuleFromPa(def, stateId)
      if (rule) derivedRules.push(rule)
    }

    // final per-set rule list = derived rules + manual corrections
    rulesBySet[def.id] = mrgRlsWithVr(derivedRules, SETCNSTRULEV[def.id])
  }

  cchdRlsBySet = rulesBySet
  return rulesBySet
}

// build runtime mask used by the optimizer evaluator
export function makeSetMask(
    runtime: ResRuntime,
    setConds?: SntSetConds,
    options: BuildSetRowsOptions = {},
): number {
  const setDataLkp = mkSetDataLkp(setConds)
  const dynamicParts = options.dynamicStateParts
      ? new Set(options.dynamicStateParts.map((part) => `${part.setId}:${part.partKey}`))
      : undefined
  let mask = 0

  if (isSetPartOn(setDataLkp, 14, 'fivePiece')) {
    mask |= SETRTTGLST14
  }
  if (isSetPartOn(setDataLkp, 22, 'flamewingsShadow2pcP1')) {
    mask |= SETRTTGLST22
  }
  if (isSetPartOn(setDataLkp, 22, 'flamewingsShadow2pcP2')) {
    mask |= SET_ROT_TOGGLES
  }
  if (isSetPartOn(setDataLkp, 29, 'soundOfTrueName5pc')) {
    mask |= SETRTTGLST29
  }
  if (
    isSetPartOn(setDataLkp, 33, 'chongmingsFeather')
    && (
      !isDynamicPart(dynamicParts, 33, 'chongmingsFeather')
      || isRuntimeSetPartOn(runtime, 33, 'chongmingsFeather')
    )
  ) {
    mask |= SETRTTGLST33
  }

  return mask >>> 0
}

// map a raw piece count into one of the five lut buckets
// returns:
// 0 for <1
// 1 for 1+
// 2 for 2+
// 3 for 3+
// 4 for 5+
export function getSetCntBkt(count: number): number {
  return ((count >= 1) ? 1 : 0) + ((count >= 2) ? 1 : 0) + ((count >= 3) ? 1 : 0) + ((count >= 5) ? 1 : 0)
}

// compute the flattened lut offset for one (set id, count bucket) pair
export function getSetRowFfs(setId: number, countBucket: number): number {
  return ((setId * SETCNSTLUTCN + countBucket) * SETCNSTLUTRO)
}

// build the full static set lookup table for optimizer use
// each row already includes the cumulative contribution of all rules whose minPieces
// requirement is satisfied by that bucket threshold.
export function buildSetRows(
    runtime: ResRuntime,
    setConds?: SntSetConds,
    options: BuildSetRowsOptions = {},
): Float32Array {
  const rulesBySet = mkRlsBySet()
  const setDataLkp = mkSetDataLkp(setConds)
  const lut = new Float32Array(SETCNSTLUTSI)
  const dynamicParts = new Set(
      (options.dynamicStateParts ?? []).map((part) => `${part.setId}:${part.partKey}`),
  )

  for (let setId = 0; setId < SETCNSTLUTSE; setId += 1) {
    const setRules = rulesBySet[setId]
    if (!Array.isArray(setRules) || setRules.length === 0) {
      continue
    }

    // bucket 0 intentionally stays empty because it represents "not enough pieces"
    for (let bucket = 1; bucket < SETCNSTLUTCN; bucket += 1) {
      const thrsCnt = SETCNSTLUTBK[bucket]
      const base = getSetRowFfs(setId, bucket)

      for (const rule of setRules) {
        let activeRule: SetRule | null = rule
        if (rule.partKey && dynamicParts.has(`${setId}:${rule.partKey}`)) {
          const def = ECHO_SET_DEFS.find((entry) => entry.id === setId)
          activeRule = def ? mkRuleFromStateCtrl(def, rule.partKey, runtime.state.controls) : null
        }
        if (!activeRule) {
          continue
        }

        const minPieces = Number(activeRule.minPieces ?? 0)

        // if the current bucket does not satisfy this rule's trigger requirement, skip it
        if (thrsCnt < minPieces) {
          continue
        }

        if (!isSetPartOn(setDataLkp, setId, activeRule.partKey)) {
          continue
        }

        // accumulate every mapped stat column for this rule into the bucket row
        for (const [stat, rawValue] of Object.entries(activeRule)) {
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
export function applySetVec(
    setCount: Uint8Array,
    skillMask: number,
    setConstLut: Float32Array,
    setRtMask: number,
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

  for (let setId = 0; setId < SETCNSTLUTSE; setId += 1) {
    const pieces = setCount[setId] | 0
    if (pieces < 1) {
      continue
    }

    const bucket = getSetCntBkt(pieces)
    if (bucket === 0) {
      continue
    }

    // fetch the precomputed row for this set and achieved bucket
    const base = getSetRowFfs(setId, bucket)

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
  const hvyTrgg = (skillMask & (1 << 1)) !== 0
  const echoTrgg = (skillMask & (1 << 6)) !== 0

  // set 22 has two conditional subparts depending on whether heavy or echo skill is being evaluated
  const st22OnForSkl =
      (hvyTrgg && ((setRtMask & SETRTTGLST22) !== 0)) ||
      (echoTrgg && ((setRtMask & SET_ROT_TOGGLES) !== 0))

  // set 29 bonus only applies for echo-skill evaluation when enabled by runtime mask
  const st29OnForSkl =
      echoTrgg && ((setRtMask & SETRTTGLST29) !== 0)

  // apply runtime-gated bonuses that are not represented purely by static row accumulation
  if (setCount[22] >= 3 && st22OnForSkl) {
    critRate += 20
  }

  if (setCount[29] >= 5 && st29OnForSkl) {
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
