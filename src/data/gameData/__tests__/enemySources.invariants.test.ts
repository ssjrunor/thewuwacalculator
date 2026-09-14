/*
  Author: Runor Ewhro
  Description: protects authored enemy mechanics that are not represented by
               resistance rows in the generated enemy catalog.
*/

import { describe, expect, it } from 'vitest'
import type { SrcPkg } from '@/domain/gameData/contracts'
import enemySourcesRaw from '../../../../public/data/beta/enemies/sources.json?raw'

const NEGATIVE_STATUS_TYPES = [
  'spectroFrazzle',
  'aeroErosion',
  'fusionBurst',
  'havocBane',
  'glacioChafe',
  'electroFlare',
]

function getEnemySource(sources: SrcPkg[], enemyId: string): SrcPkg {
  const source = sources.find((candidate) => candidate.source.type === 'enemy' && candidate.source.id === enemyId)
  expect(source, `enemy ${enemyId} is missing its generated source package`).toBeDefined()
  return source as SrcPkg
}

describe('enemy source invariants', () => {
  it('encodes the new 3.6 enemy vulnerabilities', () => {
    const sources = JSON.parse(enemySourcesRaw) as SrcPkg[]
    const skywatchLancer = getEnemySource(sources, '320000690')
    const skywatchOperation = skywatchLancer.effects?.[0]?.operations[0]

    expect(skywatchOperation).toMatchObject({
      type: 'add_skilltype_mod',
      skillType: NEGATIVE_STATUS_TYPES,
      mod: 'dmgVuln',
      value: { type: 'const', value: 100 },
    })

    const calamityEffigy = getEnemySource(sources, '340000320')
    expect(calamityEffigy.states).toContainEqual(expect.objectContaining({
      id: 'affectedByNegStatus',
      path: 'enemy.status.affectedByNegStatus',
      kind: 'toggle',
      defaultValue: false,
    }))
    expect(calamityEffigy.effects).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'enemy:340000320:electro-flare-vuln',
        operations: [expect.objectContaining({
          type: 'add_skilltype_mod',
          skillType: ['electroFlare'],
          mod: 'dmgVuln',
          value: { type: 'const', value: 100 },
        })],
      }),
      expect.objectContaining({
        id: 'enemy:340000320:status-triggered-vuln',
        condition: {
          type: 'truthy',
          from: 'context',
          path: 'enemy.status.affectedByNegStatus',
        },
        operations: [{
          type: 'add_top_stat',
          stat: 'dmgVuln',
          value: { type: 'const', value: 20 },
        }],
      }),
    ]))
  })

  it('includes Sigillum additional vulnerability at five Off Course stacks', () => {
    const sources = JSON.parse(enemySourcesRaw) as SrcPkg[]

    for (const enemyId of ['340000250', '340000251']) {
      const source = getEnemySource(sources, enemyId)
      expect(source.effects).toContainEqual(expect.objectContaining({
        id: `enemy:${enemyId}:off-course-max-vuln`,
        condition: {
          type: 'gte',
          from: 'context',
          path: 'enemy.status.offCourse',
          value: 5,
        },
        operations: [{
          type: 'add_top_stat',
          stat: 'dmgVuln',
          value: { type: 'const', value: 30 },
        }],
      }))
    }
  })
})
