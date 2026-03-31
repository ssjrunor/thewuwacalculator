/*
  Author: Runor Ewhro
  Description: Computes trace node buffs from active node selections and
               provides helpers for generating fully maxed trace node buffs.
*/

import type { AttributeKey } from '@/domain/entities/stats'
import type { ResonatorSeed, TraceNodeBuffs } from '@/domain/entities/runtime'

// create a zeroed base stat buff
function makeBaseBuff() {
  return { percent: 0, flat: 0 }
}

// create a zeroed modifier buff
function makeModBuff() {
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

// create an empty trace node buff object
function makeDefaultTraceNodeBuffs(): TraceNodeBuffs {
  return {
    atk: makeBaseBuff(),
    hp: makeBaseBuff(),
    def: makeBaseBuff(),
    attribute: {
      aero: makeModBuff(),
      glacio: makeModBuff(),
      spectro: makeModBuff(),
      fusion: makeModBuff(),
      electro: makeModBuff(),
      havoc: makeModBuff(),
      physical: makeModBuff(),
    },
    critRate: 0,
    critDmg: 0,
    healingBonus: 0,
    activeNodes: {},
  }
}

// map trace node names to their buff targets
const traceBuffMap: Record<string, { type: 'stat' | 'scalar' | 'attribute'; key: string }> = {
  'ATK+': { type: 'stat', key: 'atk' },
  'HP+': { type: 'stat', key: 'hp' },
  'HP Up': { type: 'stat', key: 'hp' },
  'DEF+': { type: 'stat', key: 'def' },
  'Healing Bonus+': { type: 'scalar', key: 'healingBonus' },
  'Crit. Rate+': { type: 'scalar', key: 'critRate' },
  'Crit. Rate Up': { type: 'scalar', key: 'critRate' },
  'Crit. DMG+': { type: 'scalar', key: 'critDmg' },
  'Aero DMG Bonus+': { type: 'attribute', key: 'aero' },
  'Glacio DMG Bonus+': { type: 'attribute', key: 'glacio' },
  'Spectro DMG Bonus+': { type: 'attribute', key: 'spectro' },
  'Fusion DMG Bonus+': { type: 'attribute', key: 'fusion' },
  'Electro DMG Bonus+': { type: 'attribute', key: 'electro' },
  'Havoc DMG Bonus+': { type: 'attribute', key: 'havoc' },
}

// compute trace node buffs from the active node map
export function computeTraceNodeBuffs(
    seed: Pick<ResonatorSeed, 'traceNodes'>,
    activeNodes: Record<string, boolean>,
): TraceNodeBuffs {
  const next = makeDefaultTraceNodeBuffs()
  next.activeNodes = activeNodes

  for (const node of seed.traceNodes ?? []) {
    if (!activeNodes[node.id]) {
      continue
    }

    const mapping = traceBuffMap[node.name]
    if (!mapping) {
      continue
    }

    if (mapping.type === 'stat') {
      const statKey = mapping.key as 'atk' | 'hp' | 'def'
      next[statKey].percent += node.value
      continue
    }

    if (mapping.type === 'scalar') {
      if (mapping.key === 'critRate') {
        next.critRate += node.value
      }
      if (mapping.key === 'critDmg') {
        next.critDmg += node.value
      }
      if (mapping.key === 'healingBonus') {
        next.healingBonus += node.value
      }
      continue
    }

    const attributeKey = mapping.key as AttributeKey
    next.attribute[attributeKey].dmgBonus += node.value
  }

  return next
}

// compute trace node buffs with every trace node enabled
export function makeMaxTraceNodeBuffs(seed: Pick<ResonatorSeed, 'traceNodes'>): TraceNodeBuffs {
  const activeNodes = Object.fromEntries((seed.traceNodes ?? []).map((node) => [node.id, true]))
  return computeTraceNodeBuffs(seed, activeNodes)
}