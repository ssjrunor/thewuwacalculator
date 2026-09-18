/*
  Author: Runor Ewhro
  Description: Executes an authored rotation and projects trace, history,
               nested loop, register, summary, and inspection data for editors.
*/

import type { EnemyProfile } from '@/domain/entities/appState.ts'
import type { ResRuntime } from '@/domain/entities/runtime.ts'
import type { ResSeed } from '@/domain/entities/runtime.ts'
import type {
  FeatDef,
  FeatureResult,
  RotationNode,
  RtChng,
} from '@/domain/gameData/contracts.ts'
import {
  executeRotationProgram,
  prepareRunEnv,
  prepareRotationProgram,
  type ProgramResult,
  type InspectEntry,
} from '@/engine/rotation/execute.ts'
import { prepareResSimulation } from '@/engine/pipeline/index.ts'
import {
  runPrepWorkDetailedProgramTimed,
  type PrepWork,
} from '@/engine/pipeline/preparedWorkspace.ts'
import {
  getLoopAverageDivisor,
  getOtherLoopAverageDivisor,
  indexLoopDamageByRun,
  sumRotTtlsByAggPair,
  sumRotTtlsPair,
} from '@/engine/pipeline/rotationTotals.ts'
import { resolveSkill } from '@/engine/pipeline/resolveSkill.ts'
import type { AttributeKey, SkillDef } from '@/domain/entities/stats.ts'
import { ATTR_COLORS, getAttributeIconSrc } from '@/domain/gameData/attributeDisplay.ts'
import { seedRsntById } from '@/modules/simulation/features/resonator/lib/seedData.ts'
import { getEchoById } from '@/domain/services/echoCatalogService.ts'
import { getWpnById } from '@/domain/services/weaponCatalogService.ts'
import { weaponStatsAt } from '@/modules/simulation/features/weapons/lib/weapon.ts'
import { getSntSetIco } from '@/data/gameData/catalog/sonataSets.ts'
import type { DataSrcRef } from '@/domain/gameData/contracts.ts'
import {
  makeLoopInfo,
  ROT_LOOP_COLORS,
} from '@/modules/simulation/features/rotation/shared/loopMeta.ts'
import {
  findRotWrapLoop,
  type RotWrapLoopPlan,
} from '@/domain/gameData/rotationLoops.ts'
import {
  adjacentFeatures,
  priorFeatures,
  makeConditionChoices,
} from '@/modules/simulation/features/rotation/shared/catalog.ts'
import {
  isCheckoutableLoop,
  seedLoopPassState,
  type EditorPassForks,
} from '@/modules/simulation/features/rotation/program-editor/model/passCheckout.ts'
import type { RotationMember } from '@/modules/simulation/features/rotation/shared/authoringTypes.ts'
import {
  condActionFromChange,
  getCondChoice,
} from '@/modules/simulation/features/rotation/shared/conditions.tsx'
import { getEmbeddedEchoSource } from '@/modules/simulation/features/rotation/shared/featureCatalog.ts'
import { getNegFfctCm, getNegFfctEn } from '@/domain/gameData/negativeEffects.ts'
import {
  attachedConditionChanges,
  normalizeFeatureAttachments,
  stripFeatureAttachments,
} from '@/domain/gameData/rotationAttached.ts'
import { getSkillType } from '@/modules/simulation/model/skillTypes.ts'
import { getSkillTabLabel } from '@/modules/simulation/model/skillTabs.ts'
import type { CondChoice } from '@/modules/simulation/features/rotation/shared/authoringTypes.ts'
import type {
  EditorBlock,
  EditorCondition,
  EditorHandoff,
  EditorMember,
  EditorNote,
  EditorNode,
  EditorExecutionScope,
  NodeGate,
  RotationBreakdown,
  RotationSummary,
  NodeOwner,
  EditorSection,
  StatLine,
  EditorStep,
  SummaryGroup,
  StateWrite,
} from '@/modules/simulation/features/rotation/program-editor/model/program.ts'
import { isEditorBlock } from '@/modules/simulation/features/rotation/program-editor/model/program.ts'
import { splitEditorSections } from '@/modules/simulation/features/rotation/program-editor/model/sections.ts'
import {
  findNode,
  mapLoopBlocks,
  setBlockExtent,
} from '@/modules/simulation/features/rotation/program-editor/model/treeEdit.ts'

import { ACTIVE_RESONATOR_PATH } from '@/domain/gameData/rotationPaths.ts'
import { regDisplayValue } from '@/modules/simulation/features/rotation/program-editor/model/registerValues.ts'
import { writesFromChanges } from '@/modules/simulation/features/rotation/program-editor/model/conditionWrites.ts'
import type {
  FlatRow,
  FlatRowTarget,
  FlatScope,
  FlatWrite,
} from '@/modules/simulation/features/rotation/program-editor/presentation/flatRows.ts'
import { skillDisplayColor } from '@/modules/simulation/features/rotation/shared/skillDisplay.ts'

export function srcAssetIcon(source: DataSrcRef | undefined): string | null {
  if (!source) {
    return null
  }

  if (source.type === 'weapon') {
    return getWpnById(source.id)?.icon ?? `/assets/game/weapons/icons/${source.id}.webp`
  }

  if (source.type === 'echo') {
    return getEchoById(source.id)?.icon ?? `/assets/game/echoes/icons/${source.id}.webp`
  }

  if (source.type === 'echoSet') {
    const setId = Number(source.id)
    return Number.isFinite(setId) ? getSntSetIco(setId) : null
  }

  if (source.type === 'resonator') {
    return seedRsntById[source.id]?.profile ?? null
  }

  // an enemy state has no asset of its own
  return null
}

/** what a row needs to resolve its own state summary, later and on demand */
interface RowSnapshot {
  entry: InspectEntry
  resonatorId: string
  skill: SkillDef
}

/** what a feature can be swapped for, and what it is called once swapped */
interface FeatureBook {
  label: (featureId: string) => string
  previous: Record<string, string | undefined>
  adjacent: Record<string, string | undefined>
}

/** one write to a state, in the order the rotation performs them */
interface WriteRecord {
  nodeId: string
  /** which pass of the enclosing loop performed this write */
  run: number
  /** every enclosing loop pass for this exact execution */
  loopRuns: Readonly<Record<string, number>>
  scope: EditorExecutionScope
  /** unavailable when the interpreter could not read the path before writing */
  from?: string
  to: string
  rising: boolean
  /** what performed the write: the condition's own label, or a step's name */
  by: string
}

export interface RunResult {
  /** wall-clock time when this exact simulation result finished */
  ranAt: number
  sections: EditorSection[]
  /** conditions and features in the exact order this simulation executed them */
  flatRows: FlatRow[]
  /** the rotation as one pass: a loop's passes averaged into a single figure */
  totals: {
    normal: number
    crit: number
    avg: number
  }
  /** the rotation as it ran: every pass of every loop counted */
  fullTotals: {
    normal: number
    crit: number
    avg: number
  }
  summary: RotationSummary
  /** the same summary read with every loop pass counted */
  fullSummary: RotationSummary
  /** every write to each state path, keyed by path, in simulation order */
  history: Map<string, WriteRecord[]>
  members: EditorMember[]
  features: FeatureBook
  /**
   * the inspection row behind each step, keyed `nodeId:run`. resolving a state
   * summary is far too heavy to do for every row, so the page keeps these and
   * resolves only the selected one.
   */
  snapshots: Map<string, RowSnapshot>
  timing: ProgramRunTiming
}

interface LazyFlatProjection {
  inspection: readonly InspectEntry[]
  features: readonly FeatureResult[]
  sections: readonly EditorSection[]
  conditionMeta: ReadonlyMap<string, ConditionHistoryMeta>
}

/* Tree reads are the normal editor path. Retain the exact projection inputs
   without allocating flat rows until the flat surface actually needs them. */
const lazyFlatProjectionByRun = new WeakMap<RunResult, LazyFlatProjection>()
const lazyFlatRowsByRun = new WeakMap<RunResult, FlatRow[]>()

/**
 * Change display metadata without detaching a run from its lazy flat trace.
 * Object spread alone cannot carry WeakMap-owned projection state to the new
 * result identity.
 */
export function withRunMetadata(
  result: RunResult,
  metadata: Partial<Pick<RunResult, 'ranAt' | 'timing'>>,
): RunResult {
  const next = { ...result, ...metadata }
  const projection = lazyFlatProjectionByRun.get(result)
  if (projection) lazyFlatProjectionByRun.set(next, projection)
  const rows = lazyFlatRowsByRun.get(result)
  if (rows) lazyFlatRowsByRun.set(next, rows)
  return next
}

export function getRunFlatRows(result: RunResult | null | undefined): FlatRow[] {
  if (!result) return []
  if (result.flatRows.length > 0) return result.flatRows
  const cached = lazyFlatRowsByRun.get(result)
  if (cached) return cached
  const source = lazyFlatProjectionByRun.get(result)
  if (!source) return result.flatRows
  const rows = buildExactFlatRows(
    source.inspection,
    source.features,
    source.sections,
    source.conditionMeta,
  )
  lazyFlatRowsByRun.set(result, rows)
  return rows
}

/** Canonical phase timing for one invocation of the advanced simulation. */
export interface ProgramRunTiming {
  /** section ordering, context/environment construction and program compilation */
  prepareMs: number
  /** execution of the prepared numeric rotation program */
  executeMs: number
  /** exact editor tree, history, flat rows, summaries and registers */
  projectMs: number
  /** the sum of the three phases above */
  totalMs: number
  /** the prepared execution result was reused, so executeMs is zero */
  cacheHit: boolean
}

/** One shared integer readout for every user-visible runtime label. */
export function displayedRunMs(
  result: Pick<RunResult, 'timing'> | null | undefined,
): number {
  return Math.round(result?.timing.totalMs ?? 0)
}

/** project a member onto the record the editor's panels read */
export function memberToReg(member: RotationMember, sharePct: number): EditorMember {
  const build = member.runtime.build
  const weaponId = build.weapon?.id ?? ''
  const weaponDef = weaponId ? getWpnById(weaponId) : null
  const weaponLevel = build.weapon?.level ?? 1
  // Resolve level-scaled weapon stats once for all consumers of this projection.
  const weaponStats = weaponDef ? weaponStatsAt(weaponDef, weaponLevel) : null

  return {
    id: member.id,
    name: member.name,
    role: '',
    attribute: member.attribute,
    profile: member.profile,
    weapon: {
      id: weaponId,
      name: weaponDef?.name ?? '',
      icon: weaponDef?.icon ?? '',
      rank: build.weapon?.rank ?? 1,
      level: weaponLevel,
      baseAtk: build.weapon?.baseAtk ?? 0,
      rarity: weaponDef?.rarity ?? 0,
      statKey: weaponDef?.statKey ?? '',
      atk: weaponStats?.atk ?? 0,
      statValue: weaponStats?.scndStatVl ?? 0,
    },
    level: member.runtime.base.level,
    sequence: member.runtime.base.sequence,
    skillLevels: '',
    /* the worn loadout, slot for slot. a teammate's level and weapon level are
       materialized at max rather than stored, so those two read max for
       everyone but the active resonator. */
    echoes: build.echoes.map((echo) => {
      if (!echo) return null
      const def = getEchoById(echo.id)
      return {
        id: echo.id,
        name: def?.name ?? '',
        icon: def?.icon ?? '',
        cost: def?.cost ?? 0,
        mainEcho: echo.mainEcho,
        mainStat: echo.mainStats.primary.key,
        setId: echo.set,
      }
    }),
    sharePct,
    seedName: seedRsntById[member.id]?.name ?? member.name,
  }
}

interface WalkSection {
  id: string
  label: string
}

interface ConditionHistoryMeta {
  path: string
  label: string
  effectName?: string
  loopId: string | null
  section: WalkSection
  owner?: NodeOwner
  sourceIcon?: string
}

interface WalkCtx {
  /** every inspection row for a node id, one per loop-run context */
  entriesByNode: Map<string, InspectEntry[]>
  /** every emitted feature row, used for engine-effective multipliers */
  featureEntriesByNode: Map<string, FeatureResult[]>
  members: Map<string, RotationMember>
  runtimesById: Record<string, ResRuntime>
  snapshots: Map<string, RowSnapshot>
  /** every state the team can write, for naming what a step's writes touch */
  condChoices: CondChoice[]
  /** display metadata needed to project the ordered engine history */
  conditionHistoryByNode: Map<string, ConditionHistoryMeta>
  activeId: string
  loopId: string | null
  section: WalkSection
  /**
   * label and colour per loop, resolved the way the rotation pane resolves
   * them: an unnamed loop is generated a distinct name rather than every one
   * of them reading "Loop".
  */
  loopMeta: Map<string, {
    label: string
    color: string
    totals: { normal: number; crit: number; avg: number }
    damageByRun: Record<number, number>
  }>
  loopRunsById: Map<string, number>
}

function runOf(
  entry: { loopRuns?: Record<string, number> },
  loopId: string | null,
): number {
  return loopId ? entry.loopRuns?.[loopId] ?? 1 : 1
}

function scopeOf(
  ctx: Pick<WalkCtx, 'loopMeta' | 'loopRunsById'>,
  section: WalkSection,
  loopRuns: Readonly<Record<string, number>>,
): EditorExecutionScope {
  /*
    An inspection entry can revisit a textually nested node after its nearest
    visual loop has returned. Its last active engine loop is therefore the
    execution scope, independent of where the authored node is drawn.
  */
  const loopId = Object.keys(loopRuns).at(-1) ?? null
  if (!loopId) {
    return {
      kind: 'section',
      sectionId: section.id,
      sectionLabel: section.label,
    }
  }

  return {
    kind: 'loop',
    sectionId: section.id,
    sectionLabel: section.label,
    loopId,
    loopLabel: ctx.loopMeta.get(loopId)?.label ?? 'Loop',
    run: loopRuns[loopId] ?? 1,
    runs: ctx.loopRunsById.get(loopId) ?? 1,
  }
}

function rose(from: string | undefined, to: string): boolean {
  return from !== undefined && (
    to === 'on'
    || (from !== '' && to !== '' && Number(to) > Number(from))
  )
}

function buildConditionHistory(
  entries: InspectEntry[],
  ctx: WalkCtx,
): Map<string, WriteRecord[]> {
  const history = new Map<string, WriteRecord[]>()

  /*
    The interpreter records a pre-write value only when it can read the path.
    Do not reconstruct one from neighboring entries: that would skip writes
    performed by another node kind and fabricate a state for unknown paths.
  */
  for (const entry of entries) {
    if (!entry.executed || entry.value?.kind !== 'condition') {
      continue
    }

    const meta = ctx.conditionHistoryByNode.get(entry.nodeId)
    if (!meta) {
      continue
    }

    const path = entry.value.path || meta.path
    const from = entry.value.before === undefined
      ? undefined
      : regDisplayValue(entry.value.before)
    const to = regDisplayValue(entry.value.value)
    const loopRuns = { ...(entry.loopRuns ?? {}) }

    const write: WriteRecord = {
      nodeId: entry.nodeId,
      run: runOf(entry, meta.loopId),
      loopRuns,
      scope: scopeOf(ctx, meta.section, loopRuns),
      ...(from !== undefined ? { from } : {}),
      to,
      rising: rose(from, to),
      by: meta.label,
    }
    const writes = history.get(path)
    if (writes) {
      writes.push(write)
    } else {
      history.set(path, [write])
    }
  }

  return history
}

function hydrateConditionHistory(
  sections: EditorSection[],
  history: Map<string, WriteRecord[]>,
) {
  const writesByNode = new Map<string, WriteRecord[]>()
  for (const writes of history.values()) {
    for (const write of writes) {
      const nodeWrites = writesByNode.get(write.nodeId)
      if (nodeWrites) {
        nodeWrites.push(write)
      } else {
        writesByNode.set(write.nodeId, [write])
      }
    }
  }

  const hydrate = (nodes: EditorNode[]) => {
    for (const node of nodes) {
      if (
        node.type === 'loop'
        || node.type === 'repeat'
        || node.type === 'uptime'
        || node.type === 'setup'
      ) {
        hydrate(node.children)
        continue
      }
      if (node.type === 'swap') {
        const swapWrites = writesByNode.get(node.id)
        if (!swapWrites || swapWrites.length === 0) {
          continue
        }

        const byRun: NonNullable<EditorHandoff['byRun']> = {}
        for (const write of swapWrites) {
          if (write.from === undefined) {
            continue
          }
          byRun[write.run] = {
            from: write.from as EditorHandoff['from'],
            to: write.to as EditorHandoff['to'],
          }
        }
        node.byRun = Object.keys(byRun).length > 0 ? byRun : undefined
        continue
      }
      if (node.type !== 'condition') {
        continue
      }

      const writes = writesByNode.get(node.id)
      if (!writes || writes.length === 0) {
        continue
      }

      const existingByRun = node.byRun
      const byRun: NonNullable<EditorCondition['byRun']> = {}
      for (const write of writes) {
        byRun[write.run] = {
          ...(write.from !== undefined ? { from: write.from } : {}),
          to: write.to,
          writeValue: existingByRun?.[write.run]?.writeValue ?? node.writeValue,
          rising: write.rising,
        }
      }

      const first = writes[0]
      if (first.from !== undefined) {
        node.from = first.from
      } else {
        delete node.from
      }
      node.to = first.to
      node.rising = first.rising
      node.byRun = Object.keys(byRun).length > 1 ? byRun : undefined
    }
  }

  for (const section of sections) {
    hydrate(section.children)
  }
}

type SummaryTotals = Pick<SummaryGroup, 'normal' | 'crit' | 'avg' | 'count'>

interface SummaryBreakdownMaps {
  skillTypes: Map<string, SummaryGroup>
  talentNodes: Map<string, SummaryGroup>
  attributes: Map<string, SummaryGroup>
}

interface SummaryBreakdownDescriptor {
  skillTypeId: string
  skillTypeLabel: string
  skillTypeIcon?: string
  talentNodeId: string
  talentNodeLabel: string
  attribute: AttributeKey
  attributeIcon?: string
  attributeColor: string
}

function makeSummaryBreakdownMaps(): SummaryBreakdownMaps {
  return {
    skillTypes: new Map(),
    talentNodes: new Map(),
    attributes: new Map(),
  }
}

function addSummaryGroup(
  groups: Map<string, SummaryGroup>,
  id: string,
  label: string,
  amount: Omit<SummaryTotals, 'count'>,
  media: Pick<SummaryGroup, 'icon' | 'iconKind' | 'color'> = {},
) {
  const group = groups.get(id)
  if (group) {
    group.normal += amount.normal
    group.crit += amount.crit
    group.avg += amount.avg
    group.count += 1
    return
  }

  groups.set(id, {
    id,
    label,
    normal: amount.normal,
    crit: amount.crit,
    avg: amount.avg,
    count: 1,
    sharePct: 0,
    ...media,
  })
}

function addSummaryBreakdown(
  groups: SummaryBreakdownMaps,
  amount: Omit<SummaryTotals, 'count'>,
  descriptor: SummaryBreakdownDescriptor,
) {
  addSummaryGroup(
    groups.skillTypes,
    descriptor.skillTypeId,
    descriptor.skillTypeLabel,
    amount,
    { icon: descriptor.skillTypeIcon, iconKind: 'glyph' },
  )
  addSummaryGroup(
    groups.talentNodes,
    descriptor.talentNodeId,
    descriptor.talentNodeLabel,
    amount,
  )
  addSummaryGroup(
    groups.attributes,
    descriptor.attribute,
    attrLabel(descriptor.attribute),
    amount,
    {
      icon: descriptor.attributeIcon,
      iconKind: 'glyph',
      color: descriptor.attributeColor,
    },
  )
}

function finalizeSummaryGroups(
  groups: Map<string, SummaryGroup>,
  totalAvg: number,
): SummaryGroup[] {
  return [...groups.values()]
    .map((group) => ({
      ...group,
      sharePct: totalAvg > 0 ? (group.avg / totalAvg) * 100 : 0,
    }))
    .sort((left, right) => right.avg - left.avg)
}

function finalizeSummaryBreakdown(
  groups: SummaryBreakdownMaps,
  totalAvg: number,
): RotationBreakdown {
  return {
    skillTypes: finalizeSummaryGroups(groups.skillTypes, totalAvg),
    talentNodes: finalizeSummaryGroups(groups.talentNodes, totalAvg),
    attributes: finalizeSummaryGroups(groups.attributes, totalAvg),
  }
}

function collectRotationNodes(
  items: RotationNode[],
  out = new Map<string, RotationNode>(),
  includeFeatureAttachments = true,
): Map<string, RotationNode> {
  for (const item of items) {
    out.set(item.id, item)
    if (item.type === 'repeat') {
      collectRotationNodes(item.items, out)
    } else if (item.type === 'uptime') {
      collectRotationNodes(item.setup ?? [], out)
      collectRotationNodes(item.items, out)
    } else if (item.type === 'feature') {
      /*
        a carried feature deals its own damage under its own node id, so the
        summary has to be able to find it by that id or its rows are counted in
        the total and credited to nobody.
      */
      collectRotationNodes(item.attached?.conditions ?? [], out)
      if (includeFeatureAttachments) {
        // The interpreter accepts one direct feature-attachment level. Index
        // those child hits, but do not give malformed nested data a second
        // display-only execution model.
        collectRotationNodes(item.attached?.features ?? [], out, false)
      }
    }
  }
  return out
}

function attrLabel(attr: AttributeKey): string {
  return attr.charAt(0).toUpperCase() + attr.slice(1)
}

interface RotationSummaryInput {
  entries: InspectEntry[]
  /** canonical engine damage rows, including catalog-generated follow-ups */
  damageEntries?: FeatureResult[]
  items: RotationNode[]
  members: RotationMember[]
  runtime: ResRuntime
}

interface SummaryDamageRow {
  resonatorId: string
  resonatorName?: string
  feature?: FeatDef
  skill?: SkillDef | null
  normal: number
  crit: number
  avg: number
  loopRunCounts?: Record<string, number>
}

interface PreparedRotationSummary {
  memberById: Map<string, RotationMember>
  runtimeId: string
  damageRows: SummaryDamageRow[]
  counts: RotationSummary['counts']
}

interface RotationSummaryAccumulator {
  resonators: Map<string, SummaryGroup>
  breakdown: SummaryBreakdownMaps
  breakdownByResonator: Map<string, SummaryBreakdownMaps>
}

function prepareRotationSummary({
  entries,
  damageEntries,
  items,
  members,
  runtime,
}: RotationSummaryInput): PreparedRotationSummary {
  const nodes = collectRotationNodes(items)
  const memberById = new Map(members.map((member) => [member.id, member]))
  const runtimesById = Object.fromEntries(members.map((member) => [member.id, member.runtime]))
  let conditions = 0
  let loops = 0
  let repeats = 0
  let uptimes = 0
  const fired = new Set<string>()
  const gated = new Set<string>()

  for (const entry of entries) {
    if (!entry.executed) {
      if (entry.nodeType === 'feature') gated.add(entry.nodeId)
      continue
    }
    if (entry.nodeType === 'feature') fired.add(entry.nodeId)
    if (entry.value?.kind === 'condition') conditions += 1
    else if (entry.value?.kind === 'loop') loops += 1
    else if (entry.value?.kind === 'repeat') repeats += 1
    else if (entry.value?.kind === 'uptime') uptimes += 1
  }

  const damageRows: SummaryDamageRow[] = damageEntries
    ? damageEntries.filter((entry) => entry.aggregationType === 'damage')
    : entries.flatMap((entry): SummaryDamageRow[] => {
      if (!entry.executed || entry.value?.kind !== 'feature' || entry.value.ggrgType !== 'damage') {
        return []
      }
      const node = nodes.get(entry.nodeId)
      if (node?.type !== 'feature') return []
      const ownerId = entry.value.resonatorId
        ?? node.resonatorId
        ?? entry.activeResonatorId
        ?? runtime.id
      const member = memberById.get(ownerId) ?? memberById.get(runtime.id)
      const feature = member?.features.find((candidate) => candidate.id === node.featureId)
      const rawSkill = feature && member
        ? member.skills.find((candidate) => candidate.id === feature.skillId)
        : undefined
      const skill = rawSkill && member
        ? resolveSkill(member.runtime, rawSkill, undefined, runtimesById)
        : null
      return [{
        resonatorId: ownerId,
        resonatorName: member?.name ?? feature?.label ?? ownerId,
        feature,
        skill,
        normal: entry.value.normal,
        crit: entry.value.crit,
        avg: entry.value.avg,
        loopRunCounts: entry.loopRunCnts,
      }]
    })

  let neverFired = 0
  for (const nodeId of gated) {
    if (fired.has(nodeId)) continue
    const node = nodes.get(nodeId)
    if (node && 'enabled' in node && node.enabled === false) continue
    neverFired += 1
  }

  return {
    memberById,
    runtimeId: runtime.id,
    damageRows,
    counts: {
      entries: entries.length,
      damage: damageRows.length,
      conditions,
      neverFired,
      loops,
      repeats,
      uptimes,
    },
  }
}

function makeRotationSummaryAccumulator(): RotationSummaryAccumulator {
  return {
    resonators: new Map(),
    breakdown: makeSummaryBreakdownMaps(),
    breakdownByResonator: new Map(),
  }
}

function addRotationSummaryAmount(
  accumulator: RotationSummaryAccumulator,
  row: SummaryDamageRow,
  member: RotationMember | undefined,
  descriptor: SummaryBreakdownDescriptor,
  amount: Omit<SummaryTotals, 'count'>,
): void {
  const ownerId = row.resonatorId
  addSummaryGroup(
    accumulator.resonators,
    ownerId,
    member?.name ?? row.resonatorName ?? row.feature?.label ?? ownerId,
    amount,
    {
      icon: member?.profile,
      iconKind: 'portrait',
      color: member ? ATTR_COLORS[member.attribute] : undefined,
    },
  )
  addSummaryBreakdown(accumulator.breakdown, amount, descriptor)

  let ownerBreakdown = accumulator.breakdownByResonator.get(ownerId)
  if (!ownerBreakdown) {
    ownerBreakdown = makeSummaryBreakdownMaps()
    accumulator.breakdownByResonator.set(ownerId, ownerBreakdown)
  }
  addSummaryBreakdown(ownerBreakdown, amount, descriptor)
}

function finalizeRotationSummary(
  prepared: PreparedRotationSummary,
  accumulator: RotationSummaryAccumulator,
  totals: RotationSummary['total'],
  supportTotals: RotationSummary['supportTotals'],
): RotationSummary {
  const byResonator = Object.fromEntries(
    [...accumulator.breakdownByResonator.entries()].map(([ownerId, groups]) => [
      ownerId,
      finalizeSummaryBreakdown(groups, accumulator.resonators.get(ownerId)?.avg ?? 0),
    ]),
  )

  return {
    total: { ...totals },
    supportTotals: { ...supportTotals },
    counts: { ...prepared.counts },
    averageDamage: prepared.counts.damage > 0 ? totals.avg / prepared.counts.damage : 0,
    resonators: finalizeSummaryGroups(accumulator.resonators, totals.avg),
    ...finalizeSummaryBreakdown(accumulator.breakdown, totals.avg),
    byResonator,
  }
}

function addPreparedDamageRow(
  prepared: PreparedRotationSummary,
  accumulator: RotationSummaryAccumulator,
  row: SummaryDamageRow,
  normalizeLoops: boolean,
): void {
  const member = prepared.memberById.get(row.resonatorId)
    ?? prepared.memberById.get(prepared.runtimeId)
  const skill = row.skill
  const skillType = getSkillType(skill?.skillType)
  const skillTypeId = skill?.skillType[0] ?? 'feature'
  const tabId = skill?.tab ?? 'feature'
  const attr = skill?.element ?? member?.attribute ?? 'physical'
  const descriptor: SummaryBreakdownDescriptor = {
    skillTypeId,
    skillTypeLabel: skillType.short ?? skillType.label,
    skillTypeIcon: skillType.icon,
    talentNodeId: tabId,
    talentNodeLabel: skill ? getSkillTabLabel(skill.tab) : 'Feature',
    attribute: attr,
    attributeIcon: getAttributeIconSrc(attr) ?? undefined,
    attributeColor: ATTR_COLORS[attr],
  }
  const divisor = normalizeLoops ? getLoopAverageDivisor(row.loopRunCounts) : 1
  addRotationSummaryAmount(accumulator, row, member, descriptor, {
    normal: row.normal / divisor,
    crit: row.crit / divisor,
    avg: row.avg / divisor,
  })
}

export function buildRotationSummary({
  totals,
  supportTotals = { healing: 0, shield: 0 },
  normalizeLoops = true,
  ...input
}: RotationSummaryInput & {
  totals: RotationSummary['total']
  supportTotals?: RotationSummary['supportTotals']
  /** false counts every loop pass, so the groups add up to the full figure */
  normalizeLoops?: boolean
}): RotationSummary {
  const prepared = prepareRotationSummary(input)
  const accumulator = makeRotationSummaryAccumulator()
  for (const row of prepared.damageRows) {
    addPreparedDamageRow(prepared, accumulator, row, normalizeLoops)
  }
  return finalizeRotationSummary(prepared, accumulator, totals, supportTotals)
}

function buildRotationSummaryPair(
  input: RotationSummaryInput,
  totals: RotationSummary['total'],
  fullTotals: RotationSummary['total'],
  supportTotals: RotationSummary['supportTotals'],
  fullSupportTotals: RotationSummary['supportTotals'],
): { summary: RotationSummary; fullSummary: RotationSummary } {
  const prepared = prepareRotationSummary(input)
  const normalized = makeRotationSummaryAccumulator()
  const full = makeRotationSummaryAccumulator()
  for (const row of prepared.damageRows) {
    addPreparedDamageRow(prepared, normalized, row, true)
    addPreparedDamageRow(prepared, full, row, false)
  }
  return {
    summary: finalizeRotationSummary(prepared, normalized, totals, supportTotals),
    fullSummary: finalizeRotationSummary(prepared, full, fullTotals, fullSupportTotals),
  }
}

function ownerOf(resonatorId: string): NodeOwner {
  return { kind: 'member', memberId: resonatorId as EditorMember['id'] }
}

function buildNote(node: Extract<RotationNode, { type: 'note' }>): EditorNote {
  return {
    type: 'note',
    id: node.id,
    label: node.label,
    color: node.color,
    text: node.text,
    sourceNode: node,
  }
}

function attachedNoteFrom(node: RotationNode): { attachedNote?: EditorNote } {
  return 'note' in node && node.note
    ? { attachedNote: buildNote(node.note) }
    : {}
}

/* the count a repeat used, or the share an uptime was up for, on each run */
function readBlockValues(
  ctx: WalkCtx,
  nodeId: string,
  kind: 'repeat' | 'uptime',
): Record<number, number> | undefined {
  const out: Record<number, number> = {}
  for (const row of ctx.entriesByNode.get(nodeId) ?? []) {
    if (!row.executed) {
      continue
    }
    if (kind === 'repeat' && row.value?.kind === 'repeat') {
      out[runOf(row, ctx.loopId)] = row.value.times
    } else if (kind === 'uptime' && row.value?.kind === 'uptime') {
      out[runOf(row, ctx.loopId)] = row.value.ratio
    }
  }
  return Object.keys(out).length > 0 ? out : undefined
}

function registerConditionHistoryMeta(
  node: Extract<RotationNode, { type: 'condition' }>,
  ctx: WalkCtx,
  fallbackOwner = ctx.activeId,
): void {
  const first = node.changes[0]
  if (!first) return
  const owner = node.resonatorId ?? first.resonatorId ?? fallbackOwner
  const choice = getCondChoice(ctx.condChoices, first, owner)
  const to = String(first.value ?? '')
  const handoffName = first.path === ACTIVE_RESONATOR_PATH
    ? choice?.state.options?.find((option) => option.id === to)?.label
    : undefined
  ctx.conditionHistoryByNode.set(node.id, {
    path: first.path,
    label: node.label
      ?? handoffName
      ?? choice?.label
      ?? first.path.split('.').pop()
      ?? 'State',
    effectName: choice?.effectName,
    loopId: ctx.loopId,
    section: { ...ctx.section },
    owner: ownerOf(owner),
    sourceIcon: srcAssetIcon(choice?.state.source) ?? undefined,
  })
}

function buildStep(
  node: Extract<RotationNode, { type: 'feature' }>,
  ctx: WalkCtx,
  index: number,
  asAttachment = false,
): EditorStep | null {
  const rows = ctx.entriesByNode.get(node.id) ?? []
  const featureMember = [...ctx.members.values()].find((member) =>
    member.features.some((entry) => entry.id === node.featureId))
  const owner = node.resonatorId
    ?? featureMember?.id
    ?? rows.find((row) => row.activeResonatorId)?.activeResonatorId
    ?? ctx.activeId
  const normalizedNode = asAttachment ? stripFeatureAttachments(node) : normalizeFeatureAttachments(node)
  for (const attachedCondition of normalizedNode.attached?.conditions ?? []) {
    if (attachedCondition.type === 'condition') {
      registerConditionHistoryMeta(attachedCondition, ctx, owner)
    }
  }
  const damageByRun: Record<number, number> = {}
  const normalDamageByRun: Record<number, number> = {}
  const critDamageByRun: Record<number, number> = {}
  let anyRan = false

  const statsByRun: Record<number, StatLine> = {}
  const multiplierByRun: Record<number, number> = {}
  const effectiveMultiplierByRun: Record<number, number> = {}
  const writesByRun: Record<number, StateWrite[]> = {}
  const attachedChangesByRun: Record<number, RtChng[]> = {}
  // The engine deliberately ignores nested child attachments. Keep the page
  // projection on that same one-level contract when malformed older data is
  // encountered.
  const baseChanges = asAttachment ? [] : attachedConditionChanges(node)

  for (const row of rows) {
    const run = runOf(row, ctx.loopId)
    if (!row.executed || row.value?.kind !== 'feature') {
      continue
    }
    anyRan = true
    const divisor = getOtherLoopAverageDivisor(row.loopRunCnts, ctx.loopId)
    damageByRun[run] = (damageByRun[run] ?? 0) + row.value.avg / divisor
    normalDamageByRun[run] = (normalDamageByRun[run] ?? 0) + row.value.normal / divisor
    critDamageByRun[run] = (critDamageByRun[run] ?? 0) + row.value.crit / divisor
    // Effective stats belong to this executed skill and loop pass; use the
    // result snapshot rather than recomputing them from a generic context.
    if (row.value.effectiveStats) {
      statsByRun[run] = row.value.effectiveStats
    }

    multiplierByRun[run] = node.multiplier ?? 1

    const changes = baseChanges.length > 0 ? baseChanges : undefined
    if (changes) {
      attachedChangesByRun[run] = changes
    }
    const writes = writesFromChanges(changes, ctx.condChoices, node.id, owner)
    if (writes) {
      writesByRun[run] = writes
    }
  }

  for (const entry of ctx.featureEntriesByNode.get(node.id) ?? []) {
    effectiveMultiplierByRun[runOf(entry, ctx.loopId)] = entry.multiplier
  }

  const member = ctx.members.get(owner) ?? featureMember
  const feature = member?.features.find((entry) => entry.id === node.featureId)
    ?? featureMember?.features.find((entry) => entry.id === node.featureId)
  const rawSkill = feature && member
    ? member.skills.find((entry) => entry.id === feature.skillId)
    : undefined
  const skill = rawSkill && member
    ? resolveSkill(member.runtime, rawSkill, undefined, ctx.runtimesById)
    : null
  const echoSource = feature?.source.type === 'echo'
    ? feature.source
    : getEmbeddedEchoSource(node.featureId)

  if (skill) {
    for (const row of rows) {
      if (row.runtimeById) {
        ctx.snapshots.set(`${node.id}:${runOf(row, ctx.loopId)}`, {
          entry: row,
          resonatorId: owner,
          skill,
        })
      }
    }
  }

  /*
    a carried feature is a feature: it has its own node id, so its rows are
    found the same way and it builds through this same path. the engine strips
    attachments from a child, so asking for its own would always come back
    empty and the recursion stops at one level regardless.
  */
  const attached = asAttachment ? [] : (node.attached?.features ?? []).flatMap((child, childIndex) => {
    if (child.type !== 'feature') {
      return []
    }
    const step = buildStep(child, ctx, index + childIndex + 1, true)
    return step ? [step] : []
  })

  const isNegEffect = skill?.tab === 'negativeEffect'
  const skillType = getSkillType(skill?.skillType)
  const negCombatKey = getNegFfctCm(skill?.archetype)
  const negFixedStacks = Boolean(
    skill?.stackMode === 'fixedMax'
    || (negCombatKey && member
      ? getNegFfctEn(member.runtime, negCombatKey, ctx.runtimesById)?.stackMode === 'fixedMax'
      : false),
  )

  return {
    type: 'step',
    id: node.id,
    sourceNode: asAttachment ? stripFeatureAttachments(node) : node,
    ...attachedNoteFrom(node),
    owner: echoSource ? { kind: 'echo', echoId: echoSource.id } : ownerOf(owner),
    label: skill?.label ?? feature?.label ?? node.featureId,
    index,
    featureId: node.featureId,
    color: skill ? skillDisplayColor(skill, member?.attribute) : undefined,
    aggregationType: skill?.aggregationType ?? 'damage',
    disabled: node.enabled === false,
    negEffect: isNegEffect,
    negFixedStacks: isNegEffect ? negFixedStacks : undefined,
    negativeEffectInstances: node.negativeEffectInstances,
    negativeEffectStableWidth: node.negativeEffectStableWidth,
    element: skill?.element,
    multiplier: node.multiplier ?? 1,
    damageByRun,
    normalDamageByRun,
    critDamageByRun,
    loopScoped: ctx.loopId != null,
    statsByRun,
    multiplierByRun,
    effectiveMultiplierByRun: Object.keys(effectiveMultiplierByRun).length > 0
      ? effectiveMultiplierByRun
      : undefined,
    writesByRun: Object.keys(writesByRun).length > 0 ? writesByRun : undefined,
    attachedChangesByRun: Object.keys(attachedChangesByRun).length > 0
      ? attachedChangesByRun
      : undefined,
    changes: baseChanges,
    attached: attached.length > 0 ? attached : undefined,
    memberId: owner as EditorMember['id'],
    skillTypeLabel: skillType.short ?? skillType.label,
    talentNodeLabel: skill ? getSkillTabLabel(skill.tab) : 'Feature',
    kindLabel: skill?.tab ?? 'Feature',
    buffCount: 0,
    gate: !anyRan ? { kind: 'dead' } : undefined,
  }
}

/**
 * What the last run made of a state write, which is what the cleanup sweep
 * reads. The engine records a prior only for a node's first write and only
 * when it could read that path, so a node writing several paths can never be
 * shown to be inert from the trace and is left alone.
 */
function conditionGate(
  rows: readonly InspectEntry[],
  changes: readonly RtChng[],
): NodeGate | undefined {
  let ran = false

  for (const row of rows) {
    if (!row.executed || row.value?.kind !== 'condition') continue
    ran = true
    const { before, value } = row.value
    if (before === undefined || !Object.is(before, value)) return undefined
  }

  if (!ran) return { kind: 'dead' }
  return changes.length === 1 ? { kind: 'inert' } : undefined
}

function conditionGatesByRun(
  rows: readonly InspectEntry[],
  changes: readonly RtChng[],
  loopId: string | null,
): NonNullable<EditorCondition['gateByRun']> | undefined {
  if (!loopId) return undefined
  const rowsByRun = new Map<number, InspectEntry[]>()
  for (const row of rows) {
    const run = runOf(row, loopId)
    const list = rowsByRun.get(run)
    if (list) list.push(row)
    else rowsByRun.set(run, [row])
  }
  const gates: NonNullable<EditorCondition['gateByRun']> = {}
  for (const [run, runRows] of rowsByRun) {
    const gate = conditionGate(runRows, changes)
    if (gate) gates[run] = gate
  }
  return Object.keys(gates).length > 0 ? gates : undefined
}

/**
 * A condition node writes one or more paths. The editor names the first and
 * folds the rest into a count, and a write to the active-resonator path is not
 * a condition at all: it is the handoff row.
 */
function buildCondition(
  node: Extract<RotationNode, { type: 'condition' }>,
  ctx: WalkCtx,
): EditorNode | null {
  const changes = node.changes ?? []
  const rows = ctx.entriesByNode.get(node.id) ?? []
  const gate = conditionGate(rows, changes)
  const gateByRun = conditionGatesByRun(rows, changes, ctx.loopId)
  if (changes.length === 0) {
    const owner = node.resonatorId ?? ctx.activeId
    return {
      type: 'condition',
      id: node.id,
      sourceNode: node,
      ...attachedNoteFrom(node),
      owner: ownerOf(owner),
      label: node.label ?? 'Condition',
      to: '',
      rising: false,
      disabled: node.enabled === false,
      gate,
      gateByRun,
    }
  }

  const swap = changes.find((change) => change.path === ACTIVE_RESONATOR_PATH)
  if (swap) {
    const authoredTo = String(swap.value ?? '')
    const byRun: NonNullable<EditorHandoff['byRun']> = {}
    let lastExecutedTo: string | undefined

    for (const row of rows) {
      if (!row.executed || row.value?.kind !== 'condition') continue
      const from = row.value.before === undefined ? ctx.activeId : String(row.value.before)
      const to = String(row.value.value ?? from)
      byRun[runOf(row, ctx.loopId)] = { from, to }
      lastExecutedTo = to
    }

    const runs = Object.keys(byRun).map(Number).sort((left, right) => left - right)
    const firstRun = runs[0] === undefined ? undefined : byRun[runs[0]]
    const from = firstRun?.from ?? ctx.activeId
    // Projection state follows what execution really left behind. Invalid
    // authored member ids are normalized by the engine to the context owner.
    if (lastExecutedTo !== undefined) ctx.activeId = lastExecutedTo

    /*
      a handoff writes the active-resonator state like any other condition, so
      it registers the same history metadata. without it the write is recorded
      against no node and the path's history comes back empty.
    */
    const choice = ctx.condChoices.find((entry) => entry.state.path === ACTIVE_RESONATOR_PATH)
    const evaluatedTo = firstRun?.to ?? authoredTo
    const name = choice?.state.options?.find((option) => option.id === evaluatedTo)?.label
    ctx.conditionHistoryByNode.set(node.id, {
      path: ACTIVE_RESONATOR_PATH,
      label: name ?? evaluatedTo,
      loopId: ctx.loopId,
      section: { ...ctx.section },
      owner: ownerOf(evaluatedTo),
    })

    return {
      type: 'swap',
      id: node.id,
      from: from as EditorMember['id'],
      /*
        Keep the authored destination on the structural row. A stale imported
        member must remain stale (and therefore removable by cleanup), rather
        than being redrawn as an additional valid handoff when the engine
        normalizes its write. Evaluated state lives in byRun/ctx.activeId.
      */
      to: authoredTo as EditorMember['id'],
      disabled: node.enabled === false,
      sourceNode: node,
      ...attachedNoteFrom(node),
      gate,
      gateByRun,
      ...(runs.length > 0 ? { byRun } : {}),
    }
  }

  const first = changes[0]
  const path = first.path

  // The engine supplies a prior only when it could read that path.
  const byRun: NonNullable<EditorCondition['byRun']> = {}
  for (const row of rows) {
    if (!row.executed || row.value?.kind !== 'condition') {
      continue
    }
    const run = runOf(row, ctx.loopId)
    const wrote = regDisplayValue(row.value.value)
    const from = row.value.before === undefined
      ? undefined
      : regDisplayValue(row.value.before)
    const authored = first
    const write = {
      ...(from !== undefined ? { from } : {}),
      to: wrote,
      writeValue: authored.value,
      writeAction: condActionFromChange(authored),
      rising: rose(from, wrote),
    }
    byRun[run] = write
  }

  const runs = Object.keys(byRun).map(Number).sort((left, right) => left - right)
  const to = runs.length > 0
    ? byRun[runs[0]].to
    : regDisplayValue(first.value as string | number | boolean)
  const from = runs.length > 0 ? byRun[runs[0]].from : undefined

  const owner = node.resonatorId ?? ctx.activeId
  const choice = getCondChoice(ctx.condChoices, first, owner)
  const label = node.label ?? choice?.label ?? path.split('.').pop() ?? 'State'
  const rising = rose(from, to)

  ctx.conditionHistoryByNode.set(node.id, {
    path,
    label,
    effectName: choice?.effectName,
    loopId: ctx.loopId,
    section: { ...ctx.section },
    owner: ownerOf(owner),
    sourceIcon: srcAssetIcon(choice?.state.source) ?? undefined,
  })

  return {
    type: 'condition',
    id: node.id,
    sourceNode: node,
    ...attachedNoteFrom(node),
    path,
    sourceName: choice?.sourceName,
    effectName: choice?.effectName,
    sourceIcon: srcAssetIcon(choice?.state.source) ?? undefined,
    state: choice?.state,
    description: choice?.description,
    descriptionParams: choice?.dscrPrms,
    disabled: node.enabled === false,
    owner: ownerOf(owner),
    label,
    ...(from !== undefined ? { from } : {}),
    to,
    writeValue: first.value,
    writeAction: condActionFromChange(first),
    rising,
    extra: changes.length > 1 ? changes.length - 1 : undefined,
    change: first,
    byRun: runs.length > 1 ? byRun : undefined,
    gateByRun,
    gate,
  }
}

/**
 * After the full tree exists (including free-marker placement), seed bounded
 * loops with COW pass state. Must not run mid-walk or wrap geometry is frozen
 * before the crossing pass finishes.
 */
function seedCheckoutableLoopsInTree(
  nodes: EditorNode[],
  ctx: WalkCtx,
  depth = 0,
): void {
  for (const node of nodes) {
    if (!isEditorBlock(node)) {
      continue
    }
    seedCheckoutableLoopsInTree(node.children, ctx, depth + 1)
    if (!isCheckoutableLoop(node)) {
      continue
    }
    const startSource = node.sourceNode
    const engineForks = startSource?.type === 'loop' && startSource.kind === 'start'
      ? startSource.passForks
      : undefined
    const passForks: EditorPassForks = {}
    if (engineForks) {
      const forkCtx: WalkCtx = {
        ...ctx,
        loopId: node.loopId ?? node.id,
      }
      for (const [key, body] of Object.entries(engineForks)) {
        passForks[Number(key)] = walk(body, forkCtx, depth)
      }
    }
    Object.assign(node, seedLoopPassState(node, {
      passForks: Object.keys(passForks).length > 0 ? passForks : undefined,
      checkoutRun: 1,
    }))
  }
}

/** flat loop markers resolve into one nested block */
function walk(items: RotationNode[], ctx: WalkCtx, depth = 0): EditorNode[] {
  const wrap = findRotWrapLoop(items)
  if (wrap) {
    return walkWrapped(items, wrap, ctx, depth)
  }

  const out: EditorNode[] = []
  let index = 0
  const open: Array<{ block: EditorBlock; previousLoopId: string | null }> = []

  const push = (node: EditorNode) => {
    const parent = open[open.length - 1]
    if (parent) {
      parent.block.children.push(node)
    } else {
      out.push(node)
    }
  }

  for (const item of items) {
    if (item.type === 'note') {
      push(buildNote(item))
      continue
    }

    if (item.type === 'loop') {
      if (item.kind === 'start') {
        const meta = ctx.loopMeta.get(item.loopId)
        const block: EditorBlock = {
          type: 'loop',
          id: item.id,
          sourceNode: item,
          ...attachedNoteFrom(item),
          loopId: item.loopId,
          owner: ownerOf(ctx.activeId),
          label: item.label ?? meta?.label ?? 'Loop',
          runs: Math.max(1, Math.floor(item.runs ?? 1)),
          // a loop is identified by its own colour wherever it appears
          color: item.color ?? meta?.color ?? ROT_LOOP_COLORS[0],
          totals: meta?.totals,
          damageByRun: meta?.damageByRun,
          disabled: item.enabled === false,
          nodeCount: 0,
          children: [],
        }
        push(block)
        open.push({ block, previousLoopId: ctx.loopId })
        // Display values bind to the nearest loop's selected run.
        ctx.loopId = item.loopId
      } else {
        let openIndex = -1
        for (let at = open.length - 1; at >= 0; at -= 1) {
          if (open[at].block.loopId === item.loopId) {
            openIndex = at
            break
          }
        }
        /*
          Only the innermost loop can be closed by nesting. A marker that
          closes a loop with others still open inside it is a crossing, and
          taking it here would drop those loops off the stack along with it:
          their own ends would then find nothing open and the rows after them
          would land outside the loop that still holds them.

          So the marker is left for the cross-list pass, which places it as an
          extent once the tree exists. The loop stays open meanwhile and holds
          the loops it crosses in the ordinary way, which is what that pass
          expects to find. A marker sitting in a block's own list takes the
          same route, because this walk never sees it either.
        */
        if (openIndex >= 0 && openIndex === open.length - 1) {
          const closing = open[openIndex]
          closing.block.nodeCount = closing.block.children.length
          closing.block.sourceEndNode = item
          open.splice(openIndex)
          ctx.loopId = closing.previousLoopId
        }
      }
      continue
    }

    if (item.type === 'repeat') {
      const runsByRun = readBlockValues(ctx, item.id, 'repeat')
      const setupNodes = walk(item.setup ?? [], ctx, depth + 1)
      const children: EditorNode[] = setupNodes.length > 0
        ? [{
          type: 'setup',
          id: `${item.id}:setup`,
          owner: ownerOf(ctx.activeId),
          label: 'Setup',
          runs: 1,
          nodeCount: setupNodes.length,
          children: setupNodes,
        }]
        : []
      children.push(...walk(item.items, ctx, depth + 1))
      const block: EditorBlock = {
        type: 'repeat',
        id: item.id,
        sourceNode: item,
        ...attachedNoteFrom(item),
        owner: ownerOf(ctx.activeId),
        label: item.label ?? 'Repeat',
        color: item.color,
        runs: Math.max(
          1,
          Math.floor(
            runsByRun?.[1]
              ?? (typeof item.times === 'number' ? item.times : 1),
          ),
        ),
        runsByRun,
        ratio: typeof item.ratio === 'number' ? item.ratio : 1,
        disabled: item.enabled === false,
        nodeCount: 0,
        children,
      }
      block.nodeCount = block.children.length
      push(block)
      continue
    }

    if (item.type === 'uptime') {
      const ratioByRun = readBlockValues(ctx, item.id, 'uptime')
      /*
        the setup runs in full to open the window, so it is walked first and
        kept as a block of its own inside the uptime block. that makes it a
        real branch: it folds, it stacks, and a node can be dropped into it,
        without the tree needing a second kind of child list.
      */
      const setupNodes = walk(item.setup ?? [], ctx, depth + 1)
      const children: EditorNode[] = []

      if (setupNodes.length > 0) {
        children.push({
          type: 'setup',
          id: `${item.id}:setup`,
          owner: ownerOf(ctx.activeId),
          label: 'Setup',
          runs: 1,
          nodeCount: setupNodes.length,
          children: setupNodes,
        })
      }

      children.push(...walk(item.items, ctx, depth + 1))

      const block: EditorBlock = {
        type: 'repeat',
        id: item.id,
        sourceNode: item,
        ...attachedNoteFrom(item),
        owner: ownerOf(ctx.activeId),
        label: item.label ?? 'Block',
        color: item.color,
        runs: 1,
        ratio: ratioByRun?.[1]
          ?? (typeof item.ratio === 'number' ? item.ratio : 1),
        ratioByRun,
        disabled: item.enabled === false,
        nodeCount: children.length,
        children,
      }
      push(block)
      continue
    }

    if (item.type === 'condition') {
      const node = buildCondition(item, ctx)
      if (node) {
        push(node)
      }
      continue
    }

    if (item.type === 'feature') {
      const step = buildStep(item, ctx, index)
      if (step) {
        index += 1
        push(step)
      }
    }
  }

  if (open.length > 0) {
    for (const entry of open) {
      entry.block.nodeCount = entry.block.children.length
    }
    ctx.loopId = open[0].previousLoopId
  }

  return out
}

/*
  the two segments of one wrapped loop, in document order: the continuation
  that the body reaches last sits at the top of the list, whatever lies outside
  the loop sits in the middle, and the segment that begins at the start marker
  sits at the bottom. only that last one is headed, because there is only one
  loop here.
*/
function walkWrapped(
  items: RotationNode[],
  wrap: RotWrapLoopPlan,
  ctx: WalkCtx,
  depth: number,
): EditorNode[] {
  const start = wrap.start
  const meta = ctx.loopMeta.get(start.loopId)
  const stop = wrap.endIndex ?? wrap.startIndex
  const endCandidate = wrap.endIndex == null ? undefined : items[wrap.endIndex]
  const sourceEnd = endCandidate?.type === 'loop' && endCandidate.kind === 'end'
    ? endCandidate
    : undefined

  const segment = (
    id: string,
    children: EditorNode[],
    kind: 'head' | 'tail' | null,
  ): EditorBlock => ({
    type: 'loop',
    id,
    sourceNode: start,
    ...attachedNoteFrom(start),
    sourceEndNode: sourceEnd,
    loopId: start.loopId,
    owner: ownerOf(ctx.activeId),
    label: start.label ?? meta?.label ?? 'Loop',
    runs: Math.max(1, Math.floor(start.runs ?? 1)),
    color: start.color ?? meta?.color ?? ROT_LOOP_COLORS[0],
    totals: meta?.totals,
    damageByRun: meta?.damageByRun,
    disabled: start.enabled === false,
    // written with no end at all, rather than with one standing above its start
    ...(wrap.endIndex == null ? { noEnd: true } : {}),
    ...(kind ? { wrap: kind } : {}),
    ...(kind === 'head' ? { wrapOf: start.id } : {}),
    nodeCount: children.length,
    children,
  })

  // Walk authored order for display ownership; execution history comes from
  // the interpreter's ordered inspection entries after the tree is projected.
  const previousLoopId = ctx.loopId
  const inLoop = start.loopId

  // everything above the stopping point is the tail of the body, reached last
  ctx.loopId = inLoop
  const headChildren = walk(items.slice(0, stop), ctx, depth)

  // whatever sits between the stopping point and the marker is outside the loop
  ctx.loopId = previousLoopId
  const between = wrap.endIndex == null
    ? []
    : walk(items.slice(wrap.endIndex + 1, wrap.startIndex), ctx, depth)

  ctx.loopId = inLoop
  const tailChildren = walk(items.slice(wrap.startIndex + 1), ctx, depth)
  ctx.loopId = previousLoopId

  /*
    nothing above the stopping point means nothing crosses the seam: the body
    lies wholly below the marker and runs only inside the loop, which is an
    ordinary loop however it was written.

    the other way round is not the same rotation. a marker at the foot of its
    list still has a body above it, and the walk executes those rows on its way
    down before the loop ever starts, so they run once outside and again on
    every pass. that has to keep the wrap drawing even though the segment
    holding the marker has no rows of its own.
  */
  if (headChildren.length === 0) {
    return [...between, segment(start.id, tailChildren, null)]
  }

  return [
    segment(`${start.id}:wrap`, headChildren, 'head'),
    ...between,
    segment(start.id, tailChildren, 'tail'),
  ]
}

interface AuthoredLoopEndPlacement {
  loopId: string
  startId: string
  end: Extract<RotationNode, { type: 'loop'; kind: 'end' }>
  targetId: string | null
}

function collectAuthoredLoopEndPlacements(
  itemSections: Array<{ items: RotationNode[] }>,
): AuthoredLoopEndPlacement[] {
  const starts = new Map<string, Extract<RotationNode, { type: 'loop'; kind: 'start' }>>()
  const ends: Array<{
    node: Extract<RotationNode, { type: 'loop'; kind: 'end' }>
    targetId: string | null
  }> = []

  const visit = (nodes: RotationNode[]) => {
    for (const [index, node] of nodes.entries()) {
      if (node.type === 'loop') {
        if (node.kind === 'start') {
          starts.set(node.loopId, node)
        } else {
          const target = [...nodes.slice(0, index)].reverse().find((candidate) =>
            candidate.type !== 'loop' || candidate.kind === 'start')
          ends.push({ node, targetId: target?.id ?? null })
        }
      }

      if (node.type === 'repeat') {
        visit(node.items)
      } else if (node.type === 'uptime') {
        visit(node.setup ?? [])
        visit(node.items)
      }
    }
  }

  itemSections.forEach((section) => visit(section.items))
  const usedLoopIds = new Set<string>()
  return ends.flatMap(({ node, targetId }): AuthoredLoopEndPlacement[] => {
    const start = starts.get(node.loopId)
    if (!start || usedLoopIds.has(node.loopId)) {
      return []
    }
    usedLoopIds.add(node.loopId)
    return [{
      loopId: node.loopId,
      startId: start.id,
      end: node,
      targetId,
    }]
  })
}

function hasProjectedLoopEnd(
  sections: EditorSection[],
  loopId: string,
  endId: string,
): boolean {
  const visit = (nodes: EditorNode[]): boolean => {
    for (const node of nodes) {
      if (!isEditorBlock(node)) {
        continue
      }
      if (
        node.type === 'loop'
        && (node.loopId ?? node.id) === loopId
        && node.sourceEndNode?.id === endId
      ) {
        return true
      }
      if (visit(node.children)) {
        return true
      }
    }
    return false
  }

  return sections.some((section) => visit(section.children))
}

function restoreCrossListLoopEnds(
  sections: EditorSection[],
  itemSections: Array<{ items: RotationNode[] }>,
): EditorSection[] {
  return collectAuthoredLoopEndPlacements(itemSections).reduce((current, placement) => {
    if (
      hasProjectedLoopEnd(current, placement.loopId, placement.end.id)
      || !findNode(current, placement.startId)
    ) {
      return current
    }

    const withEnd = mapLoopBlocks(current, placement.loopId, (node) => ({
      ...node,
      sourceEndNode: placement.end,
    }))
    return placement.targetId
      ? setBlockExtent(withEnd, placement.startId, placement.targetId)
      : withEnd
  }, sections)
}

export interface RunInput {
  runtime: ResRuntime
  seed: ResSeed
  runtimesById: Record<string, ResRuntime>
  targetSelections?: Record<string, string | null>
  items?: RotationNode[]
  itemSections?: Array<{ id: string; title: string; meta?: string; items: RotationNode[] }>
  enemy: EnemyProfile
  members: RotationMember[]
  prepWork?: PrepWork | null
  detail?: 'full' | 'summary'
  includeSnapshots?: boolean
  /** retain the ordered rows for the live flattened execution surface */
  includeFlatRows?: boolean
}

export interface RunTrace extends Pick<ProgramResult, 'entries' | 'inspection'> {
  prepareMs: number
  executeMs: number
  cacheHit: boolean
}

interface FlatProjectionIndex {
  nodesById: Map<string, EditorNode[]>
  scopesById: Map<string, EditorBlock[]>
  targetById: Map<string, string>
  copyNodeById: Map<string, EditorNode>
}

function indexFlatProjection(sections: readonly EditorSection[]): FlatProjectionIndex {
  const nodesById = new Map<string, EditorNode[]>()
  const scopesById = new Map<string, EditorBlock[]>()
  const targetById = new Map<string, string>()
  const copyNodeById = new Map<string, EditorNode>()

  const add = (
    id: string,
    node: EditorNode,
    scopes: readonly EditorBlock[],
    targetId = node.id,
  ) => {
    const nodes = nodesById.get(id)
    if (nodes) nodes.push(node)
    else nodesById.set(id, [node])
    if (!scopesById.has(id)) scopesById.set(id, [...scopes])
    if (!targetById.has(id)) targetById.set(id, targetId)
    if (!copyNodeById.has(id)) copyNodeById.set(id, node)
  }

  const addAttachedCondition = (
    condition: Extract<RotationNode, { type: 'condition' }>,
    parent: EditorStep,
    scopes: readonly EditorBlock[],
  ) => {
    const first = condition.changes[0]
    const ownerId = condition.resonatorId ?? parent.memberId
    const copyNode: EditorCondition = {
      type: 'condition',
      id: condition.id,
      sourceNode: condition,
      owner: ownerOf(ownerId),
      label: condition.label ?? first?.path.split('.').pop() ?? 'Condition',
      ...(first ? {
        path: first.path,
        change: first,
        writeValue: first.value,
        writeAction: condActionFromChange(first),
      } : {}),
      to: first ? regDisplayValue(first.value) : '',
      rising: false,
      disabled: condition.enabled === false,
    }
    add(condition.id, copyNode, scopes, parent.id)
  }

  const visit = (nodes: readonly EditorNode[], scopes: readonly EditorBlock[]) => {
    for (const node of nodes) {
      if (isEditorBlock(node)) {
        const nextScopes = node.type === 'setup' ? scopes : [...scopes, node]
        visit(node.children, nextScopes)
        if (node.passTemplate && node.passTemplate !== node.children) {
          visit(node.passTemplate, nextScopes)
        }
        for (const body of Object.values(node.passForks ?? {})) {
          visit(body, nextScopes)
        }
        continue
      }

      add(node.id, node, scopes)
      if (node.type !== 'step') continue
      for (const attached of node.attached ?? []) add(attached.id, attached, scopes, node.id)

      const source = node.sourceNode
      if (source?.type !== 'feature') continue
      for (const condition of normalizeFeatureAttachments(source).attached?.conditions ?? []) {
        addAttachedCondition(condition, node, scopes)
      }
    }
  }

  for (const section of sections) visit(section.children, [])
  return { nodesById, scopesById, targetById, copyNodeById }
}

function flatScopesFor(
  blocks: readonly EditorBlock[],
  entry: InspectEntry,
): FlatScope[] {
  const scopes: FlatScope[] = []
  let run = 1

  for (const block of blocks) {
    if (block.type === 'setup') continue
    if (block.type === 'loop') {
      const id = block.loopId ?? block.id
      const exactRun = entry.loopRuns?.[id]
      // Wrapped bodies can execute once outside their visual loop. The engine
      // context, not the tree position, decides whether the delimiter applies.
      if (exactRun === undefined) continue
      run = exactRun
      scopes.push({
        kind: 'loop',
        id,
        label: block.label,
        run: exactRun,
        runs: Math.max(1, Math.floor(block.runs)),
        transient: false,
      })
      continue
    }

    if (block.type === 'repeat') {
      const runs = Math.max(1, Math.floor(block.runsByRun?.[run] ?? block.runs))
      scopes.push({
        kind: 'repeat',
        id: block.id,
        label: block.label,
        run: 1,
        runs,
        transient: false,
      })
      continue
    }

    const ratio = block.ratioByRun?.[run] ?? block.ratio ?? 1
    scopes.push({
      kind: 'uptime',
      id: block.id,
      label: block.label,
      run: 1,
      runs: 1,
      ratio,
      transient: true,
    })
  }

  return scopes
}

function exactStepFor(
  entry: InspectEntry,
  exact: FeatureResult,
  candidates: readonly EditorNode[],
  run: number,
): EditorStep {
  const projected = candidates.find((node): node is EditorStep =>
    node.type === 'step' && node.featureId === exact.feature.id)
    ?? candidates.find((node): node is EditorStep => node.type === 'step')
  const skillType = getSkillType(exact.skill.skillType)
  const echoSource = exact.feature.source.type === 'echo'
    ? exact.feature.source
    : getEmbeddedEchoSource(exact.feature.id)
  const base: EditorStep = projected ?? {
    type: 'step',
    id: entry.nodeId,
    owner: echoSource ? { kind: 'echo', echoId: echoSource.id } : ownerOf(exact.resonatorId),
    label: exact.skill.label ?? exact.feature.label ?? exact.feature.id,
    index: 0,
    featureId: exact.feature.id,
    multiplier: exact.multiplier,
    damageByRun: {},
    statsByRun: {},
    loopScoped: Object.keys(entry.loopRuns ?? {}).length > 0,
    memberId: exact.resonatorId,
    skillTypeLabel: skillType.short ?? skillType.label,
    talentNodeLabel: getSkillTabLabel(exact.skill.tab),
    kindLabel: exact.skill.tab,
    buffCount: 0,
  }

  return {
    ...base,
    owner: base.owner.kind === 'echo' ? base.owner : ownerOf(exact.resonatorId),
    label: exact.skill.label ?? base.label,
    featureId: exact.feature.id,
    element: exact.skill.element,
    multiplier: exact.multiplier,
    damageByRun: { [run]: exact.avg },
    normalDamageByRun: { [run]: exact.normal },
    critDamageByRun: { [run]: exact.crit },
    statsByRun: exact.effectiveStats ? { [run]: exact.effectiveStats } : {},
    multiplierByRun: { [run]: exact.multiplier },
    effectiveMultiplierByRun: { [run]: exact.multiplier },
    loopScoped: Object.keys(entry.loopRuns ?? {}).length > 0,
    memberId: exact.resonatorId,
    disabled: false,
    gate: undefined,
    writesByRun: undefined,
    pendingWrites: undefined,
    attachedChangesByRun: undefined,
    attached: undefined,
  }
}

function buildExactFlatRows(
  inspection: readonly InspectEntry[],
  features: readonly FeatureResult[],
  sections: readonly EditorSection[],
  conditionMeta: ReadonlyMap<string, ConditionHistoryMeta>,
): FlatRow[] {
  const index = indexFlatProjection(sections)
  const featureRows = new Map<string, FeatureResult[]>()
  const featureCursors = new Map<string, number>()
  for (const feature of features) {
    if (!feature.nodeId) continue
    const rows = featureRows.get(feature.nodeId)
    if (rows) rows.push(feature)
    else featureRows.set(feature.nodeId, [feature])
  }

  const out: FlatRow[] = []
  let sequence = 0
  for (const entry of inspection) {
    if (!entry.executed || !entry.value) continue
    const scope = flatScopesFor(index.scopesById.get(entry.nodeId) ?? [], entry)
    const target: FlatRowTarget = {
      nodeId: index.targetById.get(entry.nodeId) ?? entry.nodeId,
      ...(Object.keys(entry.loopRuns ?? {}).length > 0
        ? { loopRuns: { ...entry.loopRuns } }
        : {}),
    }

    if (entry.value.kind === 'condition') {
      const meta = conditionMeta.get(entry.nodeId)
      const from = entry.value.before === undefined
        ? undefined
        : regDisplayValue(entry.value.before)
      const value = regDisplayValue(entry.value.value)
      const isHandoff = (entry.value.path || meta?.path) === ACTIVE_RESONATOR_PATH
      const write: FlatWrite = {
        id: `${entry.nodeId}:${sequence}`,
        label: isHandoff ? 'On field' : meta?.label ?? entry.value.path.split('.').pop() ?? 'State',
        ...(!isHandoff && meta?.effectName
          ? { effectName: meta.effectName }
          : {}),
        ...(!isHandoff && (entry.value.path || meta?.path)
          ? { path: entry.value.path || meta?.path }
          : {}),
        ...(isHandoff ? { memberId: value } : {}),
        ...(!isHandoff && meta?.owner ? { owner: meta.owner } : {}),
        ...(!isHandoff && meta?.sourceIcon ? { sourceIcon: meta.sourceIcon } : {}),
        rising: isHandoff ? true : rose(from, value),
        ...(!isHandoff && from !== undefined ? { from } : {}),
        value: isHandoff ? '' : value,
      }
      out.push({
        kind: 'state',
        key: `s:${sequence += 1}:${entry.nodeId}`,
        writes: [write],
        copyNode: index.copyNodeById.get(entry.nodeId),
        scope,
        target,
      })
      continue
    }

    if (entry.value.kind !== 'feature') continue
    const cursor = featureCursors.get(entry.nodeId) ?? 0
    const exact = featureRows.get(entry.nodeId)?.[cursor]
    if (!exact) continue
    featureCursors.set(entry.nodeId, cursor + 1)
    const run = [...scope].reverse().find((entryScope) => entryScope.kind === 'loop')?.run ?? 1
    const step = exactStepFor(entry, exact, index.nodesById.get(entry.nodeId) ?? [], run)
    out.push({
      kind: 'hit',
      key: `h:${sequence += 1}:${entry.nodeId}`,
      step,
      copyNode: index.copyNodeById.get(entry.nodeId) ?? step,
      run,
      scope,
      target,
    })
  }

  return out
}

/** Execute the engine once and retain only the trace needed by projection. */
export function executeRunTrace(input: RunInput): RunTrace {
  const startedAt = performance.now()
  const {
    runtime,
    seed,
    runtimesById,
    targetSelections = {},
    items: overrideItems,
    itemSections: overrideItemSections,
    enemy,
    prepWork,
    detail = 'full',
    includeSnapshots = true,
  } = input
  const sourceItems = overrideItems ?? runtime.rotation.program ?? []
  const itemSections = overrideItemSections ?? splitEditorSections(sourceItems)
  const items = itemSections.flatMap((section) => section.items)
  const canReuseWorkspace = detail === 'full' && includeSnapshots
    && prepWork?.actRt === runtime
    && prepWork.activeSeed?.id === seed.id
    && prepWork.enemy === enemy
  let detailed: ProgramResult | null
  let prepareMs: number
  let executeMs: number
  let cacheHit = false
  if (canReuseWorkspace) {
    const timed = runPrepWorkDetailedProgramTimed(
      prepWork,
      items,
      overrideItemSections ? items : sourceItems,
    )
    detailed = timed?.result ?? null
    executeMs = timed?.executeMs ?? 0
    cacheHit = timed?.cacheHit ?? false
    const measuredPrepareMs = timed?.prepareMs ?? 0
    const phaseOverhead = performance.now() - startedAt - measuredPrepareMs - executeMs
    prepareMs = measuredPrepareMs + Math.max(0, phaseOverhead)
  } else {
    const prepared = prepareResSimulation(
      runtime,
      seed,
      enemy,
      runtimesById,
      targetSelections,
    )
    const environment = prepareRunEnv(prepared.context, seed)
    const program = prepareRotationProgram(items)
    prepareMs = performance.now() - startedAt
    const executeStartedAt = performance.now()
    detailed = executeRotationProgram(environment, program, {
      inspect: true,
      detail,
      includeSnapshots,
    })
    executeMs = performance.now() - executeStartedAt
  }
  if (!detailed) throw new Error('Prepared rotation workspace is incomplete')
  return {
    entries: detailed.entries,
    inspection: detailed.inspection,
    prepareMs,
    executeMs,
    cacheHit,
  }
}

export function projectRun({
  runtime,
  seed,
  runtimesById,
  targetSelections = {},
  items: overrideItems,
  itemSections: overrideItemSections,
  enemy,
  members,
  prepWork,
  detail = 'full',
  includeFlatRows = true,
  execution,
}: RunInput & { execution: RunTrace }): RunResult {
  const startedAt = performance.now()
  const sourceItems = overrideItems ?? runtime.rotation.program ?? []
  const itemSections = overrideItemSections ?? splitEditorSections(sourceItems)
  const items = itemSections.flatMap((section) => section.items)
  void seed
  void runtimesById
  void targetSelections
  void prepWork
  void detail
  const simulationEntries = execution.entries
  const inspectionEntries = execution.inspection
  const { totals: engineTotals, fullTotals } = sumRotTtlsPair(simulationEntries)
  const { totalsByGroup, fullTotalsByGroup } = sumRotTtlsByAggPair(simulationEntries)
  /*
    the same rotation read the other way: the engine's total is one pass worth
    of damage, and this is what the whole run dealt with every loop pass
    counted. both are kept so the page can state either without running again.
  */
  const entriesByNode = new Map<string, InspectEntry[]>()
  for (const entry of inspectionEntries) {
    const list = entriesByNode.get(entry.nodeId)
    if (list) {
      list.push(entry)
    } else {
      entriesByNode.set(entry.nodeId, [entry])
    }
  }

  const featureEntriesByNode = new Map<string, FeatureResult[]>()
  for (const entry of simulationEntries) {
    if (!entry.nodeId) {
      continue
    }
    const list = featureEntriesByNode.get(entry.nodeId)
    if (list) {
      list.push(entry)
    } else {
      featureEntriesByNode.set(entry.nodeId, [entry])
    }
  }

  const snapshots = new Map<string, RowSnapshot>()
  const loopInfo = makeLoopInfo(items, simulationEntries).loops
  const loopDamageByRun = indexLoopDamageByRun(simulationEntries)
  const ctx: WalkCtx = {
    entriesByNode,
    featureEntriesByNode,
    snapshots,
    condChoices: makeConditionChoices(members, runtime, enemy.id),
    members: new Map(members.map((member) => [member.id, member])),
    runtimesById: Object.fromEntries(members.map((member) => [member.id, member.runtime])),
    conditionHistoryByNode: new Map(),
    loopMeta: new Map(
      // totals are computed here from the rows walked, so the loop analysis is
      // only being asked for names and colours
      loopInfo.map((loop) => [
        loop.loopId,
        {
          label: loop.label,
          color: loop.color,
          totals: loop.totals,
          damageByRun: loopDamageByRun.get(loop.loopId) ?? {},
        },
      ]),
    ),
    loopRunsById: new Map(loopInfo.map((loop) => [
      loop.loopId,
      Math.max(1, Math.floor(loop.runs ?? 1)),
    ])),
    activeId: runtime.id,
    loopId: null,
    section: { id: 'main', label: 'Main' },
  }

  /*
    what a feature can be swapped for. the same maps the rotation pane uses for
    its previous- and adjacent-skill actions, so both surfaces offer the same
    swaps rather than each deciding for itself.
  */
  const labels = new Map<string, string>()
  const skillById = new Map<string, string>()
  for (const member of members) {
    for (const skill of member.skills) {
      skillById.set(
        `${member.id}:${skill.id}`,
        resolveSkill(member.runtime, skill, undefined, ctx.runtimesById).label ?? '',
      )
    }
    for (const feature of member.features) {
      labels.set(
        feature.id,
        skillById.get(`${member.id}:${feature.skillId}`) || feature.label,
      )
    }
  }

  const features: FeatureBook = {
    label: (featureId) => labels.get(featureId) ?? featureId,
    previous: priorFeatures(members),
    adjacent: adjacentFeatures(members),
  }

  const projectedSections = itemSections.map((section) => {
    ctx.section = { id: section.id, label: section.title }
    return {
      id: section.id,
      title: section.title,
      meta: section.meta ?? '',
      children: walk(section.items, ctx),
    }
  })
  const builtSections = restoreCrossListLoopEnds(projectedSections, itemSections)
  // Free-marker placement is done; seed bounded loops for pass checkout.
  for (const section of builtSections) {
    seedCheckoutableLoopsInTree(section.children, ctx)
  }
  const history = buildConditionHistory(inspectionEntries, ctx)
  hydrateConditionHistory(builtSections, history)
  // Background saved-rotation detail runs explicitly omit snapshots and never
  // open the live flat surface. Do not make every comparison carry another
  // full per-event projection it cannot display.
  const flatRows = includeFlatRows
    ? buildExactFlatRows(
      inspectionEntries,
      simulationEntries,
      builtSections,
      ctx.conditionHistoryByNode,
    )
    : []

  const summaryArgs = {
    entries: inspectionEntries,
    damageEntries: simulationEntries,
    items,
    members,
    runtime,
  }
  const { summary, fullSummary } = buildRotationSummaryPair(
    summaryArgs,
    engineTotals,
    fullTotals,
    {
      healing: totalsByGroup.healing.avg,
      shield: totalsByGroup.shield.avg,
    },
    {
      healing: fullTotalsByGroup.healing.avg,
      shield: fullTotalsByGroup.shield.avg,
    },
  )
  const projectedMembers = members.map((member) => memberToReg(
    member,
    summary.resonators.find((group) => group.id === member.id)?.sharePct ?? 0,
  ))

  const projectMs = performance.now() - startedAt
  const timing: ProgramRunTiming = {
    prepareMs: execution.prepareMs,
    executeMs: execution.executeMs,
    projectMs,
    totalMs: execution.prepareMs + execution.executeMs + projectMs,
    cacheHit: execution.cacheHit,
  }

  const result: RunResult = {
    history,
    totals: engineTotals,
    fullTotals,
    summary,
    fullSummary,
    sections: builtSections,
    flatRows,
    snapshots,
    features,
    members: projectedMembers,
    timing,
    ranAt: Date.now(),
  }
  if (!includeFlatRows) {
    lazyFlatProjectionByRun.set(result, {
      inspection: inspectionEntries,
      features: simulationEntries,
      sections: builtSections,
      conditionMeta: ctx.conditionHistoryByNode,
    })
  }
  return result
}

/** Canonical convenience path: execute once, then project the resulting trace. */
export function buildRun(
  input: RunInput,
): RunResult {
  return projectRun({ ...input, execution: executeRunTrace(input) })
}
