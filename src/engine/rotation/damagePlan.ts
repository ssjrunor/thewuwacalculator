/*
  Author: Runor Ewhro
  description: compiles authored rotation damage from a context without equipped Echoes.
*/

// candidates can change damage for existing invocations without adding new ones.

import type { EnemyProfile } from '@/domain/entities/appState.ts'
import type { ResRuntime, ResSeed } from '@/domain/entities/runtime.ts'
import type { EchoInstance } from '@/domain/entities/runtime.ts'
import type { RotationNode } from '@/domain/gameData/contracts.ts'
import type { SntSetConds } from '@/domain/entities/sonataSetConditionals.ts'
import { getGameData } from '@/data/gameData/index.ts'
import { listEffects } from '@/data/gameData/registry.ts'
import { listStatesFor } from '@/data/catalog/gameDataService.ts'
import { countEchoSets } from '@/engine/pipeline/buildCombatContext.ts'
import { prepareResSimulation, type RotationCombatSetup } from '@/engine/pipeline/index.ts'
import { maxEchoStts } from '@/engine/runtime/sourceStateInit.ts'
import { stripEchoes } from '@/engine/search/context/runtime.ts'
import { isOptDmgSkll } from '@/engine/search/score/eligibility.ts'
import { ECHO_STAT_STRIDE } from '@/engine/search/layout/constants.ts'
import { materializeFinalPlane } from '@/engine/rotation/numericLayout.ts'
import { NumericDamageMemo } from '@/engine/formulas/damage.ts'
import { numericTeammateEchoInputProjector, numericTeammateReplayKey } from '@/engine/effects/numericTeam.ts'
import {
  executeRotationScore,
  prepareRunEnv,
  prepareRotationProgram,
  prepareEchoCandidateRunEnv,
  echoCandidateTeammateReplayKey,
  type DamageInvocation,
} from '@/engine/rotation/execute.ts'
import {
  buildRotationCombatContexts,
  packRotationTargetContexts,
  type RotationContextShape,
  type RotationTargetContext,
} from './targetContexts.ts'

// replay memo bounds, by cache
const ROTATION_REPLAY_CACHE = {
  structures: 64, structureBytes: 2 * 1024 * 1024, controls: 64,
  inputShapes: 256, inputScores: 32, environments: 32, semanticScores: 256,
  exactScores: 256, topologyScores: 256,
} as const

export interface RotationDamageTarget extends RotationTargetContext {
  eventKey?: string
  runtime: ResRuntime
  finalStats: ReturnType<typeof materializeFinalPlane>
  combat: DamageInvocation['combat']
  nodeMultiplier: number
}

/** the clean run's teammate event membership and the fixed rotation inputs. */
export interface RotationTeamDamagePlan {
  runtime: ResRuntime
  seed: ResSeed
  enemy: EnemyProfile
  items: RotationNode[]
  runtimesById: Record<string, ResRuntime>
  selectedTargets: Record<string, string | null>
  combatSetup?: RotationCombatSetup
  setConds?: SntSetConds
  eventKeys: string[]
  eventDamage: Float64Array
  featureKeys: string[]
  sourceStatsAffectTeam: boolean
  teamEffectSetMinimums: Record<string, number>
  teamEffectEchoIds: string[]
  statSensitiveSets: number[]
  statSensitiveEchoIds: string[]
  /** theory rows represent distinct profile slots even when catalog ids repeat. */
  theoryUniqueSets?: boolean
}

const TEAM_SCOPES = new Set(['active', 'activeOther', 'teamWide', 'otherTeammates'])

const ECHO_CONTROL_PATH = /^runtime\.state\.controls\.(?:echo|echoSet):/

function isContextEchoControlChange(
  change: { path?: string; resonatorId?: string },
  nodeResonatorId: string | undefined,
  contextResonatorId: string,
): boolean {
  if (!change.path || !ECHO_CONTROL_PATH.test(change.path)) return false
  return (change.resonatorId ?? nodeResonatorId ?? contextResonatorId) === contextResonatorId
}

/** remove searched-resonator Echo initialization writes from the shared
 * rotation while retaining teammate setup writes for fixed teammate builds. */
export function normalizeRotationForCleanContext(
  items: readonly RotationNode[],
  contextResonatorId: string,
): RotationNode[] {
  const cleanNodes: RotationNode[] = []
  for (const node of items) {
    if (node.type === 'condition') {
      const changes = node.changes.filter((change) => !isContextEchoControlChange(
        change, node.resonatorId, contextResonatorId,
      ))
      if (changes.length === 0) continue
      cleanNodes.push(changes.length === node.changes.length ? node : { ...node, changes })
      continue
    }
    if (node.type === 'feature') {
      const changes = node.changes?.filter((change) => !isContextEchoControlChange(
        change, node.resonatorId, contextResonatorId,
      ))
      const attached = node.attached ? {
        conditions: normalizeRotationForCleanContext(node.attached.conditions, contextResonatorId)
          .filter((entry): entry is Extract<RotationNode, { type: 'condition' }> => entry.type === 'condition'),
        features: normalizeRotationForCleanContext(node.attached.features, contextResonatorId)
          .filter((entry): entry is Extract<RotationNode, { type: 'feature' }> => entry.type === 'feature'),
      } : undefined
      cleanNodes.push({
        ...node,
        ...(changes ? { changes } : {}),
        ...(attached ? { attached } : {}),
      })
      continue
    }
    if (node.type === 'repeat' || node.type === 'uptime') {
      cleanNodes.push({
        ...node,
        ...(node.setup ? { setup: normalizeRotationForCleanContext(node.setup, contextResonatorId) } : {}),
        items: normalizeRotationForCleanContext(node.items, contextResonatorId),
      })
      continue
    }
    if (node.type === 'loop' && node.kind === 'start' && node.passForks) {
      cleanNodes.push({
        ...node,
        passForks: Object.fromEntries(Object.entries(node.passForks).map(([run, fork]) => [
          run,
          normalizeRotationForCleanContext(fork, contextResonatorId),
        ])),
      })
      continue
    }
    cleanNodes.push(node)
  }
  return cleanNodes
}

function stripEchoState(runtime: ResRuntime): ResRuntime {
  const withoutEchoes = stripEchoes(runtime)
  const controls = Object.fromEntries(Object.entries(withoutEchoes.state.controls)
    .filter(([key]) => !key.startsWith('echo:') && !key.startsWith('echoSet:')))
  return {
    ...withoutEchoes,
    state: { ...withoutEchoes.state, controls },
  }
}

function candidateTeamEffectSources(runtime: ResRuntime) {
  const registry = getGameData()
  const hasTeamEffects = (type: 'resonator' | 'weapon' | 'echoSet' | 'echo', id: string) =>
    listEffects(registry, { type, id }).filter((effect) => TEAM_SCOPES.has(effect.targetScope ?? 'self'))
  const readsCandidateStats = (effect: ReturnType<typeof hasTeamEffects>[number]) => {
    const source = JSON.stringify(effect)
    return source.includes('sourceFinalStats') || source.includes('build.echoes')
  }
  const sourceStatsAffectTeam = [
    ...hasTeamEffects('resonator', runtime.id),
    ...hasTeamEffects('weapon', runtime.build.weapon.id ?? ''),
  ].some(readsCandidateStats)
  const teamEffectSetMinimums: Record<string, number> = {}
  const statSensitiveSets: number[] = []
  for (const key of Object.keys(registry.sourcesByKey)) {
    if (!key.startsWith('echoSet:')) continue
    const id = key.slice(8)
    const effects = hasTeamEffects('echoSet', id)
    if (effects.length === 0) continue
    const minimum = (condition: unknown): number => {
      if (!condition || typeof condition !== 'object') return 1
      const node = condition as { type?: string; from?: string; path?: string; value?: number; values?: unknown[] }
      if (node.from === 'context' && node.path === `echoSetCounts.${id}` && node.type === 'gte') {
        return Math.max(1, node.value ?? 1)
      }
      if (node.type === 'and') return Math.max(1, ...(node.values ?? []).map(minimum))
      if (node.type === 'or') return Math.min(...(node.values ?? []).map(minimum))
      return 1
    }
    teamEffectSetMinimums[id] = Math.min(...effects.map((effect) => minimum(effect.condition)))
    if (effects.some(readsCandidateStats)) statSensitiveSets.push(Number(id))
  }
  const teamEffectEchoIds = Object.keys(registry.sourcesByKey)
    .filter((key) => key.startsWith('echo:') && hasTeamEffects('echo', key.slice(5)).length > 0)
    .map((key) => key.slice(5))
  return {
    sourceStatsAffectTeam,
    teamEffectSetMinimums,
    teamEffectEchoIds,
    statSensitiveSets,
    statSensitiveEchoIds: teamEffectEchoIds.filter((id) => hasTeamEffects('echo', id).some(readsCandidateStats)),
  }
}

interface PreparedTeamReplay {
  program: ReturnType<typeof prepareRotationProgram>
  members: ReadonlySet<string>
  features: ReadonlySet<string>
  cleanDamage: number
  environments: Map<string, ReturnType<typeof prepareRunEnv>>
  baseEnvironment?: ReturnType<typeof prepareRunEnv>
  scoreMembers: ReadonlySet<string>
  damageMemo: NumericDamageMemo
  exactScores: Map<string, number>
  semanticScores: Map<string, number>
  structureIds: ReplayStructureIds
  controlsByShape: Map<string, ResRuntime['state']['controls'] | null>
  controlSignatures: WeakMap<ResRuntime['state']['controls'], string>
  echoInputScores: Map<string, { project: (echoes: readonly EchoInstance[]) => string; scores: Map<string, number> }>
  diagnostics: {
    calls: number
    topologyHits: number
    dependencyHits: number
    inputHits: number
    echoInputHits: number
    exactHits: number
    replays: number
    environmentCompiles: number
    environmentRebases: number
    environmentMs: number
    dependencyKeyMs: number
    replayMs: number
  }
}

// keep structural bytecode once per plan instead of repeating its serialized
// definition in every result key. IDs never repeat after eviction.
class ReplayStructureIds {
  private readonly keys = new Map<string, number>()
  private bytes = 0
  private nextId = 0
  get size(): number { return this.keys.size }
  get retainedBytes(): number { return this.bytes }
  readonly intern = (structure: string): number => {
    const known = this.keys.get(structure)
    if (known !== undefined) return known
    if (structure.length * 2 > ROTATION_REPLAY_CACHE.structureBytes) return this.nextId++
    while (this.keys.size > 0 && (this.keys.size >= ROTATION_REPLAY_CACHE.structures || this.bytes + structure.length * 2 > ROTATION_REPLAY_CACHE.structureBytes)) {
      const oldest = this.keys.keys().next().value!
      this.bytes -= oldest.length * 2
      this.keys.delete(oldest)
    }
    const id = this.nextId++
    this.keys.set(structure, id)
    this.bytes += structure.length * 2
    return id
  }
}
const preparedByTeamPlan = new WeakMap<RotationTeamDamagePlan, PreparedTeamReplay>()
const teamDeltaByTopology = new WeakMap<RotationTeamDamagePlan, Map<string, number>>()
const opaqueStateBounds = new WeakMap<object, boolean>()
const opaqueEnvironmentBounds = new WeakMap<ReturnType<typeof prepareRunEnv>, boolean>()
function hasOpaqueStateBounds(environment: ReturnType<typeof prepareRunEnv>): boolean {
  const cached = opaqueEnvironmentBounds.get(environment)
  if (cached !== undefined) return cached
  const opaque = [...Object.values(environment.stateDefsByResonator), environment.enemyStateDefs]
    .some((states) => Object.values(states).some((state) => {
    let opaque = opaqueStateBounds.get(state)
    if (opaque === undefined) {
      // authored writes can be clamped by state bounds. A bound that reads
      // candidate-derived stats needs ordinary replay, beyond numeric effects.
      opaque = /(?:finalStats|sourceFinalStats|pool\.|"from":"pool"|build\.echoes|echoSetCounts|state\.controls\.(?:echo|echoSet):)/
        .test(JSON.stringify([state.maxWhen, state.optionsWhen]))
      opaqueStateBounds.set(state, opaque)
    }
    return opaque
    }))
  opaqueEnvironmentBounds.set(environment, opaque)
  return opaque
}
export function getRotationTeamScoringDiagnostics(plan: RotationTeamDamagePlan | undefined) {
  const prepared = plan && preparedByTeamPlan.get(plan)
  return prepared ? {
    ...prepared.diagnostics,
    cacheEntries: {
      environments: prepared.environments.size,
      exactScores: prepared.exactScores.size,
      dependencyScores: prepared.semanticScores.size,
      structures: prepared.structureIds.size,
      controls: prepared.controlsByShape.size,
      echoInputShapes: prepared.echoInputScores.size,
      topologies: teamDeltaByTopology.get(plan!)?.size ?? 0,
    },
    retainedKeyBytes: prepared.structureIds.retainedBytes
      + [...prepared.exactScores.keys(), ...prepared.semanticScores.keys()].reduce((sum, key) => sum + key.length * 2, 0),
    damageMemoHits: prepared.damageMemo.hits,
    damageMemoMisses: prepared.damageMemo.misses,
  } : null
}
export function mayCandidateAffectTeam(plan: RotationTeamDamagePlan, echoes: readonly EchoInstance[], theory = false): boolean {
  const setCounts = theory
    ? echoes.reduce<Record<string, number>>((counts, echo) => {
      counts[echo.set] = (counts[echo.set] ?? 0) + 1
      return counts
    }, {})
    : countEchoSets([...echoes])
  return plan.eventKeys.length > 0 && (
    plan.sourceStatsAffectTeam
    || Object.entries(plan.teamEffectSetMinimums).some(([id, minimum]) => (setCounts[id] ?? 0) >= minimum)
    || echoes.some((echo) => plan.teamEffectEchoIds.includes(echo.id))
  )
}

export function scoreRotationTeammateDelta(
  plan: RotationTeamDamagePlan | undefined,
  echoes: readonly EchoInstance[],
): number {
  if (!plan || plan.eventKeys.length === 0) return 0
  let prepared = preparedByTeamPlan.get(plan)
  if (!prepared) {
    prepared = {
      program: prepareRotationProgram(plan.items),
      members: new Set(plan.eventKeys),
      features: new Set(plan.featureKeys),
      cleanDamage: plan.eventDamage.reduce((sum, value) => sum + value, 0),
      environments: new Map(),
      scoreMembers: new Set(Object.keys(plan.runtimesById).filter((id) => id !== plan.runtime.id)),
      damageMemo: new NumericDamageMemo(),
      exactScores: new Map(), semanticScores: new Map(),
      structureIds: new ReplayStructureIds(),
      controlsByShape: new Map(),
      controlSignatures: new WeakMap(),
      echoInputScores: new Map(),
      diagnostics: { calls: 0, topologyHits: 0, dependencyHits: 0, inputHits: 0, echoInputHits: 0, exactHits: 0, replays: 0, environmentCompiles: 0, environmentRebases: 0, environmentMs: 0, dependencyKeyMs: 0, replayMs: 0 },
    }
    preparedByTeamPlan.set(plan, prepared)
  }
  prepared.diagnostics.calls += 1
  const candidate = plan.theoryUniqueSets
    ? echoes.map((echo, index) => echo.mainEcho ? echo : { ...echo, id: `${echo.id}:theory-slot:${index}` })
    : echoes
  const main = candidate.find((echo) => echo.mainEcho)
  const setCounts = countEchoSets([...candidate])
  if (!plan.sourceStatsAffectTeam
    && !Object.entries(plan.teamEffectSetMinimums).some(([id, minimum]) => (setCounts[id] ?? 0) >= minimum)
    && (!main || !plan.teamEffectEchoIds.includes(main.id))) return 0

  const statSensitive = plan.sourceStatsAffectTeam
    || Object.entries(setCounts).some(([id, count]) => count >= (plan.teamEffectSetMinimums[id] ?? Infinity) && plan.statSensitiveSets.includes(Number(id)))
    || (main != null && plan.statSensitiveEchoIds.includes(main.id))
  // when team effects read no candidate stats, unrelated self-only sets cannot
  // change teammate damage. cache all filler variants under the same relevant
  // team-effect topology, retaining main identity for authored Echo controls.
  const topology = statSensitive
    ? null
    : `${Object.entries(setCounts)
      .filter(([id, count]) => count >= (plan.teamEffectSetMinimums[id] ?? Infinity))
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([id, count]) => `${id}:${count}`).join(',')}|${main?.id ?? ''}`
  const cached = topology == null ? undefined : teamDeltaByTopology.get(plan)?.get(topology)
  if (cached !== undefined) {
    prepared.diagnostics.topologyHits += 1
    return cached
  }

  // candidate Echoes determine which controls are available. the searcher's
  // Sonata condition settings still decide which set states are enabled.
  const controlsShape = `${main?.id ?? candidate[0]?.id ?? ''}|${JSON.stringify(setCounts)}`
  let controls = prepared.controlsByShape.get(controlsShape)
  const knownControls = controls !== undefined
  const initialized = {
    ...plan.runtime,
    build: { ...plan.runtime.build, echoes: Array.from({ length: 5 }, (_, index) => candidate[index] ?? null) },
  }
  if (!controls) {
    controls = { ...maxEchoStts(initialized).state.controls }
    for (const [setId, parts] of Object.entries(plan.setConds?.off ?? {})) {
      for (const part of parts) delete controls[`echoSet:${setId}:bonus:${part}`]
    }
    if (!knownControls) {
      const states = [
        ...listStatesFor('echo', main?.id ?? candidate[0]?.id ?? ''),
        ...Object.keys(setCounts).flatMap((id) => listStatesFor('echoSet', id)),
      ]
      const mayReadEchoStats = /(?:build\.echoes|finalStats|sourceFinalStats|"from":"pool"|pool\.)/.test(JSON.stringify(states))
      if (prepared.controlsByShape.size >= ROTATION_REPLAY_CACHE.controls) prepared.controlsByShape.delete(prepared.controlsByShape.keys().next().value!)
      prepared.controlsByShape.set(controlsShape, mayReadEchoStats ? null : controls)
    }
  }
  const runtime = { ...initialized, state: { ...initialized.state, controls } }
  // stats and body-specific reads live in the numeric input banks. A source
  // change (main Echo or set counts) gets its own environment; stat-only
  // candidates reuse catalogs, effects, routing, and fixed teammate inputs.
  let controlSignature = prepared.controlSignatures.get(controls)
  if (controlSignature === undefined) {
    controlSignature = JSON.stringify(controls)
    prepared.controlSignatures.set(controls, controlSignature)
  }
  const shape = `${candidate[0]?.id ?? ''}|${JSON.stringify(setCounts)}|${controlSignature}`
  const knownInputs = prepared.echoInputScores.get(shape)
  const knownInputKey = knownInputs?.project(candidate)
  const inputScore = knownInputKey == null ? undefined : knownInputs?.scores.get(knownInputKey)
  if (inputScore !== undefined) {
    prepared.diagnostics.dependencyHits += 1
    prepared.diagnostics.inputHits += 1
    prepared.diagnostics.echoInputHits += 1
    return inputScore
  }
  const template = prepared.environments.get(shape)
  const rememberEchoInput = (environment: ReturnType<typeof prepareRunEnv>, score: number) => {
    if (hasOpaqueStateBounds(environment)) return
    let inputs = knownInputs
    if (!inputs) {
      const project = numericTeammateEchoInputProjector(environment.numericBase, runtime.id)
      if (!project) return
      if (prepared.echoInputScores.size >= ROTATION_REPLAY_CACHE.inputShapes) prepared.echoInputScores.delete(prepared.echoInputScores.keys().next().value!)
      inputs = { project, scores: new Map() }
      prepared.echoInputScores.set(shape, inputs)
    }
    if (inputs.scores.size >= ROTATION_REPLAY_CACHE.inputScores) inputs.scores.delete(inputs.scores.keys().next().value!)
    inputs.scores.set(knownInputKey ?? inputs.project(candidate), score)
  }
  if (template && !hasOpaqueStateBounds(template)) {
    const started = performance.now()
    const inputs = echoCandidateTeammateReplayKey(template, runtime, prepared.structureIds.intern)
    const key = inputs == null ? null : `${candidate[0]?.id ?? ''}|${inputs}`
    prepared.diagnostics.dependencyKeyMs += performance.now() - started
    const score = key == null ? undefined : prepared.semanticScores.get(key)
    if (score !== undefined) {
      prepared.diagnostics.dependencyHits += 1
      prepared.diagnostics.inputHits += 1
      rememberEchoInput(template, score)
      return score
    }
  }
  const exactKey = JSON.stringify(candidate.map((echo) => [
    echo.id, echo.set, echo.mainEcho, echo.mainStats, echo.substats,
  ]))
  const exactScore = prepared.exactScores.get(exactKey)
  if (exactScore !== undefined) {
    prepared.diagnostics.exactHits += 1
    return exactScore
  }
  const environmentStarted = performance.now()
  let environment: ReturnType<typeof prepareRunEnv>
  if (template) {
    environment = prepareEchoCandidateRunEnv(template, runtime, true)
    prepared.diagnostics.environmentRebases += 1
  } else {
    prepared.diagnostics.environmentCompiles += 1
    if (prepared.baseEnvironment) {
      environment = prepareEchoCandidateRunEnv(prepared.baseEnvironment, runtime, false)
    } else {
      const { context } = prepareResSimulation(
        runtime, plan.seed, plan.enemy,
        { ...plan.runtimesById, [runtime.id]: runtime },
        plan.selectedTargets, plan.combatSetup,
      )
      environment = prepareRunEnv(context, plan.seed)
      prepared.baseEnvironment = environment
    }
    if (environment.numericBase.program.canRebaseEchoStats) {
      // each plan belongs to one search. bound its retained source variants so
      // inventory and theory searches cannot accumulate an environment per row.
      if (prepared.environments.size >= ROTATION_REPLAY_CACHE.environments) {
        prepared.environments.delete(prepared.environments.keys().next().value!)
      }
      prepared.environments.set(shape, environment)
    }
  }
  prepared.diagnostics.environmentMs += performance.now() - environmentStarted
  const dependencyStarted = performance.now()
  const semanticInputs = hasOpaqueStateBounds(environment) ? null
    : numericTeammateReplayKey(environment.numericBase, runtime.id, undefined, prepared.structureIds.intern)
  const semanticKey = semanticInputs == null ? null : `${candidate[0]?.id ?? ''}|${semanticInputs}`
  prepared.diagnostics.dependencyKeyMs += performance.now() - dependencyStarted
  const semanticScore = semanticKey == null ? undefined : prepared.semanticScores.get(semanticKey)
  if (semanticScore !== undefined) {
    prepared.diagnostics.dependencyHits += 1
    rememberEchoInput(template ?? environment, semanticScore)
    return semanticScore
  }
  prepared.diagnostics.replays += 1
  const replayStarted = performance.now()
  let teammateDamage = 0
  executeRotationScore(environment, prepared.program, {
    aggregationType: 'damage',
    allowedFeatureKeys: prepared.features,
    scoreResonatorIds: prepared.scoreMembers,
    damageMemo: prepared.damageMemo,
    onDamageScore: (key, resonatorId, avg) => {
      if (resonatorId !== runtime.id && prepared.members.has(key)) teammateDamage += avg
    },
  })
  prepared.diagnostics.replayMs += performance.now() - replayStarted
  const delta = teammateDamage - prepared.cleanDamage
  rememberEchoInput(template ?? environment, delta)
  if (semanticKey != null) {
    if (prepared.semanticScores.size >= ROTATION_REPLAY_CACHE.semanticScores) prepared.semanticScores.delete(prepared.semanticScores.keys().next().value!)
    prepared.semanticScores.set(semanticKey, delta)
  }
  if (prepared.exactScores.size >= ROTATION_REPLAY_CACHE.exactScores) prepared.exactScores.delete(prepared.exactScores.keys().next().value!)
  prepared.exactScores.set(exactKey, delta)
  if (topology != null) {
    let cache = teamDeltaByTopology.get(plan)
    if (!cache) teamDeltaByTopology.set(plan, cache = new Map())
    if (cache.size >= ROTATION_REPLAY_CACHE.topologyScores) cache.delete(cache.keys().next().value!)
    cache.set(topology, delta)
  }
  return delta
}

const ENCODED_ECHO_STATS = [
  'atkPercent', 'atkFlat', 'hpPercent', 'hpFlat', 'defPercent', 'defFlat',
  'critRate', 'critDmg', 'energyRegen', 'healingBonus', 'basicAtk', 'heavyAtk',
  'resonanceSkill', 'resonanceLiberation', 'aero', 'spectro', 'fusion',
  'glacio', 'havoc', 'electro',
] as const

/** rebuild the candidate source pool from the same numeric rows used by evaluation. */
export function scoreEncodedRotationTeammateDelta(
  plan: RotationTeamDamagePlan | undefined,
  echoes: readonly EchoInstance[],
  stats: Float32Array,
  sets: Uint8Array,
  comboIds: Int32Array,
  mainIndex: number,
): number {
  if (!plan) return 0
  const candidate = Array.from(comboIds, (id) => {
    const original = echoes[id]
    if (!original) return null
    const substats: Record<string, number> = {}
    for (let column = 0; column < ENCODED_ECHO_STATS.length; column += 1) {
      const value = stats[id * ECHO_STAT_STRIDE + column] ?? 0
      if (value) substats[ENCODED_ECHO_STATS[column]!] = value
    }
    return {
      ...original,
      set: sets[id] ?? original.set,
      mainEcho: id === mainIndex,
      mainStats: {
        primary: { key: 'atkFlat', value: 0 },
        secondary: { key: 'atkFlat', value: 0 },
      },
      substats,
    }
  }).filter((echo): echo is NonNullable<typeof echo> => echo != null)
  return scoreRotationTeammateDelta(plan, candidate)
}

export function captureRotationDamagePlan(input: {
  runtime: ResRuntime
  seed: ResSeed
  enemy: EnemyProfile
  items: RotationNode[]
  runtimesById: Record<string, ResRuntime>
  selectedTargets: Record<string, string | null>
  combatSetup?: RotationCombatSetup
  setConds?: SntSetConds
  preserveEchoStateChanges?: boolean
}) {
  // keep the candidate-control catalogue on the packed runtime so the set
  // encoder can build rows for search sets that are not currently equipped.
  // the clean simulation itself uses a copy with all Echo controls cleared.
  const runtime = stripEchoes(input.runtime)
  const cleanRuntime = stripEchoState(input.runtime)
  const items = input.preserveEchoStateChanges
    ? input.items
    : normalizeRotationForCleanContext(input.items, runtime.id)
  const participants = { ...input.runtimesById, [runtime.id]: cleanRuntime }
  const prepared = prepareResSimulation(
    cleanRuntime,
    input.seed,
    input.enemy,
    participants,
    input.selectedTargets,
    input.combatSetup,
  )
  const targets: RotationDamageTarget[] = []
  const teammateEvents = new Map<string, number>()
  const featureKeys = new Set<string>()
  const damageEventKeys = new Set<string>()
  let invocationTarget: RotationDamageTarget | null = null
  const environment = prepareRunEnv(prepared.context, input.seed)
  const score = executeRotationScore(
    environment,
    prepareRotationProgram(items),
    {
      aggregationType: 'damage',
      onDamageInvocation: (invocation) => {
        invocationTarget = null
        if (
          invocation.resonatorId !== runtime.id
          || invocation.skill.aggregationType !== 'damage'
          || !isOptDmgSkll(invocation.skill)
        ) return
        targets.push({
          resonatorId: invocation.resonatorId,
          skill: invocation.skill,
          weight: invocation.weight,
          runtime: invocation.runtime,
          finalStats: materializeFinalPlane(invocation.finalPlane, invocation.finalOffset),
          combat: { ...invocation.combat },
          nodeMultiplier: invocation.nodeMultiplier,
        })
        invocationTarget = targets.at(-1)!
      },
      onDamageScore: (key, resonatorId, avg) => {
        damageEventKeys.add(key)
        if (resonatorId !== runtime.id) teammateEvents.set(key, avg)
        else if (invocationTarget) invocationTarget.eventKey = key
      },
      onFeatureUse: (key: string) => featureKeys.add(key),
    },
  )
  const ownDamage = score.resonators.find((entry) => entry.id === runtime.id)?.avg ?? 0
  const fixedTeamDamage = score.total.avg - ownDamage
  return {
    runtime,
    graph: prepared.graph,
    activeContext: prepared.context,
    environment,
    targets,
    fixedTeamDamage,
    cleanContextDamage: ownDamage,
    damageEventKeys,
    teamDamagePlan: {
      runtime: cleanRuntime,
      seed: input.seed,
      enemy: input.enemy,
      items,
      runtimesById: participants,
      selectedTargets: input.selectedTargets,
      combatSetup: input.combatSetup,
      setConds: input.setConds,
      eventKeys: [...teammateEvents.keys()],
      eventDamage: Float64Array.from(teammateEvents.values()),
      featureKeys: [...featureKeys],
      ...candidateTeamEffectSources(runtime),
    } satisfies RotationTeamDamagePlan,
  }
}

export function packRotationDamagePlan(
  captured: ReturnType<typeof captureRotationDamagePlan>,
  enemy: EnemyProfile,
  shape: RotationContextShape,
  dedupe = true,
) {
  const packed = packRotationTargetContexts({
    targets: captured.targets,
    combatByResonatorId: buildRotationCombatContexts(
      captured.graph,
      captured.activeContext,
      captured.runtime.id,
      captured.targets,
      enemy,
    ),
    activeContext: captured.activeContext,
    enemy,
    shape,
  })
  // weapon search stores one context slab per weapon. its per-weapon event
  // columns must keep the same positions even when only one weapon happens to
  // make two columns numerically equal.
  if (!dedupe) return packed
  const stride = packed.contexts.length / Math.max(1, packed.targets.length)
  const seen = new Map<string, number>()
  const targets: typeof packed.targets = []
  const contexts = new Float32Array(packed.contexts.length)
  const weights = new Float32Array(packed.contextWeight.length)
  let count = 0
  for (let index = 0; index < packed.targets.length; index += 1) {
    const row = packed.contexts.subarray(index * stride, (index + 1) * stride)
    const bits = new Uint32Array(row.buffer, row.byteOffset, row.length)
    const key = Array.from(bits).join(',')
    let output = seen.get(key)
    if (output === undefined) {
      output = count++
      seen.set(key, output)
      contexts.set(row, output * stride)
      targets.push(packed.targets[index])
    }
    weights[output] += packed.contextWeight[index] ?? 1
  }
  return {
    ...packed,
    targets,
    contexts: contexts.subarray(0, count * stride),
    contextWeight: weights.subarray(0, count),
  }
}
