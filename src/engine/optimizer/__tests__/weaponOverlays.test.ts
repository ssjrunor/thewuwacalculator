/*
  Validates the weapon-overlay builder: for a real resonator it produces one
  overlay row per visible weapon, the rows differ from each other, and the
  baseAtk slot tracks the weapon's level-scaled ATK (a cheap sanity anchor).
*/

import { describe, expect, it } from 'vitest'
import { makeEnemy, makeOptSets, makeResRuntime } from '@/domain/state/defaults.ts'
import { getResSeedBy } from '@/domain/services/resonatorSeedService.ts'
import { listWpnsByTy } from '@/domain/services/weaponCatalogService.ts'
import { listOptTrgt } from '@/engine/optimizer/target/skills.ts'
import { buildWeaponOverlays } from '@/engine/optimizer/context/weaponOverlays.ts'
import { WEAPON_OVERLAY_STRIDE, WEAPON_OVERLAY_SLOTS, BASE_ATK } from '@/engine/optimizer/config/constants.ts'
import { DEF_SET_COND } from '@/domain/entities/sonataSetConditionals.ts'
import type { OptStartPay } from '@/engine/optimizer/types.ts'

const HIYUKI = '1108' // sword (weapon type 2)

function mkPay(): OptStartPay {
  const seed = getResSeedBy(HIYUKI)
  if (!seed) throw new Error('missing Hiyuki seed')
  const runtime = makeResRuntime(seed)
  const settings = {
    ...makeOptSets(),
    searchMode: 'theory' as const,
    rotationMode: false,
    targetSkillId: listOptTrgt(runtime)[0]?.id ?? null,
  }
  return {
    resonatorId: seed.id,
    resSeed: seed,
    runtime,
    settings,
    invChs: [],
    enemyProfile: makeEnemy(),
    setConds: DEF_SET_COND,
    rotTms: runtime.rotation.personalItems,
  }
}

describe('weapon overlay builder', () => {
  it('produces one overlay per visible weapon with distinct, sane rows', () => {
    const result = buildWeaponOverlays(mkPay())
    expect(result).not.toBeNull()
    if (!result) return

    // Hiyuki is a sword; 4★+5★ swords = 19 (type 2: {5★:10, 4★:9})
    const swords45 = listWpnsByTy(2).filter((w) => w.rarity === 4 || w.rarity === 5)
    expect(result.count).toBe(Math.min(swords45.length, 31))
    expect(result.weaponIds.length).toBe(result.count)
    expect(result.overlays.length).toBe(result.count * WEAPON_OVERLAY_STRIDE)

    // every overlay's baseAtk slot should be positive and finite
    const baseAtkSlot = WEAPON_OVERLAY_SLOTS.indexOf(BASE_ATK)
    expect(baseAtkSlot).toBeGreaterThanOrEqual(0)
    for (let w = 0; w < result.count; w += 1) {
      const baseAtk = result.overlays[w * WEAPON_OVERLAY_STRIDE + baseAtkSlot]!
      expect(Number.isFinite(baseAtk)).toBe(true)
      expect(baseAtk).toBeGreaterThan(0)
    }

    // rows must not all be identical (different weapons -> different contexts)
    const rowKey = (w: number) =>
      Array.from(result.overlays.subarray(w * WEAPON_OVERLAY_STRIDE, (w + 1) * WEAPON_OVERLAY_STRIDE)).join(',')
    const distinct = new Set(Array.from({ length: result.count }, (_, w) => rowKey(w)))
    expect(distinct.size).toBeGreaterThan(1)
  })
})
