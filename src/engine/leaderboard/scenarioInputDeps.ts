/*
  Author: Runor Ewhro
  description: the game-data side of buildScenarioInput: the echo catalog, the
               second main stat by cost, and the scoring enemy for a team.
               needs the game data registry initialised (initGameData).
*/

import { listEchoes } from '@/data/catalog/echoCatalogService'
import { ECHO_SIDE_STATS } from '@/data/gameData/catalog/echoStats'
import { makeEvaluationEnemy } from '@/engine/evaluation/evaluationAssumptions'
import { getTuneStrainMaxForMembers } from '@/engine/gameData/tuneStrain'
import type { ScenarioInputDeps } from './scenarioInput'

export function scenarioInputDeps(): ScenarioInputDeps {
  return {
    echoes: listEchoes().map((echo) => ({ id: String(echo.id), cost: echo.cost, sets: [...echo.sets] })),
    secondaryByCost: Object.fromEntries(Object.entries(ECHO_SIDE_STATS)
      .map(([cost, stat]) => [Number(cost), { key: stat.key, value: stat.value }])),
    enemyFor: (resonatorIds) => makeEvaluationEnemy(getTuneStrainMaxForMembers(resonatorIds)),
  }
}
