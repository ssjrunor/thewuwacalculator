/*
  Author: Runor Ewhro
  description: keeps evaluation anchor sheet crit separate from Lily's
               attack-specific Energy Regen conversion.
*/

import { beforeAll, expect, it } from 'vitest'
import { initGameData } from '@/data/gameData'
import { getResSeedBy } from '@/data/catalog/resonatorSeedService'
import { listChsByCos } from '@/data/catalog/echoCatalogService'
import { ECHO_MAIN_STATS, ECHO_SIDE_STATS } from '@/data/gameData/catalog/echoStats'
import { makeEnemy, mkMaxResRt } from '@/engine/runtime/defaults'
import { runResSmlt } from '@/engine/pipeline'
import { makeRuntimeMap } from '@/engine/runtime/runtimeAdapters'
import { rotationBuildEvaluationReport } from '@/engine/evaluation/buildEvaluation'
import { combatScenarioId, teamMemberId } from '@/domain/entities/combatScenario'
import type { EchoInstance } from '@/domain/entities/runtime'
import { prepSkill } from '@/engine/pipeline/prepareRuntimeSkill'

beforeAll(async () => { await initGameData({ mode: 'beta' }) })

it('shows sheet crit in Lily anchors while finishers retain their own ER-derived crit', () => {
  const seed = getResSeedBy('1512')!
  const runtime = mkMaxResRt(seed, 0)
  runtime.build.echoes = ([ [4, 'hpPercent'], [3, 'energyRegen'], [3, 'energyRegen'], [1, 'hpPercent'], [1, 'hpPercent'] ] as const)
    .map(([cost, key], index): EchoInstance => {
      const def = listChsByCos(cost).filter(x => x.sets.includes(5))[index % 2]
      return { id: def.id, uid: `lily-anchor-${index}`, set: 5, mainEcho: index === 0,
        mainStats: { primary: { key, value: ECHO_MAIN_STATS[cost][key] }, secondary: { ...ECHO_SIDE_STATS[cost] } },
        substats: { energyRegen: 8.4, critRate: 7.5, critDmg: 15, hpPercent: 8.6, hpFlat: 430 } }
    })
  const enemy = makeEnemy(), runtimesById = makeRuntimeMap(runtime)
  const simulation = runResSmlt(runtime, seed, enemy, runtimesById, {})
  const report = rotationBuildEvaluationReport({ scenarioId: combatScenarioId('lily-anchor'), memberId: teamMemberId('1512'),
    runtime, simulation, enemy, runtimesById }, { sections: { rotationFeatures: true, upgradePaths: false, echoStatsTable: true } })!
  for (const key of ['referenceBuild', 'maximumBuild'] as const) {
    const build = report.evaluation.builds[key]
    const total = (stat: string) => build.statRows.find(row => row.key === stat)?.total ?? 0
    const sheet = (stat: string) => build.overviewStats.secondaryStats.find(row => row.key === stat)!.total
    expect(sheet('critRate')).toBeCloseTo(5 + total('critRate'), 4)
    expect(sheet('critDmg')).toBeCloseTo(150 + total('critDmg'), 4)
    const candidate = { ...runtime, build: { ...runtime.build, echoes: build.echoes.map((echo, index): EchoInstance => ({
      id: echo.echoId, uid: `anchor-replay-${index}`, set: echo.setId, mainEcho: echo.mainEcho,
      mainStats: { primary: echo.primary, secondary: echo.secondary },
      // Maximum anchors retain their allocation in aggregate stat rows.
      substats: Object.fromEntries(build.statRows.map(stat => [stat.key, stat.substatTotal / build.echoes.length])),
    })) } }
    const prepared = prepSkill({ runtime: candidate, seed, enemy, skillId: '1512023' })!
    expect(prepared.context.finalStats.critRate).toBeCloseTo(sheet('critRate'), 4)
    expect(prepared.context.finalStats.critDmg).toBeCloseTo(sheet('critDmg'), 4)
    expect(prepared.skill.skillBuffs?.critRate).toBe(80)
    expect(prepared.skill.skillBuffs?.critDmg).toBe(160)
  }
}, 120_000)
