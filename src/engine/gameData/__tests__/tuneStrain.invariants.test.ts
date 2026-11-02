/*
  Author: Runor Ewhro
  description: preserves enemy-specific Tune Strain ceilings through team
               inference, authored rotation writes, and portable scoring.
*/

import { describe, expect, it } from 'vitest'
import { getResSeedBy } from '@/data/catalog/resonatorSeedService'
import { listResFeats } from '@/data/catalog/gameDataService'
import type { RotationNode } from '@/domain/gameData/contracts'
import { makeEnemy, makeResRuntime } from '@/engine/runtime/defaults'
import { getTuneStrainMaxForTeam } from '@/engine/gameData/tuneStrain'
import { prepareResSimulation } from '@/engine/pipeline'
import { executeRotationProgram, executeRotationScore, prepareRotationProgram, prepareRunEnv } from '@/engine/rotation/execute'
import { compilePortableRotation } from '@/engine/rotation/portable/compiler'
import { executeScalarProgram } from '@/engine/rotation/portable/ir'
import { readEffects } from '@/modules/simulation/features/enemies/lib/effects'

describe('Tune Strain stack ceilings', () => {
  it.each(['340000260', '340000261'])('uses shared stacks for %s damage and the enemy summary', (id) => {
    const seed = getResSeedBy('1510')!
    const runtime = makeResRuntime(seed)
    runtime.build.team = ['1510', '1509', '1209']
    const enemy = { ...makeEnemy(), id, status: { tuneStrain: 6 } }
    const { context } = prepareResSimulation(runtime, seed, enemy)
    expect(context.finalStats.dmgVuln).toBe(24)
    const summary = readEffects(runtime, enemy, null, (key) => enemy.status[key as 'tuneStrain'], () => false)
    expect(summary.dmgVuln).toBe(24)
    expect(summary.rows.filter((row) => row.side === 'target')).toHaveLength(1)
    expect(summary.rows.find((row) => row.side === 'target')?.state).toBeNull()
  })

  it('applies Pavilion vulnerability once per recipient in portable team scoring', () => {
    const seed = getResSeedBy('1102')!
    const runtime = makeResRuntime(seed)
    const teammate = makeResRuntime(getResSeedBy('1502')!)
    for (const member of [runtime, teammate]) {
      member.build.team = [runtime.id, teammate.id, null]
      member.build.echoes = [null, null, null, null, null]
    }
    const enemy = { ...makeEnemy(), id: '340000310', status: { tuneStrain: 3 } }
    const { context } = prepareResSimulation(runtime, seed, enemy, { [teammate.id]: teammate })
    expect(context.finalStats.dmgVuln).toBe(25)
    const env = prepareRunEnv(context, seed)
    const items: RotationNode[] = [runtime, teammate].map((member, index) => ({
      id: `hit-${index}`, type: 'feature', resonatorId: member.id,
      featureId: listResFeats(member.id).find((feature) => feature.variant !== 'subHit')!.id,
    }))
    const exact = executeRotationScore(env, prepareRotationProgram(items))
    expect(exact.resonators.filter((member) => member.avg > 0)).toHaveLength(2)
    const portable = compilePortableRotation(env, items, [], new Set(['hit-0|0', 'hit-1|0']), {}, undefined, undefined, { echoCount: 0 })
    const score = executeScalarProgram(portable.scalar, new Float64Array(portable.scalar.inputCount))[0]!
    expect(score).toBeCloseTo(exact.total.avg, 7)
  })

  it.each(['340000260', '340000261', '340000310'])('adds two stacks for enemy %s', (id) => {
    const runtime = makeResRuntime(getResSeedBy('1510')!)
    runtime.build.team = ['1510', '1509', '1209']
    expect(getTuneStrainMaxForTeam(runtime)).toBe(4)
    expect(getTuneStrainMaxForTeam(runtime, { id })).toBe(6)
    expect(getTuneStrainMaxForTeam(runtime, { id: '340000250' })).toBe(4)
    runtime.build.team = ['1510', '1510', null]
    expect(getTuneStrainMaxForTeam(runtime, { id })).toBe(4)
    expect(getTuneStrainMaxForTeam(null, { id })).toBe(3)
  })

  it.each(['340000260', '340000261', '340000310', '340000250'])('shares %s bounds across detailed, rowless, and portable execution', (id) => {
    const seed = getResSeedBy('1209')!
    const runtime = makeResRuntime(seed)
    runtime.base.level = 90
    runtime.build.echoes = [null, null, null, null, null]
    runtime.state.controls['resonator:1209:decoupling:active'] = true
    const enemy = { ...makeEnemy(), id }
    const { context } = prepareResSimulation(runtime, seed, enemy)
    const env = prepareRunEnv(context, seed)
    const max = getTuneStrainMaxForTeam(runtime, enemy)
    expect(max).toBe(id === '340000250' ? 2 : 4)
    const score = (value: number, type: 'set' | 'add' = 'set') => {
      const items: RotationNode[] = [
        { id: 'strain', type: 'condition', changes: [{ type, path: 'enemy.status.tuneStrain', value }] },
        { id: 'hit', type: 'feature', featureId: 'damage:1209001' },
      ]
      const program = prepareRotationProgram(items)
      const detailed = executeRotationProgram(env, program, { inspect: true })
      const rowless = executeRotationScore(env, program)
      const portable = compilePortableRotation(env, items, [], new Set(['hit|0']), {}, undefined, undefined, { echoCount: 0 })
      const portableScore = executeScalarProgram(portable.scalar, new Float64Array(portable.scalar.inputCount))[0]!
      expect(detailed.inspection.find((entry) => entry.nodeId === 'strain')?.value)
        .toMatchObject({ kind: 'condition', value: Math.max(0, Math.min(value, max)) })
      expect(detailed.entries).toHaveLength(1)
      expect(rowless.total.avg).toBeCloseTo(detailed.entries[0]!.avg, 8)
      expect(portableScore).toBeCloseTo(rowless.total.avg, 7)
      return rowless.total.avg
    }
    const capped = score(max)
    expect(score(99)).toBeCloseTo(capped, 8)
    expect(score(99, 'add')).toBeCloseTo(capped, 8)
    expect(score(-1)).toBeLessThan(capped)
    expect(score(max - 1)).toBeLessThan(capped)
  })
})
