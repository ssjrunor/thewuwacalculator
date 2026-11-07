/*
  Author: Runor Ewhro
  description: protects the leaderboard's strict reading rules: only a card
               with a verified uid, a resolved resonator and weapon, five
               identified echoes and exact substats yields a snapshot.
*/

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EchoInstance } from '@/domain/entities/runtime'
import type { ParsedBuildScreenshot, RawPrsdEcho } from '@/engine/echoParser/ocrParsing'
import type { SubstatReading } from '@/engine/echoParser/statReading'

const built: Array<EchoInstance | null> = []
const readings = new Map<string, SubstatReading[]>()

vi.mock('@/engine/echoParser/echoBuilder', () => ({ mkEchoNstnFr: () => built }))
vi.mock('@/engine/echoParser/statReading', () => ({
  readSbstDtl: (rows: string[]) => readings.get(rows.join('|')) ?? [],
}))
vi.mock('@/data/catalog/resonatorSeedService', () => ({
  getResSeedBy: (id: string) => ({ '1406': { name: 'Rover: Aero' }, '1408': { name: 'Rover: Aero' }, '1102': { name: 'Sanhua' } })[id] ?? null,
}))

const { makeCardRead, failedCardRead } = await import('@/engine/echoParser/cardRead')

function rawEcho(slot: number): RawPrsdEcho {
  return {
    cost: slot === 0 ? '4' : '1',
    mainStatLbl: 'Crit. Rate',
    substats: [`row${slot}a`, `row${slot}b`],
    substatValues: ['', ''],
    echoName: `Echo ${slot}`,
    setName: 'Set',
  }
}

function instance(slot: number): EchoInstance {
  return {
    uid: `u${slot}`,
    id: `600000${slot}`,
    set: 3,
    mainEcho: slot === 0,
    mainStats: { primary: { key: 'critRate', value: 22 }, secondary: { key: 'atkFlat', value: 150 } },
    substats: { critDmg: 21, atkPercent: 9.4 },
  }
}

function parsedCard(overrides: Partial<ParsedBuildScreenshot> = {}): ParsedBuildScreenshot {
  return {
    player: { id: 'xuri', uid: '500395087', uidAgreed: true },
    resonator: {
      id: '1102', candidateIds: ['1102'], name: 'Sanhua', attribute: 'glacio', level: 90, sequence: 2,
      skillLevels: { normalAttack: 1, resonanceLiberation: 10, forteCircuit: 10, introSkill: 1, resonanceSkill: 10 },
    },
    weapon: { id: '21020016', name: 'Blazing Brilliance', level: 90 },
    echoes: [0, 1, 2, 3, 4].map(rawEcho),
    source: { width: 1920, height: 1080, lowResolution: false, frameScore: 3, botFrame: true, unreadText: false },
    ...overrides,
  }
}

function setExact(slot: number, fix: SubstatReading['fix'] = 'exact') {
  readings.set(`row${slot}a|row${slot}b`, [
    { key: 'critDmg', value: 21, fix },
    { key: 'atkPercent', value: 9.4, fix: 'exact' },
  ])
}

beforeEach(() => {
  built.length = 0
  built.push(...[0, 1, 2, 3, 4].map(instance))
  readings.clear()
  for (const slot of [0, 1, 2, 3, 4]) setExact(slot)
})

describe('leaderboard card read', () => {
  it('produces a snapshot from a clean card', () => {
    const read = makeCardRead(parsedCard(), '3.8.3/beta', 1200)
    expect(read.outcome).toBe('ok')
    expect(read.confidence.issues).toEqual([])
    expect(read.uid).toBe('500395087')
    expect(read.snapshot).toMatchObject({
      v: 1,
      gameVer: '3.8.3/beta',
      uid: '500395087',
      name: 'xuri',
      resonator: { id: '1102', level: 90, sequence: 2 },
      weapon: { id: '21020016', level: 90 },
    })
    expect(read.snapshot!.echoes).toHaveLength(5)
    expect(read.snapshot!.echoes[0]).toEqual({
      slot: 0, id: '6000000', set: 3, mainEcho: true,
      main: { primary: { key: 'critRate', value: 22 }, secondary: { key: 'atkFlat', value: 150 } },
      substats: { critDmg: 21, atkPercent: 9.4 },
    })
    // saved snapshots exclude parser-local Echo UIDs.
    expect(JSON.stringify(read.snapshot)).not.toContain('"u0"')
  })

  it('refuses a single uid read even when the app would accept it', () => {
    const read = makeCardRead(parsedCard({ player: { id: 'xuri', uid: '500395087', uidAgreed: false } }), 'v', 0)
    expect(read.outcome).toBe('uid_unreadable')
    expect(read.uid).toBeNull()
    expect(read.snapshot).toBeNull()
  })

  it('treats a card that is not the bot frame as unreadable first', () => {
    const read = makeCardRead(parsedCard({
      player: { id: null, uid: null, uidAgreed: false },
      source: { width: 1920, height: 1080, lowResolution: false, frameScore: 99, botFrame: false, unreadText: false },
    }), 'v', 0)
    expect(read.outcome).toBe('unreadable')
    expect(read.confidence.issues).toEqual(expect.arrayContaining(['not_bot_card', 'uid_unverified']))
  })

  it('rejects corrected and snapped substats', () => {
    setExact(3, 'corrected')
    expect(makeCardRead(parsedCard(), 'v', 0).confidence.issues).toEqual(['substat_not_exact'])
    setExact(3, 'snapped')
    expect(makeCardRead(parsedCard(), 'v', 0).outcome).toBe('unreadable')
  })

  it('rejects a printed row that produced no reading', () => {
    readings.set('row2a|row2b', [{ key: 'critDmg', value: 21, fix: 'exact' }])
    const read = makeCardRead(parsedCard(), 'v', 0)
    expect(read.confidence.issues).toEqual(['substat_unread'])
    expect(read.confidence.echoes[2].unreadRows).toBe(1)
  })

  it('rejects an unidentified echo and an empty panel', () => {
    built[1] = null
    expect(makeCardRead(parsedCard(), 'v', 0).confidence.issues).toEqual(['echo_unresolved'])

    built[1] = instance(1)
    const echoes = [0, 1, 2, 3].map(rawEcho)
    echoes.push({ cost: '', mainStatLbl: '', substats: [], substatValues: [], echoName: null, setName: null })
    expect(makeCardRead(parsedCard({ echoes }), 'v', 0).confidence.issues).toEqual(['echo_missing'])
  })

  it('requires a resolved weapon and resonator', () => {
    const read = makeCardRead(parsedCard({ weapon: { id: null, name: 'Blazing', level: 90 } }), 'v', 0)
    expect(read.confidence.issues).toEqual(['weapon_unresolved'])
    const noRes = makeCardRead(parsedCard({
      resonator: { ...parsedCard().resonator, id: null, candidateIds: ['1102', '1406'] },
    }), 'v', 0)
    expect(noRes.confidence.issues).toEqual(['resonator_unresolved'])
  })

  it('resolves gender variants of one resonator to the first id', () => {
    const read = makeCardRead(parsedCard({
      resonator: { ...parsedCard().resonator, id: null, candidateIds: ['1408', '1406'], name: 'Rover: Aero' },
    }), 'v', 0)
    expect(read.outcome).toBe('ok')
    expect(read.resonatorId).toBe('1406')
    expect(read.confidence.resonatorCandidates).toEqual(['1408', '1406'])
  })

  it('reports a parser failure as unreadable', () => {
    const read = failedCardRead('invalid_image_size', 40)
    expect(read).toMatchObject({ outcome: 'unreadable', snapshot: null, error: 'invalid_image_size', ms: 40 })
  })
})
