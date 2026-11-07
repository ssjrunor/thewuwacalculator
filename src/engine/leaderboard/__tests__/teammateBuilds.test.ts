/*
  Author: Runor Ewhro
  description: guards the fixed teammate builds: every team seat that is a
               teammate in some scenario has exactly one build, and every build
               is legal in the game data (mains, rolls, sets, main echo, weapon).
*/

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { indexTeammateBuilds, teamSlotKey, type TeammateBuildsFile } from '@/engine/leaderboard/teammateBuilds'
import { canonicalResonatorId as canonical } from '@/engine/leaderboard/scenarioInput'
import type { ScenariosFile } from '@/engine/leaderboard/scenarioDefs'

const root = join(__dirname, '../../../..')
const readJson = (path: string) => JSON.parse(readFileSync(join(root, path), 'utf8'))
const file: TeammateBuildsFile = readJson('services/leaderboard/data/teammate-builds.json')
const scenarios: ScenariosFile = readJson('services/leaderboard/data/scenarios.json')
const stats = readJson('public/data/beta/echoes/stats.json')
const weapons = new Set(readJson('public/data/beta/weapons/catalog.json').map((w: { id: string }) => String(w.id)))
const sets = new Set(readJson('public/data/beta/sonata/sets.json').map((s: { id: number }) => s.id))
const echoes = new Map(readJson('public/data/beta/echoes/catalog.json').map((e: { id: string; cost: number; sets: number[] }) => [String(e.id), e]))

function legalRolls(key: string): number[] {
  if (key === 'hpFlat') return [320, 360, 390, 430, 470, 510, 540, 580]
  const { min, max, divisions } = stats.substatRanges[key]
  const step = (max - min) / divisions
  return Array.from({ length: divisions + 1 }, (_, index) => {
    const raw = min + step * index
    return key.endsWith('Flat') ? Math.ceil(raw / 10) * 10 : Number(raw.toFixed(1))
  })
}

/** team seats that are a teammate in at least one scenario. */
function teammateSlots(): Array<{ key: string; resonatorId: string }> {
  return Object.entries(scenarios.teams).flatMap(([teamId, seats]) => {
    const scored = Object.entries(scenarios.resonators)
      .filter(([, entry]) => entry.teams.includes(teamId)).map(([id]) => canonical(id))
    return seats.flatMap((seat, index) => scored.some((id) => id !== canonical(seat.resonatorId))
      ? [{ key: teamSlotKey(teamId, index), resonatorId: canonical(seat.resonatorId) }] : [])
  })
}

describe('teammate builds', () => {
  const index = indexTeammateBuilds(file)

  it('covers every teammate slot exactly once, with the right resonator', () => {
    const slots = teammateSlots()
    expect(slots.length).toBeGreaterThan(0)
    for (const slot of slots) expect(index.get(slot.key)?.resonatorId, slot.key).toBe(slot.resonatorId)
    expect(index.size).toBe(slots.length)
  })

  it.each(Object.entries(file.resonators))('%s builds are legal', (_id, entry) => {
    for (const layout of entry.builds) {
      expect(weapons.has(layout.weapon)).toBe(true)
      expect([1, 5]).toContain(layout.rank)
      for (const echo of layout.echoes) {
        expect(stats.primaryStats[String(echo.cost)][echo.main[0]], `${echo.cost}-cost ${echo.main[0]}`).toBe(echo.main[1])
        const keys = Object.keys(echo.substats)
        expect(keys).toHaveLength(5)
        for (const key of keys) expect(legalRolls(key), key).toContain(echo.substats[key])
      }
      for (const outfit of layout.outfits) {
        const main = echoes.get(outfit.mainEcho) as { cost: number; sets: number[] } | undefined
        expect(main, outfit.mainEcho).toBeDefined()
        expect(layout.echoes[outfit.mainSlot].cost).toBe(main!.cost)
        expect(outfit.sets.reduce((sum, [, pieces]) => sum + pieces, 0)).toBeLessThanOrEqual(5)
        for (const [id] of outfit.sets) expect(sets.has(id)).toBe(true)
      }
    }
  })
})
