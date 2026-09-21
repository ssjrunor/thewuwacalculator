/*
  Author: Runor Ewhro
  Description: Extracts the Sonata plan, cost, and main Echo provenance for generated evaluation builds.
*/

import { getSntSetIco, getSntSetNam } from '@/data/gameData/catalog/sonataSets.ts'
import { getEchoById } from '@/data/catalog/echoCatalogService'
import type {
  EvaluationBuildSnapshot,
  EvaluationEchoSlot,
} from '@/engine/evaluation/buildEvaluation.ts'

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
