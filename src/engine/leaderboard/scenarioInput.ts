/*
  Author: Runor Ewhro
  description: builds the rotation generator's input for one scenario from a
               read card: the card's echoes and sequence in the scored seat with
               the scenario's weapon, the fixed teammate builds in the others,
               every seat's mode, and the scoring enemy. pure: game
               data comes in through `ScenarioInputDeps` (see scenarioInputDeps.ts).
*/

import type { EchoInstance } from '@/domain/entities/runtime'
import type { EnemyProfile } from '@/domain/entities/appState'
import type { BuildSnapshot } from '@/domain/leaderboard/snapshot'
import type { ScenarioDef } from '@/domain/leaderboard/ruleset'
import type {
  ScenarioInputIssue,
  ScenarioInputMember,
  ScenarioInputResult,
} from '@/domain/leaderboard/scenarioInput'
import type { ResolvedTeammate } from './teammateBuilds'
import { canonicalResonatorId } from '@/domain/rotationActions/identities'

export interface CatalogEcho {
  id: string
  cost: number
  sets: number[]
}

export interface ScenarioInputDeps {
  /** every echo that can be equipped: id, cost and the sets it can roll. */
  echoes: CatalogEcho[]
  /** the fixed second main stat by echo cost. */
  secondaryByCost: Record<number, { key: string; value: number }>
  /** the scoring enemy for a team (tune strain limit depends on the members). */
  enemyFor: (resonatorIds: string[]) => EnemyProfile
}

// both rover forms are one leaderboard identity, as everywhere else plans name resonators.
export { canonicalResonatorId }

export const SNAPSHOT_ECHOES = 5

// validate the stored snapshot contract before replacing scenario progression and assembling teammate builds.
export function snapshotIssues(snapshot: BuildSnapshot): ScenarioInputIssue[] {
  const issues: ScenarioInputIssue[] = []
  if (snapshot.v !== 1) return ['snapshot_version']
  if (snapshot.echoes.length !== SNAPSHOT_ECHOES) issues.push('echo_count')
  if (snapshot.echoes.filter((echo) => echo.mainEcho).length !== 1) issues.push('main_echo')
  const slots = new Set(snapshot.echoes.map((echo) => echo.slot))
  if (slots.size !== snapshot.echoes.length || [...slots].some((slot) => slot < 0 || slot >= SNAPSHOT_ECHOES)) {
    issues.push('echo_slots')
  }
  const sequence = snapshot.resonator.sequence
  if (!Number.isInteger(sequence) || sequence < 0 || sequence > 6) issues.push('sequence')
  return issues
}

/** the card's echoes as runtime echoes, in card order. */
export function snapshotEchoes(snapshot: BuildSnapshot): EchoInstance[] {
  return [...snapshot.echoes].sort((a, b) => a.slot - b.slot).map((echo) => ({
    uid: `card:${echo.slot}`,
    id: echo.id,
    set: echo.set,
    mainEcho: echo.mainEcho,
    mainStats: {
      primary: { ...echo.main.primary },
      secondary: { ...echo.main.secondary },
    },
    substats: { ...echo.substats },
  }))
}

/** a teammate's echoes as runtime echoes. the build fixes stats, the main echo
    and the set counts; any echo of the right cost and set fills the rest, so
    the first one in the catalog is taken. */
export function teammateEchoes(
  teammate: ResolvedTeammate,
  teamSlot: string,
  deps: Pick<ScenarioInputDeps, 'echoes' | 'secondaryByCost'>,
): EchoInstance[] {
  const remaining = teammate.sets.map((set) => ({ ...set }))
  const used = new Set<string>()
  // reserve the required main Echo first, then allocate higher-cost slots while enforcing unique Echo identities.
  const order = teammate.echoes.map((echo, index) => ({ echo, index }))
    .sort((a, b) => Number(b.echo.mainEcho) - Number(a.echo.mainEcho) || b.echo.cost - a.echo.cost)
  const picked = new Map<number, { id: string; set: number }>()

  for (const { echo, index } of order) {
    let found: { id: string; set: number } | null = null
    for (const set of remaining.filter((entry) => entry.pieces > 0)) {
      const candidate = deps.echoes.find((entry) => entry.cost === echo.cost && entry.sets.includes(set.id) &&
        !used.has(entry.id) && (!echo.mainEcho || entry.id === teammate.mainEchoId))
      if (candidate) {
        found = { id: candidate.id, set: set.id }
        set.pieces -= 1
        break
      }
    }
    // pieces past the set plan (e.g. 3+2 plus a fifth echo) take any echo of the cost.
    if (!found) {
      const candidate = deps.echoes.find((entry) => entry.cost === echo.cost && !used.has(entry.id) &&
        (!echo.mainEcho || entry.id === teammate.mainEchoId))
      if (candidate) found = { id: candidate.id, set: candidate.sets[0] }
    }
    if (!found) throw new Error(`${teamSlot}: no ${echo.cost}-cost echo for slot ${index}`)
    used.add(found.id)
    picked.set(index, found)
  }

  return teammate.echoes.map((echo, index) => {
    const secondary = deps.secondaryByCost[echo.cost]
    if (!secondary) throw new Error(`No second main stat for cost ${echo.cost}`)
    const { id, set } = picked.get(index)!
    return {
      uid: `team:${teamSlot}:${index}`,
      id,
      set,
      mainEcho: echo.mainEcho,
      mainStats: {
        primary: { key: echo.main[0], value: echo.main[1] },
        secondary: { ...secondary },
      },
      substats: { ...echo.substats },
    }
  })
}

// combine the scored card seat with fixed teammate builds and return all validation issues before constructing a scenario.
export function buildScenarioInput(
  snapshot: BuildSnapshot,
  scenario: ScenarioDef,
  teammates: ReadonlyMap<string, ResolvedTeammate>,
  deps: ScenarioInputDeps,
): ScenarioInputResult {
  const issues = snapshotIssues(snapshot)
  const detail: string[] = []
  if (canonicalResonatorId(snapshot.resonator.id) !== canonicalResonatorId(scenario.resonatorId)) {
    issues.push('resonator_mismatch')
    detail.push(`card is ${snapshot.resonator.id}, scenario scores ${scenario.resonatorId}`)
  }
  if (issues.length) return { ok: false, issues, detail }

  const members: ScenarioInputMember[] = []
  let scoredSlot = -1
  // authored slot numbers determine team order; the scored seat uses card Echoes and sequence with the scenario weapon.
  for (const member of [...scenario.members].sort((a, b) => a.slot - b.slot)) {
    if (member.isContext) {
      scoredSlot = member.slot
      members.push({
        slot: member.slot,
        resonatorId: snapshot.resonator.id,
        role: 'scored',
        mode: member.mode,
        sequence: snapshot.resonator.sequence,
        weapon: { id: scenario.weapon.id, rank: scenario.weapon.rank },
        echoes: snapshotEchoes(snapshot),
      })
      continue
    }

    const teammate = member.teamSlot ? teammates.get(member.teamSlot) : undefined
    if (!teammate) {
      issues.push('teammate_missing')
      detail.push(`no teammate build for ${member.teamSlot ?? `slot ${member.slot}`}`)
      continue
    }
    if (canonicalResonatorId(teammate.resonatorId) !== canonicalResonatorId(member.resonatorId)) {
      issues.push('teammate_mismatch')
      detail.push(`${member.teamSlot} holds ${teammate.resonatorId}, scenario seats ${member.resonatorId}`)
      continue
    }
    let echoes: EchoInstance[]
    try {
      echoes = teammateEchoes(teammate, member.teamSlot!, deps)
    } catch (error) {
      issues.push('teammate_echo')
      detail.push(String((error as Error).message))
      continue
    }
    members.push({
      slot: member.slot,
      resonatorId: member.resonatorId,
      role: 'teammate',
      mode: member.mode,
      sequence: teammate.sequence,
      weapon: { ...teammate.weapon },
      echoes,
    })
  }
  if (issues.length) return { ok: false, issues: [...new Set(issues)], detail }

  return {
    ok: true,
    input: {
      v: 1,
      scenarioId: scenario.id,
      teamId: scenario.teamId,
      scoredSlot,
      members,
      enemy: deps.enemyFor(members.map((member) => member.resonatorId)),
    },
  }
}
