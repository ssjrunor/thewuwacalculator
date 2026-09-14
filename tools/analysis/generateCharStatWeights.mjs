/*
  Author: Runor Ewhro
  Description: Generates mode-specific Echo stat-weight tables from stratified
               evaluation samples, then overlays catalog-driven utility weights.
*/

import path from 'node:path'
import process from 'node:process'
import os from 'node:os'
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'

const DEFAULTS = {
  attempts: 50_000,
  binWidth: 10,
  concurrency: 3,
  mode: 'all',
  samples: 25,
  seed: 0x51A7E,
  sequence: 0,
  writeMode: 'new-only',
}

const FLAT_SCORE_FACTORS = {
  atkFlat: 0.6,
  defFlat: 0.6,
  hpFlat: 0.05,
}

function printHelp() {
  console.log(`Usage:
  npm run generate:char-stat-weights -- [options]

Options:
  --mode <all|beta|live> Data mode(s) to generate (default: all)
  --all                  Regenerate every resonator in a single selected mode;
                         with --mode all, live is split from the full beta result
  --new-only             Generate only missing resonators (default)
  --sequence <0..6>      Canonical evaluation sequence (default: 0)
  --bin-width <number>   Evaluation percentage points per stratum (default: 10)
  --samples <number>     Retained builds per stratum (default: 25)
  --attempts <number>    Candidate builds per resonator (default: 50000)
  --seed <integer>       Deterministic random seed (default: 334462)
  --concurrency <number> Parallel analyzer processes (default: 3)
  --help                 Show this message`)
}

function positiveInteger(name, value) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer.`)
  return parsed
}

function parseArgs(argv) {
  const options = { ...DEFAULTS }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const next = () => {
      const value = argv[index + 1]
      if (value == null || value.startsWith('--')) throw new Error(`${arg} requires a value.`)
      index += 1
      return value
    }

    if (arg === '--help' || arg === '-h') options.help = true
    else if (arg === '--mode') options.mode = next()
    else if (arg === '--all') options.writeMode = 'all'
    else if (arg === '--new-only') options.writeMode = 'new-only'
    else if (arg === '--sequence') options.sequence = Number(next())
    else if (arg === '--bin-width') options.binWidth = Number(next())
    else if (arg === '--samples') options.samples = positiveInteger(arg, next())
    else if (arg === '--attempts') options.attempts = positiveInteger(arg, next())
    else if (arg === '--seed') options.seed = Number(next())
    else if (arg === '--concurrency') options.concurrency = positiveInteger(arg, next())
    else throw new Error(`Unknown option: ${arg}`)
  }

  if (options.help) return options
  if (!['all', 'beta', 'live'].includes(options.mode)) throw new Error('--mode must be all, beta, or live.')
  if (!Number.isInteger(options.sequence) || options.sequence < 0 || options.sequence > 6) {
    throw new Error('--sequence must be an integer from 0 through 6.')
  }
  if (!Number.isFinite(options.binWidth) || options.binWidth <= 0 || options.binWidth > 200) {
    throw new Error('--bin-width must be greater than 0 and no more than 200.')
  }
  if (!Number.isInteger(options.seed)) throw new Error('--seed must be an integer.')
  return options
}

function round(value, places = 4) {
  return Number(value.toFixed(places))
}

function sortRecord(record) {
  return Object.fromEntries(Object.entries(record).sort(([left], [right]) => left.localeCompare(right)))
}

function makeWeights(report, resonator, { hasAuthoredHealing }) {
  const calibrated = {}
  for (const row of report.overall.weights) {
    const sampledWeight = Math.max(0, row.relativeWeightPct.mean)
    if (sampledWeight <= 0) continue
    calibrated[row.key] = sampledWeight / (FLAT_SCORE_FACTORS[row.key] ?? 1)
  }

  const damageCeiling = Math.max(0, ...Object.values(calibrated))
  const weights = {}
  if (damageCeiling > 0) {
    for (const [key, value] of Object.entries(calibrated)) {
      const normalized = round(value / damageCeiling)
      if (normalized > 0) weights[key] = normalized
    }
  }

  // The analyzer omits ER only for resonators covered by the shared no-ER
  // policy. Everyone else receives the utility floor used by Echo grading.
  const sampledEr = report.overall.weights.some((row) => row.key === 'energyRegen')
  if (sampledEr) weights.energyRegen = Math.max(weights.energyRegen ?? 0, 1)
  else delete weights.energyRegen

  // Healing Bonus is a main stat rather than a rollable substat. The catalog's
  // role tag is the authored utility signal, so new healers need no id table.
  if (hasAuthoredHealing && (resonator.tags ?? []).some((tag) => tag.id === 'A1')) {
    weights.healingBonus = 1
  }

  // Elemental bonus is also main-stat-only. It remains relevant to the Echo
  // score independently of which damage substats the sampled frontier favors.
  if (resonator.attribute && resonator.attribute !== 'physical') {
    weights[resonator.attribute] = 1
  }

  return sortRecord(weights)
}

function analyzerArgs({ id, mode, output, options }) {
  return [
    path.join('tools', 'analysis', 'evaluationSubstatWeights.mjs'),
    '--resonator', id,
    '--mode', mode,
    '--sequence', String(options.sequence),
    '--bin-width', String(options.binWidth),
    '--samples', String(options.samples),
    '--attempts', String(options.attempts),
    '--seed', String(options.seed),
    '--output', output,
  ]
}

function runAnalyzer(job) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, analyzerArgs(job), {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error([
        `Analyzer failed for ${job.mode}:${job.id} with exit code ${code}.`,
        stderr.trim(),
        stdout.trim(),
      ].filter(Boolean).join('\n')))
    })
  })
}

async function mapConcurrent(items, concurrency, worker) {
  let nextIndex = 0
  const results = new Array(items.length)
  const lanes = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await worker(items[index], index)
    }
  })
  await Promise.all(lanes)
  return results
}

async function readExisting(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') return null
    throw error
  }
}

async function generateMode(mode, options, tempDir, inheritedArtifact = null) {
  const root = process.cwd()
  const catalogFile = path.join(root, 'public', 'data', mode, 'resonators', 'catalog.json')
  const sourcesFile = path.join(root, 'public', 'data', mode, 'resonators', 'sources.json')
  const outputFile = path.join(root, 'src', 'data', 'scoring', 'generated', `charStatWeights.${mode}.json`)
  const catalog = JSON.parse(await readFile(catalogFile, 'utf8'))
  const sources = JSON.parse(await readFile(sourcesFile, 'utf8'))
  const healingIds = new Set(sources
    .filter((source) => source.skills?.some((skill) => skill.aggregationType === 'healing'))
    .map((source) => source.source.id))
  const existing = await readExisting(outputFile)
  const inheritedWeights = inheritedArtifact?.weights ?? {}
  const existingWeights = options.writeMode === 'new-only'
    ? { ...(existing?.weights ?? {}), ...inheritedWeights }
    : { ...inheritedWeights }

  if (options.writeMode === 'new-only' && existing) {
    const expected = existing.settings ?? {}
    for (const key of ['attempts', 'binWidth', 'samples', 'seed', 'sequence']) {
      if (expected[key] !== options[key]) {
        throw new Error(
          `${mode} artifact uses ${key}=${expected[key]}; run with matching settings or use --all.`,
        )
      }
    }
  }

  const targets = catalog
    .filter((resonator) => !(resonator.id in existingWeights))
    .sort((left, right) => left.id.localeCompare(right.id))
  console.error(`${mode}: ${targets.length} resonator${targets.length === 1 ? '' : 's'} to generate.`)

  const generated = await mapConcurrent(targets, options.concurrency, async (resonator, index) => {
    const tempOutput = path.join(tempDir, `${mode}-${resonator.id}.json`)
    await runAnalyzer({ id: resonator.id, mode, output: tempOutput, options })
    const report = JSON.parse(await readFile(tempOutput, 'utf8'))
    if (report.coverage.underfilledBands.length > 0) {
      throw new Error(
        `${mode}:${resonator.id} underfilled evaluation bands: `
        + report.coverage.underfilledBands.map((band) => `${band.label}=${band.buildCount}`).join(', '),
      )
    }
    console.error(`${mode}: ${index + 1}/${targets.length} ${resonator.name} (${resonator.id})`)
    return [resonator.id, makeWeights(report, resonator, {
      hasAuthoredHealing: healingIds.has(resonator.id),
    })]
  })

  const catalogIds = new Set(catalog.map((resonator) => resonator.id))
  const merged = Object.fromEntries(
    [...Object.entries(existingWeights), ...generated]
      .filter(([id]) => catalogIds.has(id))
      .sort(([left], [right]) => left.localeCompare(right)),
  )
  const artifact = {
    revision: 1,
    mode,
    inheritedFrom: inheritedArtifact?.mode ?? null,
    settings: {
      attempts: options.attempts,
      binWidth: options.binWidth,
      samples: options.samples,
      seed: options.seed,
      sequence: options.sequence,
    },
    weights: merged,
  }
  await mkdir(path.dirname(outputFile), { recursive: true })
  const writeTemp = `${outputFile}.tmp`
  await writeFile(writeTemp, `${JSON.stringify(artifact, null, 2)}\n`)
  await rename(writeTemp, outputFile)
  console.error(`${mode}: wrote ${path.relative(root, outputFile)} (${Object.keys(merged).length} resonators).`)
  return artifact
}

async function main(options) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'wuwa-char-stat-weights-'))
  try {
    if (options.mode === 'all') {
      const betaArtifact = await generateMode('beta', options, tempDir)
      await generateMode('live', options, tempDir, betaArtifact)
    } else {
      await generateMode(options.mode, options, tempDir)
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

try {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) printHelp()
  else await main(options)
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  console.error('Run with --help for usage.')
  process.exitCode = 1
}
