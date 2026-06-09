import { describe, expect, it } from 'vitest'
import { ECHO_SET_DEFS, getEchoSetCn, type SetDef } from '@/data/gameData/echoSets/effects'
import { listEchoes } from '@/domain/services/echoCatalogService'
import { listStatesFor } from '@/domain/services/gameDataService'
import { listResSds } from '@/domain/services/resonatorSeedService'
import { listWpnsByTy } from '@/domain/services/weaponCatalogService'
import { makeResRuntime, maxRtInit } from '@/domain/state/defaults'
import {
  initWpnStts,
  maxEchoStts,
  maxWpnRt,
  srcSttKey,
  srcSttMax,
  wpnSttsMaxed,
} from '@/domain/state/sourceStateInit'
import { mkDefEchoNst } from '@/modules/calculator/features/echoes/lib/echoPane'

function findWeaponFixture() {
  for (const weaponType of [1, 2, 3, 4, 5]) {
    const weapon = listWpnsByTy(weaponType).find((entry) => listStatesFor('weapon', entry.id).length > 0)
    const seed = listResSds().find((entry) => entry.weaponType === weaponType)

    if (weapon && seed) {
      return { seed, weapon }
    }
  }

  throw new Error('missing weapon source-state fixture')
}

function findMainEchoFixture() {
  const echo = listEchoes().find((entry) => listStatesFor('echo', entry.id).length > 0)
  if (!echo) {
    throw new Error('missing main echo source-state fixture')
  }

  return echo
}

function findEchoSetFixture() {
  for (const def of ECHO_SET_DEFS) {
    if (Object.keys(def.states).length === 0) {
      continue
    }

    const echo = listEchoes().find((entry) => entry.sets.includes(def.id))
    if (echo) {
      return { echo, def }
    }
  }

  return null
}

function echoSetMax(state: SetDef['states'][string]): boolean | number {
  const perStep = state.perStep ?? state.perStack ?? state.max
  const isToggle = perStep.every((step, index) => step.value === state.max[index].value)

  if (isToggle) {
    return true
  }

  return Math.round(
    Math.max(...perStep.map((step, index) => state.max[index].value / step.value)),
  )
}

describe('source state initialization', () => {
  it('seeds weapon defaults and maxes weapon states for max init', () => {
    const { seed, weapon } = findWeaponFixture()
    const baseRuntime = makeResRuntime(seed)
    const runtime = {
      ...baseRuntime,
      build: {
        ...baseRuntime.build,
        weapon: {
          ...baseRuntime.build.weapon,
          id: weapon.id,
        },
      },
      state: {
        ...baseRuntime.state,
        controls: {},
      },
    }

    const defaulted = initWpnStts(runtime, { maxed: false })
    const maxed = initWpnStts(runtime, { maxed: true })

    for (const state of listStatesFor('weapon', weapon.id)) {
      const controlKey = srcSttKey(state)
      expect(defaulted.state.controls[controlKey], `${weapon.name} ${state.id} default`).not.toBeUndefined()
      expect(maxed.state.controls[controlKey], `${weapon.name} ${state.id} max`).toBe(
        srcSttMax(maxed, maxed, state),
      )
    }

    expect(wpnSttsMaxed(maxed)).toBe(true)
  })

  it('includes weapon state maxes in maxRtInit', () => {
    const { seed } = findWeaponFixture()
    const runtime = maxRtInit(makeResRuntime(seed))

    expect(runtime.base.sequence).toBe(0)
    expect(runtime.build.weapon.level).toBe(90)
    expect(runtime.build.weapon.rank).toBe(1)
    expect(wpnSttsMaxed(runtime)).toBe(true)
  })

  it('maxes weapon level and states while preserving the requested rank', () => {
    const { seed, weapon } = findWeaponFixture()
    const baseRuntime = makeResRuntime(seed)
    const runtime = {
      ...baseRuntime,
      build: {
        ...baseRuntime.build,
        weapon: {
          ...baseRuntime.build.weapon,
          id: weapon.id,
          rank: 3,
        },
      },
    }
    const maxed = maxWpnRt(runtime, { targetRank: runtime.build.weapon.rank })

    expect(maxed.build.weapon.level).toBe(90)
    expect(maxed.build.weapon.rank).toBe(3)
    expect(maxed.build.weapon.baseAtk).toBe(weapon.statsByLevel[90]?.atk ?? weapon.baseAtk)
    expect(wpnSttsMaxed(maxed)).toBe(true)
  })

  it('maxes main echo and echo set states when echo sources initialize', () => {
    const seed = listResSds()[0]
    if (!seed) {
      throw new Error('missing resonator fixture')
    }

    const mainEcho = findMainEchoFixture()
    const echoSetFixture = findEchoSetFixture()
    const mainEchoes = [
      mkDefEchoNst(mainEcho.id, 0, null),
      null,
      null,
      null,
      null,
    ]
    if (mainEchoes[0] == null) {
      throw new Error('failed to create echo fixtures')
    }

    const baseRuntime = makeResRuntime(seed)
    const mainRuntime = {
      ...baseRuntime,
      build: {
        ...baseRuntime.build,
        echoes: mainEchoes,
      },
      state: {
        ...baseRuntime.state,
        controls: {},
      },
    }
    const maxedMain = maxEchoStts(mainRuntime)

    for (const state of listStatesFor('echo', mainEcho.id)) {
      const controlKey = srcSttKey(state)
      expect(maxedMain.state.controls[controlKey], `${mainEcho.name} ${state.id}`).toBe(
        srcSttMax(maxedMain, maxedMain, state),
      )
    }

    if (!echoSetFixture) {
      return
    }

    const { echo: setEcho, def: setDef } = echoSetFixture
    const setEchoes = [
      mkDefEchoNst(setEcho.id, 0, null),
      mkDefEchoNst(setEcho.id, 1, null),
      mkDefEchoNst(setEcho.id, 2, null),
      mkDefEchoNst(setEcho.id, 3, null),
      mkDefEchoNst(setEcho.id, 4, null),
    ]
    if (setEchoes.some((echo) => !echo)) {
      throw new Error('failed to create echo set fixtures')
    }
    const setEchoLoadout = setEchoes.map((echo) => echo ? { ...echo, set: setDef.id } : echo)

    const maxedSet = maxEchoStts({
      ...baseRuntime,
      build: {
        ...baseRuntime.build,
        echoes: setEchoLoadout,
      },
      state: {
        ...baseRuntime.state,
        controls: {},
      },
    })

    for (const [stateId, state] of Object.entries(setDef.states)) {
      const controlKey = getEchoSetCn(setDef.id, stateId)
      expect(maxedSet.state.controls[controlKey], `set ${setDef.id} ${stateId}`).toBe(
        echoSetMax(state),
      )
    }
  })
})
