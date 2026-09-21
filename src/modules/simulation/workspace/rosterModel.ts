/*
  Author: Runor Ewhro
  Description: Builds ordered roster groups and rotation-presence metadata from canonical profiles.
*/

import type { RotationNode } from '@/domain/gameData/contracts'
import type { ScenarioWorkspace } from '@/domain/entities/scenarioLibrary'
import { listContextResonatorScenarios } from '@/domain/entities/scenarioLibrary'
import { contextScenarioMember } from '@/domain/entities/combatScenario'
import { ATTR_COLORS } from '@/modules/simulation/model/display'
import { getResonator } from '@/modules/simulation/features/resonator/lib/resonator.ts'
import { toTitle } from '@/shared/lib/format'
import type {
  BuildAttrGroup,
  BuildRosterEntry,
} from './BuildRoster.tsx'

const DEF_ACCENT = '#6b7cff'
const rosterCache = new WeakMap<object, BuildRosterEntry[]>()

// The authored tree, counted the way the rotation editor's own MAIN header
// counts it, so the roster and the page agree on the number.
function countProgramNodes(items: readonly RotationNode[]): number {
  let total = 0
  for (const node of items) {
    total += 1
    if (node.type === 'repeat' || node.type === 'uptime') {
      total += countProgramNodes(node.setup ?? [])
      total += countProgramNodes(node.items)
    }
  }
  return total
}

function compareRosterEntries(
  left: BuildRosterEntry,
  right: BuildRosterEntry,
): number {
  return left.attribute === right.attribute
    ? left.name.localeCompare(right.name)
    : left.attribute.localeCompare(right.attribute)
}

// One entry per context resonator and therefore one working scenario.
export function makeRosterEntries(
  workspace: Pick<ScenarioWorkspace, 'order' | 'scenariosById'>,
): BuildRosterEntry[] {
  const cached = rosterCache.get(workspace)
  if (cached) return cached

  const roster = listContextResonatorScenarios(workspace)
    .flatMap(({ resonatorId: id, scenarioId }) => {
      const scenario = workspace.scenariosById[scenarioId]
      if (!scenario) return []
      const member = contextScenarioMember(scenario)
      const res = getResonator(id)
      const attribute = res?.attribute ?? 'aero'
      /* a scenario owns its own program, so this is a fact about the resonator
         and not about whichever surface happens to be reading it */
      const nodes = countProgramNodes(scenario.program.program)
      return [{
        id,
        scenarioId,
        name: res?.name ?? toTitle(id),
        profile: res?.profile ?? res?.sprite ?? '/assets/game/default.webp',
        attribute,
        accent: ATTR_COLORS[attribute] ?? DEF_ACCENT,
        level: member.progression.level ?? 1,
        sequence: member.progression.sequence ?? 0,
        rotationNodes: nodes,
      }]
    })
    .sort(compareRosterEntries)
  rosterCache.set(workspace, roster)
  return roster
}

// The roster is sorted by attribute, so every run of one attribute is contiguous
// and each group can carry the entries it covers.
export function makeAttrGroups(roster: BuildRosterEntry[]): BuildAttrGroup[] {
  const groups: BuildAttrGroup[] = []
  for (const entry of roster) {
    const last = groups[groups.length - 1]
    if (last && last.attribute === entry.attribute) {
      last.items.push(entry)
    } else {
      groups.push({
        attribute: entry.attribute,
        accent: entry.accent,
        items: [entry],
      })
    }
  }
  return groups
}
