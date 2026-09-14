/*
  Author: Runor Ewhro
  Description: Turns an equipped echo into the slot shape the bench echo strip
               reads. Shared so any surface standing that strip presents echoes
               the same way the evaluation report does.
*/

import type { EchoInstance } from '@/domain/entities/runtime'
import type { EvaluationEchoSlot } from '@/data/scoring/buildEvaluation.ts'
import { getEchoById } from '@/domain/services/echoCatalogService'
import { getSntSetNam } from '@/data/gameData/catalog/sonataSets'

function roundEchoStat(value: number): number {
  return Math.round(value * 1000) / 1000
}

export function makeEchoSlot(echo: EchoInstance): EvaluationEchoSlot {
  const definition = getEchoById(echo.id)
  const setId = echo.set
  return {
    echoId: echo.id,
    echoName: definition?.name ?? echo.id,
    cost: definition?.cost ?? 0,
    mainEcho: echo.mainEcho,
    setId,
    setName: setId > 0 ? getSntSetNam(setId) : 'No set',
    primary: {
      key: echo.mainStats.primary.key,
      value: roundEchoStat(echo.mainStats.primary.value),
    },
    secondary: {
      key: echo.mainStats.secondary.key,
      value: roundEchoStat(echo.mainStats.secondary.value),
    },
    equippedSubstats: Object.entries(echo.substats)
      .map(([key, value]) => ({ key, value: roundEchoStat(value) }))
      .sort((left, right) => right.value - left.value),
  }
}
