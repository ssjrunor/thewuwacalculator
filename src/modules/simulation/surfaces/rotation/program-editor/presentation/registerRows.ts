/*
  Author: Runor Ewhro
  description: defines register column groups and projects execution data into ordered row cells.
*/

import type {
  ByRun,
  EditorBlock,
  EditorNode,
  NodeOwner,
  EditorSection,
  LoopRunSelections,
  StatLine,
  EditorStep,
} from '@/modules/simulation/surfaces/rotation/program-editor/model/program.ts'
import { isEditorBlock } from '@/modules/simulation/surfaces/rotation/program-editor/model/program.ts'
import {
  collectEditorLoopScopeByNode,
  selectedRunForLoopIds,
} from '@/modules/simulation/surfaces/rotation/program-editor/model/executionScope.ts'
import { shortenSkillTabLabel } from '@/modules/simulation/model/skillTabs.ts'
import {
  DEFAULT_ROTATION_EDITOR_STAT_KEYS,
  ROTATION_EDITOR_DAMAGE_DECIMALS,
  ROTATION_EDITOR_REGISTER_GROUPS,
  ROTATION_EDITOR_STAT_KEYS,
  type RotationEditorDamageDecimals,
  type RotationEditorPercentDisplay,
  type RotationEditorRegisterGroup,
  type RotationEditorStatKey,
} from '@/domain/entities/rotationEditorPreferences.ts'
import type { OffTuneTrace } from '@/domain/entities/stats'
import { formatTrunc } from '@/shared/lib/number'

// every value the simulator captured while evaluating an execution entry: basic and global fields are the resolved
// owner snapshot at that execution, and skill-scoped fields such as crit, bonus and enemy modifiers are aggregated
// for the skill itself
export const STAT_KEYS = ROTATION_EDITOR_STAT_KEYS
export type StatKey = RotationEditorStatKey

const TEXT_STAT_KEYS = new Set<StatKey>(['skillType', 'talentNode', 'attribute'])

export function isTextStatKey(key: StatKey): boolean {
  return TEXT_STAT_KEYS.has(key)
}

// the register band a factor belongs to (identity, output, skill, resonator, modifiers, enemy), labelled once in the
// heading row
export type RegisterGroup = RotationEditorRegisterGroup

export const REGISTER_GROUPS: readonly RegisterGroup[] = ROTATION_EDITOR_REGISTER_GROUPS

const GROUP_OF: Record<StatKey, RegisterGroup> = {
  // what the step is
  skillType: 'identity',
  talentNode: 'identity',
  attribute: 'identity',
  offTune: 'skill',

  normal: 'output',
  crit: 'output',
  // the skill's own contribution
  multiplier: 'skill',
  // the caster's snapshot
  atk: 'resonator',
  hp: 'resonator',
  def: 'resonator',
  energyRegen: 'resonator',
  // buffs stacked on the snapshot
  critRate: 'modifiers',
  critDmg: 'modifiers',
  bonus: 'modifiers',
  amplify: 'modifiers',
  tuneBreakBoost: 'modifiers',
  finalDmg: 'modifiers',
  flatDmg: 'modifiers',
  // the target's own factors
  defIgnore: 'enemy',
  defShred: 'enemy',
  resistance: 'enemy',
  dmgVuln: 'enemy',
}

export function statGroup(key: StatKey): RegisterGroup {
  return GROUP_OF[key]
}

export const GROUP_NAMES: Record<RegisterGroup, string> = {
  identity: 'Meta',
  output: 'Output',
  skill: 'Skill',
  resonator: 'Stats',
  modifiers: 'Mod',
  enemy: 'Debuffs',
}

// a band's label when folded to a single track
export const GROUP_SHORT: Record<RegisterGroup, string> = {
  identity: 'META',
  output: 'OUT',
  skill: 'SK',
  resonator: 'STATS',
  modifiers: 'MOD',
  enemy: 'DB',
}

const STAT_REM = 4
const IDENTITY_REM = 5.8
const OFF_TUNE_REM = 6
const GAP_REM = 0.9
// wide enough for the longest name in GROUP_SHORT and its caret
const SHUT_REM = 3
const DAMAGE_REM = 9.4
const CELL_REM = 0.35
const NAME_REM = 20

// the identity tracks hold words: `Res. Liberation` is the longest of both the catalog's short types and the tabs'
// short node names, so the two tracks share a size; `Coordinated Attack` is longer and shows its full text as a title
const IDENTITY_KEYS = new Set<StatKey>(['skillType', 'talentNode', 'attribute'])

function trackRem(key: StatKey): number {
  if (key === 'offTune') return OFF_TUNE_REM
  return IDENTITY_KEYS.has(key) ? IDENTITY_REM : STAT_REM
}

export function groupRem(group: RegisterGroup, keys: readonly StatKey[]): number {
  if (keys.length === 0 && group !== 'output') {
    return 0
  }
  const cells = keys.length + (group === 'output' ? 1 : 0)
  // the fence width is included in the band's width
  return keys.reduce((sum, key) => sum + trackRem(key), 0)
    + (group === 'output' ? DAMAGE_REM : 0)
    + cells * CELL_REM
    + GAP_REM + CELL_REM
}

interface RegisterBand {
  group: RegisterGroup
  keys: readonly StatKey[]
  shut: boolean
  // the average damage is the first column of the output band
  leadsDamage: boolean

  fenced: boolean
}

export interface RegisterLayout {
  bands: readonly RegisterBand[]

  template: string

  tail: string
  // minimum track width; the list scrolls below this threshold
  minWidth: string
  // the same width as a number, for width arithmetic
  widthRem: number
}

const GAP = `${GAP_REM}rem`
const SHUT_TRACK = `${SHUT_REM}rem`
const DAMAGE_TRACK = `${DAMAGE_REM}rem`

// the register's tracks from the columns the page shows; groups with no visible columns are hidden, and the output
// band is always present because the average column cannot be turned off
export function buildRegister(
  statKeys: readonly StatKey[],
  shutGroups: ReadonlySet<RegisterGroup>,
  groupOrder: readonly RegisterGroup[] = REGISTER_GROUPS,
): RegisterLayout {
  const bands: RegisterBand[] = []

  for (const group of groupOrder) {
    const keys = statKeys.filter((key) => GROUP_OF[key] === group)
    const leadsDamage = group === 'output'
    if (keys.length === 0 && !leadsDamage) {
      continue
    }
    bands.push({
      group,
      keys,
      shut: shutGroups.has(group),
      leadsDamage,
      fenced: bands.length > 0,
    })
  }

  const tracks: string[] = []
  // damage column index used to measure the remaining width
  let damageAt = -1
  let widthRem = NAME_REM + CELL_REM

  for (const band of bands) {
    if (band.fenced) {
      tracks.push(GAP)
      widthRem += GAP_REM + CELL_REM
    }
    if (band.shut) {
      tracks.push(SHUT_TRACK)
      widthRem += SHUT_REM + CELL_REM
      continue
    }
    if (band.leadsDamage) {
      damageAt = tracks.length
      tracks.push(DAMAGE_TRACK)
      widthRem += DAMAGE_REM + CELL_REM
    }
    for (const key of band.keys) {
      tracks.push(key === 'offTune'
        ? `${OFF_TUNE_REM}rem`
        : IDENTITY_KEYS.has(key) ? `${IDENTITY_REM}rem` : 'var(--rte-statw)')
      widthRem += trackRem(key) + CELL_REM
    }
  }

  // the 0.35rem gap between cells counts toward the width
  const sum = (parts: string[]) => (parts.length === 0
    ? '0rem'
    : `calc(${parts.join(' + ')} + ${parts.length} * ${CELL_REM}rem)`)

  return {
    bands,
    template: `minmax(0, 1fr) ${tracks.join(' ')}`,
    tail: sum(damageAt < 0 ? tracks : tracks.slice(damageAt + 1)),
    minWidth: `calc(${NAME_REM}rem + ${sum(tracks)} + 1.6rem)`,
    widthRem: Math.round(widthRem * 10) / 10,
  }
}

// how many cells a band draws, for a heading that spans its own tracks
export function bandSpan(band: RegisterBand): number {
  return band.shut ? 1 : band.keys.length + (band.leadsDamage ? 1 : 0)
}

// the initial register is dense; its scroller handles overflow
export const MAX_STAT_KEYS = 12

export const DOCKED_STAT_DROP = 5

export function statCeiling(docked: boolean, compact = false): number {
  return MAX_STAT_KEYS - (docked ? DOCKED_STAT_DROP : 0) - (compact ? 1 : 0)
}

// the columns a rotation opens with
export const DEFAULT_STAT_KEYS: readonly StatKey[] = DEFAULT_ROTATION_EDITOR_STAT_KEYS

// a column's label over a number, cut to fit the track
export const STAT_HEADS: Record<StatKey, string> = {
  normal: 'NORMAL',
  crit: 'CRIT',
  skillType: 'TYPE',
  talentNode: 'NODE',
  attribute: 'ATTR',
  offTune: 'OFF TUNE',
  atk: 'ATK',
  hp: 'HP',
  def: 'DEF',
  critRate: 'CR',
  critDmg: 'CD',
  bonus: 'BNS',
  amplify: 'AMP',
  multiplier: 'MV',
  energyRegen: 'ER',
  defIgnore: '-DEF',
  defShred: 'SHRD',
  resistance: '-RES',
  dmgVuln: 'VULN',
  tuneBreakBoost: 'TBB',
  finalDmg: 'F. DMG',
  flatDmg: 'FLAT',
}

// a column's full label where there is room
export const STAT_NAMES: Record<StatKey, string> = {
  normal: 'Normal damage',
  crit: 'Critical damage',
  skillType: 'Skill type',
  talentNode: 'Talent node',
  attribute: 'Feature attribute',
  offTune: 'Accumulated Off-Tune',
  atk: 'Attack',
  hp: 'HP',
  def: 'Defence',
  critRate: 'Crit rate',
  critDmg: 'Crit damage',
  bonus: 'Damage bonus',
  amplify: 'Amplify',
  multiplier: 'Skill multiplier',
  energyRegen: 'Energy regen',
  defIgnore: 'Def ignore',
  defShred: 'Def shred',
  resistance: 'Res Ignore',
  dmgVuln: 'Damage taken',
  tuneBreakBoost: 'Tune break boost',
  finalDmg: 'Final damage',
  flatDmg: 'Flat damage',
}

// empty row values render as absent columns
export const EMPTY_STATS: StatLine = {
  atk: null,
  hp: null,
  def: null,
  multiplier: null,
  critRate: null,
  critDmg: null,
  bonus: null,
  amplify: null,
  energyRegen: null,
  defIgnore: null,
  defShred: null,
  dmgVuln: null,
  resistance: null,
  tuneBreakBoost: null,
  finalDmg: null,
  flatDmg: null,
  offTune: null,
}

// what a row was evaluated against for one factor, on one pass
export function factorAt(step: EditorStep, run: number, key: StatKey): number | string | null {
  if (key === 'normal') {
    return atRun(step.normalDamageByRun, run, 0)
  }
  if (key === 'crit') {
    return atRun(step.critDamageByRun, run, 0)
  }
  if (key === 'skillType') {
    return step.skillTypeLabel ?? '-'
  }
  if (key === 'talentNode') {
    return step.talentNodeLabel ?? step.kindLabel
  }
  if (key === 'attribute') {
    if (step.aggregationType && step.aggregationType !== 'damage') {
      return '-'
    }
    const attribute = step.element
    return attribute ? `${attribute.charAt(0).toUpperCase()}${attribute.slice(1)}` : '-'
  }
  return atRun(step.statsByRun, run, EMPTY_STATS)[key]
}

// the working behind an entry's off-tune, if the run captured it; the cell shows where the gauge ended, and this is
// what the readout opens
export function offTuneTraceAt(step: EditorStep, run: number): OffTuneTrace | null {
  return atRun(step.statsByRun, run, EMPTY_STATS).offTuneTrace ?? null
}

export interface OffTuneAuthoringState {
  // this authored row is inside the current post-break hold
  sealed: boolean
  // any feature in the segment can become the player's chosen landing
  canResume: boolean
  // the landing currently selected by the player or by the three-row default
  resume: 'mark' | 'default' | null
}

// derive the editable cooldown from the current tree: attached hits inherit their parent's seal but never consume
// another held row, and rows after the current landing stay eligible so the landing can move without a run or a
// context menu
export function offTuneAuthoringStates(
  sections: readonly EditorSection[],
): ReadonlyMap<string, OffTuneAuthoringState> {
  const steps: EditorStep[] = []
  const collect = (nodes: readonly EditorNode[]) => {
    for (const node of nodes) {
      if (node.type === 'step') steps.push(node)
      else if (isEditorBlock(node)) collect(node.children)
    }
  }
  for (const section of sections) collect(section.children)

  const states = new Map<string, OffTuneAuthoringState>()
  const inheritAttachments = (step: EditorStep, sealed: boolean) => {
    for (const child of step.attached ?? []) {
      states.set(child.id, { sealed, canResume: false, resume: null })
    }
  }

  for (let breakAt = 0; breakAt < steps.length; breakAt += 1) {
    if (steps[breakAt]?.kindLabel !== 'tuneBreak') continue
    let end = breakAt + 1
    while (end < steps.length && steps[end]?.kindLabel !== 'tuneBreak') end += 1
    const candidates = steps.slice(breakAt + 1, end)
    const markedAt = candidates.findIndex((step) => step.offTuneResume)
    const landingAt = markedAt >= 0 ? markedAt : 3

    candidates.forEach((step, index) => {
      const sealed = index < landingAt
      const resume = index === landingAt
        ? (markedAt >= 0 ? 'mark' : 'default')
        : null
      states.set(step.id, { sealed, canResume: true, resume })
      inheritAttachments(step, sealed)
    })
    breakAt = end - 1
  }

  return states
}

// which gauge/cooldown state this entry is in, if any
export function offTuneState(
  trace: OffTuneTrace | null,
): 'crest' | 'held' | 'reset' | 'sealed' | null {
  if (!trace) return null
  if (trace.reset) return 'reset'
  if (trace.sealed) return 'sealed'
  if (trace.crest) return 'crest'
  if (trace.held) return 'held'
  return null
}

export function fmtExact(value: number): string {
  if (!Number.isFinite(value)) return '0'
  return Number(value.toPrecision(12)).toLocaleString('en-US', {
    maximumFractionDigits: 12,
  })
}

// read a per-run value; a node outside any loop has only run 1, and a node inside one that never varies has a single
// entry, and both use the fallback
export function atRun<T>(map: ByRun<T> | undefined, run: number, fallback: T): T {
  if (!map) {
    return fallback
  }
  if (map[run] !== undefined) {
    return map[run]
  }
  if (map[1] !== undefined) {
    return map[1]
  }
  const first = Object.values(map)[0]
  return first === undefined ? fallback : first
}

export function stepHasRun(step: EditorStep, run: number): boolean {
  if (step.damageByRun[run] !== undefined) {
    return true
  }

  return !step.loopScoped && step.damageByRun[1] !== undefined
}

export function stepDamageAt(step: EditorStep, run: number): number {
  if (step.damageByRun[run] !== undefined) {
    return step.damageByRun[run]
  }

  return step.loopScoped ? 0 : step.damageByRun[1] ?? 0
}

// flag stat cells that repeat the cell above, so repeats can be faded and change points stand out
export type GhostMap = ReadonlyMap<string, ReadonlySet<StatKey>>

export function computeGhosts(
  sections: EditorSection[],
  selections: LoopRunSelections,
  loopScopeByNodeId: ReadonlyMap<string, readonly string[]> = collectEditorLoopScopeByNode(sections).byNodeId,
): GhostMap {
  const ghosts = new Map<string, ReadonlySet<StatKey>>()
  let previous: EditorStep | null = null
  let previousRun = 1

  const visit = (nodes: EditorNode[]) => {
    for (const node of nodes) {
      if (node.type === 'swap') {
        // a handoff changes the whole stat line, so no value persists across it
        previous = null
        continue
      }

      if (isEditorBlock(node)) {
        visit(node.children)
        continue
      }

      if (node.type !== 'step') {
        continue
      }

      if (node.gate?.kind === 'dead') {
        ghosts.set(node.id, new Set())
        continue
      }

      const run = selectedRunForLoopIds(loopScopeByNodeId.get(node.id) ?? [], selections)
      const prev = previous
      const prevRun = previousRun
      // key flags by factor, because visible column positions can change
      ghosts.set(
        node.id,
        // numbers only: a repeated atk is an unchanged value, while a repeated `Basic Atk` is the step's name
        new Set(STAT_KEYS.filter((key) =>
          !isTextStatKey(key)
          && prev != null
          && factorAt(prev, prevRun, key) === factorAt(node, run, key))),
      )
      previous = node
      previousRun = run
    }
  }

  for (const section of sections) {
    visit(section.children)
  }
  return ghosts
}

// how many consecutive steps one owner takes before anything else acts; only the step that opens a run shows its
// portrait, and every step in the run points back at that head so the run can fold under it
interface RunInfo {
  headId: string
  length: number
}

export type RunMap = ReadonlyMap<string, RunInfo>

function ownerKey(owner: NodeOwner): string {
  return owner.kind === 'echo' ? `echo:${owner.echoId}` : `member:${owner.memberId}`
}

export function computeOwnerRuns(sections: EditorSection[]): RunMap {
  const runs = new Map<string, RunInfo>()

  // each children list is its own passage: a block indents its rows, so a run does not cross the boundary even when
  // the owner is unchanged
  const visit = (nodes: EditorNode[]) => {
    let headId: string | null = null
    let key: string | null = null

    for (const node of nodes) {
      if (isEditorBlock(node)) {
        headId = null
        key = null
        visit(node.children)
        continue
      }

      if (node.type === 'swap') {
        headId = null
        key = null
        continue
      }

      // conditions do not break or count toward action runs
      if (node.type !== 'step') {
        continue
      }

      const nodeKey = ownerKey(node.owner)
      if (headId != null && nodeKey === key) {
        const head = runs.get(headId)
        if (head) {
          head.length += 1
        }
        runs.set(node.id, { headId, length: 0 })
        continue
      }

      headId = node.id
      key = nodeKey
      runs.set(node.id, { headId: node.id, length: 1 })
    }
  }

  visit(sections.flatMap((section) => section.children))

  // members store the head's length too, so one lookup returns both
  for (const [id, info] of runs) {
    if (info.headId !== id) {
      info.length = runs.get(info.headId)?.length ?? 1
    }
  }

  return runs
}

// consecutive conditions written by the same source fold under that source's art, as a run of steps folds under a
// portrait; only sources with art group, because the art is the fold control
export function computeCondRuns(sections: EditorSection[]): RunMap {
  const runs = new Map<string, RunInfo>()

  const visit = (nodes: EditorNode[]) => {
    let headId: string | null = null
    let key: string | null = null

    for (const node of nodes) {
      if (isEditorBlock(node)) {
        headId = null
        key = null
        visit(node.children)
        continue
      }

      const nodeKey = node.type === 'condition' && node.sourceIcon
        ? `${node.sourceIcon}|${node.sourceName ?? ''}`
        : null

      if (!nodeKey) {
        headId = null
        key = null
        continue
      }

      if (headId != null && nodeKey === key) {
        const head = runs.get(headId)
        if (head) {
          head.length += 1
        }
        runs.set(node.id, { headId, length: 0 })
        continue
      }

      headId = node.id
      key = nodeKey
      runs.set(node.id, { headId: node.id, length: 1 })
    }
  }

  visit(sections.flatMap((section) => section.children))

  for (const [id, info] of runs) {
    if (info.headId !== id) {
      info.length = runs.get(info.headId)?.length ?? 1
    }
  }

  return runs
}

interface RowFoldGroup {
  kind: 'conditions' | 'owner'
  headId: string
  tail: EditorNode[]
}

// the compact row group beginning at `index`, if any; the renderer and node navigation both use it, so a programmatic
// reveal opens the same fold that hid the row
export function rowFoldGroupAt(
  nodes: readonly EditorNode[],
  index: number,
  ownerRuns: RunMap,
  condRuns: RunMap,
): RowFoldGroup | null {
  const node = nodes[index]
  if (!node) {
    return null
  }

  const cond = condRuns.get(node.id)
  if (cond?.headId === node.id && cond.length > 1) {
    const tail: EditorNode[] = []
    let cursor = index + 1
    while (cursor < nodes.length && condRuns.get(nodes[cursor].id)?.headId === node.id) {
      tail.push(nodes[cursor])
      cursor += 1
    }
    return tail.length > 0
      ? { kind: 'conditions', headId: node.id, tail }
      : null
  }

  const owner = ownerRuns.get(node.id)
  if (owner?.headId !== node.id || owner.length < 2) {
    return null
  }

  const tail: EditorNode[] = []
  let pending: EditorNode[] = []
  for (let cursor = index + 1; cursor < nodes.length; cursor += 1) {
    const candidate = nodes[cursor]
    if (candidate.type === 'condition') {
      pending.push(candidate)
      continue
    }
    if (ownerRuns.get(candidate.id)?.headId !== node.id) {
      break
    }
    tail.push(...pending, candidate)
    pending = []
  }

  return tail.length > 0
    ? { kind: 'owner', headId: node.id, tail }
    : null
}

// every row hidden beneath a compact owner/source head; block and section folds are structural and resolved by the
// node locator
export function computeRowFoldParents(sections: EditorSection[]): ReadonlyMap<string, string> {
  const ownerRuns = computeOwnerRuns(sections)
  const condRuns = computeCondRuns(sections)
  const parents = new Map<string, string>()

  const visit = (nodes: EditorNode[]) => {
    for (let index = 0; index < nodes.length; index += 1) {
      const node = nodes[index]
      if (isEditorBlock(node)) {
        visit(node.children)
        continue
      }

      const group = rowFoldGroupAt(nodes, index, ownerRuns, condRuns)
      if (!group) {
        continue
      }
      for (const child of group.tail) {
        parents.set(child.id, group.headId)
      }
      index += group.tail.length
    }
  }

  for (const section of sections) {
    visit(section.children)
  }
  return parents
}

// maps each crossing loop segment to its depth below the start segment; document order distinguishes crossing loops
// from loops that wrap to an earlier segment, and the start segment has depth zero so its bracket stays open for the
// continuation
export function computeLoopCrossings(sections: EditorSection[]): ReadonlyMap<string, number> {
  const crossings = new Map<string, number>()
  const startedAt = new Map<string, { depth: number; nodeId: string }>()

  const visit = (nodes: EditorNode[], depth: number) => {
    for (const node of nodes) {
      if (!isEditorBlock(node)) {
        continue
      }
      if (node.type === 'loop') {
        const loopId = node.loopId ?? node.id
        if (node.wrap == null || node.wrap === 'tail') {
          startedAt.set(loopId, { depth, nodeId: node.id })
        } else {
          const start = startedAt.get(loopId)
          if (start && depth > start.depth) {
            crossings.set(node.id, depth - start.depth)
            crossings.set(start.nodeId, 0)
          }
        }
      }
      visit(node.children, depth + 1)
    }
  }

  for (const section of sections) {
    visit(section.children, 0)
  }
  return crossings
}

function holdsLoopSegment(node: EditorNode, loopId: string): boolean {
  if (!isEditorBlock(node)) {
    return false
  }
  return node.children.some((child) =>
    (isEditorBlock(child) && child.type === 'loop' && (child.loopId ?? child.id) === loopId)
    || holdsLoopSegment(child, loopId))
}

export function loopBodyItems(sections: EditorSection[], loopId: string): EditorNode[] {
  const beforeStart: EditorNode[] = []
  const fromStart: EditorNode[] = []
  let started = false

  const visit = (nodes: EditorNode[]) => {
    for (const node of nodes) {
      if (!isEditorBlock(node)) {
        continue
      }
      if (node.type === 'loop' && (node.loopId ?? node.id) === loopId) {
        started = started || node.wrap == null || node.wrap === 'tail'
        ;(started ? fromStart : beforeStart).push(...node.children)
        continue
      }
      if (holdsLoopSegment(node, loopId)) {
        (started ? fromStart : beforeStart).push(node)
        visit(node.children)
      }
    }
  }

  for (const section of sections) {
    visit(section.children)
  }
  return [...fromStart, ...beforeStart]
}

// how many damage steps in a set of rows, at any depth
export function stepCount(nodes: EditorNode[]): number {
  return nodes.reduce(
    (sum, node) => sum + (node.type === 'step' ? 1 : isEditorBlock(node) ? blockSteps(node) : 0),
    0,
  )
}

export function collectSteps(nodes: EditorNode[], out: EditorStep[] = []): EditorStep[] {
  for (const node of nodes) {
    if (node.type === 'step') {
      out.push(node)
    } else if (isEditorBlock(node)) {
      collectSteps(node.children, out)
    }
  }
  return out
}

// the count or share a block used on a given run
export function blockRunsAt(block: EditorBlock, run: number): number {
  return Math.max(1, Math.floor(atRun(block.runsByRun, run, block.runs)))
}

export function blockRatioAt(block: EditorBlock, run: number): number {
  return atRun(block.ratioByRun, run, block.ratio ?? 1)
}

// damage a block contributes on a given run, for its collapsed summary
export function blockTotal(block: EditorBlock, run: number): number {
  if (block.damageByRun?.[run] !== undefined) {
    return block.damageByRun[run]
  }

  if (block.totals) {
    return block.totals.avg
  }

  return collectSteps(block.children).reduce(
    (sum, step) => sum + stepDamageAt(step, run),
    0,
  )
}

// how many damage steps in a block, at any depth
export function blockSteps(block: EditorBlock): number {
  return collectSteps(block.children).length
}

// how precise the rotation's numeric cells may be stated
export const DAMAGE_DECIMALS = ROTATION_EDITOR_DAMAGE_DECIMALS
export type DamageDecimals = RotationEditorDamageDecimals

// how percentage-point stats in the register are stated
export type PercentDisplay = RotationEditorPercentDisplay

// the engine stores a skill multiplier as the formula factor (0.42), while every other multiplicative register stat
// is a percentage point (42); converting here gives every visible stat column one unit
const PERCENT_STAT_KEYS = new Set<StatKey>([
  'multiplier',
  'critRate',
  'critDmg',
  'bonus',
  'amplify',
  'energyRegen',
  'defIgnore',
  'defShred',
  'resistance',
  'dmgVuln',
  'tuneBreakBoost',
  'finalDmg',
])

function fmtFixed(value: number, decimals: number): string {
  if (!Number.isFinite(value)) {
    return '0'
  }

  // truncated to its places, never rounded up
  return formatTrunc(value, Math.min(Math.max(Math.trunc(decimals), 0), 4))
}

export function formatDamage(value: number, decimals: number): string {
  return fmtFixed(value, decimals)
}

// the header shows the unit once, so each row's numeric cells stay compact
export function fmtStatHeading(key: StatKey, display: PercentDisplay): string {
  return `${STAT_HEADS[key]}${display === 'percent' && PERCENT_STAT_KEYS.has(key) ? '%' : ''}`
}

export function shortStat(key: StatKey, value: string): string {
  return key === 'talentNode' ? shortenSkillTabLabel(value) : value
}

export function fmtStat(
  value: number | string | null,
  key: StatKey,
  decimals: number,
  display: PercentDisplay,
): string {
  if (value == null) {
    return '-'
  }

  if (key === 'offTune' && typeof value === 'string') {
    const [current, maximum] = value.split('/').map(Number)
    if (Number.isFinite(current) && Number.isFinite(maximum)) {
      return `${fmtFixed(current!, decimals)}/${fmtFixed(maximum!, decimals)}`
    }
  }

  if (typeof value === 'string') {
    return value
  }

  if (!PERCENT_STAT_KEYS.has(key)) {
    return fmtFixed(value, decimals)
  }

  if (display === 'percent') {
    const percentage = key === 'multiplier' ? value * 100 : value
    return fmtFixed(percentage, decimals)
  }

  const factor = key === 'multiplier' ? value : value / 100
  return fmtFixed(factor, decimals)
}
