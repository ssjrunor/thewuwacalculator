/*
  Author: Runor Ewhro
  Description: Keeps Sonata source controls and Max initialization gated by
               the wearer's distinct equipped Echo count.
*/

import { describe, expect, it } from 'vitest'
import { listEchoes } from '@/data/catalog/echoCatalogService'
import { listStatesFor } from '@/data/catalog/gameDataService'
import { getResSeedBy } from '@/data/catalog/resonatorSeedService'
import { ECHO_SET_DEFS } from '@/data/gameData/echoSets/effects'
import type { EchoInstance } from '@/domain/entities/runtime'
import { makeResRuntime } from '@/engine/runtime/defaults'
import { maxEchoStts } from '@/engine/runtime/sourceStateInit'
import { isStateVisible } from '@/engine/services/sourceStateService'

function echoesFor(setId: number, count: number): EchoInstance[] {
  return listEchoes()
    .filter((echo) => echo.sets.includes(setId))
    .sort((a, b) => a.cost - b.cost)
    .slice(0, count)
    .map((echo, index) => ({
      uid: `${setId}:${index}`,
      id: echo.id,
      set: setId,
      mainEcho: false,
      mainStats: {
        primary: { key: 'atkPercent', value: 0 },
        secondary: { key: 'atkFlat', value: 0 },
      },
      substats: {},
    }))
}

function runtime(resonatorId = '1202') {
  const seed = getResSeedBy(resonatorId)
  if (!seed) throw new Error(`Missing resonator seed ${resonatorId}`)
  return makeResRuntime(seed)
}

describe('Sonata source state availability', () => {
  it('requires the authored piece threshold for every set control', () => {
    for (const def of ECHO_SET_DEFS) {
      const states = listStatesFor('echoSet', String(def.id))
      if (states.length === 0) continue

      const wearer = runtime()
      // Isolate the control threshold, including unreleased sets whose Echo
      // catalogs do not yet contain enough distinct bodies for a full set.
      const [template] = echoesFor(def.id, 1)
      wearer.build.echoes = Array.from({ length: def.setMax }, (_, index) => ({
        ...template,
        uid: `${def.id}:${index}`,
        id: `threshold:${def.id}:${index}`,
      }))
      wearer.state.controls = Object.fromEntries(states.map((state) => [state.controlKey, state.max ?? true]))
      for (const state of states) {
        expect(isStateVisible(wearer, wearer, state), state.controlKey).toBe(true)
      }

      wearer.build.echoes.pop()
      for (const state of states) {
        expect(isStateVisible(wearer, wearer, state), state.controlKey).toBe(false)
      }
    }
  })

  it('maxes only Flamewing controls in a 2pc Clawprint / 3pc Flamewing loadout', () => {
    const wearer = runtime()
    wearer.build.echoes = [...echoesFor(18, 2), ...echoesFor(22, 3)]
    const maxed = maxEchoStts(wearer)

    for (const state of listStatesFor('echoSet', '18')) {
      expect(isStateVisible(maxed, maxed, state)).toBe(false)
      expect(maxed.state.controls[state.controlKey]).toBeUndefined()
    }
    for (const state of listStatesFor('echoSet', '22')) {
      expect(isStateVisible(maxed, maxed, state)).toBe(true)
      expect(maxed.state.controls[state.controlKey]).toBe(true)
    }
  })

  it('does not unlock a set control through duplicate Echo bodies or another member', () => {
    const wearer = runtime()
    const active = runtime('1204')
    const echoes = echoesFor(22, 3)
    active.build.echoes = echoes
    wearer.build.echoes = [echoes[0], echoes[1], { ...echoes[1], uid: 'duplicate' }]

    for (const state of listStatesFor('echoSet', '22')) {
      wearer.state.controls[state.controlKey] = true
      expect(isStateVisible(wearer, active, state, active)).toBe(false)
    }
  })
})
