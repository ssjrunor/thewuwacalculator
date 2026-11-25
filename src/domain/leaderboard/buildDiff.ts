/*
  Author: Runor Ewhro
  description: lists changes between two of a player's builds (or any two
               builds of one resonator): sequence, level, weapon, skill levels
               and each echo. echoes are matched by identity regardless of slot,
               so moving an echo is no change; a kept echo with new stats shows
               its stat changes, and a replaced one shows as a swap. the service
               attaches this to build history, and the app can compare any two
               builds with it.
*/

import type { BuildSnapshot, SnapshotEcho, SnapshotStat } from './snapshot'

export interface StatChange {
  key: string
  from: number | null
  to: number | null
}

export type BuildChange =
  | { kind: 'sequence'; from: number; to: number }
  | { kind: 'level'; from: number | null; to: number | null }
  | { kind: 'weapon'; from: { id: string; level: number | null }; to: { id: string; level: number | null } }
  | { kind: 'skill'; key: string; from: number | null; to: number | null }
  /** the same echo kept, its main stats or substats changed (or it became the main echo). */
  | { kind: 'echo_tuned'; slot: number; echo: SnapshotEcho; main: StatChange[]; substats: StatChange[]; mainEcho: boolean | null }
  /** one echo taken off and another put on. */
  | { kind: 'echo_swapped'; slot: number; from: SnapshotEcho; to: SnapshotEcho }
  | { kind: 'echo_added'; slot: number; echo: SnapshotEcho }
  | { kind: 'echo_removed'; slot: number; echo: SnapshotEcho }

const sameStat = (a: SnapshotStat, b: SnapshotStat) => a.key === b.key && a.value === b.value

function statChanges(from: Record<string, number>, to: Record<string, number>): StatChange[] {
  const keys = [...new Set([...Object.keys(from), ...Object.keys(to)])].sort()
  return keys.filter((key) => from[key] !== to[key]).map((key) => ({ key, from: from[key] ?? null, to: to[key] ?? null }))
}

const mainOf = (echo: SnapshotEcho): Record<string, number> => ({
  [`primary:${echo.main.primary.key}`]: echo.main.primary.value, [`secondary:${echo.main.secondary.key}`]: echo.main.secondary.value,
})

/** the very same echo, as rolled: nothing about it differs but its slot. */
const identical = (a: SnapshotEcho, b: SnapshotEcho) => a.id === b.id && a.set === b.set && a.mainEcho === b.mainEcho
  && sameStat(a.main.primary, b.main.primary) && sameStat(a.main.secondary, b.main.secondary) && statChanges(a.substats, b.substats).length === 0

/** one echo, kept and retuned: the same echo in the same set with the same main stat. */
const kept = (a: SnapshotEcho, b: SnapshotEcho) => a.id === b.id && a.set === b.set && a.main.primary.key === b.main.primary.key

/** the changes that lead from `from` to `to`, in reading order: the resonator, the weapon, then echoes by slot. */
export function diffBuilds(from: BuildSnapshot, to: BuildSnapshot): BuildChange[] {
  const changes: BuildChange[] = []
  if (from.resonator.sequence !== to.resonator.sequence) changes.push({ kind: 'sequence', from: from.resonator.sequence, to: to.resonator.sequence })
  if (from.resonator.level !== to.resonator.level) changes.push({ kind: 'level', from: from.resonator.level, to: to.resonator.level })
  if (from.weapon.id !== to.weapon.id || from.weapon.level !== to.weapon.level) changes.push({ kind: 'weapon', from: from.weapon, to: to.weapon })
  const skills = [...new Set([...Object.keys(from.resonator.skillLevels), ...Object.keys(to.resonator.skillLevels)])].sort()
  for (const key of skills) {
    const a = from.resonator.skillLevels[key] ?? null
    const b = to.resonator.skillLevels[key] ?? null
    if (a !== b) changes.push({ kind: 'skill', key, from: a, to: b })
  }

  // match the echoes that did not change at all first, then the ones kept and retuned, then pair the rest by slot.
  const before = [...from.echoes]
  const after: SnapshotEcho[] = []
  for (const echo of to.echoes) {
    const index = before.findIndex((old) => identical(old, echo))
    if (index >= 0) before.splice(index, 1)
    else after.push(echo)
  }
  const echoChanges: BuildChange[] = []
  const unmatched: SnapshotEcho[] = []
  for (const echo of after) {
    const index = before.findIndex((old) => kept(old, echo))
    if (index < 0) { unmatched.push(echo); continue }
    const [old] = before.splice(index, 1)
    echoChanges.push({ kind: 'echo_tuned', slot: echo.slot, echo, main: statChanges(mainOf(old), mainOf(echo)),
      substats: statChanges(old.substats, echo.substats), mainEcho: old.mainEcho === echo.mainEcho ? null : echo.mainEcho })
  }
  for (const echo of unmatched) {
    const index = before.findIndex((old) => old.slot === echo.slot)
    const old = index >= 0 ? before.splice(index, 1)[0] : before.shift()
    echoChanges.push(old ? { kind: 'echo_swapped', slot: echo.slot, from: old, to: echo } : { kind: 'echo_added', slot: echo.slot, echo })
  }
  for (const old of before) echoChanges.push({ kind: 'echo_removed', slot: old.slot, echo: old })
  return [...changes, ...echoChanges.sort((a, b) => ('slot' in a ? a.slot : 0) - ('slot' in b ? b.slot : 0))]
}
