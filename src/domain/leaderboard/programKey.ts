/*
  Author: Runor Ewhro
  description: the parts of a scored seat's echoes the rotation generator reads,
               so builds matching on them share one generated program. a
               scenario maxes every member's level, skills and weapon, so per
               build only the seat's form, sequence and echoes differ, and of the
               echoes the generator reads the main echo (the flagged one, else
               the first slot's: runtimeSourceService.getMainEchoS), each
               sonata's piece count with repeated echoes counted once
               (countEchoSets), and the summed tune break boost
               (events/sourceValues.ts). scenarios whose plan copies a build stat
               into the program (editor/statControls.ts) share nothing and key on
               the full echo list. the key is empirical: the scorer regenerates a
               share of reused programs and stops sharing in a scenario whose
               program differs (scoreGroup.ts).
*/

import { countEchoSets } from '@/domain/gameData/echoSetCounts'
import type { BuildSnapshot } from './snapshot'

// one equipped echo in snapshot or runtime form
export interface KeyEcho {
  id: string | number
  set: number
  mainEcho: boolean
  stats: ReadonlyArray<{ key: string; value: number } | null | undefined>
  substats: Readonly<Record<string, number>> | null | undefined
}

// the echo part of a program key: plain data, canonical when written with canonicalJson
export interface ProgramEchoKey {
  // the main echo's id and whether a slot flagged it (gear reads only a flagged one; the editor uses the first slot)
  main: { id: string; flagged: boolean } | null
  // sonata set id to pieces, a repeated echo counted once, ascending by set
  sets: Array<[string, number]>
  // tune break boost over every equipped echo's main stats and substats
  tuneBreakBoost: number
  // paired transformations read the sibling Echo independently of its set
  pairedEcho?: string
}

const TUNE_BREAK_BOOST = 'tuneBreakBoost'

// the generator's reads of a seat's echoes, `echoes` in slot order with empty slots as null
export function programEchoKey(echoes: ReadonlyArray<KeyEcho | null>): ProgramEchoKey {
  const equipped = echoes.filter((echo): echo is KeyEcho => echo != null)
  const flagged = equipped.find((echo) => echo.mainEcho)
  const fallback = echoes[0] ?? equipped[0]
  const main = flagged ? { id: String(flagged.id), flagged: true } : fallback ? { id: String(fallback.id), flagged: false } : null
  const sets = Object.entries(countEchoSets(equipped.map((echo) => ({ id: echo.id, set: echo.set }))))
    .sort(([a], [b]) => Number(a) - Number(b) || a.localeCompare(b))
  let tuneBreakBoost = 0
  for (const echo of equipped) {
    for (const stat of echo.stats) if (stat?.key === TUNE_BREAK_BOOST) tuneBreakBoost += stat.value
    tuneBreakBoost += echo.substats?.[TUNE_BREAK_BOOST] ?? 0
  }
  const sibling = main?.flagged ? ({ '6000179': '6000180', '6000180': '6000179' } as Record<string, string>)[main.id] : undefined
  const pairedEcho = sibling && equipped.some(echo => !echo.mainEcho && String(echo.id) === sibling) ? sibling : undefined
  return { main, sets, tuneBreakBoost, ...(pairedEcho ? { pairedEcho } : {}) }
}

// a snapshot's echoes in slot order, empty slots null, as the scenario seats them (scenarioInput.snapshotEchoes)
export function snapshotKeyEchoes(snapshot: BuildSnapshot, slots = 5): Array<KeyEcho | null> {
  const echoes: Array<KeyEcho | null> = Array(slots).fill(null)
  for (const echo of snapshot.echoes) {
    echoes[echo.slot] = { id: echo.id, set: echo.set, mainEcho: echo.mainEcho,
      stats: [echo.main.primary, echo.main.secondary], substats: echo.substats }
  }
  return echoes
}

// the board's grouping key for a build in a scenario as text: the seat's form, sequence and echo key. builds with
// equal text share a program; the scorer derives its own key from the scenario and splits groups that disagree.
// `share` false (the scenario copies build stats into its program) keys on the full echo list
export function snapshotProgramKey(snapshot: BuildSnapshot, share: boolean): string {
  const seat = `${snapshot.resonator.id}|${snapshot.resonator.sequence}`
  if (!share) return `${seat}|${JSON.stringify([...snapshot.echoes].sort((a, b) => a.slot - b.slot))}`
  const key = programEchoKey(snapshotKeyEchoes(snapshot))
  return `${seat}|${key.main ? `${key.main.id}${key.main.flagged ? '' : '?'}` : '-'}|${key.sets.map(([set, n]) => `${set}x${n}`).join(',')}|${key.tuneBreakBoost}${key.pairedEcho ? `|pair:${key.pairedEcho}` : ''}`
}
