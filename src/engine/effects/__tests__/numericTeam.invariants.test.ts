/*
  Author: Runor Ewhro
  Description: Verifies the numericTeam.invariants.test behavior and its compatibility invariants.
*/

import { describe, expect, it } from 'vitest'
import type { CombatGraph } from '@/domain/entities/combatGraph.ts'
import type { SlotId } from '@/domain/entities/combatGraph.ts'
import { getResSeedBy } from '@/data/catalog/resonatorSeedService.ts'
import { listResRttn, listSkillsFor } from '@/data/catalog/gameDataService.ts'
import { makeEnemy, makeResRuntime } from '@/engine/runtime/defaults.ts'
import { makeCombatGraph } from '@/engine/runtime/combatGraph.ts'
import { writeRtPath } from '@/domain/gameData/runtimePath.ts'
import { wpnAtkAt } from '@/engine/runtime/weaponState.ts'
import { applyEnemyRtDataF, applyRtDataF } from '@/engine/effects/dataEffects.ts'
import { calcFinalStats } from '@/engine/formulas/finalStats.ts'
import { makeCombatEnv, mkRtBaseBuff } from '@/engine/pipeline/buildCombatContext.ts'
import type { FinalStats } from '@/domain/entities/stats.ts'
import {
  executeRotationProgram,
  executeRotationScore,
  prepareRunEnv,
  prepareRotationProgram,
} from '@/engine/rotation/execute.ts'
import {
  forkNumericTeam,
  materializeNumericContext,
  prepareNumericSkill,
  setNumericActiveLane,
  writeNumericRuntime,
} from '@/engine/effects/numericTeam.ts'

function legacyContext(graph: CombatGraph, targetSlotId: SlotId, enemy: ReturnType<typeof makeEnemy>) {
  const participant = graph.participants[targetSlotId]!
  const sourceStats: Record<string, FinalStats> = {}
  const resolved: Record<string, FinalStats> = {}
  for (const source of Object.values(graph.participants)) {
    Object.defineProperty(sourceStats, source.resonatorId, {
      enumerable: true,
      get(): FinalStats {
        const cached = resolved[source.resonatorId]
        if (cached) return cached
        const sourcePool = applyRtDataF(source.runtime, mkRtBaseBuff(source.runtime), {
          graph, targetSlotId: source.slotId, baseStats: source.baseStats, enemy,
        }, 'preStats')
        const stats = calcFinalStats(
          source.baseStats,
          sourcePool,
          wpnAtkAt(source.runtime.build.weapon.id, source.runtime.build.weapon.level),
        )
        resolved[source.resonatorId] = stats
        return stats
      },
    })
  }
  const pool = applyRtDataF(participant.runtime, mkRtBaseBuff(participant.runtime), {
    graph, targetSlotId, baseStats: participant.baseStats, sourceStats, enemy,
  }, 'preStats')
  applyEnemyRtDataF(participant.runtime, pool, {
    graph, targetSlotId, baseStats: participant.baseStats, sourceStats, enemy,
  }, 'preStats')
  const preFinal = calcFinalStats(
    participant.baseStats,
    pool,
    wpnAtkAt(participant.runtime.build.weapon.id, participant.runtime.build.weapon.level),
  )
  applyRtDataF(participant.runtime, pool, {
    graph, targetSlotId, baseStats: participant.baseStats, finalStats: preFinal, sourceStats, enemy,
  }, 'postStats')
  const postFinal = calcFinalStats(
    participant.baseStats,
    pool,
    wpnAtkAt(participant.runtime.build.weapon.id, participant.runtime.build.weapon.level),
  )
  applyRtDataF(participant.runtime, pool, {
    graph, targetSlotId, baseStats: participant.baseStats, finalStats: postFinal, sourceStats, enemy,
  }, 'finalStats')
  return {
    buffs: pool,
    finalStats: calcFinalStats(
      participant.baseStats,
      pool,
      wpnAtkAt(participant.runtime.build.weapon.id, participant.runtime.build.weapon.level),
    ),
  }
}

describe('numeric team effect kernel', () => {
  it('resolves Syntony Field and High Syntony Field without stacking their shared buildup rate', () => {
    const seed = getResSeedBy('1209')
    if (!seed) throw new Error('Missing Mornye test data')

    const resolve = (
      controls: Record<string, boolean>,
      sequence = 0,
    ) => {
      const runtime = makeResRuntime(seed)
      runtime.base.sequence = sequence
      Object.assign(runtime.state.controls, controls)
      const graph = makeCombatGraph({ actRt: runtime, activeSeed: seed })
      const context = makeCombatEnv({ graph, targetSlotId: 'active', enemy: makeEnemy() })
      return {
        buildupRate: context.finalStats.offTuneBuildupRate,
        defPercent: context.buffs.def.percent,
      }
    }

    const none = resolve({})
    const syntony = resolve({ 'team:1209:syntony_field:active': true })
    const high = resolve({ 'team:1209:high_syntony_field:active': true })
    const both = resolve({
      'team:1209:syntony_field:active': true,
      'team:1209:high_syntony_field:active': true,
    })
    const syntonyS2 = resolve({ 'team:1209:syntony_field:active': true }, 2)

    expect(none.buildupRate).toBe(1)
    expect(syntony.buildupRate).toBe(1.5)
    expect(syntony.defPercent).toBe(none.defPercent)
    expect(high.buildupRate).toBe(1.5)
    expect(high.defPercent - none.defPercent).toBe(20)
    expect(both.buildupRate).toBe(1.5)
    expect(syntonyS2.buildupRate).toBe(1.7)
  })

  it('resolves Denia Tune Break Boost before Qingxiao Tune Strain response damage', () => {
    const seeds = ['1413', '1211', '1209'].map((id) => getResSeedBy(id))
    if (seeds.some((seed) => !seed)) throw new Error('Missing Qingxiao Tune Strain team data')
    const [qingxiao, denia, mornye] = seeds as NonNullable<typeof seeds[number]>[]
    const ids = [qingxiao!.id, denia!.id, mornye!.id] as [string, string, string]
    const [qingxiaoRuntime, deniaRuntime, mornyeRuntime] = [qingxiao!, denia!, mornye!].map((seed) => {
      const runtime = makeResRuntime(seed)
      runtime.base.level = 90
      runtime.build.team = [...ids]
      return runtime
    })

    qingxiaoRuntime!.state.controls['combatState:1413:draw_and_sunder:active'] = true
    deniaRuntime!.state.controls['resonator:1211:entropy_shift:active'] = true
    deniaRuntime!.state.controls['resonator:1211:mode:value'] = 'tune_strain'
    mornyeRuntime!.state.controls['team:1209:high_syntony_field:active'] = true

    const graph = makeCombatGraph({
      actRt: qingxiaoRuntime!,
      activeSeed: qingxiao!,
      partRts: { [denia!.id]: deniaRuntime!, [mornye!.id]: mornyeRuntime! },
    })
    const enemy = makeEnemy()
    enemy.status = { ...enemy.status, tuneStrain: 4 }
    const context = makeCombatEnv({ graph, targetSlotId: 'active', enemy })

    expect(context.finalStats.offTuneBuildupRate).toBeCloseTo(1.5)
    expect(context.finalStats.tbb).toBeGreaterThan(10)
    expect(context.finalStats.finalDmg).toBeCloseTo(context.finalStats.tbb * 4 * 0.12)
  })

  it('limits Everbright Polestar RES ignore to Fusion Resonance Liberation skills', () => {
    const prepare = (resonatorId: string) => {
      const seed = getResSeedBy(resonatorId)
      if (!seed) throw new Error(`Missing resonator ${resonatorId}`)
      const runtime = makeResRuntime(seed)
      runtime.build.weapon = { id: '21020076', level: 90, rank: 1, baseAtk: 500 }
      runtime.state.controls['weapon:21020076:passive:active'] = true
      const graph = makeCombatGraph({ actRt: runtime, activeSeed: seed })
      const numeric = makeCombatEnv({ graph, targetSlotId: 'active', enemy: makeEnemy() }).numericTeam
      if (!numeric) throw new Error('Missing numeric team state')
      return { numeric, lane: numeric.program.laneById[resonatorId]!, skills: listSkillsFor('resonator', resonatorId) }
    }

    const fusion = prepare('1210')
    const fusionLiberation = fusion.skills.find((skill) => skill.id === '1210601')
    const fusionBasic = fusion.skills.find((skill) => skill.id === '1210001')
    if (!fusionLiberation || !fusionBasic) throw new Error('Missing Aemeath test skills')
    expect(prepareNumericSkill(fusion.numeric, fusion.lane, fusionLiberation).skillBuffs?.resShred).toBe(10)
    expect(prepareNumericSkill(fusion.numeric, fusion.lane, fusionBasic).skillBuffs?.resShred).toBeUndefined()

    const glacio = prepare('1102')
    const glacioLiberation = glacio.skills.find((skill) => skill.id === '3300014')
    if (!glacioLiberation) throw new Error('Missing Sanhua test skill')
    expect(prepareNumericSkill(glacio.numeric, glacio.lane, glacioLiberation).skillBuffs?.resShred).toBeUndefined()
  })

  it('matches the object executor for the advanced-rotation baseline team', () => {
    const seeds = ['1108', '1212', '1413'].map((id) => getResSeedBy(id))
    expect(seeds.every(Boolean)).toBe(true)
    const [hiyuki, jingran, qingxiao] = seeds
    if (!hiyuki || !jingran || !qingxiao) return

    const ids = [hiyuki.id, jingran.id, qingxiao.id] as const
    const runtimes = [hiyuki, jingran, qingxiao].map((seed) => {
      const runtime = makeResRuntime(seed)
      runtime.build.team = [...ids]
      return runtime
    })
    const graph = makeCombatGraph({
      actRt: runtimes[0]!,
      activeSeed: hiyuki,
      partRts: { [jingran.id]: runtimes[1]!, [qingxiao.id]: runtimes[2]! },
    })
    const enemy = makeEnemy()

    for (const slotId of ['active', 'team1', 'team2'] as const) {
      const legacy = legacyContext(graph, slotId, enemy)
      const numeric = makeCombatEnv({ graph, targetSlotId: slotId, enemy })
      expect(numeric.buffs).toEqual(legacy.buffs)
      expect(numeric.finalStats).toEqual(legacy.finalStats)
    }
  })

  it('applies scoped state writes and active switches without rebuilding the team graph', () => {
    const hiyuki = getResSeedBy('1108')
    const jingran = getResSeedBy('1212')
    const qingxiao = getResSeedBy('1413')
    if (!hiyuki || !jingran || !qingxiao) throw new Error('Missing baseline team data')
    const ids = [hiyuki.id, jingran.id, qingxiao.id] as const
    const original = [hiyuki, jingran, qingxiao].map((seed) => {
      const runtime = makeResRuntime(seed); runtime.build.team = [...ids]; return runtime
    })
    const graph = makeCombatGraph({
      actRt: original[0]!, activeSeed: hiyuki,
      partRts: { [jingran.id]: original[1]!, [qingxiao.id]: original[2]! },
    })
    const enemy = makeEnemy()
    const packed = forkNumericTeam(makeCombatEnv({ graph, targetSlotId: 'active', enemy }).numericTeam!)
    const writes = [
      [jingran.id, 'state.controls.resonator:1212:fortune_in_disguise:stacks', 3],
      [qingxiao.id, 'base.sequence', 6],
      [qingxiao.id, 'state.controls.sequence:1413:s4:active', true],
    ] as const
    let updated = [...original]
    for (const [id, path, value] of writes) {
      writeNumericRuntime(packed, id, path, value)
      updated = updated.map((runtime) => runtime.id === id ? writeRtPath(runtime, path, value) : runtime)
    }
    setNumericActiveLane(packed, qingxiao.id)
    const rebuilt = makeCombatGraph({
      actRt: updated[0]!, activeSeed: hiyuki,
      partRts: { [jingran.id]: updated[1]!, [qingxiao.id]: updated[2]! },
    })
    rebuilt.activeSlotId = 'team2'

    for (const slotId of ['active', 'team1', 'team2'] as const) {
      const legacy = legacyContext(rebuilt, slotId, enemy)
      const numeric = materializeNumericContext(
        packed,
        graph,
        slotId,
        enemy,
        updated[['active', 'team1', 'team2'].indexOf(slotId)],
      )
      expect(numeric.buffs).toEqual(legacy.buffs)
      expect(numeric.finalStats).toEqual(legacy.finalStats)
    }
  })

  it('keeps packed score execution equal to detailed rows for each baseline advanced rotation', () => {
    const seeds = ['1108', '1212', '1413'].map((id) => getResSeedBy(id))
    if (seeds.some((seed) => !seed)) throw new Error('Missing baseline team data')
    const resolved = seeds as NonNullable<typeof seeds[number]>[]
    const ids = resolved.map((seed) => seed.id) as [string, string, string]

    for (let activeIndex = 0; activeIndex < resolved.length; activeIndex += 1) {
      const orderedSeeds = [
        resolved[activeIndex]!,
        resolved[(activeIndex + 1) % 3]!,
        resolved[(activeIndex + 2) % 3]!,
      ]
      const orderedIds = orderedSeeds.map((seed) => seed.id) as [string, string, string]
      const runtimes = orderedSeeds.map((seed) => {
        const runtime = makeResRuntime(seed); runtime.build.team = [...orderedIds]; return runtime
      })
      const graph = makeCombatGraph({
        actRt: runtimes[0]!, activeSeed: orderedSeeds[0],
        partRts: { [orderedIds[1]]: runtimes[1]!, [orderedIds[2]]: runtimes[2]! },
      })
      const enemy = makeEnemy()
      const context = makeCombatEnv({ graph, targetSlotId: 'active', enemy })
      const environment = prepareRunEnv(context, orderedSeeds[0]!)
      const authored = listResRttn(orderedSeeds[0]!.id)[0]?.items ?? runtimes[0]!.rotation.program
      const program = prepareRotationProgram(authored)
      const detailed = executeRotationProgram(environment, program, { detail: 'summary' })
      const packed = executeRotationScore(environment, program)
      expect(program.items.length, ids[activeIndex]).toBeGreaterThan(0)
      expect(detailed.entries.length, ids[activeIndex]).toBeGreaterThan(0)
      const total = detailed.entries.reduce(
        (sum, entry) => ({
          normal: sum.normal + entry.normal,
          crit: sum.crit + entry.crit,
          avg: sum.avg + entry.avg,
        }),
        { normal: 0, crit: 0, avg: 0 },
      )
      expect(packed.total.normal, ids[activeIndex]).toBeCloseTo(total.normal, 10)
      expect(packed.total.crit, ids[activeIndex]).toBeCloseTo(total.crit, 10)
      expect(packed.total.avg, ids[activeIndex]).toBeCloseTo(total.avg, 10)
    }
  })
})
