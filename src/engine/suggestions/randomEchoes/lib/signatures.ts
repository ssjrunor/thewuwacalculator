/*
  Author: Runor Ewhro
  Description: Builds deterministic signatures for generated echo
               loadouts and filters result lists down to unique builds.
*/

import type { RandGenEcho } from './echoSetBuilder'

// turn a stat object into a stable, sorted string so order differences
// do not change the final signature
function fmtStatEnts(stats: Record<string, number>): string {
  return Object.keys(stats)
      .sort()
      .map((key) => `${key}:${stats[key]}`)
      .join(',')
}

// build a full signature for one generated loadout using each echo's
// cost, main stat, and sorted substat entries
function mkLdtSig(echoes: RandGenEcho[]): string {
  return echoes
      .map((echo) => {
        const main = `${echo.primaryKey}:${echo.primaryValue}`
        const sub = fmtStatEnts(echo.substats)
        return `${echo.cost}|${main}|${sub}`
      })
      .join(';')
}

// walk the result list in order and keep only the first occurrence
// of each unique loadout signature until the requested target is met
export function pickNqLdtRsl(
    results: Array<{ value: number; echoes: RandGenEcho[] }>,
    uniqueTarget: number,
): Array<{ value: number; echoes: RandGenEcho[] }> {
  const unique: Array<{ value: number; echoes: RandGenEcho[] }> = []
  const seen = new Set<string>()

  for (const result of results) {
    const echoes = result.echoes ?? []

    // skip malformed or empty loadouts
    if (!echoes.length) {
      continue
    }

    const key = mkLdtSig(echoes)

    // keep only the first copy of any matching signature
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