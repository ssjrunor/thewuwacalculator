import { describe, expect, it } from 'vitest'
import {
  OPTIMIZER_CONTEXT_FLOATS,
  OPTIMIZER_CTX_BASE_INDEX,
  OPTIMIZER_CTX_COMBAT_0,
  OPTIMIZER_CTX_COMBO_N,
  OPTIMIZER_CTX_DISPATCH_WORKGROUP_BASE,
  OPTIMIZER_CTX_LOCKED_PACKED,
  OPTIMIZER_CTX_META0,
  OPTIMIZER_CTX_META1,
  OPTIMIZER_CTX_SET_RUNTIME_MASK,
} from '@/engine/optimizer/config/constants'
import {
  patchTargetContextDispatchWorkgroupBase,
  patchTargetContextForGpuJob,
} from '@/engine/optimizer/context/pack'

describe('optimizer gpu target context patching', () => {
  it('keeps the dispatch workgroup base in the shader-visible slot directly after set runtime mask', () => {
    expect(OPTIMIZER_CTX_DISPATCH_WORKGROUP_BASE).toBe(OPTIMIZER_CTX_SET_RUNTIME_MASK + 1)
    expect(OPTIMIZER_CTX_COMBO_N).toBe(OPTIMIZER_CTX_DISPATCH_WORKGROUP_BASE + 1)
    expect(OPTIMIZER_CTX_COMBAT_0).toBe(OPTIMIZER_CTX_COMBO_N + 1)
  })

  it('resets and updates the per-dispatch workgroup base independently from the job base index', () => {
    const baseContext = new Float32Array(OPTIMIZER_CONTEXT_FLOATS)
    const baseU32 = new Uint32Array(baseContext.buffer)
    baseU32[OPTIMIZER_CTX_META0] = (1206 | (3 << 12) | (5 << 18)) >>> 0
    baseU32[OPTIMIZER_CTX_META1] = 123
    baseU32[OPTIMIZER_CTX_COMBO_N] = 17
    baseU32[OPTIMIZER_CTX_LOCKED_PACKED] = 9
    baseU32[OPTIMIZER_CTX_BASE_INDEX] = 55
    baseU32[OPTIMIZER_CTX_DISPATCH_WORKGROUP_BASE] = 777

    const patched = patchTargetContextForGpuJob({
      baseContext,
      comboN: 12,
      comboK: 4,
      comboCount: 20_000_000,
      comboBaseIndex: 12345,
      lockedEchoIndex: 6,
    })
    const patchedU32 = new Uint32Array(patched.buffer)

    expect(patchedU32[OPTIMIZER_CTX_BASE_INDEX]).toBe(12345)
    expect(patchedU32[OPTIMIZER_CTX_LOCKED_PACKED]).toBe(7)
    expect(patchedU32[OPTIMIZER_CTX_DISPATCH_WORKGROUP_BASE]).toBe(0)
    expect(patchedU32[OPTIMIZER_CTX_META0] & 0xfff).toBe(1206)
    expect((patchedU32[OPTIMIZER_CTX_META0] >>> 12) & 0xf).toBe(3)
    expect((patchedU32[OPTIMIZER_CTX_META0] >>> 18) & 0x7).toBe(4)
    expect(patchedU32[OPTIMIZER_CTX_META1]).toBe(20_000_000)
    expect(patchedU32[OPTIMIZER_CTX_COMBO_N]).toBe(12)
    expect(baseU32[OPTIMIZER_CTX_DISPATCH_WORKGROUP_BASE]).toBe(777)

    patchTargetContextDispatchWorkgroupBase(patched, 321)
    expect(patchedU32[OPTIMIZER_CTX_DISPATCH_WORKGROUP_BASE]).toBe(321)
    expect(patchedU32[OPTIMIZER_CTX_BASE_INDEX]).toBe(12345)
  })
})
