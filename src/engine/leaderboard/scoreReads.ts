/*
  Author: Runor Ewhro
  description: the ruleset units a scenario score reads
               (scripts/anchorgen/deps/units.mjs names them): its def, plan and
               selections, each member's resonator data and authored build
               (weapon, sets and the echoes that build resolves to), the scenario
               weapon, the scored seat's own echoes and sets, and `shared` for
               every unit without an entity owner. a rollout compares these by
               name and hash to decide whether a stored score still applies.
               names are resolved from the build, so a catalog change picking a
               different filler echo changes the names and is detected.
*/

import type { ScenarioDef } from '@/domain/leaderboard/ruleset'
import { resonatorForms } from '@/domain/rotationActions/identities'
import type { ResolvedTeammate } from './teammateBuilds'
import { teammateEchoes, type ScenarioInputDeps } from './scenarioInput'

/** the single name for every unit without an entity owner (shared:<path>, enemy:<id>). */
export const SHARED_UNITS = 'shared'

/** the scenario id without its ruleset, as units and offline anchors name it. */
export const scenarioKey = (scenarioId: string) => scenarioId.slice(scenarioId.indexOf(':') + 1)

/**
 * units read by a scenario's score; `scored` is the scored seat's gear: the submitted build's echoes for a score, the
 * authored template's for the offline anchors (null resolves the template).
 */
export function scenarioReads(def: ScenarioDef, teammates: ReadonlyMap<string, ResolvedTeammate>,
  deps: Pick<ScenarioInputDeps, 'echoes' | 'secondaryByCost'>, scored: Array<{ id: string; set?: number | null }> | null): string[] {
  const reads = new Set<string>([`def:${scenarioKey(def.id)}`, `plan:${def.teamId}`, `selection:${def.resonatorId}`,
    `selection-team:${def.teamId}`, `weapon:${def.weapon.id}`, SHARED_UNITS])
  const wear = (echoes: Array<{ id: string; set?: number | null }>) => {
    for (const echo of echoes) {
      reads.add(`echo:${echo.id}`)
      if (echo.set != null) reads.add(`set:${echo.set}`)
    }
  }
  for (const member of def.members) {
    for (const form of resonatorForms(member.resonatorId)) { reads.add(`resonator:${form}`); reads.add(`teammates:${form}`) }
    if (member.isContext && scored) { wear(scored); continue }
    const key = member.isContext ? `${def.teamId}:${member.slot}` : member.teamSlot
    const template = key ? teammates.get(key) : undefined
    if (!template) continue
    reads.add(`weapon:${template.weapon.id}`)
    reads.add(`echo:${template.mainEchoId}`)
    for (const set of template.sets) reads.add(`set:${set.id}`)
    wear(teammateEchoes(template, key!, deps))
  }
  return [...reads].sort()
}
