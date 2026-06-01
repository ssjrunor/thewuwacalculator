import { describe, expect, it } from 'vitest'
import { getResById } from '@/domain/services/resonatorCatalogService'
import { makeResProfile } from '@/domain/state/defaults'
import {
  makeProfileClip,
  parseProfClip,
  serializeClip,
} from '@/modules/calculator/features/overview/lib/clipboard.ts'

function makeProfileEntry(resonatorId: string, resonatorName: string) {
  const seed = getResById(resonatorId)
  if (!seed) {
    throw new Error(`missing resonator ${resonatorId}`)
  }

  return {
    resonatorId,
    resonatorName,
    profile: makeResProfile(seed),
  }
}

describe('overview profile clipboard helpers', () => {
  it('round-trips a valid multi-profile payload', () => {
    const payload = makeProfileClip([
      makeProfileEntry('1505', 'Shorekeeper'),
      makeProfileEntry('1506', 'Phoebe'),
    ])

    const parsed = parseProfClip(
      serializeClip(payload),
    )

    expect(parsed?.kind).toBe('overview-profile-clipboard')
    expect(parsed?.profiles).toHaveLength(2)
    expect(parsed?.profiles.map((entry) => entry.resonatorId)).toEqual(['1505', '1506'])
  })

  it('rejects invalid payloads', () => {
    expect(parseProfClip('')).toBeNull()
    expect(parseProfClip('{"kind":"wrong"}')).toBeNull()
    expect(parseProfClip(JSON.stringify({
      kind: 'overview-profile-clipboard',
      version: 1,
      profiles: [{ resonatorId: '1505', resonatorName: 'Shorekeeper' }],
    }))).toBeNull()
  })
})
