/*
  Author: Runor Ewhro
  description: checks the Pact sonata grant, which scales from the recipient's Tune Break Boost.
*/

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { listEchoes } from '@/data/catalog/echoCatalogService'
import { listStatesFor } from '@/data/catalog/gameDataService'
import { getResSeedBy } from '@/data/catalog/resonatorSeedService'
import type { RotationNode } from '@/domain/gameData/contracts'
import { migrateLegacyRotationItems } from '@/domain/gameData/loopPasses'
import { makeEnemy, makeResRuntime } from '@/engine/runtime/defaults'
import { prepareResSimulation } from '@/engine/pipeline'
import { executeRotationProgram, executeRotationScore, prepareRotationProgram, prepareRunEnv } from '@/engine/rotation/execute'
import { compilePortableRotation } from '@/engine/rotation/portable/compiler'
import { executeScalarProgram } from '@/engine/rotation/portable/ir'

const PACT = 'runtime.state.controls.echoSet:24:bonus:neonlightLeap5'
const RETIRED = 'runtime.state.controls.echoSet:24:bonus:neonlightLeapOffTune'
const hit = (id: string): Extract<RotationNode, { type: 'feature' }> => ({ id, type: 'feature', resonatorId: '1306', featureId: 'damage:1306036' })
const condition = (id: string, path: string, value: boolean | number | string, owner = '1509'): Extract<RotationNode, { type: 'condition' }> => ({ id, type: 'condition',
  resonatorId: owner, changes: [{ type: 'set', path, value, resonatorId: owner }] })

function score(wearerBoost: number, recipientBoost: number, enabled: boolean, body: RotationNode[] = [hit('hit')]) {
  const ids: [string, string, string] = ['1509', '1306', '1211']
  const runtimes = ids.map(id => {
    const runtime = makeResRuntime(getResSeedBy(id)!)
    runtime.base.level = 90
    runtime.build.team = ids
    runtime.build.echoes = [null, null, null, null, null]
    runtime.state.controls = {}
    runtime.state.manualBuffs.modifiers.push({ id: 'boost', enabled: true, scope: 'topStat', stat: 'tuneBreakBoost',
      value: (id === '1509' ? wearerBoost : recipientBoost) - getResSeedBy(id)!.baseStats.tuneBreakBoost })
    return runtime
  })
  runtimes[0]!.build.echoes = listEchoes().filter(echo => echo.sets.includes(24)).slice(0, 5).map((echo, index) => ({
    uid: `pact:${index}`, id: echo.id, set: 24, mainEcho: false,
    mainStats: { primary: { key: 'atkPercent', value: 0 }, secondary: { key: 'atkFlat', value: 0 } }, substats: {},
  }))
  expect(runtimes[0]!.build.echoes).toHaveLength(5)
  runtimes[0]!.state.controls['echoSet:24:bonus:neonlightLeap5'] = enabled
  // a stored value on the retired control must not change the computed grant
  runtimes[0]!.state.controls['echoSet:24:bonus:neonlightLeapOffTune'] = 50
  const { context } = prepareResSimulation(runtimes[1]!, getResSeedBy('1306')!, makeEnemy(),
    Object.fromEntries(runtimes.map(runtime => [runtime.id, runtime])), { '1509@echoSet:24:bonus': '1306' })
  const env = prepareRunEnv(context, getResSeedBy('1306')!)
  const items: RotationNode[] = [condition('active', 'runtime.rotation.activeResonatorId', '1306'), ...body]
  const program = prepareRotationProgram(items)
  const detailed = executeRotationProgram(env, program, { inspect: true })
  const total = detailed.entries.reduce((sum, entry) => sum + entry.avg, 0)
  expect(executeRotationScore(env, program).total.avg).toBeCloseTo(total, 6)
  const portable = compilePortableRotation(env, items, [], new Set(body.filter(node => node.type === 'feature').map(node => `${node.id}|0`)),
    {}, undefined, undefined, { echoCount: 0 })
  expect(executeScalarProgram(portable.scalar, new Float64Array(portable.scalar.inputCount))[0]).toBeCloseTo(total, 6)
  return detailed.inspection.flatMap(entry => entry.value?.kind === 'feature' ? [entry.value.effectiveStats!.atk!] : [])
}

describe('Pact recipient scaling', () => {
  it.each(['live', 'beta'])('%s data exposes one activation control and reads the recipient final Tune Break Boost', mode => {
    const sets = JSON.parse(readFileSync(new URL(`../../../../public/data/${mode}/sonata/effects.json`, import.meta.url), 'utf8'))
    const set = sets.find((set: { id: number }) => set.id === 24)
    expect(Object.keys(set.states)).toEqual(['neonlightLeap5'])
    expect(set.extraEffects[0]).toMatchObject({ id: 'neonlightLeapOffTune', stage: 'finalStats', targetScope: 'activeOther' })
    expect(set.extraEffects[0].operations[0].value.value.values[0]).toEqual({ type: 'read', from: 'finalStats', path: 'tbb', default: 0 })
    expect(listStatesFor('echoSet', '24').map(state => state.controlKey)).toEqual(['echoSet:24:bonus:neonlightLeap5'])
  })

  it('ignores wearer boost, scales from the recipient and caps at 15 additional ATK percent in all executors', () => {
    const off = score(50, 0, false)[0]!, base = score(50, 0, true)[0]!
    const extra = score(50, 40, true)[0]!
    // 40 recipient boost adds 12 of the 15 additional ATK percent
    expect((extra - base) / (base - off)).toBeCloseTo(12 / 15, 7)
    expect(score(200, 40, true)[0]).toBeCloseTo(extra, 7)
    expect(score(0, 40, true)[0]).toBeCloseTo(extra, 7)
    expect(score(50, 100, true)[0]! - base).toBeCloseTo(base - off, 7)
  })

  it('recalculates the magnitude when a recipient buff changes during the active handoff', () => {
    const path = 'runtime.state.controls.resonator:1509:true_color:active'
    const values = score(50, 0, true, [hit('before'), condition('boost-on', path, true), hit('during'),
      condition('boost-off', path, false), hit('after')])
    const baseline = score(50, 0, false)[0]!
    expect(values[2]).toBeCloseTo(values[0]!, 7)
    expect((values[1]! - values[0]!) / (values[0]! - baseline)).toBeCloseTo(12 / 15, 7)
  })

  it('includes Tune Break Boost produced by another post-stat conversion before computing the ATK grant', () => {
    const values = score(50, 0, true, [hit('before'),
      condition('mode', 'runtime.state.controls.resonator:1211:mode:value', 'tune_strain', '1211'),
      condition('etched-on', 'runtime.state.controls.resonator:1211:entropy_shift:active', true, '1211'), hit('during'),
      condition('etched-off', 'runtime.state.controls.resonator:1211:entropy_shift:active', false, '1211'), hit('after')])
    const baseline = score(50, 0, false)[0]!
    expect(values[2]).toBeCloseTo(values[0]!, 7)
    // Etched Colors grants 10 boost at the native 100% buildup rate
    expect((values[1]! - values[0]!) / (values[0]! - baseline)).toBeCloseTo(3 / 15, 7)
  })

  it('removes retired setters from imports, including attachments and loop forks, preserving activation and other edits', () => {
    const items: RotationNode[] = [condition('old', RETIRED, 50), condition('activation', PACT, true), {
      ...condition('mixed', RETIRED, 20), changes: [
        { type: 'set', path: RETIRED, value: 20 }, { type: 'set', path: PACT, value: true },
      ],
    }, { ...hit('attached'), attached: { conditions: [condition('retired-attached', RETIRED, 40)], features: [] } },
    { id: 'loop', type: 'loop', kind: 'start', loopId: 'l', runs: 2,
      passForks: { '2': [condition('retired-fork', RETIRED, 50), hit('fork-hit')] } }, hit('loop-hit'),
    { id: 'end', type: 'loop', kind: 'end', loopId: 'l' }]
    const migrated = migrateLegacyRotationItems(items)
    expect(JSON.stringify(migrated)).not.toContain(RETIRED)
    expect(JSON.stringify(items)).toContain(RETIRED)
    expect(migrated.some(node => node.id === 'activation')).toBe(true)
    expect(migrated.find(node => node.id === 'mixed')).toMatchObject({ changes: [{ path: PACT, value: true }] })
    expect(migrateLegacyRotationItems(migrated)).toEqual(migrated)
  })
})
