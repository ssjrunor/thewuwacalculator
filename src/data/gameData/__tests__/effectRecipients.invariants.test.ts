/*
  Author: Runor Ewhro
  description: preserves team and active-field recipients through generated
               bundles and both rotation execution paths.
*/

import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { initGameData } from '@/data/gameData'
import { getResSeedBy } from '@/data/catalog/resonatorSeedService'
import { listResFeats } from '@/data/catalog/gameDataService'
import type { ResRuntime } from '@/domain/entities/runtime'
import type { RotationNode, SrcPkg } from '@/domain/gameData/contracts'
import { makeEnemy, makeResRuntime } from '@/engine/runtime/defaults'
import { prepareResSimulation } from '@/engine/pipeline'
import { executeRotationProgram, executeRotationScore, prepareRotationProgram, prepareRunEnv } from '@/engine/rotation/execute'
import { compilePortableRotation } from '@/engine/rotation/portable/compiler'
import { executeScalarProgram } from '@/engine/rotation/portable/ir'

beforeAll(async () => { await initGameData({ mode: 'beta' }) })

const scopes = [
  ['1311:outro:unison', 'otherTeammates'],
  ['1311:outro:electro-flare', 'otherTeammates'],
  ['1409:blessing', 'active'],
  ['1110:reflecting-shadows:dmg', 'active'],
] as const

const active = (id: string): RotationNode => ({ id: `active:${id}`, type: 'condition', changes: [
  { type: 'set', path: 'runtime.rotation.activeResonatorId', value: id },
] })
const hit = (id: string, resonatorId: string): RotationNode => ({ id, type: 'feature', resonatorId,
  featureId: listResFeats(resonatorId).find(feature => feature.variant !== 'subHit')!.id })

function execute(ids: [string, string, string], configure: (source: ResRuntime) => void, items: RotationNode[], selectedTargets = {}) {
  const runtimes = ids.map(id => {
    const runtime = makeResRuntime(getResSeedBy(id)!)
    runtime.build.team = ids
    runtime.build.echoes = [null, null, null, null, null]
    runtime.state.controls = {}
    return runtime
  })
  configure(runtimes[0]!)
  const { context } = prepareResSimulation(runtimes[0]!, getResSeedBy(ids[0])!, makeEnemy(),
    Object.fromEntries(runtimes.map(runtime => [runtime.id, runtime])), selectedTargets)
  const environment = prepareRunEnv(context, getResSeedBy(ids[0])!)
  const program = prepareRotationProgram(items)
  const detailed = executeRotationProgram(environment, program, { inspect: true })
  const packed = executeRotationScore(environment, program)
  const portable = compilePortableRotation(environment, items, [],
    new Set(items.filter(item => item.type === 'feature').map(item => `${item.id}|0`)),
    {}, undefined, undefined, { echoCount: 0 })
  const score = executeScalarProgram(portable.scalar, new Float64Array(portable.scalar.inputCount))[0]!
  const total = detailed.entries.reduce((sum, entry) => sum + entry.avg, 0)
  expect(packed.total.avg).toBeCloseTo(total, 6)
  expect(score).toBeCloseTo(total, 6)
  return detailed.inspection.flatMap(entry => entry.value?.kind === 'feature' ? [entry.value.effectiveStats!] : [])
}

describe('effect recipient contracts', () => {
  it.each(['beta', 'live'])('%s keeps Augusta Battlesong in the amplification channel on every surface', (mode) => {
    const read = (file: string) => JSON.parse(readFileSync(new URL(`../../../../public/data/${mode}/resonators/${file}`, import.meta.url), 'utf8'))
    const sources = read('sources.json') as SrcPkg[]
    for (const source of [sources.find(source => source.source.id === '1306'),
      read('runtime-bundles/1306.json').source, read('worker-bundles/1306.json').source] as SrcPkg[]) {
      expect(source.effects?.find(effect => effect.id === '1306:battlesong')).toMatchObject({
        targetScope: 'activeOther', operations: [{ type: 'add_attribute_mod', attribute: 'all',
          mod: 'amplify', value: { type: 'const', value: 15 } }],
      })
    }
  })

  it('applies Augusta Battlesong amplification to its selected recipient', () => {
    const items = [active('1404'), hit('recipient', '1404'), hit('source', '1306')]
    const run = (enabled: boolean) => execute(['1306', '1404', '1405'], source => {
      source.state.controls['team:1306:battlesong_of_the_unyielding:active'] = enabled
    }, items, { '1306@team:1306:battlesong_of_the_unyielding': '1404' })
    const on = run(true), off = run(false)
    expect(on.map((stats, index) => stats.amplify! - off[index]!.amplify!)).toEqual([15, 0])
    expect(on.map((stats, index) => stats.bonus! - off[index]!.bonus!)).toEqual([0, 0])
  })

  it.each(['beta', 'live'])('%s sources, runtime bundles, and worker bundles agree on recipient scopes', (mode) => {
    const read = (file: string) => JSON.parse(readFileSync(new URL(`../../../../public/data/${mode}/resonators/${file}`, import.meta.url), 'utf8'))
    const sources = read('sources.json') as SrcPkg[]
    for (const [effectId, scope] of scopes) {
      const id = effectId.split(':')[0]!
      for (const source of [sources.find(source => source.source.id === id), read(`runtime-bundles/${id}.json`).source, read(`worker-bundles/${id}.json`).source] as SrcPkg[]) {
        expect(source.effects?.find(effect => effect.id === effectId)?.targetScope, effectId).toBe(scope)
      }
    }
  })

  it.each(['unison', 'electro_flare'])('keeps Hsin %s Outro on both other teammates across swaps', (mode) => {
    const items = [active('1506'), hit('first', '1506'), hit('off-field-second', '1312'),
      active('1312'), hit('off-field-first', '1506'), hit('second', '1312'), active('1311'), hit('source', '1311')]
    const run = (enabled: boolean) => execute(['1311', '1506', '1312'], source => {
      source.state.controls['resonator:1311:mode:value'] = mode
      source.state.controls['team:1311:herself_a_thousand_lanterns:active'] = enabled
    }, items, { '1311@team:1311:herself_a_thousand_lanterns': '1506' })
    const on = run(true), off = run(false)
    const expected = mode === 'unison' ? [20, 20, 20, 20, 0] : [0, 20, 0, 20, 0]
    expect(on.map((stats, index) => stats.amplify! - off[index]!.amplify!)).toEqual(expected)
  })

  it('moves Cartethyia blessing to the current active teammate and excludes Cartethyia', () => {
    const items: RotationNode[] = [{ id: 'negative-status', type: 'condition', changes: [
      { type: 'set', path: 'enemy.combat.aeroErosion', value: 1 },
    ] }, active('1404'), hit('first', '1404'), active('1405'), hit('old', '1404'), hit('second', '1405'),
      active('1409'), hit('source', '1409')]
    const run = (enabled: boolean) => execute(['1409', '1404', '1405'], source => {
      source.state.controls['team:1409:winds_divine_blessing:active'] = enabled
    }, items)
    const on = run(true), off = run(false)
    expect(on.map((stats, index) => stats.amplify! - off[index]!.amplify!)).toEqual([17.5, 0, 17.5, 0])
  })

  it('moves Suisui Reflecting Shadows with the active Resonator, including Suisui', () => {
    const items = [active('1404'), hit('first', '1404'), active('1405'), hit('old', '1404'), hit('second', '1405'),
      active('1110'), hit('source', '1110')]
    const run = (enabled: boolean) => execute(['1110', '1404', '1405'], source => {
      source.state.manualBuffs.quick.energyRegen = 160
      source.state.controls['team:1110:ceaseless_landscape:active'] = true
      source.state.controls['team:1110:rippling_waters:active'] = true
      source.state.controls['team:1110:reflecting_shadows:active'] = enabled
    }, items)
    const on = run(true), off = run(false)
    expect(on.map((stats, index) => stats.bonus! - off[index]!.bonus!)).toEqual([12, 0, 12, 12])
  })
})
