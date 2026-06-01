import { describe, expect, it } from 'vitest'
import type { MnlMod } from '@/domain/entities/manualBuffs.ts'
import {
  makeModClip,
  cloneManualMods,
  prsMnlModClp,
  serMnlModClp,
} from '@/modules/calculator/features/buffs/lib/clipboard.ts'

const modifier: MnlMod = {
  id: 'manual:one',
  enabled: true,
  scope: 'skill',
  matchMode: 'skillId',
  skillId: 'skill-one',
  effect: 'addMultiplier',
  value: 1250,
}

describe('manual modifier clipboard helpers', () => {
  it('serializes and parses selected advanced manual modifiers', () => {
    const payload = makeModClip([modifier])
    const parsed = prsMnlModClp(serMnlModClp(payload))

    expect(parsed?.kind).toBe('manual-modifier-clipboard')
    expect(parsed?.modifiers).toEqual([modifier])
  })

  it('rejects invalid clipboard payloads', () => {
    expect(prsMnlModClp('')).toBeNull()
    expect(prsMnlModClp(JSON.stringify({ kind: 'wrong', modifiers: [modifier] }))).toBeNull()
    expect(prsMnlModClp(JSON.stringify({
      kind: 'manual-modifier-clipboard',
      version: 1,
      modifiers: [{ ...modifier, scope: 'missing' }],
    }))).toBeNull()
  })

  it('creates fresh ids for pasted modifiers', () => {
    const cloned = cloneManualMods([modifier])

    expect(cloned).toHaveLength(1)
    expect(cloned[0]).toMatchObject({ ...modifier, id: expect.any(String) })
    expect(cloned[0]?.id).not.toBe(modifier.id)
  })
})
