/*
  Unit-tests the CPU weapon evaluation core: composeWeaponContexts overlays only
  the weapon-varying slots, and evalTgtCpuCmWeapons returns the argmax weapon.
*/

import { describe, expect, it } from 'vitest'
import { makeResRuntime, makeEnemy, makeOptSets } from '@/domain/state/defaults.ts'
import { getResSeedBy } from '@/domain/services/resonatorSeedService.ts'
import { listOptTrgt } from '@/engine/optimizer/target/skills.ts'
import { compOptTgtCt } from '@/engine/optimizer/target/context.ts'
import { packTargetCtx } from '@/engine/optimizer/context/pack.ts'
import { makeRuntimeMap } from '@/domain/state/runtimeAdapters.ts'
import { stripEchoes } from '@/engine/optimizer/compiler/shared.ts'
import {
  composeWeaponContexts,
  evalTgtCpuCmWeapons,
} from '@/engine/optimizer/target/cpu.ts'
import { makeCpuScratch } from '@/engine/optimizer/cpu/scratch.ts'
import {
  BASE_ATK,
  FINAL_ATK,
  WEAPON_OVERLAY_SLOTS,
  WEAPON_OVERLAY_STRIDE,
} from '@/engine/optimizer/config/constants.ts'

const HIYUKI = '1108'

// build a real single-skill packed context for Hiyuki to use as the base.
function baseContext(): Float32Array {
  const seed = getResSeedBy(HIYUKI)
  if (!seed) throw new Error('missing Hiyuki seed')
  const runtime = stripEchoes(makeResRuntime(seed))
  const settings = { ...makeOptSets(), targetSkillId: listOptTrgt(runtime)[0]?.id ?? null }
  const target = compOptTgtCt({
    runtime,
    resonatorId: seed.id,
    resSeed: seed,
    skillId: settings.targetSkillId!,
    enemy: makeEnemy(),
    runtimesById: makeRuntimeMap(runtime),
  })
  return packTargetCtx({
    compiled: target.compiled,
    skill: target.skill,
    runtime,
    comboN: 1, comboK: 1, comboCount: 1, comboBaseIndex: 0, lockEchoIdx: -1, setRtMask: 0,
  })
}

describe('weapon eval core', () => {
  it('composeWeaponContexts overlays only the weapon slots', () => {
    const base = baseContext()
    // two weapons: identical to base except slot values bumped on weapon 1
    const overlays = new Float32Array(2 * WEAPON_OVERLAY_STRIDE)
    for (let s = 0; s < WEAPON_OVERLAY_STRIDE; s += 1) {
      overlays[s] = base[WEAPON_OVERLAY_SLOTS[s]!]! // weapon 0 == base
      overlays[WEAPON_OVERLAY_STRIDE + s] = base[WEAPON_OVERLAY_SLOTS[s]!]!
    }
    // weapon 1: double the ATK-related slots
    const baseAtkSlot = WEAPON_OVERLAY_SLOTS.indexOf(BASE_ATK)
    const finalAtkSlot = WEAPON_OVERLAY_SLOTS.indexOf(FINAL_ATK)
    overlays[WEAPON_OVERLAY_STRIDE + baseAtkSlot] = base[BASE_ATK]! * 2
    overlays[WEAPON_OVERLAY_STRIDE + finalAtkSlot] = base[FINAL_ATK]! * 2

    const [ctx0, ctx1] = composeWeaponContexts(base, overlays, 2)
    // ctx0 must equal base on every slot
    for (let i = 0; i < base.length; i += 1) {
      expect(ctx0![i]).toBeCloseTo(base[i]!, 5)
    }
    // ctx1 differs only on the overlaid slots
    expect(ctx1![BASE_ATK]).toBeCloseTo(base[BASE_ATK]! * 2, 3)
    expect(ctx1![FINAL_ATK]).toBeCloseTo(base[FINAL_ATK]! * 2, 3)
    const overlaid = new Set<number>(WEAPON_OVERLAY_SLOTS)
    for (let i = 0; i < base.length; i += 1) {
      if (!overlaid.has(i)) {
        expect(ctx1![i]).toBeCloseTo(base[i]!, 5)
      }
    }
  })

  it('evalTgtCpuCmWeapons picks the higher-ATK weapon', () => {
    const base = baseContext()
    const overlays = new Float32Array(2 * WEAPON_OVERLAY_STRIDE)
    for (let s = 0; s < WEAPON_OVERLAY_STRIDE; s += 1) {
      overlays[s] = base[WEAPON_OVERLAY_SLOTS[s]!]!
      overlays[WEAPON_OVERLAY_STRIDE + s] = base[WEAPON_OVERLAY_SLOTS[s]!]!
    }
    const baseAtkSlot = WEAPON_OVERLAY_SLOTS.indexOf(BASE_ATK)
    const finalAtkSlot = WEAPON_OVERLAY_SLOTS.indexOf(FINAL_ATK)
    overlays[WEAPON_OVERLAY_STRIDE + baseAtkSlot] = base[BASE_ATK]! + 2000
    overlays[WEAPON_OVERLAY_STRIDE + finalAtkSlot] = base[FINAL_ATK]! + 2000

    const weaponContexts = composeWeaponContexts(base, overlays, 2)

    // minimal single-echo combo; empty stats/sets so it's a clean baseline.
    const echoCount = 8
    const stats = new Float32Array(echoCount * 20)
    const sets = new Uint8Array(echoCount).fill(255) // no set
    const kinds = new Uint16Array(echoCount)
    const setConstLut = new Float32Array(33 * 5 * 23)
    const mainEchoBuffs = new Float32Array(echoCount * 18)
    // disable every constraint: a (min,max) pair is disabled when min > max
    const constraints = new Float32Array(16)
    for (let i = 0; i < 8; i += 1) {
      constraints[i * 2] = 1
      constraints[i * 2 + 1] = 0
    }
    const comboIds = Int32Array.from([0, 1, 2, 3, 4])

    const result = evalTgtCpuCmWeapons({
      weaponContexts,
      stats, setConstLut, mainEchoBuffs, sets, kinds, constraints,
      comboIds, lockMainIdx: comboIds[0]!, scratch: makeCpuScratch(),
    })

    expect(result).not.toBeNull()
    expect(result!.weaponIndex).toBe(1) // the +2000 ATK weapon wins
    expect(result!.damage).toBeGreaterThan(0)
  })
})
