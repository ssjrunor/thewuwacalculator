/*
  Author: Runor Ewhro
  description: every weapon in the scenario and teammate data plays at the rank
               the leaderboard rule gives it: limited 5-stars R1, standard
               5-stars and anything below 5 stars R5.
*/

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { STANDARD_WEAPON_IDS, leaderboardWeaponRank } from '@/engine/leaderboard/weaponRank'

const root = join(__dirname, '../../../..')
const readJson = (path: string) => JSON.parse(readFileSync(join(root, path), 'utf8'))
const catalog: { id: string; rarity: number }[] = readJson('public/data/beta/weapons/catalog.json')
const rarity = new Map(catalog.map((weapon) => [String(weapon.id), weapon.rarity]))

describe('leaderboard weapon rank', () => {
  it('knows every standard weapon as a 5-star', () => {
    for (const id of STANDARD_WEAPON_IDS) expect(rarity.get(id), id).toBe(5)
  })

  it('ranks limited 5-stars R1 and the rest R5', () => {
    expect(leaderboardWeaponRank('21050036', 5)).toBe(1)
    expect(leaderboardWeaponRank('21030015', 5)).toBe(5)
    expect(leaderboardWeaponRank('21050024', 4)).toBe(5)
  })

  it('applies the rank policy to every scenario and teammate weapon', () => {
    const scenarios = readJson('services/leaderboard/data/scenarios.json')
    const teammates = readJson('services/leaderboard/data/teammate-builds.json')
    const weapons: { id: string; rank: number }[] = [
      ...Object.values<{ weapons: { id: string; rank: number }[] }>(scenarios.resonators).flatMap((entry) => entry.weapons),
      ...Object.values<{ builds: { weapon: string; rank: number }[] }>(teammates.resonators)
        .flatMap((entry) => entry.builds.map((build) => ({ id: build.weapon, rank: build.rank }))),
    ]
    for (const weapon of weapons) expect(weapon.rank, weapon.id).toBe(leaderboardWeaponRank(weapon.id, rarity.get(weapon.id)!))
  })
})
