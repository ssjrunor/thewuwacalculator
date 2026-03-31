import { describe, expect, it } from 'vitest'
import {
  applyTowerOfAdversityResistances,
  buildEnemyProfileFromCatalog,
  getEnemyResistanceTable,
} from '@/domain/entities/enemy'

describe('enemy catalog profile mapping', () => {
  const catalogEnemy = {
    id: '340000240',
    name: 'Test Overlord',
    description: '',
    descriptionOpen: '',
    class: 3 as const,
    element: 2 as const,
    elementArray: [2 as const],
    icon: null,
    resistances: {
      0: 10,
      1: 40,
      2: 10,
      3: 10,
      4: 10,
      5: 10,
      6: 10,
    },
  }

  it('maps standard 10 and 40 resistance values to TOA equivalents', () => {
    expect(
      applyTowerOfAdversityResistances({
        0: 10,
        1: 40,
        2: 10,
        3: 10,
        4: 10,
        5: 10,
        6: 10,
      }),
    ).toEqual({
      0: 20,
      1: 60,
      2: 20,
      3: 20,
      4: 20,
      5: 20,
      6: 20,
    })
  })

  it('builds a selected enemy profile from catalog data and prior session state', () => {
    expect(
      buildEnemyProfileFromCatalog(catalogEnemy, {
        previousProfile: {
          id: 'old',
          level: 100,
          class: 4,
          toa: true,
          source: 'catalog',
          status: {
            tuneStrain: 4,
          },
          res: {
            0: 0,
            1: 0,
            2: 0,
            3: 0,
            4: 0,
            5: 0,
            6: 0,
          },
        },
      }),
    ).toEqual({
      id: '340000240',
      level: 100,
      class: 3,
      toa: true,
      source: 'catalog',
      status: {
        tuneStrain: 4,
      },
      res: {
        0: 20,
        1: 60,
        2: 20,
        3: 20,
        4: 20,
        5: 20,
        6: 20,
      },
    })
  })

  it('returns non-TOA resistance values when the target is not in tower mode', () => {
    expect(getEnemyResistanceTable(catalogEnemy, false)).toEqual({
      0: 10,
      1: 40,
      2: 10,
      3: 10,
      4: 10,
      5: 10,
      6: 10,
    })
  })
})
