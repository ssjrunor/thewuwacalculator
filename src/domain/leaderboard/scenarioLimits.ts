/*
  Author: Runor Ewhro
  description: limits on the teams and weapons a ruleset selects per resonator,
               checked by scenarioDefs.
*/

// board selections are curated separately from shared rotation verification
export const MAX_SCENARIO_TEAMS = 5
export const MAX_SCENARIO_WEAPONS = 4

export function assertScenarioSelectionLimits(
  resonators: Record<string, { teams: readonly unknown[]; weapons: readonly unknown[] }>,
): void {
  for (const [id, selection] of Object.entries(resonators)) {
    if (Array.isArray(selection?.teams) && selection.teams.length > MAX_SCENARIO_TEAMS) {
      throw new Error(`${id}: select at most ${MAX_SCENARIO_TEAMS} teams`)
    }
    if (Array.isArray(selection?.weapons) && selection.weapons.length > MAX_SCENARIO_WEAPONS) {
      throw new Error(`${id}: select at most ${MAX_SCENARIO_WEAPONS} weapons`)
    }
  }
}
