/*
  Author: Runor Ewhro
  description: a card scores end to end against a packaged ruleset: the
               package is opened through its hashes, the engine reads game data
               from the package, the team's plan generates a program, the
               executor's damage becomes dps and a score against the refs, and
               the best scenario is picked. execution is a fixed fake here (the
               real executor is not connected yet), and the scored path also
               takes a fixed program, since no scenario's characters are fully
               covered by the generator's rules yet.
*/

import { beforeAll, describe, expect, it } from 'vitest'
import type { BuildSnapshot } from '@/domain/leaderboard/snapshot'
import {
  openRuleset, openScoringSession, pendingRotationExecutor, pickBest, scoreBuild, scoreScenario,
  RulesetError, ScoringDataConflict, bindRulesetGameData,
  type OpenedRuleset, type RotationExecutor, type RotationGenerator, type RulesetFiles, type ScoringSession,
} from '@/engine/leaderboard'
import { assembleRuleset, attachRefs } from '../tools/lib/ruleset.mjs'

type Package = { manifest: { scenarios: Array<{ id: string; resonatorId: string; teamId: string; weapon: { id: string } }> }; files: Map<string, string> }

const encoder = new TextEncoder()
const memoryFiles = (pkg: Package): RulesetFiles => ({
  read: async (path) => (pkg.files.has(path) ? encoder.encode(pkg.files.get(path)!) : null),
})

function phoebeCard(): BuildSnapshot {
  const echo = (slot: number, id: string, set: number, primary: [string, number], secondary: [string, number]) => ({
    slot, id, set, mainEcho: slot === 0,
    main: { primary: { key: primary[0], value: primary[1] }, secondary: { key: secondary[0], value: secondary[1] } },
    substats: { critRate: 8.1, critDmg: 16.2, atkPercent: 8.6, energyRegen: 9.2, atkFlat: 40 },
  })
  return {
    v: 1, gameVer: 'test', uid: '700000001', name: null,
    resonator: { id: '1506', level: 90, sequence: 0, skillLevels: {} },
    weapon: { id: '21050046', level: 90 },
    // phoebe's usual set: Eternal Radiance with the Fallacy of No Return main echo.
    echoes: [echo(0, '6000104', 11, ['spectro', 30], ['atkFlat', 100]), echo(1, '6000064', 11, ['atkPercent', 18], ['hpFlat', 2280]),
      echo(2, '6000067', 11, ['atkPercent', 18], ['hpFlat', 2280]), echo(3, '6000092', 11, ['critDmg', 44], ['atkFlat', 150]),
      echo(4, '6000096', 11, ['spectro', 30], ['atkFlat', 100])],
  }
}

const TARGET = '1506:t547:21050046'
const fixedDamage: RotationExecutor = async ({ duration }) => ({ status: 'ok', damage: 50_000 * duration })
/** a fixed 20 s program that names the plan's sections, standing in for full rule coverage. */
const fixedProgram: RotationGenerator = async (plan, scenario) => ({
  status: 'interpreted', duration: 20, diagnostics: {},
  scenario: { ...scenario, initialOnFieldMemberId: scenario.team.members[plan.initialActiveSlot].id,
    program: { ...scenario.program, program: plan.sections.map((_, index) => ({ kind: 'section', index })) as never } },
})
const scoredPath = () => ({ ...session.context(fixedDamage), generate: fixedProgram })

let pkg: Package
let ruleset: OpenedRuleset
let session: ScoringSession

beforeAll(async () => {
  const assembled = await assembleRuleset({ id: 'score-test', mode: 'beta', gameVersion: 'test' }) as Package
  const target = assembled.manifest.scenarios.find((def) => def.id.endsWith(TARGET))!
  pkg = attachRefs(assembled, [
    { scenarioId: target.id, sequence: 0, status: 'ok', baselineDps: 20_000, benchDps: 40_000, perfectDps: 60_000,
      programs: { baseline: 'a', bench: 'b', perfect: 'c' } },
  ]) as Package
  ruleset = await openRuleset(memoryFiles(pkg))
  session = await openScoringSession(ruleset)
}, 60_000)

describe('scoring a card against a ruleset', () => {
  it('turns a program\'s damage into dps and scores it against the refs', async () => {
    const def = ruleset.defs.find((entry) => entry.id.endsWith(TARGET))!
    const first = await scoreScenario(phoebeCard(), def, scoredPath())
    expect(first.status, JSON.stringify(first.detail)).toBe('ok')
    expect(first.dps).toBeCloseTo(50_000)
    expect(first.score).toBeCloseTo(150)
    expect(first.program?.program.length).toBeGreaterThan(0)
    expect(first.programSha256).toMatch(/^[0-9a-f]{64}$/)
    // the same card and ruleset give byte-identical programs and so the same hash.
    const again = await scoreScenario(phoebeCard(), def, scoredPath())
    expect(again.programText).toBe(first.programText)
    expect(again.programSha256).toBe(first.programSha256)
  }, 60_000)

  it('reports every scenario without a score until execution is connected', async () => {
    const def = ruleset.defs.find((entry) => entry.id.endsWith(TARGET))!
    const row = await scoreScenario(phoebeCard(), def, { ...session.context(pendingRotationExecutor), generate: fixedProgram })
    expect(row).toMatchObject({ status: 'unsupported', reason: 'rotation_execution_pending', score: null })
    expect(row.programSha256).toMatch(/^[0-9a-f]{64}$/)
  }, 60_000)

  it('runs the real generator: a covered scenario gets a program, a gap is an unsupported row with its diagnostics', async () => {
    const result = await scoreBuild(phoebeCard(), ruleset.defs, session.context(fixedDamage))
    expect(result.rows.length).toBe(ruleset.defs.filter((def) => def.resonatorId === '1506').length)
    // coverage grows as characters and gear are translated, so each row is checked by its outcome.
    for (const row of result.rows) {
      expect(['ok', 'unsupported'], JSON.stringify(row.detail)).toContain(row.status)
      if (row.status === 'ok') {
        expect(row.program?.program.length).toBeGreaterThan(0)
        expect(row.programSha256).toMatch(/^[0-9a-f]{64}$/)
      } else {
        expect(row.reason).toBeTruthy()
        expect(row.detail).toBeTruthy()
        expect(row.score).toBeNull()
      }
    }
  }, 180_000)

  it('scores every scenario of the resonator and picks the best scored one', async () => {
    const result = await scoreBuild(phoebeCard(), ruleset.defs, scoredPath())
    expect(result.rows.map((row) => row.scenarioId)).toEqual(
      ruleset.defs.filter((def) => def.resonatorId === '1506').map((def) => def.id))
    for (const row of result.rows) expect(['ok', 'unsupported', 'error']).toContain(row.status)
    expect(result.rows.filter((row) => row.status === 'error'), JSON.stringify(result.rows.filter((row) => row.status === 'error').map((row) => row.detail))).toEqual([])
    // only the scenario with refs has a score, so it is the best.
    expect(result.best?.scenarioId).toMatch(new RegExp(`${TARGET}$`))
    expect(pickBest(result.rows)).toBe(result.best)
  }, 180_000)

  it('refuses a card that is not the scenario\'s resonator as unsupported, not as zero', async () => {
    const def = ruleset.defs.find((entry) => entry.id.endsWith(TARGET))!
    const card = phoebeCard()
    card.echoes = card.echoes.slice(0, 4)
    const row = await scoreScenario(card, def, session.context(fixedDamage))
    expect(row).toMatchObject({ status: 'unsupported', reason: 'scenario_input', dps: null, score: null })
  })

  it('refuses tampered files and a second game data snapshot in the same process', async () => {
    const tampered = new Map(pkg.files)
    tampered.set('teammates.json', tampered.get('teammates.json')!.replace('"sequence":0', '"sequence":1'))
    await expect(openRuleset(memoryFiles({ ...pkg, files: tampered }))).rejects.toBeInstanceOf(RulesetError)
    const other = await openRuleset(memoryFiles(pkg))
    await expect(bindRulesetGameData({ ...other, gameDataFingerprint: 'f'.repeat(64) })).rejects.toBeInstanceOf(ScoringDataConflict)
  })
})
