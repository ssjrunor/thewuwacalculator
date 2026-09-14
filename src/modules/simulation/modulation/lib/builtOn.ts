/*
  Author: Runor Ewhro
  Description: What a evaluation build was built on, for the sheet's card column.

               The two target columns are numbers with no provenance: nothing on
               the page says which frame produced them. That frame is three
               things and only three -- the sonata plan, the cost it spends, and
               the main Echo. The rest of the frame is cost filler, and in a
               generated build its identity says nothing, so it is left out.
*/

import { getSntSetIco, getSntSetNam } from '@/data/gameData/catalog/sonataSets.ts'
import { getEchoById } from '@/domain/services/echoCatalogService'
import type {
  EvaluationBuildSnapshot,
  EvaluationEchoSlot,
} from '@/data/scoring/buildEvaluation.ts'

export const ECHO_COST_MAX = 12

export interface BuiltOnSet {
  setId: number
  name: string
  icon: string | null
  pieces: number
}

export interface BuiltOnMain {
  echoId: string
  name: string
  icon: string | null
  cost: number
}

export interface BuiltOnFrame {
  key: 'active' | 'b100' | 'b200'
  label: string
  sets: BuiltOnSet[]
  main: BuiltOnMain | null
  cost: number
}

/* main Echo is the `mainEcho` flag, not a slot: slot 0 is only the default */
function mainOf(echoes: EvaluationEchoSlot[]): EvaluationEchoSlot | null {
  return echoes.find((echo) => echo.mainEcho) ?? null
}

export function makeBuiltOnFrame(
  key: BuiltOnFrame['key'],
  label: string,
  build: EvaluationBuildSnapshot | null,
): BuiltOnFrame | null {
  if (!build) return null

  const main = mainOf(build.echoes)
  const definition = main ? getEchoById(main.echoId) : null

  return {
    key,
    label,
    sets: build.sets.map((set) => ({
      setId: set.setId,
      name: set.name || getSntSetNam(set.setId),
      icon: getSntSetIco(set.setId),
      pieces: set.pieces,
    })),
    main: main
      ? {
          echoId: main.echoId,
          name: definition?.name ?? main.echoName,
          icon: definition?.icon ?? null,
          cost: main.cost,
        }
      : null,
    cost: build.echoes.reduce((total, echo) => total + echo.cost, 0),
  }
}
