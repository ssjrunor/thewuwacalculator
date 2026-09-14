/*
  Author: Runor Ewhro
  Description: Samples legal Echo builds across evaluation score strata and
               reports average marginal and owned substat damage weights.
*/

import path from 'node:path'
import process from 'node:process'
import { readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'vite'

const DEFAULTS = {
  attempts: 50_000,
  binWidth: 10,
  gameDataMode: 'beta',
  output: null,
  samplesPerBin: 25,
  seed: 0x51A7E,
  sequence: 0,
}

function printHelp() {
  console.log(`Usage:
  npm run analyze:substats -- --resonator <id> [options]

Options:
  --resonator <id>       Resonator catalog id (required)
  --sequence <0..6>      Sequence used by the evaluation context (default: 0)
  --mode <beta|live>     Generated game-data tree (default: beta)
  --bin-width <number>   Evaluation percentage points per stratum (default: 10)
  --samples <number>     Retained random builds per stratum (default: 25)
  --attempts <number>    Candidate builds generated before reporting (default: 50000)
  --seed <integer>       Deterministic random seed (default: 334462)
  --output <path>        JSON output path (default: evaluation-substat-weights-<id>.json)
  --csv <path>           Optional flattened CSV output path
  --help                 Show this message

The primary weight is the damage gained from one maximum legal roll of a
substat at the sampled build. "Relative weight" normalizes those positive
marginal gains to 100% within each build. Owned contribution is the damage
lost by removing all currently equipped rolls of that substat.`)
}

function parsePositiveNumber(name, value, { integer = false } = {}) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0 || (integer && !Number.isInteger(parsed))) {
    throw new Error(`${name} must be a positive${integer ? ' integer' : ''}.`)
  }
  return parsed
}

function parseArgs(argv) {
  const options = { ...DEFAULTS, csv: null, resonatorId: null }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const next = () => {
      const value = argv[index + 1]
      if (value == null || value.startsWith('--')) throw new Error(`${arg} requires a value.`)
      index += 1
      return value
    }

    if (arg === '--help' || arg === '-h') options.help = true
    else if (arg === '--resonator') options.resonatorId = next()
    else if (arg === '--sequence') options.sequence = Number(next())
    else if (arg === '--mode') options.gameDataMode = next()
    else if (arg === '--bin-width') options.binWidth = parsePositiveNumber(arg, next())
    else if (arg === '--samples') options.samplesPerBin = parsePositiveNumber(arg, next(), { integer: true })
    else if (arg === '--attempts') options.attempts = parsePositiveNumber(arg, next(), { integer: true })
    else if (arg === '--seed') options.seed = Number(next())
    else if (arg === '--output') options.output = next()
    else if (arg === '--csv') options.csv = next()
    else throw new Error(`Unknown option: ${arg}`)
  }

  if (options.help) return options
  if (!options.resonatorId) throw new Error('--resonator is required.')
  if (!Number.isInteger(options.sequence) || options.sequence < 0 || options.sequence > 6) {
    throw new Error('--sequence must be an integer from 0 through 6.')
  }
  if (!['beta', 'live'].includes(options.gameDataMode)) {
    throw new Error('--mode must be beta or live.')
  }
  if (!Number.isInteger(options.seed)) throw new Error('--seed must be an integer.')
  if (options.binWidth > 200) throw new Error('--bin-width cannot exceed 200.')
  options.output ??= `evaluation-substat-weights-${options.resonatorId}.json`
  return options
}

function mulberry32(seed) {
  let value = seed >>> 0
  return () => {
    value += 0x6D2B79F5
    let result = value
    result = Math.imul(result ^ (result >>> 15), result | 1)
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61)
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296
  }
}

function pick(rng, values) {
  if (values.length === 0) throw new Error('Cannot pick from an empty collection.')
  return values[Math.floor(rng() * values.length)]
}

function shuffle(rng, values) {
  const result = [...values]
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rng() * (index + 1))
    const value = result[index]
    result[index] = result[swapIndex]
    result[swapIndex] = value
  }
  return result
}

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value))
}

function round(value, places = 6) {
  return Number(value.toFixed(places))
}

function percentile(sorted, fraction) {
  if (sorted.length === 0) return 0
  const index = (sorted.length - 1) * fraction
  const lower = Math.floor(index)
  const upper = Math.ceil(index)
  if (lower === upper) return sorted[lower]
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower)
}

function summarize(values) {
  if (values.length === 0) return { mean: 0, median: 0, p10: 0, p90: 0 }
  const sorted = [...values].sort((left, right) => left - right)
  return {
    mean: round(values.reduce((sum, value) => sum + value, 0) / values.length),
    median: round(percentile(sorted, 0.5)),
    p10: round(percentile(sorted, 0.1)),
    p90: round(percentile(sorted, 0.9)),
  }
}

function csvEscape(value) {
  const text = String(value)
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

function makeCsv(report) {
  const header = [
    'band', 'bandMin', 'bandMax', 'buildCount', 'averageScore', 'substat',
    'marginalDamagePctMean', 'marginalDamagePctMedian', 'marginalDamagePctP10',
    'marginalDamagePctP90', 'relativeWeightPctMean', 'ownedContributionPctMean',
    'presenceRatePct',
  ]
  const rows = [header]
  const append = (band, weight) => rows.push([
    band.label,
    band.min,
    band.max,
    band.buildCount,
    band.averageScore,
    weight.key,
    weight.marginalDamagePct.mean,
    weight.marginalDamagePct.median,
    weight.marginalDamagePct.p10,
    weight.marginalDamagePct.p90,
    weight.relativeWeightPct.mean,
    weight.ownedContributionPct.mean,
    weight.presenceRatePct,
  ])

  for (const band of report.bands) {
    for (const weight of band.weights) append(band, weight)
  }
  for (const weight of report.overall.weights) append(report.overall, weight)
  return `${rows.map((row) => row.map(csvEscape).join(',')).join('\n')}\n`
}

async function createModuleLoader(root) {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    if (url.startsWith('/data/')) {
      const file = path.join(root, 'public', url.slice(1))
      const text = await readFile(file, 'utf8')
      return new Response(text, { headers: { 'content-type': 'application/json' } })
    }
    if (!originalFetch) throw new Error(`Unhandled fetch request: ${url}`)
    return originalFetch(input, init)
  }

  const server = await createServer({
    appType: 'custom',
    configFile: false,
    logLevel: 'error',
    optimizeDeps: { include: [], noDiscovery: true },
    root,
    resolve: { alias: { '@': path.join(root, 'src') } },
    server: { hmr: false, middlewareMode: true, ws: false },
  })

  return {
    load: (modulePath) => server.ssrLoadModule(modulePath),
    close: async () => {
      await server.close()
      globalThis.fetch = originalFetch
    },
  }
}

function makeBands(binWidth, samplesPerBin) {
  const count = Math.ceil(200 / binWidth)
  return Array.from({ length: count }, (_, index) => {
    const min = index * binWidth
    const max = Math.min(200, min + binWidth)
    return {
      min,
      max,
      label: `${round(min, 2)}-${round(max, 2)}%`,
      reservoir: [],
      seen: 0,
      target: samplesPerBin,
    }
  })
}

function bandIndexFor(score, bands, binWidth) {
  if (!Number.isFinite(score) || score < 0 || score > 200 + 1e-7) return -1
  if (score >= 200) return bands.length - 1
  return Math.min(bands.length - 1, Math.floor(score / binWidth))
}

function echoSignature(echoes) {
  return echoes.map((echo) => [
    echo.id,
    echo.set,
    echo.mainEcho ? 1 : 0,
    echo.mainStats.primary.key,
    Object.entries(echo.substats).sort(([left], [right]) => left.localeCompare(right)),
  ])
}

function addToReservoir(band, candidate, rng) {
  band.seen += 1
  if (band.reservoir.length < band.target) {
    band.reservoir.push(candidate)
    return
  }
  const replaceIndex = Math.floor(rng() * band.seen)
  if (replaceIndex < band.target) band.reservoir[replaceIndex] = candidate
}

async function run(options) {
  const root = process.cwd()
  const loader = await createModuleLoader(root)

  try {
    const [
      gameData,
      seedService,
      defaults,
      runtimeAdapters,
      resonatorMax,
      resonatorStore,
      pipeline,
      suggestions,
      combinations,
      mutate,
      echoStats,
      echoCatalog,
      substatMath,
      scoringStats,
      evaluationSearch,
      echoDiscovery,
      evaluationAssumptions,
      setStatePolicy,
      echoSetEffects,
      combatScenario,
    ] = await Promise.all([
      loader.load('/src/data/gameData/index.ts'),
      loader.load('/src/domain/services/resonatorSeedService.ts'),
      loader.load('/src/domain/state/defaults.ts'),
      loader.load('/src/domain/state/runtimeAdapters.ts'),
      loader.load('/src/domain/gameData/resonatorMax.ts'),
      loader.load('/src/data/gameData/resonators/resonatorDataStore.ts'),
      loader.load('/src/engine/pipeline/index.ts'),
      loader.load('/src/engine/suggestions/shared.ts'),
      loader.load('/src/data/scoring/evaluation/costPlans.ts'),
      loader.load('/src/engine/suggestions/mutate.ts'),
      loader.load('/src/data/gameData/catalog/echoStats.ts'),
      loader.load('/src/domain/services/echoCatalogService.ts'),
      loader.load('/src/data/scoring/substatMath.ts'),
      loader.load('/src/data/scoring/evaluation/stats.ts'),
      loader.load('/src/data/scoring/evaluation/search.ts'),
      loader.load('/src/data/scoring/evaluation/echoDiscovery.ts'),
      loader.load('/src/modules/simulation/model/evaluationAssumptions.ts'),
      loader.load('/src/data/scoring/setStatePolicy.ts'),
      loader.load('/src/data/gameData/echoSets/effects.ts'),
      loader.load('/src/domain/entities/combatScenario.ts'),
    ])

    await gameData.initGameData({ mode: options.gameDataMode })
    const seed = seedService.getResSeedBy(options.resonatorId)
    if (!seed) throw new Error(`Unknown resonator id: ${options.resonatorId}`)

    let runtime = evaluationAssumptions.applyEvaluationAsm(defaults.makeResRuntime(seed))
    runtime = resonatorMax.maxResRt(runtime, resonatorStore.getResDtlsBy()[seed.id], {
      targetSequence: options.sequence,
    })
    runtime = evaluationAssumptions.applyEvaluationAsm(runtime)
    runtime.build.echoes = [null, null, null, null, null]

    const runtimesById = runtimeAdapters.makeRuntimeMap(runtime)
    const simulation = pipeline.runResSmlt(
      runtime,
      seed,
      evaluationAssumptions.EVALUATION_ENEMY,
      runtimesById,
      {},
    )
    const authoredSetRule = setStatePolicy.SET_RULES[runtime.id]
    const availableStatefulSets = new Set(echoSetEffects.ECHO_SET_DEFS
      .filter((set) => Object.keys(set.states).length > 0)
      .map((set) => set.id))
    const unavailablePolicySets = (authoredSetRule?.sets ?? [])
      .filter((setId) => !availableStatefulSets.has(setId))
    if (authoredSetRule?.sets && unavailablePolicySets.length > 0) {
      setStatePolicy.SET_RULES[runtime.id] = {
        ...authoredSetRule,
        sets: authoredSetRule.sets.filter((setId) => availableStatefulSets.has(setId)),
      }
    }

    const suggestionInput = {
      scenarioId: combatScenario.combatScenarioId('analysis:substat-weights'),
      memberId: combatScenario.teamMemberId(runtime.id),
      runtime,
      seed,
      enemy: evaluationAssumptions.EVALUATION_ENEMY,
      runtimesById,
      selectedTargets: {},
      setConds: setStatePolicy.evaluationSetConditions(runtime.id),
      setStateMode: 'resolved',
      tgtFeatId: null,
      rotationMode: true,
    }
    let context = suggestions.mkSuggVltnCt(suggestionInput, simulation)
    if (!context) {
      suggestionInput.rotationMode = false
      context = suggestions.mkSuggVltnCt(suggestionInput, simulation)
    }
    if (!context) throw new Error(`Could not create an evaluation context for ${seed.name}.`)

    console.error(`Building ${seed.name} evaluation anchors...`)
    const anchors = evaluationSearch.buildEvaluationAnchors(context, runtime.build.echoes)
    if (!anchors) throw new Error(`Could not build evaluation anchors for ${seed.name}.`)

    const rng = mulberry32(options.seed)
    const bands = makeBands(options.binWidth, options.samplesPerBin)
    const costPlans = combinations.makeEvaluationCostPlans()
    const setPlans = mutate.mkSetPlanCnd(5)
    const substatKeys = substatMath.substatKeysForResonator(runtime.id)
    const seenSignatures = new Set()

    const fromSnapshot = (snapshot) => {
      const slots = snapshot.echoes.map((echo, index) => {
        const original = echoCatalog.getEchoById(echo.echoId)
        const candidates = echoCatalog.listEchoes()
          .filter((definition) => definition.cost === echo.cost && definition.sets.includes(echo.setId))
          .sort((left, right) => Number(right.id === echo.echoId) - Number(left.id === echo.echoId))
        return { echo, index, original, candidates }
      })
      if (slots.some((slot) => !slot.original || slot.candidates.length === 0)) return []

      // Anchor search can retain a forced set on a fallback identity. Re-match
      // each slot to a same-cost catalog identity so sampled builds remain
      // physically legal without changing the anchor's set/main-stat frame.
      const assigned = new Array(slots.length)
      const ordered = [...slots].sort((left, right) => left.candidates.length - right.candidates.length)
      const usedPieces = new Set()
      const assign = (position) => {
        if (position >= ordered.length) return true
        const slot = ordered[position]
        for (const definition of slot.candidates) {
          const pieceKey = `${definition.id}|${slot.echo.setId}`
          if (usedPieces.has(pieceKey)) continue
          usedPieces.add(pieceKey)
          assigned[slot.index] = definition
          if (assign(position + 1)) return true
          usedPieces.delete(pieceKey)
        }
        return false
      }
      if (!assign(0)) return []

      const result = slots.map(({ echo, index }) => ({
        uid: `analysis-anchor-${index}`,
        id: assigned[index].id,
        set: echo.setId,
        mainEcho: echo.mainEcho,
        mainStats: {
          primary: { ...echo.primary },
          secondary: { ...echo.secondary },
        },
        substats: {},
      }))

      // Generated evaluation snapshots store their substat plan as aggregate
      // rows. Re-materialize that plan across the five legal Echoes so the
      // high-score strata are sampled from the actual 100%/200% frontier.
      for (const row of snapshot.statRows) {
        const count = Math.min(result.length, Math.max(0, Math.round(row.substatCount)))
        if (count === 0 || !substatKeys.includes(row.key)) continue
        const rolls = echoStats.getSbstStepP(row.key)
        const desiredRoll = row.substatTotal / count
        const roll = rolls.reduce((closest, candidate) => (
          Math.abs(candidate - desiredRoll) < Math.abs(closest - desiredRoll) ? candidate : closest
        ), rolls[0])
        const available = result
          .filter((echo) => echo.substats[row.key] == null)
          .sort((left, right) => Object.keys(left.substats).length - Object.keys(right.substats).length)
        for (const echo of available.slice(0, count)) echo.substats[row.key] = roll
      }
      return result
    }

    const anchorFrames = [
      fromSnapshot(anchors.builds.referenceBuild),
      fromSnapshot(anchors.builds.maximumBuild),
    ].filter((echoes) => echoes.length === 5)

    const preferredKeys = anchors.builds.maximumBuild.statRows
      .filter((row) => row.substatCount > 0)
      .sort((left, right) => right.substatCount - left.substatCount || right.damage - left.damage)
      .flatMap((row) => Array.from({ length: Math.max(1, Math.round(row.substatCount)) }, () => row.key))
      .filter((key) => substatKeys.includes(key))

    const randomLegalFrame = () => {
      for (let retry = 0; retry < 30; retry += 1) {
        const costPlan = pick(rng, costPlans)
        const reference = echoDiscovery.makeReferenceEvaluationEchoes(costPlan, null)
        if (reference.length !== 5) continue
        const feasible = mutate.prepSetPlanFsb(reference)
        const validPlans = setPlans.filter(feasible)
        if (validPlans.length === 0) continue
        const plan = pick(rng, validPlans)
        const echoes = mutate.applySetPlan(plan, reference).filter(Boolean)
        if (
          echoes.length !== 5
          || new Set(echoes.map((echo) => `${echo.id}|${echo.set}`)).size !== 5
          || echoes.some((echo) => !echoCatalog.getEchoById(echo.id)?.sets.includes(echo.set))
          || !echoDiscovery.echoesMatchSetPlan(echoes, plan)
        ) continue

        return echoes.map((echo, index) => {
          const definition = echoCatalog.getEchoById(echo.id)
          const mains = Object.entries(echoStats.ECHO_MAIN_STATS[definition.cost] ?? {})
          const [key, value] = pick(rng, mains)
          return {
            ...echo,
            uid: `analysis-random-${index}-${Math.floor(rng() * 0xFFFFFFFF)}`,
            mainEcho: index === 0,
            mainStats: {
              primary: { key, value },
              secondary: { ...echoStats.ECHO_SIDE_STATS[definition.cost] },
            },
            substats: {},
          }
        })
      }
      throw new Error('Failed to generate a legal Echo frame after 30 attempts.')
    }

    const randomizeSubstats = (echoes, power, retainTemplate = false) => {
      const result = echoes.map((echo) => ({
        ...echo,
        mainStats: {
          primary: { ...echo.mainStats.primary },
          secondary: { ...echo.mainStats.secondary },
        },
        substats: {},
      }))
      const fillChance = clamp((power - 0.08) / 0.82 + (rng() - 0.5) * 0.3)
      const focusChance = clamp(power * 0.92)
      const quality = clamp(power + (rng() - 0.5) * 0.4)
      let preferredIndex = Math.floor(rng() * Math.max(1, preferredKeys.length))

      for (const [echoIndex, echo] of result.entries()) {
        const keys = []
        const templateKeys = retainTemplate ? shuffle(rng, Object.keys(echoes[echoIndex]?.substats ?? {})) : []
        for (let slot = 0; slot < 5; slot += 1) {
          if (rng() > fillChance) continue
          let key = null
          if (templateKeys.length > 0 && rng() < focusChance) {
            key = templateKeys.find((candidate) => !keys.includes(candidate)) ?? null
          }
          if (!key && preferredKeys.length > 0 && rng() < focusChance) {
            for (let offset = 0; offset < preferredKeys.length; offset += 1) {
              const candidate = preferredKeys[(preferredIndex + offset) % preferredKeys.length]
              if (!keys.includes(candidate)) {
                key = candidate
                preferredIndex = (preferredIndex + offset + 1) % preferredKeys.length
                break
              }
            }
          }
          key ??= pick(rng, substatKeys.filter((candidate) => !keys.includes(candidate)))
          keys.push(key)
          const rolls = echoStats.getSbstStepP(key)
          const rollPosition = clamp(quality + (rng() - 0.5) * 0.55)
          const rollIndex = Math.min(rolls.length - 1, Math.floor(rollPosition * rolls.length))
          echo.substats[key] = rolls[rollIndex]
        }
      }
      return result
    }

    const assertLegalBuild = (echoes) => {
      if (echoes.length > 5) throw new Error('Generated build exceeds five Echo slots.')
      if (echoes.filter((echo) => echo.mainEcho).length !== (echoes.length > 0 ? 1 : 0)) {
        throw new Error('Generated build must have exactly one main Echo when non-empty.')
      }

      let totalCost = 0
      const usedPieces = new Set()
      for (const echo of echoes) {
        const definition = echoCatalog.getEchoById(echo.id)
        if (!definition) throw new Error(`Generated build uses unknown Echo ${echo.id}.`)
        totalCost += definition.cost
        if (!definition.sets.includes(echo.set)) {
          throw new Error(`Echo ${echo.id} cannot use Sonata set ${echo.set}.`)
        }
        const pieceKey = `${echo.id}|${echo.set}`
        if (usedPieces.has(pieceKey)) throw new Error(`Generated build duplicates ${pieceKey}.`)
        usedPieces.add(pieceKey)

        const legalMainValue = echoStats.ECHO_MAIN_STATS[definition.cost]?.[echo.mainStats.primary.key]
        if (legalMainValue == null || legalMainValue !== echo.mainStats.primary.value) {
          throw new Error(`Echo ${echo.id} has an illegal ${echo.mainStats.primary.key} main stat.`)
        }
        const entries = Object.entries(echo.substats)
        if (entries.length > 5) throw new Error(`Echo ${echo.id} exceeds five substat slots.`)
        for (const [key, value] of entries) {
          if (!substatKeys.includes(key) || !echoStats.getSbstStepP(key).includes(value)) {
            throw new Error(`Echo ${echo.id} has an illegal ${key} substat roll (${value}).`)
          }
        }
      }
      if (totalCost > 12) throw new Error(`Generated build exceeds the 12-cost limit (${totalCost}).`)
    }

    const makeCandidate = (targetBandIndex) => {
      const targetPower = clamp(((targetBandIndex + rng()) * options.binWidth) / 200)
      const power = clamp(targetPower + (rng() - 0.5) * 0.34)
      const useAnchorFrame = anchorFrames.length > 0 && rng() < 0.35 + power * 0.55
      const full = useAnchorFrame
        ? pick(rng, anchorFrames).map((echo) => ({ ...echo }))
        : randomLegalFrame()

      let echoCount = 5
      if (power < 0.42) {
        echoCount = Math.max(0, Math.min(5, Math.floor((power / 0.42) * 6 + (rng() - 0.5) * 2)))
      }
      const selected = echoCount === 5
        ? full
        : shuffle(rng, full).slice(0, echoCount)
      selected.forEach((echo, index) => { echo.mainEcho = index === 0 })
      return randomizeSubstats(selected, power, useAnchorFrame)
    }

    const scoreEchoes = (echoes) => {
      const mainBuffs = suggestions.mkSuggMainEc(context, echoes)
      const frame = echoDiscovery.makeEvaluationEchoFrame(context, echoes, mainBuffs)
      const damage = frame.score(frame.stats, frame.sets)
      const score = scoringStats.scorePercent(
        damage,
        anchors.baselineDamage,
        anchors.referenceDamage,
        anchors.maximumDamage,
      ) * 100
      return { damage, frame, score }
    }

    for (let attempt = 0; attempt < options.attempts; attempt += 1) {
      const targetBandIndex = attempt % bands.length
      const echoes = makeCandidate(targetBandIndex)
      assertLegalBuild(echoes)
      const signature = JSON.stringify(echoSignature(echoes))
      if (seenSignatures.has(signature)) continue
      seenSignatures.add(signature)

      const scored = scoreEchoes(echoes)
      const bandIndex = bandIndexFor(scored.score, bands, options.binWidth)
      if (bandIndex < 0) continue
      addToReservoir(bands[bandIndex], {
        echoes,
        damage: scored.damage,
        score: scored.score,
      }, rng)
    }

    const measure = (candidate) => {
      const { frame, damage } = scoreEchoes(candidate.echoes)
      const aggregate = substatMath.aggregateSubstats(candidate.echoes)
      const marginal = {}
      const contribution = {}

      for (const key of substatKeys) {
        const rolls = echoStats.getSbstStepP(key)
        const maxRoll = rolls.at(-1) ?? 0
        const up = frame.stats.slice()
        scoringStats.addStatTotal(up, key, maxRoll)
        marginal[key] = frame.score(up, frame.sets) - damage

        const owned = aggregate.totals[key] ?? 0
        if (owned > 0) {
          const down = frame.stats.slice()
          scoringStats.addStatTotal(down, key, -owned)
          contribution[key] = damage - frame.score(down, frame.sets)
        } else {
          contribution[key] = 0
        }
      }

      const positiveMarginalTotal = Object.values(marginal)
        .reduce((sum, value) => sum + Math.max(0, value), 0)
      return Object.fromEntries(substatKeys.map((key) => [key, {
        marginalDamagePct: damage > 0 ? (marginal[key] / damage) * 100 : 0,
        relativeWeightPct: positiveMarginalTotal > 0
          ? (Math.max(0, marginal[key]) / positiveMarginalTotal) * 100
          : 0,
        ownedContributionPct: damage > 0 ? (contribution[key] / damage) * 100 : 0,
        present: (aggregate.counts[key] ?? 0) > 0 ? 1 : 0,
      }]))
    }

    const summarizeBand = (band) => {
      const measured = band.reservoir.map((candidate) => ({ candidate, weights: measure(candidate) }))
      return {
        label: band.label,
        min: band.min,
        max: band.max,
        buildCount: measured.length,
        candidatesSeen: band.seen,
        averageScore: round(measured.length > 0
          ? measured.reduce((sum, entry) => sum + entry.candidate.score, 0) / measured.length
          : 0),
        weights: substatKeys.map((key) => ({
          key,
          marginalDamagePct: summarize(measured.map((entry) => entry.weights[key].marginalDamagePct)),
          relativeWeightPct: summarize(measured.map((entry) => entry.weights[key].relativeWeightPct)),
          ownedContributionPct: summarize(measured.map((entry) => entry.weights[key].ownedContributionPct)),
          presenceRatePct: round(measured.length > 0
            ? measured.reduce((sum, entry) => sum + entry.weights[key].present, 0) / measured.length * 100
            : 0),
        })),
      }
    }

    console.error(`Measuring ${bands.reduce((sum, band) => sum + band.reservoir.length, 0)} retained builds...`)
    const summarizedBands = bands.map(summarizeBand)
    const populatedBands = summarizedBands.filter((band) => band.buildCount > 0)
    const overallWeights = substatKeys.map((key) => {
      const rows = populatedBands.map((band) => band.weights.find((weight) => weight.key === key))
      return {
        key,
        marginalDamagePct: summarize(rows.map((row) => row.marginalDamagePct.mean)),
        relativeWeightPct: summarize(rows.map((row) => row.relativeWeightPct.mean)),
        ownedContributionPct: summarize(rows.map((row) => row.ownedContributionPct.mean)),
        presenceRatePct: round(rows.length > 0
          ? rows.reduce((sum, row) => sum + row.presenceRatePct, 0) / rows.length
          : 0),
      }
    })

    const report = {
      metadata: {
        generatedAt: new Date().toISOString(),
        resonatorId: seed.id,
        resonatorName: seed.name,
        contextMode: context.mode,
        unavailablePolicySets,
        sequence: options.sequence,
        gameDataMode: options.gameDataMode,
        seed: options.seed,
        attempts: options.attempts,
        uniqueCandidates: seenSignatures.size,
        binWidth: options.binWidth,
        samplesPerBin: options.samplesPerBin,
        weighting: 'Each populated evaluation band contributes equally to the overall averages.',
        marginalDefinition: 'Damage gained by adding one maximum-value roll to aggregate build stats; this comparable sensitivity probe does not require an open physical substat slot.',
        contributionDefinition: 'Damage lost by removing every owned roll of the named substat.',
        sampledBuildLegality: 'Every sampled build has at most five Echoes and 12 cost, unique id-and-set pieces, catalog-supported sets and main stats, and at most five distinct discrete legal substat rolls per Echo.',
      },
      anchors: {
        baseline0: round(anchors.baselineDamage),
        reference100: round(anchors.referenceDamage),
        maximum200: round(anchors.maximumDamage),
      },
      coverage: {
        populatedBands: populatedBands.length,
        totalBands: summarizedBands.length,
        retainedBuilds: summarizedBands.reduce((sum, band) => sum + band.buildCount, 0),
        underfilledBands: summarizedBands
          .filter((band) => band.buildCount < options.samplesPerBin)
          .map((band) => ({ label: band.label, buildCount: band.buildCount })),
      },
      bands: summarizedBands,
      overall: {
        label: 'equal-weighted populated bands',
        min: 0,
        max: 200,
        buildCount: summarizedBands.reduce((sum, band) => sum + band.buildCount, 0),
        averageScore: round(populatedBands.length > 0
          ? populatedBands.reduce((sum, band) => sum + band.averageScore, 0) / populatedBands.length
          : 0),
        weights: overallWeights,
      },
    }

    await writeFile(path.resolve(root, options.output), `${JSON.stringify(report, null, 2)}\n`)
    if (options.csv) await writeFile(path.resolve(root, options.csv), makeCsv(report))

    console.error(`Wrote ${options.output}`)
    if (options.csv) console.error(`Wrote ${options.csv}`)
    console.log(JSON.stringify({
      resonator: `${seed.name} (${seed.id})`,
      anchors: report.anchors,
      coverage: report.coverage,
      output: options.output,
      csv: options.csv,
      overallWeights: report.overall.weights
        .map((weight) => ({
          key: weight.key,
          marginalDamagePct: weight.marginalDamagePct.mean,
          relativeWeightPct: weight.relativeWeightPct.mean,
        }))
        .sort((left, right) => right.marginalDamagePct - left.marginalDamagePct),
    }, null, 2))
  } finally {
    await loader.close()
  }
}

let options
try {
  options = parseArgs(process.argv.slice(2))
  if (options.help) {
    printHelp()
  } else {
    await run(options)
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  console.error('Run with --help for usage.')
  process.exitCode = 1
}
