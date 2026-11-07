/*
  Author: Runor Ewhro
  description: a created scenario is one the engine takes as it is: maxed seats
               with the input's builds, the scored seat as context, the mode in
               the seat's controls, the scoring enemy as target, and a final stat
               sheet for every seat.
*/

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ensureResonatorData } from '@/data/gameData'
import type { BuildSnapshot } from '@/domain/leaderboard/snapshot'
import { buildScenarioInput } from '@/engine/leaderboard/scenarioInput'
import { scenarioInputDeps } from '@/engine/leaderboard/scenarioInputDeps'
import { scenarioDefs, type ScenariosFile } from '@/engine/leaderboard/scenarioDefs'
import { indexTeammateBuilds, type TeammateBuildsFile } from '@/engine/leaderboard/teammateBuilds'
import { createScenario, modeControlKey, scenarioResonatorIds } from '@/engine/leaderboard/scenario'
import { mkPartRtLkp } from '@/engine/runtime/runtimeAdapters'
import { findCombatPart, makeCombatGraph } from '@/engine/runtime/combatGraph'
import { makeCombatEnv } from '@/engine/pipeline/buildCombatContext'
import { getResSeedBy } from '@/data/catalog/resonatorSeedService'

const root = join(__dirname, '../../../..')
const readJson = (path: string) => JSON.parse(readFileSync(join(root, path), 'utf8'))
const scenarios: ScenariosFile = readJson('services/leaderboard/data/scenarios.json')
const teammates = indexTeammateBuilds(readJson('services/leaderboard/data/teammate-builds.json') as TeammateBuildsFile)
const recipeHashes = Object.fromEntries(Object.keys(scenarios.teams).map((id) => [id, `sha:${id}`]))
const defs = scenarioDefs({ rulesetId: 'test', scenarios, recipeHashes })

function card(resonatorId: string): BuildSnapshot {
  const echo = (slot: number, id: string, set: number, primary: [string, number], secondary: [string, number]) => ({
    slot, id, set, mainEcho: slot === 0,
    main: { primary: { key: primary[0], value: primary[1] }, secondary: { key: secondary[0], value: secondary[1] } },
    substats: { critRate: 8.1, critDmg: 16.2, atkPercent: 8.6, energyRegen: 9.2, atkFlat: 40 },
  })
  return {
    v: 1, gameVer: 'test', uid: '700000001', name: null,
    resonator: { id: resonatorId, level: 90, sequence: 0, skillLevels: {} },
    weapon: { id: '21020016', level: 90 },
    echoes: [echo(0, '6000052', 8, ['critRate', 22], ['atkFlat', 150]), echo(1, '6000044', 8, ['atkPercent', 30], ['atkFlat', 100]),
      echo(2, '6000045', 8, ['atkPercent', 30], ['atkFlat', 100]), echo(3, '6000038', 8, ['atkPercent', 18], ['hpFlat', 2280]),
      echo(4, '6000039', 8, ['atkPercent', 18], ['hpFlat', 2280])],
  }
}

async function create(find: (def: (typeof defs)[number]) => boolean) {
  const def = defs.find(find)
  if (!def) throw new Error('no such scenario')
  const result = buildScenarioInput(card(def.resonatorId), def, teammates, scenarioInputDeps())
  if (!result.ok) throw new Error(result.issues.join(', '))
  await ensureResonatorData(scenarioResonatorIds(result.input))
  return { def, input: result.input, scenario: createScenario(result.input) }
}

describe('scenario creation', () => {
  it('seats maxed members with the input builds and the scored seat as context', async () => {
    const { def, input, scenario } = await create((entry) => entry.teamId === 't1' && entry.resonatorId === '1102')
    expect(scenario.id).toBe(def.id)
    expect(scenario.team.members).toHaveLength(3)
    const context = scenario.team.members.find((member) => member.id === scenario.contextMemberId)!
    expect(scenario.team.members[0]).toBe(context)
    expect(context.resonatorId).toBe('1102')
    expect(context.loadout.weapon).toMatchObject({ id: def.weapon.id, level: 90, rank: def.weapon.rank })
    expect(context.loadout.weapon.baseAtk).toBeGreaterThan(0)
    for (const member of scenario.team.members) {
      const source = input.members.find(seat => seat.resonatorId === member.resonatorId)!
      expect(member.progression.level).toBe(90)
      expect(member.progression.sequence).toBe(source.sequence)
      expect(member.loadout.echoes).toEqual(source.echoes)
    }
    expect(scenario.target).toEqual(input.enemy)
    // shorekeeper is no tune strain responder; the limit is the base one or more.
    expect(scenario.target.status?.tuneStrain).toBeGreaterThanOrEqual(1)
  })

  it('puts each seat in its resonance mode', async () => {
    const { scenario } = await create((entry) =>
      entry.members.some((member) => member.resonatorId === '1211' && member.mode === 'tune_strain' && !member.isContext))
    const denia = scenario.team.members.find((member) => member.resonatorId === '1211')!
    expect(denia.local.controls[modeControlKey('1211')]).toBe('tune_strain')
  })

  it('resolves final stats for every seat', async () => {
    const { scenario } = await create((entry) => entry.teamId === 't1' && entry.resonatorId === '1102')
    const runtimes = mkPartRtLkp(scenario)
    for (const member of scenario.team.members) {
      const runtime = runtimes[member.resonatorId]
      expect(runtime, member.resonatorId).toBeDefined()
      const graph = makeCombatGraph({ actRt: runtime, activeSeed: getResSeedBy(member.resonatorId)!, partRts: runtimes })
      const stats = makeCombatEnv({ graph, targetSlotId: findCombatPart(graph, member.resonatorId)!, enemy: scenario.target }).finalStats
      expect(stats.atk.final).toBeGreaterThan(stats.atk.base)
      // a seat without an ER requirement uses its base ER.
      expect(stats.energyRegen).toBeGreaterThanOrEqual(100)
      expect(stats.critRate).toBeGreaterThan(5)
    }
  })
})
