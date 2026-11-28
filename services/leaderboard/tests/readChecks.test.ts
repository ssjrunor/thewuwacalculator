/*
  Author: Runor Ewhro
  description: the automatic staff report a card read opens: a name only when
               it would change what the boards show, the build's own doubts
               only for a new build, and nothing for a clean read.
*/

import { describe, expect, it } from 'vitest'
import type { CardReadFlag, CardReadResult } from '@lb/contract/read'
import { readCheckDetails } from '../src/api/read/ingest'

function readWith(name: string | null, flags: CardReadFlag[] = [], review: CardReadResult['confidence']['review'] = undefined): CardReadResult {
  return {
    parserVer: 'test',
    outcome: 'ok',
    uid: '500144374',
    resonatorId: '1509',
    snapshot: {
      v: 1, gameVer: 'v', uid: '500144374', name,
      resonator: { id: '1509', level: 90, sequence: 0,
        skillLevels: { normalAttack: 10, resonanceSkill: 10, forteCircuit: 10, resonanceLiberation: 10, introSkill: 10 } },
      weapon: { id: '21010016', level: 90 },
      echoes: [],
    },
    confidence: { frameScore: 1, botFrame: true, uidAgreed: true, resonatorCandidates: [], echoes: [], issues: [],
      ...(review ? { review } : {}), ...(flags.length ? { flags } : {}) },
    ms: 0,
  } as CardReadResult
}

describe('read check reports', () => {
  it('reports nothing for a clean read', () => {
    expect(readCheckDetails(readWith('xuri'), { name: null, nameAt: null }, 0, true)).toBeNull()
    expect(readCheckDetails(readWith('xuri'), { name: 'xuri', nameAt: null }, 0, true)).toBeNull()
  })

  it('reports a missing name only while the player has none on record', () => {
    expect(readCheckDetails(readWith(null, ['name_blank']), { name: null, nameAt: null }, 0, true)).toContain('the card prints no player name, so the player shows as Unnamed')
    expect(readCheckDetails(readWith(null, ['name_obscured']), { name: null, nameAt: null }, 0, true)).toContain('art behind the player name')
    expect(readCheckDetails(readWith(null, ['name_blank']), { name: 'xuri', nameAt: null }, 0, true)).toBeNull()
    // a repeat of a stored build adds nothing new to the boards
    expect(readCheckDetails(readWith(null, ['name_blank']), { name: null, nameAt: null }, 0, false)).toBeNull()
  })

  it('reports a name change, with or without a repeat', () => {
    expect(readCheckDetails(readWith('Marmalade'), { name: '~Marmalade~', nameAt: null }, 0, false)).toContain('changed from "~Marmalade~" to "Marmalade"')
    expect(readCheckDetails(readWith('Marmalade'), { name: '~Marmalade~', nameAt: 100 }, 100, false)).toContain('changed from')
  })

  it('does not report the name on a card older than the source of the stored name', () => {
    expect(readCheckDetails(readWith('Marmalade'), { name: '~Marmalade~', nameAt: 100 }, 50, false)).toBeNull()
  })

  it('reports edge punctuation only on a name new to the record', () => {
    const edge = readWith('Marmalade-', ['name_edge'])
    expect(readCheckDetails(edge, { name: null, nameAt: null }, 0, true)).toContain('read as "Marmalade-"')
    expect(readCheckDetails(edge, { name: 'Marmalade', nameAt: null }, 0, true)).toContain('may be a misread decoration')
    expect(readCheckDetails(edge, { name: 'Marmalade-', nameAt: null }, 0, true)).toBeNull()
  })

  it('reports a name no second read confirmed whenever it would show', () => {
    const unsure = readWith('Λξεα', ['name_unconfirmed'])
    expect(readCheckDetails(unsure, { name: null, nameAt: null }, 0, true)).toContain('read as "Λξεα", but no second read confirmed it')
    expect(readCheckDetails(unsure, { name: 'Λæα', nameAt: null }, 0, false)).toContain('changed from "Λæα" to "Λξεα", but no second read')
    expect(readCheckDetails(unsure, { name: 'Λξεα', nameAt: null }, 0, true)).toBeNull()
  })

  it('lists corrections and build doubts in one report for a new build only', () => {
    const read = readWith('xuri', ['level_unread', 'weapon_disagrees'], [{ slot: 2, key: 'critDmg' }])
    const details = readCheckDetails(read, { name: 'xuri', nameAt: null }, 0, true)!
    expect(details).toMatch(/^Automatic: /)
    expect(details).toContain('a value was corrected by one character (echo 3 critDmg)')
    expect(details).toContain('the resonator level was not read')
    expect(details).not.toContain('weapon')
    expect(readCheckDetails(read, { name: 'xuri', nameAt: null }, 0, false)).toBeNull()
  })

  it('reports nothing for doubts the reader resolved', () => {
    expect(readCheckDetails(readWith('xuri', ['resonator_by_art', 'weapon_disagrees']), { name: 'xuri', nameAt: null }, 0, true)).toBeNull()
  })
})
