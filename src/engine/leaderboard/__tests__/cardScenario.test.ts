/*
  Author: Runor Ewhro
  description: tests the submitted-build scenario: its own weapon at the assumed
               rank, with no teammates.
*/

import { describe, expect, it } from 'vitest'
import type { BuildSnapshot } from '@/domain/leaderboard/snapshot'
import { ensureResonatorData } from '@/data/gameData'
import { cardBuildStats, cardScenarioInput, createScenario } from '@/engine/leaderboard'

function snapshot(weaponId: string): BuildSnapshot {
  const echo = (slot: number) => ({ slot, id: '6000199', set: 30, mainEcho: slot === 0,
    main: { primary: { key: 'critDmg', value: 44 }, secondary: { key: 'atkFlat', value: 150 } }, substats: { critRate: 8.1 } })
  return { v: 1, uid: '500000001', resonator: { id: '1108', level: 90, sequence: 0, skillLevels: {} },
    weapon: { id: weaponId, level: 90 }, echoes: [0, 1, 2, 3, 4].map(echo) } as unknown as BuildSnapshot
}

describe('card scenario', () => {
  it('keeps the read weapon and seats the build alone', async () => {
    await ensureResonatorData(['1108'])
    const input = cardScenarioInput(snapshot('21020086'))
    expect(input.members).toHaveLength(1)
    // a limited five-star is assumed at R1.
    expect(input.members[0]).toMatchObject({ resonatorId: '1108', role: 'scored', sequence: 0, weapon: { id: '21020086', rank: 1 } })
    expect(createScenario(input).team.members).toHaveLength(1)
    // a standard five-star is assumed at R5.
    expect(cardScenarioInput(snapshot('21020015')).members[0].weapon.rank).toBe(5)
    expect(await cardBuildStats(snapshot('21020086'))).toMatchObject({ critRate: expect.any(Number), atk: expect.any(Number) })
  }, 60_000)
})
