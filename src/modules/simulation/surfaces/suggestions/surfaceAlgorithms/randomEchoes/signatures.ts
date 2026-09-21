/*
  Author: Runor Ewhro
  Description: Builds insertion-order-independent signatures for generated
               Echo loadouts and retains the first result for each unique build.
*/

import type { RandGenEcho } from './echoSetBuilder'

// Sorting makes signatures independent of object insertion order.
function fmtStatEnts(stats: Record<string, number>): string {
  return Object.keys(stats)
      .sort()
      .map((key) => `${key}:${stats[key]}`)
      .join(',')
}

function mkLdtSig(echoes: RandGenEcho[]): string {
  return echoes
      .map((echo) => {
        const main = `${echo.primaryKey}:${echo.primaryValue}`
        const sub = fmtStatEnts(echo.substats)
        return `${echo.cost}|${main}|${sub}`
      })
      .join(';')
}

export function pickNqLdtRsl<T extends { value: number; echoes: RandGenEcho[] }>(
    results: T[],
    uniqueTarget: number,
): T[] {
  const unique: T[] = []
  const seen = new Set<string>()

  for (const result of results) {
    const echoes = result.echoes ?? []

    if (!echoes.length) {
      continue
    }

    const key = mkLdtSig(echoes)

    if (seen.has(key)) {
      continue
    }

    seen.add(key)
    unique.push(result)

    if (unique.length >= uniqueTarget) {
      break
    }
  }

  return unique
}
