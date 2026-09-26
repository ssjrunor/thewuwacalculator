/*
  Author: Runor Ewhro
  Description: Replays uncached evaluation reports from a local WWCB1 backup and compares reference outputs.
*/

import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import zlib from 'node:zlib'
import { createServer } from 'vite'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const args = process.argv.slice(2)
const backupPath = args.find(arg => !arg.startsWith('--'))
const option = name => args.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3)
if (!backupPath) throw new Error('Usage: node tools/analysis/evaluationColdAudit.mjs <backup.wwcalc> [--output=results.json] [--compare=baseline.json]')
const raw = await fs.readFile(path.resolve(backupPath))
assert.equal(raw.subarray(0, 5).toString(), 'WWCB1')
const backup = JSON.parse(zlib.brotliDecompressSync(raw.subarray(5)).toString())

const originalFetch = globalThis.fetch
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input.url ?? String(input)
  if (url.startsWith('/data/')) return new Response(await fs.readFile(path.join(root, 'public', url.slice(1)), 'utf8'))
  return originalFetch(input, init)
}
const server = await createServer({
  root, configFile: false, appType: 'custom', logLevel: 'error',
  optimizeDeps: { include: [], noDiscovery: true },
  resolve: { alias: { '@': path.join(root, 'src') } },
  server: { hmr: false, middlewareMode: true, ws: false },
})

try {
  const load = modulePath => server.ssrLoadModule(modulePath)
  const gameData = await load('/src/data/gameData/index.ts')
  await gameData.initGameData()
  const [seeds, project, adapters, pipeline, evaluation, assumptions, tune] = await Promise.all([
    load('/src/data/catalog/resonatorSeedService.ts'),
    load('/src/engine/runtime/scenarioRuntime.ts'),
    load('/src/engine/runtime/runtimeAdapters.ts'),
    load('/src/engine/pipeline/index.ts'),
    load('/src/engine/evaluation/buildEvaluation.ts'),
    load('/src/modules/simulation/model/evaluationAssumptions.ts'),
    load('/src/engine/gameData/tuneStrain.ts'),
  ])
  const results = []
  for (const id of backup.combat.order) {
    const scenario = backup.combat.scenariosById[id]
    const projected = project.projectScenarioUiRuntimes(scenario)
    const baseRuntime = projected.subjectRuntime
    if (!baseRuntime) throw new Error(`Missing runtime in ${id}`)
    const runtime = assumptions.applyEvaluationAsm(baseRuntime)
    const seed = seeds.getResSeedBy(runtime.id)
    if (!seed) throw new Error(`Missing resonator seed ${runtime.id}`)
    const runtimesById = adapters.makeRuntimeMap(runtime, assumptions.applyEvaluationMapAsm(projected.runtimesById))
    const enemy = assumptions.makeEvaluationEnemy(tune.getTuneStrainMaxForTeam(runtime))
    const selectedTargets = project.flattenScenarioRouting(scenario)
    const simulation = pipeline.runResSmlt(runtime, seed, enemy, runtimesById, selectedTargets)
    const input = { scenarioId: scenario.id, memberId: scenario.team.members[0].id,
      runtime, simulation, enemy, runtimesById }
    const options = { alternativesLimit: 0, sections: {
      rotationFeatures: false, upgradePaths: false, echoStatsTable: true, evaluationTargets: true,
    } }
    const start = performance.now()
    const report = evaluation.rotationBuildEvaluationReport(input, options)
    const ms = performance.now() - start
    if (!report) throw new Error(`Missing evaluation report in ${id}`)
    const row = {
      id, resonatorId: runtime.id, name: seed.name, ms,
      score: report.evaluation.percent * 100,
      userDamage: report.evaluation.userDamage,
      referenceDamage: report.evaluation.referenceDamage,
      maximumDamage: report.evaluation.maximumDamage,
      reference: report.evaluation.builds.referenceBuild,
    }
    results.push(row)
    console.log(JSON.stringify({ id, resonatorId: runtime.id, coldMs: Number(ms.toFixed(2)) }))
  }
  const comparable = row => {
    const { ms, ...output } = row
    return output
  }
  const comparisonPath = option('compare')
  if (comparisonPath) {
    const baseline = JSON.parse(await fs.readFile(path.resolve(comparisonPath), 'utf8'))
    const expected = baseline.map(({ warmMs, ...row }) => comparable(row))
    const actual = JSON.parse(JSON.stringify(results.map(comparable)))
    const mismatch = actual.findIndex((row, index) => !isDeepStrictEqual(row, expected[index]))
    if (mismatch >= 0 || actual.length !== expected.length) {
      throw new Error(`Cold anchor mismatch at ${actual[mismatch]?.id ?? expected[mismatch]?.id ?? 'length'}`)
    }
  }
  const outputPath = option('output')
  if (outputPath) await fs.writeFile(path.resolve(outputPath), JSON.stringify(results))
  console.log(JSON.stringify({ scenarios: results.length,
    totalColdMs: results.reduce((sum, row) => sum + row.ms, 0), outputsMatch: comparisonPath ? true : undefined }))
} finally {
  await server.close()
  globalThis.fetch = originalFetch
}
