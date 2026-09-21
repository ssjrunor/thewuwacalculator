/*
  Author: Runor Ewhro
  Description: protects the generated beta Unison sonata effects, including
               their self, incoming-resonator, and team-wide scopes.
*/

import { describe, expect, it } from 'vitest'
import type { SetDef } from '@/data/gameData/echoSets/effects'
import { makeOptSets } from '@/engine/runtime/defaults'
import { listEffectsFor, listStatesFor } from '@/data/catalog/gameDataService'
import betaEffectsRaw from '../../../../public/data/beta/sonata/effects.json?raw'
import betaSetsRaw from '../../../../public/data/beta/sonata/sets.json?raw'

function effect(id: number): SetDef {
  const value = (JSON.parse(betaEffectsRaw) as SetDef[]).find((candidate) => candidate.id === id)
  if (!value) throw new Error(`Missing beta sonata effect ${id}`)
  return value
}

describe('beta Unison sonata invariants', () => {
  it('keeps all three set catalog and behavior records paired', () => {
    const setIds = (JSON.parse(betaSetsRaw) as Array<{ id: number }>).map((set) => set.id)

    expect(setIds).toEqual(expect.arrayContaining([36, 37, 38]))
    expect([36, 37, 38].map((id) => effect(id).id)).toEqual([36, 37, 38])
  })

  it('publishes all three sets to simulation and optimizer consumers', () => {
    const optimizerSetIds = makeOptSets().allowedSets[5]

    for (const setId of [36, 37, 38]) {
      expect(optimizerSetIds).toContain(setId)
      expect(listEffectsFor('echoSet', String(setId)).length).toBeGreaterThan(0)
      expect(listStatesFor('echoSet', String(setId)).length).toBeGreaterThan(0)
    }
  })

  it('applies Heart of Sworn Vigil to the wearer', () => {
    expect(effect(36).states.swornVigil5pc?.max).toEqual([
      { value: 15, path: ['critRate'] },
      { value: 22.5, path: ['attribute', 'electro', 'dmgBonus'] },
    ])
  })

  it('keeps Flash of Electric Reflection handoff-scoped', () => {
    expect(effect(37).states.electricReflectOutro?.max).toEqual([
      {
        value: 25,
        path: ['attribute', 'electro', 'dmgBonus'],
        targetScope: 'activeOther',
      },
    ])
  })

  it('keeps both Flower of Tinged Yearning ATK tiers team-wide', () => {
    expect(effect(38).states.tingedYearning5pc?.max).toEqual([
      { value: 10, path: ['atk', 'percent'], targetScope: 'teamWide' },
    ])
    expect(effect(38).states.tingedYearningUnison?.max).toEqual([
      { value: 15, path: ['atk', 'percent'], targetScope: 'teamWide' },
    ])
  })

  it('derives Halo of Starry Radiance from the wearer buildup rate', () => {
    const state = listStatesFor('echoSet', '25').find(
      (candidate) => candidate.id === 'starryRadiance5pc',
    )
    const sourceEffect = listEffectsFor('echoSet', '25').find(
      (candidate) => candidate.id === 'echoSet:25:starryRadiance5pc',
    )

    expect(state).toMatchObject({
      kind: 'toggle',
      defaultValue: false,
    })
    expect(state).not.toHaveProperty('max')
    expect(sourceEffect).toMatchObject({
      targetScope: 'teamWide',
      operations: [{
        type: 'add_base_stat',
        stat: 'atk',
        field: 'percent',
        value: {
          type: 'clamp',
          max: 25,
          value: {
            type: 'mul',
            values: [
              {
                type: 'read',
                from: 'sourceFinalStats',
                path: 'offTuneBuildupRate',
                default: 1,
              },
              { type: 'const', value: 20 },
            ],
          },
        },
      }],
    })
  })
})
