/*
  Author: Runor Ewhro
  Description: Builds ordered roster groups and rotation-presence metadata from canonical profiles.
*/

import { getResSeedBy } from '@/data/catalog/resonatorSeedService'
import type { ScenarioWorkspace } from '@/domain/entities/scenarioLibrary'
import { listContextResonatorScenarios, summarizeScenario } from '@/domain/entities/scenarioLibrary'
import { ATTR_COLORS } from '@/modules/simulation/model/display'

import { toTitle } from '@/shared/lib/format'
import type {
  BuildAttrGroup,
  BuildRosterEntry,
} from './BuildRoster.tsx'

const DEF_ACCENT = '#6b7cff'
const rosterCache = new WeakMap<object, BuildRosterEntry[]>()

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
  workspace: Pick<ScenarioWorkspace, 'order' | 'scenariosById' | 'summaryById'>,
): BuildRosterEntry[] {
  const cacheKey = workspace.summaryById ?? workspace
  const cached = rosterCache.get(cacheKey)
  if (cached) return cached

  const roster = listContextResonatorScenarios(workspace)
    .flatMap(({ resonatorId: id, scenarioId }) => {
      const summary = workspace.summaryById?.[scenarioId]
        ?? (workspace.scenariosById[scenarioId]
          ? summarizeScenario(workspace.scenariosById[scenarioId])
          : null)
      if (!summary) return []
      const res = getResSeedBy(id)
      const attribute = res?.attribute ?? 'aero'
      /* a scenario owns its own program, so this is a fact about the resonator
         and not about whichever surface happens to be reading it */
      return [{
        id,
        scenarioId,
        name: res?.name ?? toTitle(id),
        profile: res?.profile ?? res?.sprite ?? '/assets/game/default.webp',
        attribute,
        accent: ATTR_COLORS[attribute] ?? DEF_ACCENT,
        level: summary.level,
        sequence: summary.sequence,
        rotationNodes: summary.rotationNodes,
      }]
    })
    .sort(compareRosterEntries)
  rosterCache.set(cacheKey, roster)
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
