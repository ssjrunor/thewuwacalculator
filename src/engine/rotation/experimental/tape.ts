/*
  Author: Runor Ewhro
  Description: Experimental replay infrastructure. Records what a rotation decided, so it can be scored again
               without deciding it again.

               Walking a rotation is mostly deliberation: which node runs, who
               owns the feature, what the skill resolves to, which states are
               set. None of that is the damage number. A search that scores one
               rotation tens of thousands of times pays for that deliberation
               every time, and it reaches the same conclusions every time.

               A tape is that conclusion: the ordered list of damage
               evaluations, each with the stat plane it was evaluated against.
               Replaying one costs a kernel call per evaluation and nothing
               else. Supply different planes and the same tape scores a
               different build, which is what a search actually varies.
*/

import type { EnemyProfile } from '@/domain/entities/appState.ts'
import type { SkillDef } from '@/domain/entities/stats.ts'
import type { DamageCombatState, NumericDamageLane } from '@/engine/formulas/damage.ts'
import { scoreDamageAgainstLane } from '@/engine/formulas/damage.ts'
import { NUMERIC_FINAL_CELL_COUNT } from '@/engine/rotation/numericLayout.ts'
import {
  executeRotationProgram,
  type DamageInvocation,
  type RunEnvironment,
  type PreparedRotationProgram,
  type NumericScore,
} from '@/engine/rotation/execute.ts'

export interface RotationTape {
  /** Tapes may vary final stat planes only; control/runtime topology is fixed. */
  readonly replayDomain: 'final-stat-planes'
  /** Lane order matches the score vector a replay produces. */
  readonly resonatorIds: readonly string[]
  readonly count: number

  readonly laneByIndex: Int32Array
  readonly scoreIndexByIndex: Int32Array
  readonly groupByIndex: Int32Array
  readonly suppressWhenEmpty: Uint8Array
  readonly multiplierByIndex: Float64Array
  readonly weightByIndex: Float64Array
  readonly loopDivisorByIndex: Float64Array
  readonly levelByIndex: Float64Array

  /** Distinct stat planes, addressed per invocation. */
  readonly planes: Float64Array
  readonly planeCount: number
  readonly planeByIndex: Int32Array

  readonly immunityAll: Int32Array
  readonly immunityElements: Int32Array
  readonly immunitySkillTypes: Int32Array
  readonly immunityNegative: Int32Array

  /** Cold payloads the kernel still consults for non-lowered archetypes. */
  readonly skills: readonly SkillDef[]
  readonly combats: readonly (DamageCombatState | undefined)[]
  readonly enemies: readonly EnemyProfile[]
}

interface TapeDraft {
  lanes: number[]
  scoreIndexes: number[]
  groups: number[]
  suppress: number[]
  multipliers: number[]
  weights: number[]
  loopDivisors: number[]
  levels: number[]
  planeIndexes: number[]
  planeChunks: Float64Array[]
  immunityAll: number[]
  immunityElements: number[]
  immunitySkillTypes: number[]
  immunityNegative: number[]
  skills: SkillDef[]
  combats: (DamageCombatState | undefined)[]
  enemies: EnemyProfile[]
}

export function assertPlaneReplayTape(
  tape: Pick<RotationTape, 'replayDomain'>,
): void {
  if (tape.replayDomain !== 'final-stat-planes') {
    throw new Error('Rotation tape replay only accepts final-stat-plane variants')
  }
}

function planesEqual(left: Float64Array, right: Float64Array, rightOffset: number): boolean {
  for (let cell = 0; cell < NUMERIC_FINAL_CELL_COUNT; cell += 1) {
    if (left[cell] !== right[rightOffset + cell]) return false
  }
  return true
}

/**
 * Record one execution. The rotation runs exactly as it normally would; this
 * only listens to the damage boundary, so a tape can never disagree with the
 * interpreter about what happened.
 */
export function recordRotationTape(
  environment: RunEnvironment,
  program: PreparedRotationProgram,
): RotationTape {
  const resonatorIds = Object.values(environment.graph.participants)
    .map((participant) => participant.resonatorId)
  const scoreIndexById: Record<string, number> = {}
  resonatorIds.forEach((id, index) => { scoreIndexById[id] = index })

  const draft: TapeDraft = {
    lanes: [], scoreIndexes: [], groups: [], suppress: [], multipliers: [], weights: [], loopDivisors: [],
    levels: [], planeIndexes: [], planeChunks: [], immunityAll: [], immunityElements: [],
    immunitySkillTypes: [], immunityNegative: [], skills: [], combats: [], enemies: [],
  }

  const capture = (invocation: DamageInvocation): void => {
    /*
      The plane belongs to the running interpreter and is reused, so it is
      copied. Consecutive evaluations usually share one, and a rotation reads
      far fewer distinct stat states than it performs evaluations.
    */
    const previous = draft.planeChunks[draft.planeChunks.length - 1]
    let planeIndex = draft.planeChunks.length - 1
    if (!previous || !planesEqual(previous, invocation.finalPlane, invocation.finalOffset)) {
      const chunk = new Float64Array(NUMERIC_FINAL_CELL_COUNT)
      chunk.set(invocation.finalPlane.subarray(
        invocation.finalOffset,
        invocation.finalOffset + NUMERIC_FINAL_CELL_COUNT,
      ))
      draft.planeChunks.push(chunk)
      planeIndex = draft.planeChunks.length - 1
    }

    draft.lanes.push(invocation.lane)
    draft.scoreIndexes.push(scoreIndexById[invocation.resonatorId] ?? -1)
    draft.groups.push(invocation.group)
    draft.suppress.push(invocation.suppressWhenEmpty ? 1 : 0)
    draft.multipliers.push(invocation.nodeMultiplier)
    draft.weights.push(invocation.weight)
    draft.loopDivisors.push(invocation.loopDivisor)
    draft.levels.push(invocation.level)
    draft.planeIndexes.push(planeIndex)
    draft.skills.push(invocation.skill)
    // combat state is scratch owned by the interpreter, so it is snapshotted
    draft.combats.push(invocation.combat ? { ...invocation.combat } : undefined)
    draft.enemies.push(invocation.enemy)
    draft.immunityAll.push(invocation.immunityAll)
    draft.immunityElements.push(invocation.immunityElements)
    draft.immunitySkillTypes.push(invocation.immunitySkillTypes)
    draft.immunityNegative.push(invocation.immunityNegative)
  }

  executeRotationProgram(environment, program, {
    detail: 'summary',
    captureEntries: false,
    onDamageInvocation: capture,
  })

  const count = draft.lanes.length
  const planes = new Float64Array(draft.planeChunks.length * NUMERIC_FINAL_CELL_COUNT)
  draft.planeChunks.forEach((chunk, index) => planes.set(chunk, index * NUMERIC_FINAL_CELL_COUNT))

  return {
    replayDomain: 'final-stat-planes',
    resonatorIds,
    count,
    laneByIndex: Int32Array.from(draft.lanes),
    scoreIndexByIndex: Int32Array.from(draft.scoreIndexes),
    groupByIndex: Int32Array.from(draft.groups),
    suppressWhenEmpty: Uint8Array.from(draft.suppress),
    multiplierByIndex: Float64Array.from(draft.multipliers),
    weightByIndex: Float64Array.from(draft.weights),
    loopDivisorByIndex: Float64Array.from(draft.loopDivisors),
    levelByIndex: Float64Array.from(draft.levels),
    planes,
    planeCount: draft.planeChunks.length,
    planeByIndex: Int32Array.from(draft.planeIndexes),
    immunityAll: Int32Array.from(draft.immunityAll),
    immunityElements: Int32Array.from(draft.immunityElements),
    immunitySkillTypes: Int32Array.from(draft.immunitySkillTypes),
    immunityNegative: Int32Array.from(draft.immunityNegative),
    skills: draft.skills,
    combats: draft.combats,
    enemies: draft.enemies,
  }
}

export interface TapeReplayOptions {
  /**
   * Stat planes to score against, laid out exactly like `tape.planes`. Omit to
   * replay the planes the tape recorded.
   */
  planes?: Float64Array
  /** Reusable output, sized `(resonatorIds.length + 1) * 3`. */
  into?: Float64Array
  /** Divide damage by enclosing loop pass counts. */
  normalizeLoops?: boolean
}

/** Score a tape. This is the whole cost of one replay: one kernel call each. */
export function replayTapeInto(tape: RotationTape, options: TapeReplayOptions = {}): Float64Array {
  assertPlaneReplayTape(tape)
  const planes = options.planes ?? tape.planes
  const values = options.into ?? new Float64Array((tape.resonatorIds.length + 1) * 3)
  values.fill(0)

  const scratch = REPLAY_SCRATCH
  const lane = REPLAY_LANE
  lane.finals = planes

  let index = 0
  while (index < tape.count) {
    const group = tape.groupByIndex[index]!
    const scoreIndex = tape.scoreIndexByIndex[index]!
    const weight = tape.weightByIndex[index]!
    const loopScale = options.normalizeLoops
      ? 1 / Math.max(1, tape.loopDivisorByIndex[index] ?? 1)
      : 1
    const suppress = tape.suppressWhenEmpty[index] === 1
    let normal = 0
    let crit = 0
    let avg = 0

    while (index < tape.count && tape.groupByIndex[index] === group) {
      lane.offset = tape.planeByIndex[index]! * NUMERIC_FINAL_CELL_COUNT
      lane.immunityAll = tape.immunityAll[index]!
      lane.immunityElements = tape.immunityElements[index]!
      lane.immunitySkillTypes = tape.immunitySkillTypes[index]!
      lane.immunityNegative = tape.immunityNegative[index]!
      scratch[0] = 0
      scratch[1] = 0
      scratch[2] = 0
      scoreDamageAgainstLane(
        REPLAY_TARGET,
        lane,
        tape.skills[index]!,
        tape.enemies[index]!,
        tape.levelByIndex[index]!,
        tape.combats[index],
        tape.multiplierByIndex[index]!,
      )
      normal += scratch[0]!
      crit += scratch[1]!
      avg += scratch[2]!
      index += 1
    }

    // an empty negative effect is absent, not a zero row
    if (suppress && avg <= 0) continue
    if (scoreIndex < 0) continue

    const weightedNormal = normal * weight * loopScale
    const weightedCrit = crit * weight * loopScale
    const weightedAvg = avg * weight * loopScale
    values[0]! += weightedNormal
    values[1]! += weightedCrit
    values[2]! += weightedAvg
    const offset = (scoreIndex + 1) * 3
    values[offset]! += weightedNormal
    values[offset + 1]! += weightedCrit
    values[offset + 2]! += weightedAvg
  }

  return values
}

const REPLAY_SCRATCH = new Float64Array(3)
const REPLAY_TARGET = { values: REPLAY_SCRATCH }
const REPLAY_LANE: NumericDamageLane = {
  finals: REPLAY_SCRATCH,
  offset: 0,
  immunityAll: 0,
  immunityElements: 0,
  immunitySkillTypes: 0,
  immunityNegative: 0,
}

/** The same numbers `executeRotationScore` returns, from a recorded tape. */
export function replayTape(tape: RotationTape, options: TapeReplayOptions = {}): NumericScore {
  const values = replayTapeInto(tape, { ...options, normalizeLoops: false })
  const normalizedValues = replayTapeInto(tape, {
    planes: options.planes,
    normalizeLoops: true,
  })
  return {
    total: { normal: values[0] ?? 0, crit: values[1] ?? 0, avg: values[2] ?? 0 },
    resonators: tape.resonatorIds.map((id, index) => ({
      id,
      normal: values[(index + 1) * 3] ?? 0,
      crit: values[(index + 1) * 3 + 1] ?? 0,
      avg: values[(index + 1) * 3 + 2] ?? 0,
    })),
    normalizedTotal: {
      normal: normalizedValues[0] ?? 0,
      crit: normalizedValues[1] ?? 0,
      avg: normalizedValues[2] ?? 0,
    },
    normalizedResonators: tape.resonatorIds.map((id, index) => ({
      id,
      normal: normalizedValues[(index + 1) * 3] ?? 0,
      crit: normalizedValues[(index + 1) * 3 + 1] ?? 0,
      avg: normalizedValues[(index + 1) * 3 + 2] ?? 0,
    })),
    metrics: {
      numericForks: 0,
      numericCheckpoints: 0,
      objectOverlayCopies: 0,
      runtimeMaterializations: 0,
      graphMaterializations: 0,
      legacyConditionEvaluations: 0,
      scalarFeatures: 0,
      capturedEntries: 0,
    },
  }
}

/**
 * Score many stat variants against one tape.
 *
 * `planeSets` holds one full set of planes per variant, laid out exactly like
 * `tape.planes` and concatenated. Results land in `into` as one score triple
 * per resonator per variant, preceded by the team total, which is the layout
 * `replayTapeInto` writes.
 */
export function replayTapeBatch(
  tape: RotationTape,
  planeSets: Float64Array,
  into?: Float64Array,
): Float64Array {
  const stride = tape.planeCount * NUMERIC_FINAL_CELL_COUNT
  const variants = stride > 0 ? Math.floor(planeSets.length / stride) : 0
  const width = (tape.resonatorIds.length + 1) * 3
  const output = into ?? new Float64Array(variants * width)

  for (let variant = 0; variant < variants; variant += 1) {
    replayTapeInto(tape, {
      planes: planeSets.subarray(variant * stride, (variant + 1) * stride),
      into: output.subarray(variant * width, (variant + 1) * width),
    })
  }

  return output
}

/**
 * The tape as plain transferable data. Skills and enemies are shared by
 * reference across the invocations that use them, so a tape crossing a worker
 * boundary carries each one once rather than once per evaluation.
 */
export interface PackedRotationTape {
  replayDomain: 'final-stat-planes'
  resonatorIds: readonly string[]
  count: number
  planeCount: number
  laneByIndex: Int32Array
  scoreIndexByIndex: Int32Array
  groupByIndex: Int32Array
  suppressWhenEmpty: Uint8Array
  multiplierByIndex: Float64Array
  weightByIndex: Float64Array
  loopDivisorByIndex: Float64Array
  levelByIndex: Float64Array
  planes: Float64Array
  planeByIndex: Int32Array
  immunityAll: Int32Array
  immunityElements: Int32Array
  immunitySkillTypes: Int32Array
  immunityNegative: Int32Array
  skillTable: readonly SkillDef[]
  skillByIndex: Int32Array
  enemyTable: readonly EnemyProfile[]
  enemyByIndex: Int32Array
  combats: readonly (DamageCombatState | undefined)[]
}

function internAll<T>(values: readonly T[]): { table: T[]; indexes: Int32Array } {
  const table: T[] = []
  const seen = new Map<T, number>()
  const indexes = new Int32Array(values.length)
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]!
    let at = seen.get(value)
    if (at === undefined) {
      at = table.length
      table.push(value)
      seen.set(value, at)
    }
    indexes[index] = at
  }
  return { table, indexes }
}

export function packTape(tape: RotationTape): PackedRotationTape {
  const skills = internAll(tape.skills)
  const enemies = internAll(tape.enemies)
  return {
    replayDomain: tape.replayDomain,
    resonatorIds: tape.resonatorIds,
    count: tape.count,
    planeCount: tape.planeCount,
    laneByIndex: tape.laneByIndex,
    scoreIndexByIndex: tape.scoreIndexByIndex,
    groupByIndex: tape.groupByIndex,
    suppressWhenEmpty: tape.suppressWhenEmpty,
    multiplierByIndex: tape.multiplierByIndex,
    weightByIndex: tape.weightByIndex,
    loopDivisorByIndex: tape.loopDivisorByIndex,
    levelByIndex: tape.levelByIndex,
    planes: tape.planes,
    planeByIndex: tape.planeByIndex,
    immunityAll: tape.immunityAll,
    immunityElements: tape.immunityElements,
    immunitySkillTypes: tape.immunitySkillTypes,
    immunityNegative: tape.immunityNegative,
    skillTable: skills.table,
    skillByIndex: skills.indexes,
    enemyTable: enemies.table,
    enemyByIndex: enemies.indexes,
    combats: tape.combats,
  }
}

export function unpackTape(packed: PackedRotationTape): RotationTape {
  const skills = new Array<SkillDef>(packed.count)
  const enemies = new Array<EnemyProfile>(packed.count)
  for (let index = 0; index < packed.count; index += 1) {
    skills[index] = packed.skillTable[packed.skillByIndex[index]!]!
    enemies[index] = packed.enemyTable[packed.enemyByIndex[index]!]!
  }
  return {
    replayDomain: packed.replayDomain,
    resonatorIds: packed.resonatorIds,
    count: packed.count,
    laneByIndex: packed.laneByIndex,
    scoreIndexByIndex: packed.scoreIndexByIndex,
    groupByIndex: packed.groupByIndex,
    suppressWhenEmpty: packed.suppressWhenEmpty,
    multiplierByIndex: packed.multiplierByIndex,
    weightByIndex: packed.weightByIndex,
    loopDivisorByIndex: packed.loopDivisorByIndex,
    levelByIndex: packed.levelByIndex,
    planes: packed.planes,
    planeCount: packed.planeCount,
    planeByIndex: packed.planeByIndex,
    immunityAll: packed.immunityAll,
    immunityElements: packed.immunityElements,
    immunitySkillTypes: packed.immunitySkillTypes,
    immunityNegative: packed.immunityNegative,
    skills,
    combats: packed.combats,
    enemies,
  }
}

/** Buffers a worker can take ownership of when a packed tape is posted. */
export function tapeTransferables(packed: PackedRotationTape): ArrayBuffer[] {
  return [
    packed.laneByIndex, packed.scoreIndexByIndex, packed.groupByIndex,
    packed.suppressWhenEmpty, packed.multiplierByIndex, packed.weightByIndex,
    packed.loopDivisorByIndex,
    packed.levelByIndex, packed.planes, packed.planeByIndex,
    packed.immunityAll, packed.immunityElements, packed.immunitySkillTypes,
    packed.immunityNegative, packed.skillByIndex, packed.enemyByIndex,
  ].map((view) => view.buffer as ArrayBuffer)
}
