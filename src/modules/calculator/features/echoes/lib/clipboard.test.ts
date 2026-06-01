import { describe, expect, it } from 'vitest'
import { makeEchoUid, type EchoInstance } from '@/domain/entities/runtime.ts'
import {
  ECHO_CLIP_KIND,
  ECHO_CLIP_VER,
  type EchoClipPayload,
  prsEchoClpbP,
  pstChsIntoLd,
  serEcho,
} from '@/modules/calculator/features/echoes/lib/clipboard.ts'

function makeEcho(id: string, mainEcho = false): EchoInstance {
  return {
    uid: makeEchoUid(),
    id,
    set: 100001,
    mainEcho,
    mainStats: {
      primary: { key: 'atkPercent', value: 33 },
      secondary: { key: 'atkFlat', value: 30 },
    },
    substats: {
      critRate: 10.5,
    },
  }
}

describe('echo clipboard helpers', () => {
  it('round-trips a valid clipboard payload', () => {
    const payload: EchoClipPayload = {
      kind: ECHO_CLIP_KIND,
      version: ECHO_CLIP_VER,
      source: 'loadout' as const,
      resonatorId: 'rover',
      resName: 'Rover',
      echoes: [makeEcho('6000001', true), makeEcho('6000002')],
    }

    expect(prsEchoClpbP(serEcho(payload))).toEqual(payload)
  })

  it('fills forward from the requested target slot', () => {
    const initial = [makeEcho('6000001', true), null, makeEcho('6000003'), null, null]
    const payload: EchoClipPayload = {
      kind: ECHO_CLIP_KIND,
      version: ECHO_CLIP_VER,
      source: 'loadout' as const,
      resonatorId: 'rover',
      resName: 'Rover',
      echoes: [makeEcho('6000004'), makeEcho('6000005')],
    }

    const result = pstChsIntoLd(initial, payload, 2)

    expect(result.pastedCount).toBe(2)
    expect(result.skippedCount).toBe(0)
    expect(result.nextEchoes[2]?.id).toBe('6000004')
    expect(result.nextEchoes[3]?.id).toBe('6000005')
    expect(result.nextEchoes[2]?.mainEcho).toBe(false)
  })

  it('counts echoes that overflow the loadout', () => {
    const payload: EchoClipPayload = {
      kind: ECHO_CLIP_KIND,
      version: ECHO_CLIP_VER,
      source: 'inventory' as const,
      resonatorId: 'rover',
      resName: 'Rover',
      echoes: [makeEcho('6000004'), makeEcho('6000005')],
    }

    const result = pstChsIntoLd([null, null, null, null, null], payload, 4)

    expect(result.pastedCount).toBe(1)
    expect(result.skippedCount).toBe(1)
    expect(result.nextEchoes[4]?.id).toBe('6000004')
  })
})
