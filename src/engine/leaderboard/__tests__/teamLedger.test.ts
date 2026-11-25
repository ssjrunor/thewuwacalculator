/*
  Author: Runor Ewhro
  description: tests contribution.team (teamLedger.ts) on a real scored run
               (Phoebe S6 with Shorekeeper and Zani, a stored local rotation):
               every member's damage, and the teammate effects that reached
               Phoebe with their share.
*/

import { describe, expect, it } from 'vitest'
import type { CombatScenario } from '@/domain/entities/combatScenario'
import { ensureResonatorData } from '@/data/gameData'
import { executeCombatScenarioProgram, prepareCombatScenario } from '@/engine/pipeline/combatScenario'
import { projectScenarioEngineRuntimes } from '@/engine/runtime/scenarioRuntime'
import { scoredContribution } from '../execute'
import { teamLedger } from '../teamLedger'
import scenario from './fixtures/phoebeTeamRun.json'

describe('team ledger', () => {
  it('splits the team damage and lists what the teammates put on the scored resonator', async () => {
    const run = scenario as unknown as CombatScenario
    await ensureResonatorData(run.team.members.map((member) => member.resonatorId))
    const result = executeCombatScenarioProgram(prepareCombatScenario(run), run.program.program)!
    const { subjectRuntime, runtimesById } = projectScenarioEngineRuntimes(run)
    const ledger = teamLedger(result, subjectRuntime, runtimesById)

    // the scored member's share is the row's DPR.
    expect(ledger.members.map((member) => member.resonatorId).sort()).toEqual(['1505', '1506', '1507'])
    const phoebe = ledger.members.find((member) => member.resonatorId === '1506')!
    expect(phoebe.damage).toBe(Math.round(scoredContribution(result.entries, '1506').damage))
    expect(ledger.members.every((member) => member.damage > 0)).toBe(true)

    // only teammates' effects, each with what it does and a cover inside 0..100.
    expect(ledger.buffs.every((buff) => buff.from !== '1506' && buff.covers > 0 && buff.covers <= 100)).toBe(true)
    const butterfly = ledger.buffs.find((buff) => buff.name === 'Binary Butterfly')!
    expect(butterfly).toMatchObject({ from: '1505', kind: 'Outro Skill', effects: [{ text: 'DMG Amplify', value: '+15%' }] })
    const beacon = ledger.buffs.find((buff) => buff.name === 'Beacon For the Future')!
    expect(beacon).toMatchObject({ from: '1507', effects: [{ text: 'Spectro DMG Amplify', value: '+20%' }] })
    // a stat-driven value is labelled with stats: Inner Stellarealm reads Shorekeeper's energy regen.
    expect(ledger.buffs.find((buff) => buff.name === 'Inner Stellarealm')?.effects[0]).toEqual({ text: 'Crit Rate', value: '+12.5%' })
    // the weapon and echo set that buff her name their source.
    expect(ledger.buffs.find((buff) => buff.source.type === 'weapon')?.source.id).toBe('21050036')
    expect(ledger.buffs.find((buff) => buff.source.type === 'echoSet')?.name).toBe('Rejuvenating Glow 5pc')
  }, 120_000)
})
