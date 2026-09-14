/*
  Author: Runor Ewhro
  Description: Owns register rows behavior and state transitions for the presentation module.
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
} from '@/modules/simulation/features/rotation/program-editor/model/program.ts'
import { isEditorBlock } from '@/modules/simulation/features/rotation/program-editor/model/program.ts'
import {
  collectEditorLoopScopeByNode,
  selectedRunForLoopIds,
} from '@/modules/simulation/features/rotation/program-editor/model/executionScope.ts'
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

/**
 * Every value the simulator captured while evaluating an execution entry.
 *
 * Basic and global fields are the resolved owner snapshot at that execution;
 * skill-scoped fields such as crit, bonus and enemy modifiers are already
 * aggregated for the skill itself.
 */
export const STAT_KEYS = ROTATION_EDITOR_STAT_KEYS
export type StatKey = RotationEditorStatKey

const TEXT_STAT_KEYS = new Set<StatKey>(['skillType', 'talentNode', 'attribute'])

export function isTextStatKey(key: StatKey): boolean {
  return TEXT_STAT_KEYS.has(key)
}

/**
 * Which band of the register a factor belongs to.
 *
 * The list used to hold every column as one uniform track set, which asked the
 * reader to tell a word from an outcome from an input with nothing but the
 * heading to go on. The bands are the taxonomy stated once, at the top, so a
 * cell does not have to carry it.
 */
export type RegisterGroup = RotationEditorRegisterGroup

export const REGISTER_GROUPS: readonly RegisterGroup[] = ROTATION_EDITOR_REGISTER_GROUPS

const GROUP_OF: Record<StatKey, RegisterGroup> = {
  // what the step is, which is not a measurement of anything
  skillType: 'identity',
  talentNode: 'identity',
  attribute: 'identity',

  normal: 'output',
  crit: 'output',
  // the skill's own contribution
  multiplier: 'skill',
  // the caster's snapshot, which barely moves down a resonator's stretch
  atk: 'resonator',
  hp: 'resonator',
  def: 'resonator',
  energyRegen: 'resonator',
  // what was stacked on top of it
  critRate: 'modifiers',
  critDmg: 'modifiers',
  bonus: 'modifiers',
  amplify: 'modifiers',
  tuneBreakBoost: 'modifiers',
  finalDmg: 'modifiers',
  flatDmg: 'modifiers',
  // what the thing being hit did about it
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

/** what a band is called once it is folded down to a single track */
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
const GAP_REM = 0.9
/* wide enough for the longest name in GROUP_SHORT and its caret, and no wider */
const SHUT_REM = 3
const DAMAGE_REM = 9.4
const CELL_REM = 0.35
const NAME_REM = 20

/*
  the identity tracks hold words, not figures. `Res. Liberation` is the longest
  of both the catalog's short types and the tabs' short node names, so the two
  are the same size. only `Coordinated Attack` runs past it, and it keeps the
  full text as its title.
*/
const IDENTITY_KEYS = new Set<StatKey>(['skillType', 'talentNode', 'attribute'])

function trackRem(key: StatKey): number {
  return IDENTITY_KEYS.has(key) ? IDENTITY_REM : STAT_REM
}

export function groupRem(group: RegisterGroup, keys: readonly StatKey[]): number {
  if (keys.length === 0 && group !== 'output') {
    return 0
  }
  const cells = keys.length + (group === 'output' ? 1 : 0)
  // the fence is counted in: it is width the band brings with it
  return keys.reduce((sum, key) => sum + trackRem(key), 0)
    + (group === 'output' ? DAMAGE_REM : 0)
    + cells * CELL_REM
    + GAP_REM + CELL_REM
}

interface RegisterBand {
  group: RegisterGroup
  keys: readonly StatKey[]
  shut: boolean
  /** the average damage rides at the head of the output band */
  leadsDamage: boolean

  fenced: boolean
}

export interface RegisterLayout {
  bands: readonly RegisterBand[]

  template: string

  tail: string
  /** the width below which the list scrolls rather than crushing its tracks */
  minWidth: string
  /** the same width as a number, for anything that has to weigh it */
  widthRem: number
}

const GAP = `${GAP_REM}rem`
const SHUT_TRACK = `${SHUT_REM}rem`
const DAMAGE_TRACK = `${DAMAGE_REM}rem`

/**
 * The register's tracks, worked out from the columns the page is showing.
 *
 * Groups the page has no columns for do not appear at all, so switching every
 * modifier off removes the band rather than leaving an empty heading. The
 * output band always exists: the average is a column the page cannot turn off.
 */
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
  // where the damage column lands, so the tail can be measured from after it
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
      tracks.push(IDENTITY_KEYS.has(key) ? `${IDENTITY_REM}rem` : 'var(--rte-statw)')
      widthRem += trackRem(key) + CELL_REM
    }
  }

  // the 0.35rem between cells counts as much as the cells do
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

/** how many cells a band draws, for a heading that spans its own tracks */
export function bandSpan(band: RegisterBand): number {
  return band.shut ? 1 : band.keys.length + (band.leadsDamage ? 1 : 0)
}

/** the initial register is intentionally dense; its scroller owns overflow */
export const MAX_STAT_KEYS = 12

/**
 * What the register gives up when the side panel is kept open.
 *
 * A docked panel takes its width out of the list rather than floating over it,
 * so the columns have that much less room to stand in. Dropping the ceiling is
 * how the register stays a register instead of becoming a sideways scroll.
 */
export const DOCKED_STAT_DROP = 5

export function statCeiling(docked: boolean): number {
  return docked ? MAX_STAT_KEYS - DOCKED_STAT_DROP : MAX_STAT_KEYS
}

/** the columns a rotation opens with, which is what the list has always shown */
export const DEFAULT_STAT_KEYS: readonly StatKey[] = DEFAULT_ROTATION_EDITOR_STAT_KEYS

/** what a column is called over a number, cut to fit the track */
export const STAT_HEADS: Record<StatKey, string> = {
  normal: 'NORMAL',
  crit: 'CRIT',
  skillType: 'TYPE',
  talentNode: 'NODE',
  attribute: 'ATTR',
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

/** what it is called where there is room to say it */
export const STAT_NAMES: Record<StatKey, string> = {
  normal: 'Normal damage',
  crit: 'Critical damage',
  skillType: 'Skill type',
  talentNode: 'Talent node',
  attribute: 'Feature attribute',
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

/** a row with nothing behind it, so a column reads as absent rather than zero */
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
}

/** What a row was worked out against for one factor, on one pass. */
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

/**
 * Read a per-run value. A node outside any loop only ever has run 1, and a
 * node inside one that never varies has a single entry, so both fall back
 * rather than reading as missing.
 */
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

/**
 * A stat cell repeats far more often than it changes: across a whole
 * resonator stretch only one or two values move. Flagging the repeats lets
 * the repeats can be faded, leaving the change points.
 */
export type GhostMap = ReadonlyMap<string, ReadonlySet<StatKey>>

export function computeGhosts(
  sections: EditorSection[],
  selections: LoopRunSelections,
): GhostMap {
  const ghosts = new Map<string, ReadonlySet<StatKey>>()
  const loopScopeByNodeId = collectEditorLoopScopeByNode(sections).byNodeId
  let previous: EditorStep | null = null
  let previousRun = 1

  const visit = (nodes: EditorNode[]) => {
    for (const node of nodes) {
      if (node.type === 'swap') {
        // a handoff changes the whole stat line, so nothing carries across it
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
      /*
        keyed by factor rather than by position: the page shows the columns it
        was asked for, so a flag read off an index would land on whichever
        factor happened to sit there.
      */
      ghosts.set(
        node.id,
        /*
          numbers only. a repeated ATK is a value that did not move, which is
          worth stepping back from. a repeated `Basic Atk` is just what the
          step is, and fading it says nothing about the row.
        */
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

/**
 * How many steps in a row one owner takes before anything else acts. Only the
 * step that opens a run carries its portrait, so the icon column stops
 * repeating the same face down a stretch, and every step in the run points
 * back at that head so the run can be folded shut under it.
 */
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

  // each children list is its own passage: a block indents its rows, so a run
  // does not reach across the boundary even when the owner is unchanged.
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

      // a condition is an aside, not an action, so it neither breaks a run nor
      // counts toward one
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

  // members carry the head's length too, so a lookup answers both questions
  for (const [id, info] of runs) {
    if (info.headId !== id) {
      info.length = runs.get(info.headId)?.length ?? 1
    }
  }

  return runs
}

/**
 * Consecutive conditions written by the same source, so a stretch of them can
 * fold under that source's art the way a stretch of steps folds under a
 * portrait. Only sources with art group: the art is the control, so without
 * one there is nothing to press.
 */
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

/**
 * The compact row group beginning at `index`, if any. Both the renderer and
 * node navigation use this so a programmatic reveal opens the exact same fold
 * that hid the row.
 */
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

/**
 * Every row hidden beneath a compact owner/source head. Block and section
 * folds are structural and are resolved by the node locator itself.
 */
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

/**
 * How far below its own start each continuation of a crossing loop sits, in
 * block levels.
 *
 * A loop drawn in two pieces is either of two different shapes, and only
 * document order tells them apart. A loop that runs back around reaches its
 * continuation before it reaches its start, because the continuation is the
 * tail of the body sat above the marker. A loop that closes inside a block
 * below it reaches its start first and its continuation after, one or more
 * levels deeper. Only the second is a crossing, and the depth it is caught at
 * is how far left its bracket has to be drawn to stay in the loop's own lane.
 *
 * The segment holding the start is in the map too, at depth zero, because it
 * is the one that has to leave its foot open for the rest of the line.
 */
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

/**
 * Everything a loop runs, in the order it runs it.
 *
 * A loop drawn in more than one piece holds more than its own segment's rows,
 * and the page has to say so: the segment is a drawing, the loop is the thing
 * that runs. Reading it the way the interpreter does gives the order back.
 *
 * Meeting another loop's start is a call, not a boundary. That loop runs to
 * its own end, every pass of it, and then this one carries on from just after
 * the start it met, which is where its next piece begins. So the block appears
 * whole, and the rows it holds that this loop also holds appear again after
 * it, because that is twice that they run.
 *
 * A loop that runs back around to its own start is the same reading taken from
 * the start rather than from the top of the list: the rows above the marker
 * are the last of the body, so they come last.
 */
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

/** how many damage steps a set of rows holds, at any depth */
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

/** the count or share a block actually used on a given run */
export function blockRunsAt(block: EditorBlock, run: number): number {
  return Math.max(1, Math.floor(atRun(block.runsByRun, run, block.runs)))
}

export function blockRatioAt(block: EditorBlock, run: number): number {
  return atRun(block.ratioByRun, run, block.ratio ?? 1)
}

/** damage a block contributes on a given run, for its collapsed summary */
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

/** how many damage steps a block holds, at any depth */
export function blockSteps(block: EditorBlock): number {
  return collectSteps(block.children).length
}

/** how precise the rotation's numeric cells may be stated */
export const DAMAGE_DECIMALS = ROTATION_EDITOR_DAMAGE_DECIMALS
export type DamageDecimals = RotationEditorDamageDecimals

/** How percentage-point stats in the register are stated. */
export type PercentDisplay = RotationEditorPercentDisplay

/*
  The engine stores a skill multiplier as the formula factor (0.42), while
  every other multiplicative register stat is a percentage point (42). Keep
  that storage detail here so every visible stat column can use one unit.
*/
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

  const places = Math.min(Math.max(Math.trunc(decimals), 0), 4)
  return value.toLocaleString('en-US', {
    minimumFractionDigits: places,
    maximumFractionDigits: places,
  })
}

export function formatDamage(value: number, decimals: number): string {
  return fmtFixed(value, decimals)
}

/** The header carries the unit once, leaving each row's numeric cells compact. */
export function fmtStatHeading(key: StatKey, display: PercentDisplay): string {
  return `${STAT_HEADS[key]}${display === 'percent' && PERCENT_STAT_KEYS.has(key) ? '%' : ''}`
}

/**
 * A word cut to its track.
 *
 * Only the talent node needs it: the type column is already stated short by
 * the engine, and a node name spelled out ("Resonance Liberation") is four
 * times the width of the number columns beside it for no more meaning. The
 * cell keeps the long form as its title, so nothing is actually lost.
 */
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
