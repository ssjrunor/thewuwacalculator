/*
  Author: Runor Ewhro
  Description: Covers weapon suggestion candidate scoring, passive control
               variants, and runtime immutability.
*/

import { describe, expect, it } from 'vitest'
import { listResSds } from '@/domain/services/resonatorSeedService'
import { listWpnsByTy } from '@/domain/services/weaponCatalogService'
import { listStatesFor } from '@/domain/services/gameDataService'
import { makeEnemy, makeResRuntime, mkDefWpnSug } from '@/domain/state/defaults'
import { makeRuntimeMap } from '@/domain/state/runtimeAdapters'
import { makeEchoUid } from '@/domain/entities/runtime'
import { ECHO_MAIN_STATS, ECHO_SIDE_STATS } from '@/data/gameData/catalog/echoStats'
import { listChsByCos } from '@/domain/services/echoCatalogService'
import { runResSmlt } from '@/engine/pipeline'
import { mkPrepWpnSu, resSuggDmg } from '@/engine/suggestions/shared'
import { runPrepWpn } from '@/engine/suggestions/weapon-suggestion/compute'
import { isStdWpn } from '@/domain/entities/weapon'
import { weaponStatsAt } from '@/domain/services/weaponPlan'

// build one equipped echo so the packed evaluator has a concrete loadout to score.
function mkEcho() {
  const def = listChsByCos(3)[0]
  if (!def) {
    throw new Error('missing cost 3 echo fixture')
  }

  return {
    uid: makeEchoUid(),
    id: def.id,
    set: def.sets[0] ?? 0,
    mainEcho: true,
    mainStats: {
      primary: {
        key: 'atkPercent',
        value: ECHO_MAIN_STATS[3]?.atkPercent ?? 0,
      },
      secondary: { ...ECHO_SIDE_STATS[3] },
    },
    substats: {},
  }
}

describe('weapon suggestions', () => {
  it('scores default and max variants without mutating runtime', () => {
    const seed = listResSds().find((entry) =>
      listWpnsByTy(entry.weaponType).some((wpn) => listStatesFor('weapon', wpn.id).length > 0),
    )
    expect(seed).toBeTruthy()
    if (!seed) return

    const rt = makeResRuntime(seed)
    const startWpnId = rt.build.weapon.id
    rt.build.weapon.baseAtk = Math.max(0, rt.build.weapon.baseAtk - 0.5)
    rt.build.echoes = [mkEcho(), null, null, null, null]

    const enemy = makeEnemy()
    const sim = runResSmlt(rt, seed, enemy, makeRuntimeMap(rt, {}), {})
    const sets = {
      ...mkDefWpnSug(),
      mode: 'both' as const,
      target: 'default' as const,
      visible: {
        '5': true,
        '4': true,
        '3': true,
        '2': true,
        '1': true,
      },
    }
    const prep = mkPrepWpnSu({
      runtime: rt,
      seed,
      enemy,
      runtimesById: {},
      selectedTargets: {},
      tgtFeatId: null,
      rotationMode: false,
      weapon: sets,
      topK: 200,
    }, sim)

    expect(prep).toBeTruthy()
    if (!prep) return

    const out = runPrepWpn(prep)
    expect(out.length).toBeGreaterThan(0)
    expect(out.some((entry) => entry.mode === 'default')).toBe(true)
    expect(out.some((entry) => entry.mode === 'max')).toBe(true)
    expect(out[0]?.mode).toBe('default')
    expect(out[1]?.weaponId).toBe(out[0]?.weaponId)
    expect(out[1]?.mode).toBe('max')
    expect(out.some((entry) => Object.keys(entry.controls).length > 0)).toBe(true)
    const curEnt = out.find((entry) => entry.weaponId === startWpnId && entry.mode === 'default')
    const curWpn = listWpnsByTy(seed.weaponType).find((wpn) => wpn.id === startWpnId)
    expect(curWpn).toBeTruthy()
    const curStats = curWpn ? weaponStatsAt(curWpn, rt.build.weapon.level) : null
    expect(curEnt?.baseAtk).toBe(curStats?.atk)
    expect(curEnt?.damage).toBeCloseTo(resSuggDmg(sim, {
      runtime: rt,
      seed,
      enemy,
      runtimesById: {},
      selectedTargets: {},
      tgtFeatId: null,
      rotationMode: false,
    }), 4)

    const stateEnt = out.find((entry) => Object.keys(entry.controls).length > 0)
    expect(stateEnt).toBeTruthy()
    if (!stateEnt) return
    const stateKey = Object.keys(stateEnt.controls)[0]
    const offOut = runPrepWpn({
      ...prep,
      settings: {
        ...sets,
        states: {
          [stateEnt.weaponId]: {
            [stateKey]: { off: true },
          },
        },
      },
    })
    const offEnts = offOut.filter((entry) => entry.weaponId === stateEnt.weaponId)
    expect(offEnts.length).toBeGreaterThan(0)
    expect(offEnts.every((entry) => !(stateKey in entry.controls))).toBe(true)

    const maxOut = runPrepWpn({
      ...prep,
      settings: {
        ...sets,
        mode: 'max',
        target: 'max',
        stdRank: 5,
        visible: {
          '5': true,
          '4': false,
          '3': false,
          '2': false,
          '1': false,
        },
      },
    })

    expect(maxOut.length).toBeGreaterThan(0)
    expect(maxOut.every((entry) => entry.mode === 'max')).toBe(true)
    expect(maxOut.every((entry) => entry.rarity === 5)).toBe(true)
    expect(maxOut.some((entry) => isStdWpn(entry.weaponId))).toBe(true)
    expect(maxOut.filter((entry) => isStdWpn(entry.weaponId)).every((entry) => entry.rank === 5)).toBe(true)
    expect(maxOut.filter((entry) => !isStdWpn(entry.weaponId)).every((entry) => entry.rank === 1)).toBe(true)

    const noFiveOut = runPrepWpn({
      ...prep,
      settings: {
        ...sets,
        stdRank: 5,
        visible: {
          '5': false,
          '4': true,
          '3': true,
          '2': true,
          '1': true,
        },
      },
    })

    expect(noFiveOut.every((entry) => entry.rarity !== 5)).toBe(true)
    expect(noFiveOut.some((entry) => isStdWpn(entry.weaponId))).toBe(false)
    expect(rt.build.weapon.id).toBe(startWpnId)
  })

  it('uses configured max values only for allowed max variants', () => {
    const pair = listResSds().flatMap((seed) =>
      listWpnsByTy(seed.weaponType).map((wpn) => ({ seed, wpn })),
    ).find(({ wpn }) =>
      listStatesFor('weapon', wpn.id).some((state) =>
        (state.kind === 'stack' || state.kind === 'number') && (state.max ?? 0) > (state.min ?? 0),
      ),
    )
    expect(pair).toBeTruthy()
    if (!pair) return

    const state = listStatesFor('weapon', pair.wpn.id).find((entry) =>
      (entry.kind === 'stack' || entry.kind === 'number') && (entry.max ?? 0) > (entry.min ?? 0),
    )
    expect(state).toBeTruthy()
    if (!state) return

    const rt = makeResRuntime(pair.seed)
    rt.build.echoes = [mkEcho(), null, null, null, null]

    const enemy = makeEnemy()
    const sim = runResSmlt(rt, pair.seed, enemy, makeRuntimeMap(rt, {}), {})
    const low = state.min ?? 0
    const sets = {
      ...mkDefWpnSug(),
      mode: 'both' as const,
      target: 'max' as const,
      visible: {
        '5': true,
        '4': true,
        '3': true,
        '2': true,
        '1': true,
      },
      states: {
        [pair.wpn.id]: {
          [state.controlKey]: { max: low },
        },
      },
    }
    const prep = mkPrepWpnSu({
      runtime: rt,
      seed: pair.seed,
      enemy,
      runtimesById: {},
      selectedTargets: {},
      tgtFeatId: null,
      rotationMode: false,
      weapon: sets,
      topK: 200,
    }, sim)

    expect(prep).toBeTruthy()
    if (!prep) return

    const out = runPrepWpn(prep)
    const defEnt = out.find((entry) => entry.weaponId === pair.wpn.id && entry.mode === 'default')
    const maxEnt = out.find((entry) => entry.weaponId === pair.wpn.id && entry.mode === 'max')

    expect(defEnt?.controls[state.controlKey]).toBe(state.defaultValue ?? state.min ?? 0)
    expect(maxEnt?.controls[state.controlKey]).toBe(low)
  })
})
