/*
  Author: Runor Ewhro
  description: protects authored enemy mechanics that are not represented by
               resistance rows in the generated enemy catalog.
*/

import { describe, expect, it } from 'vitest'
import type { EffectScope, SrcPkg } from '@/domain/gameData/contracts'
import { mkGameDataRe, listSrcRtFfc } from '@/data/gameData/registry'
import { evalCond, evalForm } from '@/engine/effects/evaluator'
import enemySourcesRaw from '../../../../public/data/beta/enemies/sources.json?raw'
import liveSourcesRaw from '../../../../public/data/live/enemies/sources.json?raw'

const betaSources = JSON.parse(enemySourcesRaw) as SrcPkg[]
const liveSources = JSON.parse(liveSourcesRaw) as SrcPkg[]

function scope(paradox: number): EffectScope {
  return {
    context: {
      enemy: {
        status: { paradox },
        res: { 0: 10, 1: 20, 2: 30, 3: 40, 4: 50, 5: 60, 6: 70 },
      },
    },
  } as unknown as EffectScope
}
function getEnemySource(sources: SrcPkg[], enemyId: string): SrcPkg {
  const source = sources.find((candidate) => candidate.source.type === 'enemy' && candidate.source.id === enemyId)
  expect(source, `enemy ${enemyId} is missing its generated source package`).toBeDefined()
  return source as SrcPkg
}

describe('enemy source invariants', () => {
  it('adds Prowler invisibility as 30% All-Attribute RES', () => {
    for (const sources of [liveSources, betaSources]) {
      const source = getEnemySource(sources, '320000560')
      expect(source.states).toContainEqual(expect.objectContaining({ id: 'invisibility', kind: 'toggle', defaultValue: false }))
      expect(source.effects).toContainEqual(expect.objectContaining({
        condition: { type: 'truthy', from: 'context', path: 'enemy.status.invisibility' },
        operations: [{ type: 'add_attribute_mod', attribute: 'all', mod: 'resShred', value: { type: 'const', value: -30 } }],
      }))
    }
  })
  it('keeps beta and live enemy mechanics identical', () => {
    expect(liveSources).toEqual(betaSources)
  })

  it('preserves Nameless Explorer and Thousand-Puppet Pavilion\'s two additional Tune Strain stacks', () => {
    for (const sources of [liveSources, betaSources]) {
      const registry = mkGameDataRe(sources)
      for (const id of ['340000260', '340000261', '340000310']) {
        expect(registry.sourcesByKey[`enemy:${id}`]?.tuneStrainMaxBonus).toBe(2)
      }
      expect(getEnemySource(sources, '340000250').tuneStrainMaxBonus).toBeUndefined()
    }
  })

  it('reads Nameless Explorer vulnerability from shared Tune Strain without another control', () => {
    for (const sources of [liveSources, betaSources]) {
      for (const id of ['340000260', '340000261']) {
        const source = getEnemySource(sources, id)
        expect(source.states).toEqual([])
        const operation = source.effects?.find((effect) => effect.id.endsWith(':interfered-vuln'))?.operations[0]
        if (!operation || !('value' in operation)) throw new Error(`Missing vulnerability for ${id}`)
        for (const stacks of [0, 3, 6]) {
          expect(evalForm(operation.value, {
            context: { enemy: { status: { tuneStrain: stacks } } },
          } as unknown as EffectScope)).toBe(stacks * 4)
        }
        expect(JSON.stringify(source)).not.toContain('tuneStrainInterfered')
      }
    }
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

  it('applies Suhsin Paradox vulnerability and removes each current resistance at two stacks', () => {
    const registry = mkGameDataRe(betaSources)

    for (const id of ['340000330', '340000331', '340000332']) {
      const source = getEnemySource(betaSources, id)
      const paradox = source.states?.find((state) => state.id === 'paradox')
      const vulnerability = source.effects?.find((effect) => effect.id.endsWith(':paradox-vuln'))
      const resistance = source.effects?.find((effect) => effect.id.endsWith(':paradox-res-zero'))

      expect(paradox).toMatchObject({ kind: 'stack', max: 2, path: 'enemy.status.paradox' })
      expect(vulnerability?.operations).toMatchObject([{ type: 'add_top_stat', stat: 'dmgVuln' }])
      expect(resistance?.operations).toHaveLength(7)
      expect(listSrcRtFfc(registry, { type: 'enemy', id }, 'preStats').map((effect) => effect.id))
        .toEqual([`enemy:${id}:paradox-vuln`, `enemy:${id}:paradox-res-zero`])
      if (!vulnerability || !resistance) throw new Error(`Missing Suhsin effects for ${id}`)

      const value = vulnerability.operations[0]
      if (!value || !('value' in value)) throw new Error(`Missing Paradox value for ${id}`)
      expect(evalForm(value.value, scope(1))).toBe(15)
      expect(evalForm(value.value, scope(2))).toBe(30)
      expect(evalCond(resistance.condition, scope(1))).toBe(false)
      expect(evalCond(resistance.condition, scope(2))).toBe(true)

      for (const [index, operation] of resistance.operations.entries()) {
        expect(operation).toMatchObject({ type: 'add_attribute_mod', mod: 'resShred' })
        if (!('value' in operation)) throw new Error(`Missing RES value for ${id}`)
        expect(evalForm(operation.value, scope(2))).toBe((index + 1) * 10)
      }
    }
  })
})
