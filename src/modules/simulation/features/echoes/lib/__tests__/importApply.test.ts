/*
  Author: Runor Ewhro
  description: locks what a build-card import writes: the bands it is handed and
               nothing else, with the values the card cannot see left alone.
*/

import { describe, expect, it } from 'vitest'
import type { ResRuntime } from '@/domain/entities/runtime'
import type { ParsedBuildScreenshot } from '@/engine/echoParser/ocrParsing'
import { makeResProfile, makeResRuntime, makeScenarioFromProfiles, mkMaxResRt } from '@/engine/runtime/defaults'
import { listResSds } from '@/data/catalog/resonatorSeedService'
import { listEchoes } from '@/data/catalog/echoCatalogService'
import { getResDtlsBy } from '@/data/gameData/resonators/resonatorDataStore'
import { ECHO_SET_DEFS, getEchoSetCn } from '@/data/gameData/echoSets/effects'
import { isResRtMaxed } from '@/engine/gameData/resonatorMax'
import { runtimeFromSnapshot } from '@/engine/runtime/runtimeAdapters'
import { listWpnsByTy } from '@/data/catalog/weaponCatalogService'
import { applyImprtRd } from '@/modules/simulation/features/echoes/lib/importApply'
import { mergeEchoImportIntoProfile } from '@/modules/simulation/features/echoes/lib/echoImportDestination'

function makeRead(weaponId: string | null): ParsedBuildScreenshot {
  return {
    player: { id: 'xuri', uid: '500395087' },
    resonator: {
      id: null,
      candidateIds: [],
      name: 'Hiyuki',
      attribute: 'glacio',
      level: 90,
      sequence: 3,
      skillLevels: {
        normalAttack: 10,
        resonanceSkill: 1,
        forteCircuit: 10,
        resonanceLiberation: 10,
        introSkill: 1,
      },
    },
    weapon: { id: weaponId, name: 'Frostburn', level: 90 },
    echoes: [],
    source: { width: 1920, height: 1080, lowResolution: false, frameScore: 1, botFrame: true, unreadText: false },
  }
}

describe('applyImprtRd', () => {
  const seed = listResSds()[0]
  const base: ResRuntime = makeResRuntime(seed)

  it('writes only the bands it is handed', () => {
    const next = applyImprtRd(base, makeRead(null), [], {
      resonator: false,
      weapon: false,
      echoes: false,
    })

    expect(next).toBe(base)
  })

  it('moves level, sequence, and five forte levels from the card', () => {
    const next = applyImprtRd(base, makeRead(null), [], {
      resonator: true,
      weapon: false,
      echoes: false,
    })

    expect(next.base.level).toBe(90)
    expect(next.base.sequence).toBe(3)
    expect(next.base.skillLevels.normalAttack).toBe(10)
    expect(next.base.skillLevels.resonanceSkill).toBe(1)
    expect(next.base.skillLevels.introSkill).toBe(1)
    // tune break is absent from the card and retains the build's stored level.
    expect(next.base.skillLevels.tuneBreak).toBe(base.base.skillLevels.tuneBreak)
  })

  it('keeps maxed resonator effects when the card changes sequence', () => {
    const sequenceSeed = listResSds().find((entry) => entry.id === '1210')!
    const maxed = mkMaxResRt(sequenceSeed)
    const read = makeRead(null)
    read.resonator.level = 80
    read.resonator.sequence = 6
    const next = applyImprtRd(maxed, read, [], {
      resonator: true,
      weapon: false,
      echoes: false,
    })

    expect(next.base.level).toBe(80)
    expect(next.base.sequence).toBe(6)
    expect(next.state.controls['resonator:1210:fusion_trail:value']).toBe(60)
  })

  it('retains imported progression and maxed effects for a never-initialized context', () => {
    const freshSeed = listResSds().find((entry) => entry.id === '1210')!
    const profile = makeResProfile(freshSeed, { maxed: true })
    const previous = runtimeFromSnapshot(profile)!
    const sonata = ECHO_SET_DEFS.find((definition) => definition.id === 22)!
    const echoes = listEchoes()
      .filter((echo) => echo.sets.includes(sonata.id))
      .slice(0, sonata.setMax)
      .map((echo, index) => ({
        uid: `fresh:${index}`,
        id: echo.id,
        set: sonata.id,
        mainEcho: index === 0,
        mainStats: {
          primary: { key: 'atkPercent', value: 0 },
          secondary: { key: 'atkFlat', value: 0 },
        },
        substats: {},
      }))
    const read = makeRead(null)
    read.resonator.id = freshSeed.id
    read.resonator.level = 80
    read.resonator.sequence = 6
    const imported = applyImprtRd(previous, read, echoes, {
      resonator: true,
      weapon: false,
      echoes: true,
    })
    const saved = mergeEchoImportIntoProfile(profile, imported, {
      maxEffectsOnInit: true,
    })
    const scenario = makeScenarioFromProfiles({ [freshSeed.id]: saved }, null, 0, freshSeed.id)
    const sonataControl = getEchoSetCn(sonata.id, Object.keys(sonata.states)[0]!)

    expect(isResRtMaxed(previous, getResDtlsBy()[freshSeed.id])).toBe(true)
    expect(saved.runtime.progression.level).toBe(80)
    expect(saved.runtime.progression.sequence).toBe(6)
    expect(saved.runtime.progression.skillLevels.resonanceSkill).toBe(1)
    expect(saved.runtime.local.controls['resonator:1210:fusion_trail:value']).toBe(60)
    expect(saved.runtime.local.controls[sonataControl]).toBe(true)
    expect(scenario.team.members[0].local.controls['resonator:1210:fusion_trail:value']).toBe(60)
    expect(scenario.team.members[0].local.controls[sonataControl]).toBe(true)
  })

  it('recognizes fresh maxed profiles across the catalog before an S6 import', () => {
    const notMaxed = listResSds().filter((resonator) => {
      const runtime = runtimeFromSnapshot(makeResProfile(resonator, { maxed: true }))!
      return !isResRtMaxed(runtime, getResDtlsBy()[resonator.id])
    })

    expect(notMaxed.map((resonator) => resonator.id)).toEqual([])
  })

  it('keeps the synthesis rank the card cannot see when the weapon changes', () => {
    const weapon = listWpnsByTy(seed.weaponType).find((entry) => entry.id !== base.build.weapon.id)!
    const ranked: ResRuntime = {
      ...base,
      build: { ...base.build, weapon: { ...base.build.weapon, rank: 4 } },
    }
    const next = applyImprtRd(ranked, makeRead(weapon.id), [], {
      resonator: false,
      weapon: true,
      echoes: false,
    })

    expect(next.build.weapon.id).toBe(weapon.id)
    expect(next.build.weapon.level).toBe(90)
    expect(next.build.weapon.rank).toBe(4)
  })

  it('leaves the weapon alone when the card names one the catalog does not have', () => {
    const next = applyImprtRd(base, makeRead(null), [], {
      resonator: false,
      weapon: true,
      echoes: false,
    })

    expect(next.build.weapon).toEqual(base.build.weapon)
  })

  it('leaves the weapon alone when its type does not match the destination', () => {
    const otherSeed = listResSds().find((candidate) => candidate.weaponType !== seed.weaponType)!
    const weapon = listWpnsByTy(otherSeed.weaponType)[0]!
    const next = applyImprtRd(base, makeRead(weapon.id), [], {
      resonator: false,
      weapon: true,
      echoes: false,
    })

    expect(next.build.weapon).toEqual(base.build.weapon)
  })
})
