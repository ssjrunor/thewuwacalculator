/*
  Author: Runor Ewhro
  description: protects the card -> scenario handoff: every listed scenario turns
               a card into a complete generator input (scored seat from the card
               with the scenario weapon, both teammates from their fixed builds,
               modes per seat), and bad cards or data are refused.
*/

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { EnemyProfile } from '@/domain/entities/appState'
import type { BuildSnapshot } from '@/domain/leaderboard/snapshot'
import { buildScenarioInput, type ScenarioInputDeps } from '@/engine/leaderboard/scenarioInput'
import { scenarioDefs, type ScenariosFile } from '@/engine/leaderboard/scenarioDefs'
import { indexTeammateBuilds, type TeammateBuildsFile } from '@/engine/leaderboard/teammateBuilds'

const root = join(__dirname, '../../../..')
const readJson = (path: string) => JSON.parse(readFileSync(join(root, path), 'utf8'))
const scenarios: ScenariosFile = readJson('services/leaderboard/data/scenarios.json')
const builds: TeammateBuildsFile = readJson('services/leaderboard/data/teammate-builds.json')
const catalog: Array<{ id: string; cost: number; sets: number[] }> = readJson('public/data/beta/echoes/catalog.json')
const stats = readJson('public/data/beta/echoes/stats.json')

const enemy = (tuneStrain: number): EnemyProfile => ({
  id: 'custom:evaluation', level: 100, class: 4, toa: false, source: 'custom',
  status: { tuneStrain }, res: { 0: 20, 1: 20, 2: 20, 3: 20, 4: 20, 5: 20, 6: 20 },
})
const deps: ScenarioInputDeps = {
  echoes: catalog.map((echo) => ({ id: String(echo.id), cost: echo.cost, sets: echo.sets })),
  secondaryByCost: Object.fromEntries(Object.entries(stats.secondaryStats).map(([cost, stat]) => [Number(cost), stat as { key: string; value: number }])),
  enemyFor: (ids) => enemy(ids.length),
}
const teammates = indexTeammateBuilds(builds)
const recipeHashes = Object.fromEntries(Object.keys(scenarios.teams).map((id) => [id, `sha:${id}`]))
const defs = scenarioDefs({ rulesetId: 'test', scenarios, recipeHashes })

const heron = { id: '6000052', set: 8 }
function card(resonatorId: string, overrides: Partial<BuildSnapshot> = {}): BuildSnapshot {
  const echo = (slot: number, cost: number, primary: [string, number], mainEcho = false) => ({
    slot, id: slot === 0 ? heron.id : catalog.find((entry) => entry.cost === cost && entry.sets.includes(8))!.id,
    set: heron.set, mainEcho,
    main: { primary: { key: primary[0], value: primary[1] }, secondary: stats.secondaryStats[String(cost)] },
    substats: { critRate: 8.1, critDmg: 16.2, atkPercent: 8.6, energyRegen: 9.2, atkFlat: 40 },
  })
  return {
    v: 1, gameVer: 'test', uid: '700000001', name: null,
    resonator: { id: resonatorId, level: 90, sequence: 2, skillLevels: {} },
    weapon: { id: '21020016', level: 90 },
    echoes: [echo(0, 4, ['critRate', 22], true), echo(1, 3, ['glacio', 30]), echo(2, 3, ['glacio', 30]),
      echo(3, 1, ['atkPercent', 18]), echo(4, 1, ['atkPercent', 18])],
    ...overrides,
  }
}

describe('scenario definitions', () => {
  it('lists every resonator, team and weapon once', () => {
    const expected = Object.values(scenarios.resonators).reduce((sum, entry) => sum + entry.teams.length * entry.weapons.length, 0)
    expect(defs).toHaveLength(expected)
    expect(new Set(defs.map((def) => def.id)).size).toBe(defs.length)
  })
})

describe('scenario input', () => {
  it('builds a complete input for every scenario', () => {
    for (const def of defs) {
      const result = buildScenarioInput(card(def.resonatorId), def, teammates, deps)
      if (!result.ok) throw new Error(`${def.id}: ${result.issues.join(', ')} ${result.detail.join('; ')}`)
      const { input } = result
      expect(input.members).toHaveLength(def.members.length)
      expect(input.members.filter((member) => member.role === 'scored')).toHaveLength(1)
      for (const member of input.members) {
        expect(member.echoes).toHaveLength(5)
        expect(member.echoes.filter((echo) => echo.mainEcho)).toHaveLength(1)
        if (member.role === 'teammate') {
          const build = teammates.get(def.members[member.slot].teamSlot!)!
          // preserve the selected mode and the build's set plan.
          expect(member.mode, `${def.id} slot ${member.slot}`).toBe(def.members[member.slot].mode)
          expect(member.echoes.find((echo) => echo.mainEcho)!.id).toBe(build.mainEchoId)
          for (const set of build.sets) {
            expect(member.echoes.filter((echo) => echo.set === set.id).length).toBeGreaterThanOrEqual(set.pieces)
          }
        }
      }
    }
  })

  it('seats the card with the scenario weapon and the teammates with their builds', () => {
    const def = defs.find((entry) => entry.teamId === 't1' && entry.resonatorId === '1102')!
    const result = buildScenarioInput(card('1102'), def, teammates, deps)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const scored = result.input.members[result.input.scoredSlot]
    expect(scored.resonatorId).toBe('1102')
    expect(scored.sequence).toBe(2)
    expect(scored.weapon).toEqual({ id: def.weapon.id, rank: def.weapon.rank })
    expect(scored.echoes[0]).toMatchObject({ uid: 'card:0', id: heron.id, mainEcho: true })
    const shorekeeper = result.input.members.find((member) => member.resonatorId === '1505')!
    expect(shorekeeper.role).toBe('teammate')
    expect(shorekeeper.weapon).toEqual({ id: '21050036', rank: 1 })
    expect(shorekeeper.echoes[1].mainStats.primary).toEqual({ key: 'energyRegen', value: 32 })
    expect(result.input.enemy.status?.tuneStrain).toBe(3)
  })

  it('preserves each seat\'s resonance mode', () => {
    const def = defs.find((entry) => entry.members.some((member) => member.resonatorId === '1211' && member.mode === 'tune_strain' && !member.isContext))!
    const result = buildScenarioInput(card(def.resonatorId), def, teammates, deps)
    expect(result.ok && result.input.members.find((member) => member.resonatorId === '1211')!.mode).toBe('tune_strain')
  })

  it('refuses a card for another resonator, a bad echo set-up or a missing teammate', () => {
    const def = defs.find((entry) => entry.teamId === 't1' && entry.resonatorId === '1102')!
    const other = buildScenarioInput(card('1505'), def, teammates, deps)
    expect(!other.ok && other.issues).toEqual(['resonator_mismatch'])
    const short = card('1102')
    const four = buildScenarioInput({ ...short, echoes: short.echoes.slice(0, 4) }, def, teammates, deps)
    expect(!four.ok && four.issues).toContain('echo_count')
    const missing = buildScenarioInput(card('1102'), def, new Map(), deps)
    expect(!missing.ok && missing.issues).toEqual(['teammate_missing'])
  })

  it('treats rover gender variants as one resonator', () => {
    const def = defs.find((entry) => entry.resonatorId === '1501')
    if (!def) return
    expect(buildScenarioInput(card('1502'), def, teammates, deps).ok).toBe(true)
  })
})
