/*
  Author: Runor Ewhro
  Description: compiles compact resonator set-state rules into the conditional
               format consumed by benchmark scoring.
*/

import { ECHO_SET_DEFS } from '@/data/gameData/echoSets/effects'
import {
  DEF_SET_COND,
  type SntSetConds,
  withSntSet,
} from '@/domain/entities/sonataSetConditionals'

type SetRule = {
  type: 'include' | 'exclude'
  sets?: readonly number[]
  states?: readonly string[]
}

type PreservedSetPlan = {
  setId: number
  pieces: number
}

export type BenchmarkSetCondsOptions = {
  preservedUtilityPlan?: readonly PreservedSetPlan[]
  preservedUtilityControls?: Readonly<Record<string, boolean | number | string | undefined>>
}

export const SET_RULES: Partial<Record<string, SetRule>> = {
  '1102': { type: 'include', sets: [1, 9] }, // Sanhua
  '1103': { type: 'include', sets: [1] }, // Baizhi
  '1104': { type: 'include', sets: [1, 9] }, // Lingyang
  '1105': { type: 'include', sets: [1, 9, 13] }, // Zhezhi
  '1106': { type: 'include', sets: [1, 9] }, // Youhu
  '1107': { type: 'include', sets: [1, 9, 10] }, // Carlotta
  '1108': { type: 'include', sets: [1, 9, 30] }, // Hiyuki
  '1109': { type: 'include', sets: [1, 9, 30, 19] }, // Lucilla
  '1110': { type: 'include', sets: [1] }, // Suisui
  '1202': { type: 'include', sets: [2, 9] }, // Chixia
  '1203': { type: 'include', sets: [2, 9] }, // Encore
  '1204': { type: 'include', sets: [2, 9, 13] }, // Mortefi
  '1205': { type: 'include', sets: [2, 9] }, // Changli
  '1206': { type: 'include', sets: [2, 9] }, // Brant
  '1207': { type: 'include', sets: [2, 9, 18] }, // Lupa
  '1208': { type: 'include', sets: [2, 9, 22] }, // Galbrena
  '1209': { type: 'include', sets: [2] }, // Mornye
  '1210': { type: 'include', sets: [2, 9, 27] }, // Aemeath
  '1211': { type: 'include', sets: [2, 9, 27, 28] }, // Denia
  '1301': { type: 'include', sets: [3, 9] }, // Calcharo
  '1302': { type: 'include', sets: [3, 9, 13] }, // Yinlin
  '1303': { type: 'include', sets: [3, 13] }, // Yuanwu
  '1304': { type: 'include', sets: [5, 9] }, // Jinhsi
  '1305': { type: 'include', sets: [3, 9] }, // Xiangli Yao
  '1306': { type: 'include', sets: [3, 9, 20] }, // Augusta
  '1307': { type: 'include', sets: [3, 9] }, // Buling
  '1308': { type: 'include', sets: [3, 9, 32] }, // Rebecca
  '1309': { type: 'include', sets: [3, 9] }, // Rover: Electro
  '1310': { type: 'include', sets: [3, 9] }, // Rover: Electro
  '1402': { type: 'include', sets: [4, 9] }, // Yangyang
  '1403': { type: 'include', sets: [4, 9] }, // Aalto
  '1404': { type: 'include', sets: [4, 9] }, // Jiyan
  '1405': { type: 'include', sets: [4, 9] }, // Jianxin
  '1406': { type: 'include', sets: [4, 9, 17] }, // Rover: Aero
  '1407': { type: 'include', sets: [4, 17, 16] }, // Ciaccona
  '1408': { type: 'include', sets: [4, 9, 17] }, // Rover: Aero
  '1409': { type: 'include', sets: [4, 17, 16] }, // Cartethyia
  '1410': { type: 'include', sets: [4, 9, 20] }, // Iuno
  '1411': { type: 'include', sets: [4, 9, 22, 29] }, // Qiuyuan
  '1412': { type: 'include', sets: [4, 9, 29] }, // Sigrika
  '1501': { type: 'include', sets: [5, 9, 11] }, // Rover: Spectro
  '1502': { type: 'include', sets: [5, 9, 11] }, // Rover: Spectro
  '1503': { type: 'include', sets: [5, 9] }, // Verina
  '1504': { type: 'include', sets: [3, 9] }, // Lumi
  '1505': { type: 'include', sets: [5] }, // Shorekeeper
  '1506': { type: 'include', sets: [5, 9, 11] }, // Phoebe
  '1507': { type: 'include', sets: [5, 9, 11] }, // Zani
  '1508': { type: 'include', sets: [6, 9, 23] }, // Chisa
  '1509': { type: 'include', sets: [5, 9, 26] }, // Lynae
  '1510': { type: 'include', sets: [5, 9, 26] }, // Luuk Herssen
  '1511': { type: 'include', sets: [5, 9, 32] }, // Lucy
  '1601': { type: 'include', sets: [6] }, // Taoqi
  '1602': { type: 'include', sets: [6, 9] }, // Danjin
  '1603': { type: 'include', sets: [6, 9] }, // Camellya
  '1604': { type: 'include', sets: [6, 9] }, // Rover: Havoc
  '1605': { type: 'include', sets: [6, 9] }, // Rover: Havoc
  '1606': { type: 'include', sets: [6, 9] }, // Roccia
  '1607': { type: 'include', sets: [6, 9] }, // Cantarella
  '1608': { type: 'include', sets: [6, 9, 19] }, // Phrolova
  '1610': { type: 'include', sets: [6, 9, 33] }, // Yangyang: Xuanling
}

type StateRef = { setId: number; key: string }
let cachedStateRefs: StateRef[] | null = null

function stateRefs(): StateRef[] {
  // flatten state keys once and reject duplicates because condition maps are
  // keyed by partKey alone in the benchmark policy output
  if (cachedStateRefs) return cachedStateRefs
  const refs: StateRef[] = []
  const seen = new Set<string>()

  for (const set of ECHO_SET_DEFS) {
    for (const key of Object.keys(set.states)) {
      if (seen.has(key)) {
        throw new Error(`Duplicate Sonata state key: ${key}`)
      }
      seen.add(key)
      refs.push({ setId: set.id, key })
    }
  }

  if (ECHO_SET_DEFS.length > 0) cachedStateRefs = refs
  return refs
}

function utilityControlKey(setId: number, stateKey: string): string {
  // utility set controls are stored under the same runtime keys used by the app,
  // so preserved utility plans can opt their active state back into benchmarks
  return `echoSet:${setId}:bonus:${stateKey}`
}

function isControlActive(value: unknown): boolean {
  // controls may be toggles, stack counts, or string-backed inputs; any useful
  // non-empty value means the preserved utility state should be considered on
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) && value > 0
  if (typeof value === 'string') return value.length > 0
  return false
}

export function benchSetConds(
  resonatorId: string,
  options: BenchmarkSetCondsOptions = {},
): SntSetConds {
  // include rules whitelist damage-relevant sets, exclude rules invert that
  // selection, and preserved utility plans add only controls the user had active
  const rule = SET_RULES[resonatorId]
  const refs = stateRefs()
  const byKey = new Map(refs.map((ref) => [ref.key, ref]))
  const selected = new Set<string>()

  for (const setId of rule?.sets ?? []) {
    const matches = refs.filter((ref) => ref.setId === setId)
    if (matches.length === 0) {
      throw new Error(`Unknown or stateless Sonata set in benchmark rule: ${setId}`)
    }
    for (const ref of matches) selected.add(ref.key)
  }

  for (const key of rule?.states ?? []) {
    if (!byKey.has(key)) {
      throw new Error(`Unknown Sonata state in benchmark rule: ${key}`)
    }
    selected.add(key)
  }

  for (const plan of options.preservedUtilityPlan ?? []) {
    const set = ECHO_SET_DEFS.find((def) => def.id === plan.setId)
    if (!set || set.type !== 'utility' || plan.pieces !== set.setMax) {
      continue
    }
    for (const key of Object.keys(set.states)) {
      if (isControlActive(options.preservedUtilityControls?.[utilityControlKey(set.id, key)])) {
        selected.add(key)
      }
    }
  }

  return withSntSet(DEF_SET_COND, refs
    .map((ref) => ({
      setId: ref.setId,
      partKey: ref.key,
      checked: rule?.type === 'exclude'
        ? !selected.has(ref.key)
        : selected.has(ref.key),
    })))
}
