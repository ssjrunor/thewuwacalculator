/*
  Author: Runor Ewhro
  description: defines the program editor's authored node model and the
               simulation-backed projections stored on those nodes.
*/

import type { AttributeKey, SkillAggType } from '@/domain/entities/stats.ts'
import type {
  DamageFeature,
  RotationNoteNode,
  RotationNode,
  RtChng,
  RuntimeValue,
  SourceState,
} from '@/domain/gameData/contracts.ts'
import type { CondAction } from '@/modules/simulation/surfaces/rotation/shared/authoringTypes.ts'

/** resonator id used as the stable member identity. */
export type MemberId = string

export interface EditorMember {
  id: MemberId
  name: string

  role: string
  attribute: AttributeKey
  profile: string
  weapon: {
    id: string
    name: string
    icon: string
    rank: number
    level: number
    baseAtk: number
    /** canonical weapon rarity from 1 through 5. */
    rarity: number
    /** secondary stat key and level-adjusted weapon values. */
    statKey: string
    atk: number
    statValue: number
  }
  level: number
  sequence: number
  skillLevels: string
  /** slot-preserving echo loadout. */
  echoes: Array<EditorEcho | null>
  sharePct: number
  seedName?: string
}

export interface SummaryGroup {
  id: string
  label: string
  normal: number
  crit: number
  avg: number
  count: number
  sharePct: number
  icon?: string

  iconKind?: 'portrait' | 'glyph'
  color?: string
}

export interface RotationBreakdown {
  skillTypes: SummaryGroup[]
  talentNodes: SummaryGroup[]
  attributes: SummaryGroup[]
}

export interface RotationSummary {
  total: {
    normal: number
    crit: number
    avg: number
  }
  /** non-damage rotation outputs, intentionally separate from `total`. */
  supportTotals: {
    healing: number
    shield: number
  }
  counts: {
    entries: number
    damage: number
    conditions: number
    /**
     * steps that are switched on but never acted because their direct
     * condition was false. a step switched off by the user is not counted.
     */
    neverFired: number
    loops: number
    repeats: number
    uptimes: number
  }
  averageDamage: number
  resonators: SummaryGroup[]
  skillTypes: SummaryGroup[]
  talentNodes: SummaryGroup[]
  attributes: SummaryGroup[]
  byResonator: Record<string, RotationBreakdown>
}

export const NO_ROTATION_SUMMARY: RotationSummary = {
  total: { normal: 0, crit: 0, avg: 0 },
  supportTotals: { healing: 0, shield: 0 },
  counts: {
    entries: 0,
    damage: 0,
    conditions: 0,
    neverFired: 0,
    loops: 0,
    repeats: 0,
    uptimes: 0,
  },
  averageDamage: 0,
  resonators: [],
  skillTypes: [],
  talentNodes: [],
  attributes: [],
  byResonator: {},
}

export interface EditorEcho {
  id: string
  name: string
  icon: string
  cost: number
  mainEcho: boolean
  mainStat: string
  setId: number
}

export type NodeOwner =
  | { kind: 'member'; memberId: MemberId }
  | { kind: 'echo'; echoId: string }

/**
 * derived from simulation. `dead` is a node the last run never got anything
 * out of: it was not reached, or what it names could not be resolved.
 * `inert` is a node that ran and wrote only what its state already held.
 */
export type NodeGate = { kind: 'dead' } | { kind: 'inert' }

/**
 * resonator stat snapshot from this node's evaluation.
 *
 * the basic and global values are this point-in-time snapshot. skill-scoped
 * values such as crit, bonus and enemy modifiers are the aggregate that the
 * evaluated skill actually resolved. using the engine result prevents a
 * second, potentially stale reconstruction of the same effective stats.
 */
export type StatLine = NonNullable<DamageFeature['effectiveStats']>

interface EditorNodeBase {
  id: string
  owner: NodeOwner
  label: string
  /**
   * the exact engine node behind this editor projection. simulation values
   * stay beside the source node. serialization applies explicit editor
   * mutations to that source.
   */
  sourceNode?: RotationNode

  ownerEdited?: boolean
  sourceIcon?: string
  gate?: NodeGate
  /** display annotation for this node; never an execution child. */
  attachedNote?: EditorNote

  noteEdited?: boolean
}

export interface EditorNote {
  type: 'note'
  id: string
  label?: string
  color?: string
  text: string
  sourceNode?: RotationNoteNode
  labelEdited?: boolean
  colorEdited?: boolean
  textEdited?: boolean
}

/**
 * a state write performed when a step fires and carried on that step.
 */
export interface StateWrite {
  id: string
  label: string
  value: string
  /** a state coming on, or a value going up */
  rising: boolean
}

/**
 * evaluated values keyed by loop run. authored differences live in exact pass
 * fork bodies; this map only records what simulation observed.
 */
export type ByRun<T> = Record<number, T>

export type ConditionWriteAction = CondAction

export interface EditorStep extends EditorNodeBase {
  type: 'step'
  index: number
  tag?: string
  /** the authored feature, so the step can be swapped for a neighbouring one */
  featureId?: string

  color?: string
  /** semantic category that separates damage from healing and shielding. */
  aggregationType?: SkillAggType
  /** a step switched off stays in the rotation but contributes nothing */
  disabled?: boolean
  /** a damage-over-time feature, with a separate stack configuration */
  negEffect?: boolean
  /**
   * fixed-max stack skills have no instance/stable-width series to configure.
   * when true the inspector hides the series section the way the pane does.
   */
  negFixedStacks?: boolean
  /** how many stack hits this series emits (default 1) */
  negativeEffectInstances?: number
  /** how many hits keep the same stack value before it steps down (default 1) */
  negativeEffectStableWidth?: number
  /** true when authored series values differ from the execution baseline. */
  negSeriesEdited?: boolean
  /**
   * the skill's damage element. rover can cast across several elements; colour
   * each step by the damage it deals.
   */
  element?: AttributeKey
  /** state this step writes when it fires, per run */
  writesByRun?: ByRun<StateWrite[]>
  /**
   * the attached writes as authored, for a step whose `changes` were edited
   * since the last run. simulation has not seen them yet, so there is no
   * per-run write to read, so these remain authoritative until the next run.
   */
  pendingWrites?: StateWrite[]
  /** authored condition writes attached to the feature */
  changes?: RtChng[]
  /** attached condition writes resolved for each loop run */
  attachedChangesByRun?: ByRun<RtChng[]>
  /*
    the features attached to this step. they are features in every respect: their
    own owner, multiplier, damage and stat line, resolved from their own rows.
    the engine strips their attachments; this projection has one attachment level.
  */
  attached?: EditorStep[]
  /** true when authored attachments differ from the source node. */
  attachedEdited?: boolean
  /** how many times this rotation action emits its skill */
  multiplier: number
  /** off-tune starts counting again on this feature after a tune break */
  offTuneResume?: boolean
  /** per-run damage, keyed by loop run. steps outside a loop use run 1 */
  damageByRun: ByRun<number>
  /** non-critical and critical outcomes from the same evaluated skill rows */
  normalDamageByRun?: ByRun<number>
  critDamageByRun?: ByRun<number>
  /** true when this step's damage is keyed by the loop run being viewed */
  loopScoped?: boolean
  /** the stat line the engine resolved for this skill, per run */
  statsByRun: ByRun<StatLine>
  /** the rotation action count actually used per run, once overrides are applied */
  multiplierByRun?: ByRun<number>
  /** exact engine multiplier per run, including a parent attachment multiplier */
  effectiveMultiplierByRun?: ByRun<number>
  multiplierEdited?: boolean

  changesEdited?: boolean
  memberId: MemberId
  /** damage category and talent-tree branch resolved from the evaluated skill */
  skillTypeLabel?: string
  talentNodeLabel?: string
  kindLabel: string
  buffCount: number
}

export interface EditorCondition extends EditorNodeBase {
  type: 'condition'
  /** the runtime path written, which is how a state's history is looked up */
  path?: string
  /** where the state comes from. every condition has one, and it filters by it. */
  sourceName?: string
  /** semantic effect/passive identity, separate from the authored control label */
  effectName?: string
  /**
   * source definition for this write. keeping it with the projected condition
   * allows every editing path to apply the same value and action rules.
   */
  state?: SourceState
  description?: string
  descriptionParams?: Array<string | number>
  /** a condition switched off stays in the rotation but writes nothing */
  disabled?: boolean
  /** the value this state held before the write, when the engine could read it */
  from?: string
  /** the value this write sets */
  to: string
  /** the authored value on the rotation node; separate from simulated state after the write */
  writeValue?: RuntimeValue
  /** whether the authored numeric write replaces or increments its state */
  writeAction?: ConditionWriteAction
  /** true when the authored base write differs from the source node. */
  writeEdited?: boolean
  /** a value that rose, or a state that came on */
  rising: boolean
  /** further writes folded into this node, beyond the one named */
  extra?: number
  /** canonical authored write represented by this condition. */
  change?: RtChng
  /** what this condition wrote on each run, where the runs differ */
  byRun?: ByRun<{
    from?: string
    to: string
    writeValue?: RuntimeValue
    writeAction?: ConditionWriteAction
    rising: boolean
  }>
  /** no-op/dead evidence for individual passes of the nearest loop */
  gateByRun?: ByRun<NodeGate>
  /**
   * the raw value stored before this write. present only when the node writes
   * one path and every execution read the same prior value. cleanup reads it
   * to decide whether the write can move past rows that undo it locally.
   */
  prior?: { value: RuntimeValue }
  /** the same prior value for each pass of the nearest loop */
  priorByRun?: ByRun<{ value: RuntimeValue }>
}

export interface EditorHandoff {
  type: 'swap'
  id: string
  from: MemberId
  to: MemberId
  /** a handoff switched off stays in the rotation but hands nothing over */
  disabled?: boolean
  gate?: NodeGate

  toEdited?: boolean

  byRun?: ByRun<{ from: MemberId; to: MemberId }>
  /** no-op/dead evidence for individual passes of the nearest loop */
  gateByRun?: ByRun<NodeGate>
  sourceNode?: Extract<RotationNode, { type: 'condition' }>
  attachedNote?: EditorNote
  noteEdited?: boolean
}

export interface EditorBlock extends EditorNodeBase {
  /**
   * `setup` is the branch of an uptime block that runs in full to open the
   * window. model it as a block with the usual folding, stacking, and drop
   * behavior.
   */
  type: 'loop' | 'repeat' | 'uptime' | 'setup'
  /** persisted loop identity; local-only loops use their node id */
  loopId?: string
  /**
   * independent loop markers can cross list and block boundaries. one authored
   * loop is therefore projected as linked segments: `tail` marks the start,
   * `middle` continues the scope, and `head` marks the end.
   *
   * a bounded loop needs no segment tag because it emits both markers.
   */
  wrap?: 'head' | 'middle' | 'tail'
  /** identity of the segment containing the loop start boundary. */
  wrapOf?: string
  /**
   * boundary role for a loop whose markers were positioned independently.
   * unlike a regular nested loop block, this scope can continue through and
   * out of another block before a later segment closes it.
   */
  loopSegment?: 'both' | 'start' | 'middle' | 'end'
  runs: number
  /** share of the time an uptime window is actually up, 0 to 1 */
  ratio?: number
  /** the count and share actually used per run, once overrides are applied */
  runsByRun?: ByRun<number>
  ratioByRun?: ByRun<number>
  valueEdited?: boolean
  /** engine-derived totals that take precedence over child aggregation. */
  totals?: { normal: number; crit: number; avg: number }
  /** pass damage for loop blocks, keyed by the loop's own run number */
  damageByRun?: ByRun<number>
  /** a block switched off stays in the rotation but nothing inside it runs */
  disabled?: boolean
  /** the paired marker retained for exact loop round trips */
  sourceEndNode?: Extract<RotationNode, { type: 'loop'; kind: 'end' }>

  noEnd?: boolean
  color?: string
  colorEdited?: boolean
  /** true when the authored label differs from its projected default. */
  labelEdited?: boolean
  /**
   * initial body before the first divergent run (lazy cow template). `children`
   * is the pass currently checked out; transition bodies live in `passForks`.
   */
  passTemplate?: EditorNode[]
  /** bodies inherited from each divergent run forward (1-based keys). */
  passForks?: Record<number, EditorNode[]>
  /** which run `children` currently represents. */
  checkedOutRun?: number
  nodeCount: number
  children: EditorNode[]
}

export type EditorNode = EditorNote | EditorStep | EditorCondition | EditorHandoff | EditorBlock

export function editorNodeLabel(node: EditorNode): string {
  if (node.type === 'swap') return 'Switch resonator'
  if (node.type === 'note') return node.label?.trim() || 'Note'
  return node.label
}

type EditorNoteHost = Exclude<EditorNode, EditorNote>

export function isEditorNoteHost(node: EditorNode): node is EditorNoteHost {
  return node.type !== 'note' && node.type !== 'setup'
}

export function isEditorBlock(node: EditorNode): node is EditorBlock {
  return (
    node.type === 'loop' ||
    node.type === 'repeat' ||
    node.type === 'uptime' ||
    node.type === 'setup'
  )
}

export interface EditorSection {
  id: string
  title: string
  meta: string
  total?: number
  generated?: boolean
  children: EditorNode[]
}

export type LoopRunSelections = Readonly<Record<string, number>>

interface EditorSectionScope {
  kind: 'section'
  sectionId: string
  sectionLabel: string
}

interface EditorLoopScope {
  kind: 'loop'
  sectionId: string
  sectionLabel: string
  loopId: string
  loopLabel: string
  run: number
  runs: number
}

/** exact section or loop pass in which a projected node executes. */
export type EditorExecutionScope = EditorSectionScope | EditorLoopScope

export interface BuffLine {
  id: string

  name: string
  icon: string
  /**
   * trusted markup emitted by the state-summary builder. consumers must not
   * escape it a second time.
   */
  effects: string[]
}
