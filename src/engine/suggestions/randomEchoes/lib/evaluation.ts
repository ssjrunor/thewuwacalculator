/*
  Author: Runor Ewhro
  Description: Encodes randomized echo sets into compact numeric buffers
               and evaluates them against direct or rotation suggestion
               contexts using the optimizer target evaluator.
*/

import { evalTarget } from '@/engine/optimizer/rebuild/target/evaluate'
import type { SuggestionEvaluationContext } from '@/engine/suggestions/types'
import type { RandGenEcho } from './echoSetBuilder'

// number of encoded stat slots stored per echo row
const STATS_PER_ECHO = 20

// number of main-echo buff fields stored per echo row
const MAIN_BUFFS_PER_ECHO = 15

// allocate an empty main-echo buff buffer for a given echo count
export function buildZeroMainEchoBuffs(count: number): Float32Array {
  return new Float32Array(count * MAIN_BUFFS_PER_ECHO)
}

// write one stat key into its fixed encoded slot for a single echo row
function addStat(vector: Float32Array, base: number, key: string, value: number): void {
  if (!value) return

  switch (key) {
    case 'atkPercent':          vector[base] += value; return
    case 'atkFlat':             vector[base + 1] += value; return
    case 'hpPercent':           vector[base + 2] += value; return
    case 'hpFlat':              vector[base + 3] += value; return
    case 'defPercent':          vector[base + 4] += value; return
    case 'defFlat':             vector[base + 5] += value; return
    case 'critRate':            vector[base + 6] += value; return
    case 'critDmg':             vector[base + 7] += value; return
    case 'energyRegen':         vector[base + 8] += value; return
    case 'healingBonus':        vector[base + 9] += value; return
    case 'basicAtk':            vector[base + 10] += value; return
    case 'heavyAtk':            vector[base + 11] += value; return
    case 'resonanceSkill':      vector[base + 12] += value; return
    case 'resonanceLiberation': vector[base + 13] += value; return
    case 'aero':                vector[base + 14] += value; return
    case 'spectro':             vector[base + 15] += value; return
    case 'fusion':              vector[base + 16] += value; return
    case 'glacio':              vector[base + 17] += value; return
    case 'havoc':               vector[base + 18] += value; return
    case 'electro':             vector[base + 19] += value; return
  }
}

// convert generated echoes into the compact arrays expected by evalTarget
function encodeRandGenEchoStats(echoes: RandGenEcho[]): {
  stats: Float32Array
  sets: Uint8Array
  kinds: Uint16Array
} {
  const stats = new Float32Array(echoes.length * STATS_PER_ECHO)
  const sets = new Uint8Array(echoes.length)
  const kinds = new Uint16Array(echoes.length)

  for (let i = 0; i < echoes.length; i++) {
    const echo = echoes[i]
    const base = i * STATS_PER_ECHO

    // encode the main stats first
    addStat(stats, base, echo.primaryKey, echo.primaryValue)
    addStat(stats, base, echo.secondaryKey, echo.secondaryValue)

    // then encode every rolled substat
    for (const [key, value] of Object.entries(echo.substats)) {
      addStat(stats, base, key, value)
    }

    // set id is carried through directly
    // 255 is the NO_SET sentinel and is intentionally ignored by set counting
    sets[i] = echo.setId

    // kinds are unique per slot so each echo is treated as distinct
    kinds[i] = i
  }

  return { stats, sets, kinds }
}

// evaluate one generated echo set in either direct-target or rotation mode
export function evaluateRandGenEchoSet(
    echoes: RandGenEcho[],
    context: SuggestionEvaluationContext,
    comboIds: Int32Array,
    mainEchoBuffs: Float32Array,
): number {
  const { stats, sets, kinds } = encodeRandGenEchoStats(echoes)

  // direct mode runs a single packed target context
  if (context.mode === 'target') {
    return evalTarget({
      context: context.packedContext,
      stats,
      setConstLut: context.setConstLut,
      mainEchoBuffs,
      sets,
      kinds,
      comboIds,
      mainIndex: 0,
    })?.damage ?? 0
  }

  // rotation mode evaluates against every packed context and sums weighted damage
  let total = 0

  for (let i = 0; i < context.contextCount; i++) {
    const slice = context.contexts.subarray(
        i * context.contextStride,
        (i + 1) * context.contextStride,
    )

    const damage = evalTarget({
      context: slice,
      stats,
      setConstLut: context.setConstLut,
      mainEchoBuffs,
      sets,
      kinds,
      comboIds,
      mainIndex: 0,
    })?.damage ?? 0

    total += damage * (context.contextWeights[i] ?? 1)
  }

  return total
}
