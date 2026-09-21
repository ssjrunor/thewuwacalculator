/*
  Author: Runor Ewhro
  Description: Prepares editor and saved-scenario execution inputs, projects
               member data, and caches exact saved-rotation comparison results.
*/


import type { EnemyProfile } from '@/domain/entities/appState.ts'
import { type SavedRotation } from '@/domain/entities/inventoryStorage.ts'
import type { RotationComparisonSummary } from '@/domain/entities/rotationSummary.ts'
import type { ResRuntime } from '@/domain/entities/runtime.ts'
import type { RotationDamageBasis } from '@/domain/entities/rotationEditorPreferences.ts'
import { projectScenarioRuntimes } from '@/engine/runtime/scenarioRuntime.ts'
import type { RotationNode } from '@/domain/gameData/contracts.ts'
import {
  buildRun,
  memberToReg,
  type RunResult,
  withRunMetadata,
} from '@/modules/simulation/surfaces/rotation/program-editor/simulation/runProgram.ts'
import type {
  EditorMember,
  EditorSection,
} from '@/modules/simulation/surfaces/rotation/program-editor/model/program.ts'
import { editorSectionsToRotation } from '@/modules/simulation/surfaces/rotation/program-editor/model/toRotationNodes.ts'
import { seedRsntById } from '@/modules/simulation/features/resonator/lib/seedData.ts'
import { visibleRotMembers } from '@/modules/simulation/surfaces/rotation/shared/catalog.ts'
import {
  SimulationBatchRunner,
  type SimulationBatchJob,
} from '@/engine/pipeline/simulationBatch.ts'
import type { PrepWork } from '@/engine/pipeline/preparedWorkspace.ts'
import { prepareResSimulation } from '@/engine/pipeline/index.ts'
import {
  executeRotationScore,
  prepareRunEnv,
  prepareRotationProgram,
} from '@/engine/rotation/execute.ts'
import { orderStoredRotationProgram } from '@/engine/rotation/programOrder.ts'

function editedRotationSections(
  runtime: ResRuntime | null | undefined,
  sections: EditorSection[],
): Array<{ id: string; title: string; meta: string; items: RotationNode[] }> {
  return runtime
    ? editorSectionsToRotation(sections, runtime.rotation.program ?? [])
    : []
}

export function editedRotationItems(
  runtime: ResRuntime | null | undefined,
  sections: EditorSection[],
): RotationNode[] {
  return editedRotationSections(runtime, sections).flatMap((section) => section.items)
}

function runRuntimeRotation({
  runtime,
  runtimesById,
  targetSelections,
  enemy,
  members,
  items,
  itemSections,
  prepWork,
  detail,
  includeSnapshots,
  includeFlatRows,
  priorPrepareMs = 0,
}: {
  runtime: ResRuntime | null | undefined
  runtimesById: Record<string, ResRuntime>
  targetSelections: Record<string, string | null>
  enemy: EnemyProfile
  members: Parameters<typeof buildRun>[0]['members']
  items?: RotationNode[]
  itemSections?: Parameters<typeof buildRun>[0]['itemSections']
  prepWork?: PrepWork | null
  detail?: 'full' | 'summary'
  includeSnapshots?: boolean
  includeFlatRows?: boolean
  /** adapter work completed before entering the canonical runner */
  priorPrepareMs?: number
}): RunResult | null {
  const startedAt = performance.now()
  if (!runtime) return null

  const seed = seedRsntById[runtime.id]
  if (!seed) return null

  const result = buildRun({
    runtime,
    seed,
    runtimesById,
    targetSelections,
    items,
    itemSections,
    enemy,
    members,
    prepWork,
    detail,
    includeSnapshots,
    includeFlatRows,
  })
  const wrapperMs = Math.max(0, performance.now() - startedAt - result.timing.totalMs)
  const additionalPrepareMs = priorPrepareMs + wrapperMs
  return withRunMetadata(result, {
    timing: {
      ...result.timing,
      prepareMs: result.timing.prepareMs + additionalPrepareMs,
      totalMs: result.timing.totalMs + additionalPrepareMs,
    },
  })
}

export function runStoredRotation({
  runtime,
  runtimesById,
  targetSelections,
  enemy,
  members,
  prepWork,
  items,
}: {
  runtime: ResRuntime | null | undefined
  runtimesById: Record<string, ResRuntime>
  targetSelections: Record<string, string | null>
  enemy: EnemyProfile
  members: Parameters<typeof buildRun>[0]['members']
  prepWork?: PrepWork | null
  /** Standing last-run document; defaults to the runtime's persisted program. */
  items?: RotationNode[]
}): RunResult | null {
  return runRuntimeRotation({
    runtime,
    runtimesById,
    targetSelections,
    enemy,
    members,
    prepWork,
    items,
    includeFlatRows: false,
  })
}

/** Rebuild a saved rotation from its persisted scenario snapshot. */
export function runSavedRotation({
  entry,
  detail = 'full',
  includeSnapshots = true,
}: {
  entry: SavedRotation | null | undefined
  detail?: 'full' | 'summary'
  includeSnapshots?: boolean
}): RunResult | null {
  const startedAt = performance.now()
  const rebuilt = rebuildSavedRotation(entry)
  if (!rebuilt) return null
  const { runtime, runtimesById, targetSelections, members } = rebuilt
  return runRuntimeRotation({
    runtime,
    runtimesById,
    targetSelections,
    enemy: entry!.scenario.target,
    members,
    detail,
    includeSnapshots,
    includeFlatRows: false,
    priorPrepareMs: performance.now() - startedAt,
  })
}

function rebuildSavedRotation(entry: SavedRotation | null | undefined) {
  if (!entry) return null
  const projection = projectScenarioRuntimes(entry.scenario)
  return {
    runtime: projection.subjectRuntime,
    runtimesById: projection.runtimesById,
    targetSelections: projection.selectedTargets,
    members: visibleRotMembers(projection.subjectRuntime, projection.runtimesById),
  }
}

/**
 * Rebuilds member data directly from a saved scenario without executing it.
 */
export function savedRotationMembers(
  entry: SavedRotation | null | undefined,
): EditorMember[] {
  const rebuilt = rebuildSavedRotation(entry)
  if (!rebuilt) {
    return []
  }

  // Member builds can be projected without executing damage-share calculations.
  return rebuilt.members.map((member) => memberToReg(member, 0))
}

export interface SavedRotationComparisonResult {
  average: RotationComparisonSummary
  full: RotationComparisonSummary
}

function comparisonSummary(
  total: { normal: number; crit: number; avg: number },
  resonators: readonly { id: string; normal: number; crit: number; avg: number }[],
  members: ReturnType<typeof visibleRotMembers>,
): RotationComparisonSummary {
  const contributionById = new Map(resonators.map((entry) => [entry.id, entry]))
  return {
    total: { ...total },
    members: members.map((member) => {
      const contribution = contributionById.get(member.id)
      return {
        id: member.id,
        name: member.name,
        contribution: contribution
          ? {
              normal: contribution.normal,
              avg: contribution.avg,
              crit: contribution.crit,
            }
          : { normal: 0, avg: 0, crit: 0 },
      }
    }),
  }
}

/** Exact saved-rotation comparison without editor rows, histories, or snapshots. */
export function runSavedRotationComparison({
  entry,
}: {
  entry: SavedRotation | null | undefined
}): SavedRotationComparisonResult | null {
  const rebuilt = rebuildSavedRotation(entry)
  if (!rebuilt) return null
  const seed = seedRsntById[rebuilt.runtime.id]
  if (!seed) return null
  const prepared = prepareResSimulation(
    rebuilt.runtime,
    seed,
    entry!.scenario.target,
    rebuilt.runtimesById,
    rebuilt.targetSelections,
  )
  const orderedItems = orderStoredRotationProgram(rebuilt.runtime.rotation.program)
  const score = executeRotationScore(
    prepareRunEnv(prepared.context, seed),
    prepareRotationProgram(orderedItems),
    { aggregationType: 'damage' },
  )
  return {
    average: comparisonSummary(score.normalizedTotal, score.normalizedResonators, rebuilt.members),
    full: comparisonSummary(score.total, score.resonators, rebuilt.members),
  }
}

const SAVED_ROTATION_ENGINE_VERSION = 3
const savedSimulationKeyCache = new WeakMap<SavedRotation, string>()
const savedEntryIdentity = new WeakMap<SavedRotation, number>()
let nextSavedEntryIdentity = 0

function objectIdentity<T extends object>(
  value: T,
  identities: WeakMap<T, number>,
  next: () => number,
): number {
  const cached = identities.get(value)
  if (cached !== undefined) return cached
  const identity = next()
  identities.set(value, identity)
  return identity
}

export function savedRotationSimulationKey(entry: SavedRotation): string {
  const cached = savedSimulationKeyCache.get(entry)
  if (cached) return cached
  /*
    Store updates replace the immutable saved artifact. Identity therefore
    invalidates on every metadata or scenario edit without recursively hashing
    the complete scenario for every saved entry.
  */
  const entryIdentity = objectIdentity(
    entry,
    savedEntryIdentity,
    () => ++nextSavedEntryIdentity,
  )
  const key = `${SAVED_ROTATION_ENGINE_VERSION}:${entryIdentity}`
  savedSimulationKeyCache.set(entry, key)
  return key
}

export interface SavedRotationJob {
  entry: SavedRotation
  mode: 'comparison' | 'detail'
}

interface SavedRotationWorkerResponse {
  results: Array<{
    id: number
    value?: RunResult | SavedRotationComparisonResult | null
    error?: string
  }>
}

let savedWorker: Worker | null = null
let savedWorkerRequestId = 0
const savedWorkerPending = new Map<number, {
  job: SavedRotationJob
  resolve: (value: RunResult | SavedRotationComparisonResult | null) => void
}>()
let savedWorkerQueue: Array<{ id: number; job: SavedRotationJob }> = []
let savedWorkerFlushQueued = false

export function runSavedRotationJob(job: SavedRotationJob) {
  return job.mode === 'comparison'
    ? runSavedRotationComparison(job)
    : runSavedRotation({ ...job, detail: 'full', includeSnapshots: false })
}

function executeSavedRotationJob(
  job: SavedRotationJob,
): Promise<RunResult | SavedRotationComparisonResult | null> {
  if (typeof Worker === 'undefined') {
    return Promise.resolve(runSavedRotationJob(job))
  }
  if (!savedWorker) {
    savedWorker = new Worker(new URL('./savedRotation.worker.ts', import.meta.url), { type: 'module' })
    savedWorker.onmessage = (event: MessageEvent<SavedRotationWorkerResponse>) => {
      for (const result of event.data.results) {
        const pending = savedWorkerPending.get(result.id)
        if (!pending) continue
        savedWorkerPending.delete(result.id)
        if (result.error) {
          pending.resolve(runSavedRotationJob(pending.job))
        } else {
          pending.resolve(result.value ?? null)
        }
      }
    }
    savedWorker.onerror = () => {
      const pending = [...savedWorkerPending.values()]
      savedWorkerPending.clear()
      savedWorkerQueue = []
      savedWorkerFlushQueued = false
      savedWorker?.terminate()
      savedWorker = null
      for (const request of pending) {
        request.resolve(runSavedRotationJob(request.job))
      }
    }
  }
  const id = ++savedWorkerRequestId
  return new Promise((resolve) => {
    savedWorkerPending.set(id, { job, resolve })
    savedWorkerQueue.push({ id, job })
    if (savedWorkerFlushQueued) return
    savedWorkerFlushQueued = true
    queueMicrotask(() => {
      savedWorkerFlushQueued = false
      const requests = savedWorkerQueue
      savedWorkerQueue = []
      savedWorker?.postMessage({ requests })
    })
  })
}

export interface SavedRotationBatch {
  key: string
  jobs: readonly SimulationBatchJob<SavedRotationJob>[]
}

const savedRotationRunner = new SimulationBatchRunner<SavedRotationJob, SavedRotationComparisonResult | null>(
  async (job) => (await executeSavedRotationJob(job)) as SavedRotationComparisonResult | null,
  8,
  64,
  { yieldBeforeExecute: false },
)
const savedRotationDetailRunner = new SimulationBatchRunner<SavedRotationJob, RunResult | null>(
  async (job) => (await executeSavedRotationJob(job)) as RunResult | null,
  3,
  12,
  { yieldBeforeExecute: false },
)

export function prepareSavedRotationBatch(
  entries: readonly SavedRotation[],
): SavedRotationBatch {
  const jobs = entries.map((entry) => ({
    id: entry.id,
    key: savedRotationSimulationKey(entry),
    input: { entry, mode: 'comparison' as const },
  }))
  return {
    key: jobs.map((job) => job.key).join('\u0000'),
    jobs,
  }
}

export function runPreparedSavedRotationBatch(
  batch: SavedRotationBatch,
  options: { signal?: AbortSignal } = {},
): Promise<Map<string, SavedRotationComparisonResult | null>> {
  return savedRotationRunner.run(batch.jobs, options)
}

export function runSavedRotationBatch(
  entries: readonly SavedRotation[],
  options: { signal?: AbortSignal } = {},
): Promise<Map<string, SavedRotationComparisonResult | null>> {
  return runPreparedSavedRotationBatch(prepareSavedRotationBatch(entries), options)
}

/** Live projections already have an editor run; only inventory entries need detail jobs. */
export function pendingSavedRotationDetails(
  entries: readonly SavedRotation[],
  requestedIds: readonly string[],
  completed: ReadonlyMap<string, RunResult | null>,
): SavedRotation[] {
  const wanted = new Set(requestedIds)
  return entries.filter((entry) => wanted.has(entry.id) && !completed.has(entry.id))
}

/** Build rich editor projections only for saved rotations currently being inspected. */
export function runSavedRotationDetailBatch(
  entries: readonly SavedRotation[],
  options: { signal?: AbortSignal } = {},
): Promise<Map<string, RunResult | null>> {
  return savedRotationDetailRunner.run(entries.map((entry) => ({
    id: entry.id,
    key: `${savedRotationSimulationKey(entry)}\u0000detail`,
    input: { entry, mode: 'detail' as const },
  })), options)
}

export function savedRotationSummary(
  run: RunResult | SavedRotationComparisonResult,
  damageBasis: RotationDamageBasis = 'avg',
): RotationComparisonSummary {
  if ('average' in run) {
    return damageBasis === 'full' ? run.full : run.average
  }
  const summary = damageBasis === 'full' ? run.fullSummary : run.summary
  const contributionById = new Map(summary.resonators.map((group) => [group.id, group]))
  return {
    total: { ...summary.total },
    members: run.members.map((member) => {
      const contribution = contributionById.get(member.id)
      return {
        id: member.id,
        name: member.name,
        contribution: contribution
          ? {
              normal: contribution.normal,
              avg: contribution.avg,
              crit: contribution.crit,
            }
          : { normal: 0, avg: 0, crit: 0 },
      }
    }),
  }
}

function appendToMain(
  sections: ReturnType<typeof editedRotationSections>,
  items: RotationNode[],
): ReturnType<typeof editedRotationSections> {
  if (items.length === 0) return sections

  const target = sections.some((section) => section.id === 'main')
    ? 'main'
    : sections.at(-1)?.id

  return sections.map((section) => (
    section.id === target
      ? { ...section, items: [...section.items, ...items] }
      : section
  ))
}

export function runEditedRotation({
  runtime,
  runtimesById,
  targetSelections,
  enemy,
  members,
  sections,
  append = [],
  prepWork,
}: {
  runtime: ResRuntime | null | undefined
  runtimesById: Record<string, ResRuntime>
  targetSelections: Record<string, string | null>
  enemy: EnemyProfile
  members: Parameters<typeof buildRun>[0]['members']
  sections: EditorSection[]
  append?: RotationNode[]
  prepWork?: PrepWork | null
}): RunResult | null {
  const startedAt = performance.now()
  const itemSections = appendToMain(editedRotationSections(runtime, sections), append)
  return runRuntimeRotation({
    runtime,
    runtimesById,
    targetSelections,
    enemy,
    members,
    itemSections,
    prepWork,
    priorPrepareMs: performance.now() - startedAt,
  })
}
