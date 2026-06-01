import { describe, expect, it } from 'vitest'
import {
  CTX_FLOATS,
  BASE_INDEX,
  OPT_COMBAT_AUX,
  COMBO_N,
  WORKGROUP_BASE,
  LOCKED_PACKED,
  META0,
  META1,
  SET_MASK,
} from '@/engine/optimizer/config/constants'
import {
  ptchTgtCtxDi,
  ptchTgtCtxFo,
} from '@/engine/optimizer/context/pack'

describe('optimizer gpu target context patching', () => {
  it('keeps the dispatch workgroup base in the shader-visible slot directly after set runtime mask', () => {
    expect(WORKGROUP_BASE).toBe(SET_MASK + 1)
    expect(COMBO_N).toBe(WORKGROUP_BASE + 1)
    expect(OPT_COMBAT_AUX).toBe(COMBO_N + 1)
  })

  it('resets and updates the per-dispatch workgroup base independently from the job base index', () => {
    const baseContext = new Float32Array(CTX_FLOATS)
    const baseU32 = new Uint32Array(baseContext.buffer)
    baseU32[META0] = (1206 | (3 << 12) | (5 << 18)) >>> 0
    baseU32[META1] = 123
    baseU32[COMBO_N] = 17
    baseU32[LOCKED_PACKED] = 9
    baseU32[BASE_INDEX] = 55
    baseU32[WORKGROUP_BASE] = 777

    const patched = ptchTgtCtxFo({
      baseContext,
      comboN: 12,
      comboK: 4,
      comboCount: 20_000_000,
      comboBaseIndex: 12345,
      lockEchoIdx: 6,
    })
    const patchedU32 = new Uint32Array(patched.buffer)

    expect(patchedU32[BASE_INDEX]).toBe(12345)
    expect(patchedU32[LOCKED_PACKED]).toBe(7)
    expect(patchedU32[WORKGROUP_BASE]).toBe(0)
    expect(patchedU32[META0] & 0xfff).toBe(1206)
    expect((patchedU32[META0] >>> 12) & 0xf).toBe(3)
    expect((patchedU32[META0] >>> 18) & 0x7).toBe(4)
    expect(patchedU32[META1]).toBe(20_000_000)
    expect(patchedU32[COMBO_N]).toBe(12)
    expect(baseU32[WORKGROUP_BASE]).toBe(777)

    ptchTgtCtxDi(patched, 321)
    expect(patchedU32[WORKGROUP_BASE]).toBe(321)
    expect(patchedU32[BASE_INDEX]).toBe(12345)
  })
})
