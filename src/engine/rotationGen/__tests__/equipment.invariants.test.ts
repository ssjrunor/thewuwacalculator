/*
  Author: Runor Ewhro
  description: tests that generator equipment matches app set activation: duplicate
               echo records and set counts per echo identity.
*/

import { describe, expect, it } from 'vitest'
import { createGearLibrary, prepareEquipment } from '../gear'
import { countEchoSets } from '@/engine/pipeline/buildCombatContext'
import gear from '@/data/rotationGen/gear/triggers.json'

const echo = (id: string, set = 30, mainEcho = false) => ({ id, set, mainEcho })
const prepare = (echoes: Array<ReturnType<typeof echo> | null>) => prepareEquipment({
  loadout: { echoes, weapon: { id: '21020086', rank: 1, level: 90 } },
  echoCatalog: [...new Set(echoes.flatMap(item => item ? [item.id] : []))].map(id => ({ id, sets: [7, 30] })),
  weaponBundle: { weapon: { statKey: 'critRate', statsByLevel: { 90: { secondaryStatValue: 24.3 } } } },
  gearLibrary: createGearLibrary(gear),
})

describe('generator equipment matches app set activation', () => {
  it('retains both duplicate Echo stat records but does not enable the five-piece bonus', () => {
    const echoes = [echo('6000199', 30, true), echo('6000188'), echo('6000187'), echo('6000174'), echo('6000174')]
    expect(countEchoSets(echoes)).toEqual({ 30: 4 })
    const result = prepare(echoes)
    expect(result.echoes.equipped).toHaveLength(5)
    expect(result.sonata.effects).toEqual({})
    expect(result.sonata.rules).toEqual([])
    const complete = prepare([...echoes.slice(0, 4), echo('6000175')])
    expect(Object.keys(complete.sonata.effects).length).toBeGreaterThan(0)
  })

  it('counts an identity separately when it wears a different set', () => {
    expect(countEchoSets([echo('1'), echo('1'), echo('1', 7), echo('2', 7)]))
      .toEqual({ 7: 2, 30: 1 })
  })

  it.each([[], [null], [echo('6000174')], [echo('6000199', 30, true), null, echo('6000174')]])(
    'accepts incomplete equipment %# without inventing a main Echo', (...echoes) => {
      const result = prepare(echoes)
      expect(result.echoes.equipped).toHaveLength(echoes.filter(Boolean).length)
      expect(result.echoes.main.id).toBe(echoes.find(item => item?.mainEcho) ? 6000199 : null)
    },
  )
})
