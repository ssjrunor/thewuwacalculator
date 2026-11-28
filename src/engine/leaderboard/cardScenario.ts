/*
  Author: Runor Ewhro
  description: the submitted build alone: the card's resonator, sequence, echoes
               and its own weapon, with no teammates. an unscored build shows this
               (its card and stats) while its scenarios score, and it is never
               scored itself. cards omit refinement, so the weapon uses the
               leaderboard's assumed rank.
*/

import type { BuildStats } from '@/domain/leaderboard/api'
import type { BuildSnapshot } from '@/domain/leaderboard/snapshot'
import type { ScenarioInput } from '@/domain/leaderboard/scenarioInput'
import { ensureResonatorData } from '@/data/gameData'
import { getWpnById } from '@/data/catalog/weaponCatalogService'
import { makeEvaluationEnemy } from '@/engine/evaluation/evaluationAssumptions'
import { getTuneStrainMaxForMembers } from '@/engine/gameData/tuneStrain'
import { scenarioBuildStats } from './buildStats'
import { snapshotEchoes } from './scenarioInput'
import { leaderboardWeaponRank } from './weaponRank'

export const CARD_SCENARIO_ID = 'card'

// the submitted build as a one-seat scenario input: what the card shows before any scenario scores it. `fallback`
// is the weapon used when the card drew none (a scenario's), and without one such a build has no card input
export function cardScenarioInput(snapshot: BuildSnapshot, fallback?: string | null): ScenarioInput {
  const resonatorId = snapshot.resonator.id
  const weaponId = snapshot.weapon.id ?? fallback
  if (!weaponId) throw new Error('the card drew no weapon and no scenario weapon stands in')
  const weapon = getWpnById(weaponId)
  return {
    v: 1,
    scenarioId: CARD_SCENARIO_ID,
    teamId: CARD_SCENARIO_ID,
    scoredSlot: 0,
    members: [{
      slot: 0,
      resonatorId,
      role: 'scored',
      mode: null,
      sequence: snapshot.resonator.sequence,
      weapon: { id: weaponId, rank: leaderboardWeaponRank(weaponId, weapon?.rarity ?? 5) },
      echoes: snapshotEchoes(snapshot),
    }],
    enemy: makeEvaluationEnemy(getTuneStrainMaxForMembers([resonatorId])),
  }
}

// the submitted build's own stats; null when the card cannot be rebuilt
export async function cardBuildStats(snapshot: BuildSnapshot, fallback?: string | null): Promise<BuildStats | null> {
  try {
    await ensureResonatorData([snapshot.resonator.id])
    return scenarioBuildStats(cardScenarioInput(snapshot, fallback))
  } catch {
    return null
  }
}
