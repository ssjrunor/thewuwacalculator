/*
  Author: Runor Ewhro
  description: protects Slumbering Moonlight's active window, recipients,
               and distinct Echo bonus and Glacio Chafe amplification lanes.
*/

import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { initGameData } from '@/data/gameData'
import { getResSeedBy } from '@/data/catalog/resonatorSeedService'
import type { RotationNode, SrcPkg } from '@/domain/gameData/contracts'
import { makeResRuntime, makeEnemy } from '@/engine/runtime/defaults'
import { makeSkillCtx } from '@/engine/pipeline/prepareRuntimeSkill'
import { listStatesFor } from '@/data/catalog/gameDataService'
import { executeRotationProgram, executeRotationScore, prepareRotationProgram, prepareRunEnv } from '@/engine/rotation/execute'
import { compilePortableRotation } from '@/engine/rotation/portable/compiler'
import { executeScalarProgram } from '@/engine/rotation/portable/ir'

const S2 = 'sequence:1109:s2:active'
const MODE = 'resonator:1109:mode:value'
const MONTAGE = 'team:1109:montage:active'

beforeAll(async () => { await initGameData({ mode: 'beta' }) })

function team(sequence: number, mode: string) {
  return ['1109', '1404', '1405'].map((id, _, ids) => {
    const runtime = makeResRuntime(getResSeedBy(id)!)
    runtime.base.sequence = id === '1109' ? sequence : 0
    runtime.state.controls = id === '1109' ? { [MODE]: mode } : {}
    runtime.build.echoes = [null, null, null, null, null]
    runtime.build.team = [id, ...ids.filter(member => member !== id)] as [string, string, string]
    return runtime
  })
}

describe('Lucilla Slumbering Moonlight', () => {
  it.each(['beta', 'live'])('%s sources and both bundles expose the same S2 effects and control', (mode) => {
    const read = (file: string) => JSON.parse(readFileSync(new URL(`../../../../public/data/${mode}/resonators/${file}`, import.meta.url), 'utf8'))
    const source = (read('sources.json') as SrcPkg[]).find(source => source.source.id === '1109')!
    const bundles = [read('runtime-bundles/1109.json'), read('worker-bundles/1109.json')]
    for (const entry of [source, ...bundles.map(bundle => bundle.source)] as SrcPkg[]) {
      const echo = entry.effects!.find(effect => effect.id === '1109:s2:montage:echo-amplify')!
      const chafe = entry.effects!.find(effect => effect.id === '1109:s2:montage:glacio-chafe-amp')!
      expect(echo.targetScope).toBe('teamWide')
      expect(echo.operations).toEqual([{ type: 'add_skilltype_mod', skillType: 'echoSkill', mod: 'dmgBonus', value: { type: 'const', value: 40 } }])
      expect(chafe.operations).toEqual([{ type: 'add_skilltype_mod', skillType: 'glacioChafe', mod: 'amplify', value: { type: 'const', value: 80 } }])
      expect(echo.condition).toEqual(source.effects!.find(effect => effect.id === echo.id)!.condition)
    }
    for (const details of [read('details.json')['1109'], ...bundles.map(bundle => bundle.details)]) {
      expect(details.stateGraph.nodes.find((node: { key: string }) => node.key === S2)).toMatchObject({
        ownerKey: 'sequence:1109:s2', kind: 'toggle', defaultValue: false, displayScope: 'both',
      })
      expect(details.resonanceChains.find((chain: { index: number }) => chain.index === 2).stateKeys).toContain(S2)
    }
    expect(listStatesFor('resonator', '1109').find(state => state.controlKey === S2)).toMatchObject({
      label: 'Slumbering Moonlight', displayScope: 'both',
    })
  })

  it.each(['echo', 'glacio_chafe'])('gates both self and teammate effects by S2 and its active window in %s mode', (mode) => {
    for (const sequence of [1, 2]) {
      const runtimes = team(sequence, mode)
      const lucilla = runtimes[0]!
      const stats = () => runtimes.map(runtime => makeSkillCtx({
        runtime, seed: getResSeedBy(runtime.id)!, enemy: makeEnemy(),
        runtimesById: Object.fromEntries(runtimes.map(runtime => [runtime.id, runtime])),
      }).context.finalStats)
      const off = stats()
      lucilla.state.controls[S2] = true
      const on = stats()
      for (let index = 0; index < runtimes.length; index++) {
        const echoBefore = off[index]!.skillType.echoSkill
        const echoAfter = on[index]!.skillType.echoSkill
        expect(echoAfter.dmgBonus - echoBefore.dmgBonus).toBe(mode === 'echo' && sequence === 2 ? 40 : 0)
        expect(echoAfter.amplify - echoBefore.amplify).toBe(0)
        expect(on[index]!.skillType.glacioChafe.amplify - off[index]!.skillType.glacioChafe.amplify)
          .toBe(mode === 'glacio_chafe' && sequence === 2 ? 80 : 0)
      }
      lucilla.state.controls[S2] = false
      expect(stats()).toEqual(off)
    }
  })

  it('keeps S2 separate from Montage so its Echo bonus can remain after the Outro ends', () => {
    const [lucilla, recipient, other] = team(2, 'echo')
    const stats = () => makeSkillCtx({ runtime: recipient!, seed: getResSeedBy(recipient!.id)!, enemy: makeEnemy(),
      runtimesById: { '1109': lucilla!, [other!.id]: other! },
    }).context.finalStats.skillType.echoSkill
    const base = stats()
    lucilla!.state.controls[S2] = true
    const moonlight = stats()
    lucilla!.state.controls[MONTAGE] = true
    const both = stats()
    expect(moonlight.dmgBonus - base.dmgBonus).toBe(40)
    expect(moonlight.amplify - base.amplify).toBe(0)
    expect(both.dmgBonus).toBe(moonlight.dmgBonus)
    expect(both.amplify - moonlight.amplify).toBe(50)
    lucilla!.state.controls[MONTAGE] = false
    expect(stats()).toEqual(moonlight)
  })

  it('updates Echo damage when a rotation enables and expires S2 in all executors', () => {
    const runtimes = team(2, 'echo')
    const lucilla = runtimes[0]!
    const seed = getResSeedBy(lucilla.id)!
    const { context } = makeSkillCtx({ runtime: lucilla, seed, enemy: makeEnemy(),
      runtimesById: Object.fromEntries(runtimes.map(runtime => [runtime.id, runtime])),
    })
    const hit = (id: string): RotationNode => ({ id, type: 'feature', featureId: 'damage:1109013' })
    const set = (enabled: boolean): RotationNode => ({ id: `s2:${enabled}`, type: 'condition', changes: [
      { type: 'set', path: `runtime.state.controls.${S2}`, value: enabled },
    ] })
    const items = [hit('before'), set(true), hit('active'), set(false), hit('expired')]
    const environment = prepareRunEnv(context, seed)
    const program = prepareRotationProgram(items)
    const detailed = executeRotationProgram(environment, program, { inspect: true })
    const hits = detailed.inspection.flatMap(row => row.value?.kind === 'feature' ? [row.value] : [])
    expect(hits).toHaveLength(3)
    expect(hits[1]!.effectiveStats!.bonus! - hits[0]!.effectiveStats!.bonus!).toBe(40)
    expect(hits[1]!.effectiveStats!.amplify).toBe(hits[0]!.effectiveStats!.amplify)
    expect(hits[1]!.avg).toBeGreaterThan(hits[0]!.avg)
    expect(hits[2]!.avg).toBe(hits[0]!.avg)
    const total = detailed.entries.reduce((sum, entry) => sum + entry.avg, 0)
    expect(executeRotationScore(environment, program).total.avg).toBeCloseTo(total, 6)
    const portable = compilePortableRotation(environment, items, [], new Set(['before|0', 'active|0', 'expired|0']),
      {}, undefined, undefined, { echoCount: 0 })
    expect(executeScalarProgram(portable.scalar, new Float64Array(portable.scalar.inputCount))[0]).toBeCloseTo(total, 6)
  })
})
