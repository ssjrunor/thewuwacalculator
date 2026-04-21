import type {CSSProperties} from 'react'
import * as React from 'react'
import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {createPortal} from 'react-dom'
import {
  ChevronDown,
  ChevronRight,
  ChevronsDown,
  ChevronsLeft,
  ChevronsRight,
  Pencil,
  Plus,
  Power,
  PowerOff,
  RotateCcw,
  Save,
  Search,
  Trash2
} from 'lucide-react'
import type {
  FeatureDefinition,
  RotationNode,
  RuntimeChange,
  SourceStateDefinition,
} from '@/domain/gameData/contracts'
import type {ResonatorRuntimeState,} from '@/domain/entities/runtime'
import {isUnsetWeaponId, type ResonatorId} from '@/domain/entities/runtime'
import type {InventoryRotationEntry} from '@/domain/entities/inventoryStorage'
import {cloneRotationNodes} from '@/domain/entities/inventoryStorage'
import {useAppStore} from '@/domain/state/store'
import type {AttributeKey, SkillAggregationType, SkillDefinition} from '@/domain/entities/stats'
import type {SimulationResult} from '@/engine/pipeline/types'
import {isSkillVisible, resolveSkill} from '@/engine/pipeline/resolveSkill'
import {buildRuntimeSourceCatalog, getMainEchoSourceRef} from '@/domain/services/runtimeSourceService'
import {listResonatorRotations, listStatesForSource} from '@/domain/services/gameDataService'
import {buildMemberContributions} from '@/modules/calculator/components/workspace/panes/right/rightPaneUtils'
import {seedResonatorsById} from '@/modules/calculator/model/seedData'
import {getSkillTypeDisplay} from '@/modules/calculator/model/skillTypes'
import {LiquidSelect} from '@/shared/ui/LiquidSelect'
import {AppDialog} from '@/shared/ui/AppDialog'
import {ModalCloseButton} from '@/shared/ui/ModalCloseButton'
import {formatRuntimeChange} from '@/shared/lib/formatGameData'
import {RichDescription} from '@/shared/ui/RichDescription'
import {Expandable} from '@/shared/ui/Expandable'
import {ConfirmationModal} from '@/shared/ui/ConfirmationModal'
import {useConfirmation} from '@/app/hooks/useConfirmation.ts'
import {useAnimatedModalValue} from '@/app/hooks/useAnimatedVisibility.ts'
import {useToastStore} from '@/shared/util/toastStore.ts'
import {getBodyPortalTarget, getMainContentPortalTarget} from '@/shared/lib/portalTarget'
import {
  getStateTeamTargetMode,
  getTeamTargetOptions,
} from '@/modules/calculator/components/workspace/panes/left/helpers/runtimeStateUtils'
import {getResonatorSeedById} from "@/domain/services/catalogService.ts";
import {formatCompactNumber} from "@/modules/calculator/model/overviewStats.ts";
import {evaluateSourceStateVisibility} from '@/modules/calculator/model/sourceStateEvaluation'
import {getSourceStateDisplay} from '@/modules/calculator/model/sourceStateDisplay'
import {getWeaponById} from '@/domain/services/weaponCatalogService'
import {resolvePassiveParams} from '@/modules/calculator/model/weapon'
import {computeEchoSetCounts} from '@/engine/pipeline/buildCombatContext'
import {getEchoSetDef} from '@/data/gameData/echoSets/effects'
import {
  getNegativeEffectAttribute,
  getNegativeEffectCombatKey,
  getNegativeEffectEntryForRuntime,
  resolveNegativeEffectsForRuntime,
} from '@/domain/gameData/negativeEffects'
import {
  createNegativeEffectConfigDraft,
  serializeNegativeEffectConfigDraft,
} from '@/modules/calculator/model/negativeEffectConfig'
import { ATTRIBUTE_COLORS } from '@/modules/calculator/model/display'
import { ROTATION_SKILL_TAB_ORDER, SKILL_TAB_LABELS, type SkillTabKey } from '@/modules/calculator/model/skillTabs'
import { extractRotationStats } from '@/modules/calculator/model/rotationAnalytics'
import { buildRotationActionSequence } from '@/modules/calculator/model/rotationSequence'
import { RotationActionSequenceList } from '@/modules/calculator/components/rotation/RotationActionSequenceList'
import { formatDateShort, formatPercent } from '@/shared/lib/format'
import { CgListTree} from "react-icons/cg";
import {GrLinkDown} from "react-icons/gr";
import {PiDownloadSimpleBold, PiPlusBold, PiUploadSimpleBold} from "react-icons/pi";

// orchestrates the rotation editor surface and the helper dialogs around it.
type RotationBranch = 'root' | 'items' | 'setup'
type RotationDragArea = 'root' | 'block-items' | 'block-setup'

interface RotationPaneProps {
  runtime: ResonatorRuntimeState
  runtimesById: Record<string, ResonatorRuntimeState>
  simulation: SimulationResult | null
  onRuntimeUpdate: (updater: (runtime: ResonatorRuntimeState) => ResonatorRuntimeState) => void
}

interface NodeTotals {
  normal: number
  crit: number
  avg: number
}

interface RotationInsertTarget {
  parentId: string | null
  branch: RotationBranch
  index?: number
}

interface RotationDropTarget extends RotationInsertTarget {
  index: number
  key: string
}

interface FeatureMenuState {
  mode: 'add' | 'edit'
  activeMemberId: string
  target?: RotationInsertTarget
  nodeId?: string
}

interface ConditionEditorState {
  mode: 'add' | 'edit'
  target?: RotationInsertTarget
  nodeId?: string
}

interface FeatureConditionEditorState {
  nodeId: string
}

type FeatureConditionActionType = 'set' | 'add'

interface FeatureConditionDraftRow {
  id: string
  action: FeatureConditionActionType
  choiceId: string
  value: string | number | boolean
}

interface NegativeEffectConfigState {
  nodeId: string
}

interface BlockPickerState {
  target: RotationInsertTarget
}

interface RotationLoadPayload {
  mode: 'personal' | 'team'
  resonatorId: ResonatorId
  resonatorName: string
  team?: ResonatorRuntimeState['build']['team']
  items: RotationNode[]
}

interface SkillMenuEntry {
  featureId: string
  resonatorId: string
  resonatorName: string
  featureLabel: string
  feature: FeatureDefinition
  skill: SkillDefinition
  variant: 'skill' | 'subHit'
  hitIndex?: number
}

interface SkillMenuGroup {
  resonatorId: string
  resonatorName: string
  skill: SkillDefinition
  totalEntry: SkillMenuEntry | null
  subHitEntries: SkillMenuEntry[]
}

interface ConditionChoice {
  id: string
  resonatorId: string
  resonatorName: string
  sourceName: string
  label: string
  description?: string
  descriptionParams?: Array<string | number>
  state: SourceStateDefinition
  changeTarget?: 'runtime' | 'enemy'
}

interface FeatureMeta {
  label: string
  skillId?: string
  tab: string
  archetype?: SkillDefinition['archetype']
  section?: string
  skillTypeLabel: string
  element: AttributeKey
  aggregationType: SkillAggregationType
  resonatorId: string
  resonatorName: string
  variant?: 'skill' | 'subHit'
  hitIndex?: number
  fixedStacks?: boolean
}

interface RotationMemberEntry {
  id: string
  name: string
  profile: string
  attribute: AttributeKey
  runtime: ResonatorRuntimeState
  skills: SkillDefinition[]
  features: FeatureDefinition[]
  states: SourceStateDefinition[]
}

function listRotationMemberStates(
  memberRuntime: ResonatorRuntimeState,
  activeRuntime: ResonatorRuntimeState,
): SourceStateDefinition[] {
  const states: SourceStateDefinition[] = []
  const seenControlKeys = new Set<string>()

  const pushStates = (nextStates: SourceStateDefinition[]) => {
    for (const state of nextStates) {
      if (seenControlKeys.has(state.controlKey)) {
        continue
      }

      if (!evaluateSourceStateVisibility(memberRuntime, memberRuntime, state, activeRuntime)) {
        continue
      }

      seenControlKeys.add(state.controlKey)
      states.push(state)
    }
  }

  pushStates(listStatesForSource('resonator', memberRuntime.id))

  const weaponId = memberRuntime.build.weapon.id
  if (!isUnsetWeaponId(weaponId)) {
    pushStates(listStatesForSource('weapon', weaponId))
  }

  const mainEchoSource = getMainEchoSourceRef(memberRuntime)
  if (mainEchoSource) {
    pushStates(listStatesForSource(mainEchoSource.type, mainEchoSource.id))
  }

  const echoSetCounts = computeEchoSetCounts(memberRuntime.build.echoes)
  for (const [setId, count] of Object.entries(echoSetCounts)) {
    const def = getEchoSetDef(Number(setId))
    if (!def) {
      continue
    }

    const stateRequirement = def.setMax === 3 ? 3 : 5
    if (count < stateRequirement) {
      continue
    }

    pushStates(listStatesForSource('echoSet', setId))
  }

  return states
}

function makeEnemyStatusState(
  id: string,
  label: string,
  path: string,
  max: number,
  description: string,
): SourceStateDefinition {
  return {
    id,
    label,
    source: { type: 'enemy', id: 'target' },
    ownerKey: 'enemy:status',
    controlKey: `enemy:${id}`,
    path,
    kind: 'stack',
    min: 0,
    max,
    defaultValue: 0,
    description,
  }
}

function buildEnemyStatusConditionChoices(runtime: ResonatorRuntimeState): ConditionChoice[] {
  const enemyMember = {
    id: runtime.id,
    name: 'Enemy',
    runtime,
  }
  const tuneStrain = makeEnemyStatusState(
      'tuneStrain',
      'Tune Strain',
      'enemy.status.tuneStrain',
      10,
      'Set the target enemy Tune Strain stacks for following rotation actions.',
  )
  const negativeEffects = resolveNegativeEffectsForRuntime(runtime)
      .filter((effect) => effect.sliderVisible)
      .map((effect) => makeEnemyStatusState(
          effect.key,
          effect.label,
          `enemy.combat.${effect.key}`,
          effect.max,
          `Set the target enemy ${effect.label} stacks for following rotation actions.`,
      ))

  return [tuneStrain, ...negativeEffects].map((state) => makeConditionChoice(
      enemyMember,
      state,
      {
        id: `enemy:${state.id}`,
        changeTarget: 'enemy',
      },
  ))
}

interface NodeMemberIcon {
  name: string
  profile: string
}

const SUPPORT_STYLE: Record<Exclude<SkillAggregationType, 'damage'>, { label: string; color: string }> = {
  healing: {
    label: 'Healing',
    color: 'var(--calc-support-healing-color)',
  },
  shield: {
    label: 'Shield',
    color: 'var(--calc-support-shield-color)',
  },
}

const EMPTY_FEATURE_CONDITION_CHANGES: RuntimeChange[] = []

function getSupportStyle(aggregationType?: SkillAggregationType) {
  if (!aggregationType || aggregationType === 'damage') {
    return null
  }

  return SUPPORT_STYLE[aggregationType]
}

function getFeatureLabelColor(meta?: FeatureMeta): string {
  const supportStyle = getSupportStyle(meta?.aggregationType)
  if (supportStyle) {
    return supportStyle.color
  }

  return ATTRIBUTE_COLORS[meta?.element ?? 'physical'] ?? '#6c6c6c'
}

function getSkillMenuLabelColor(skill: SkillDefinition): string {
  return getFeatureLabelColor({
    label: skill.label,
    tab: skill.tab,
    archetype: skill.archetype,
    section: skill.sectionTitle,
    skillTypeLabel: getSkillTypeDisplay(skill.skillType).label,
    element: skill.element,
    aggregationType: skill.aggregationType,
    resonatorId: '',
    resonatorName: '',
  })
}

function makeDefaultExpandedTabs(): Record<string, boolean> {
  return Object.fromEntries(ROTATION_SKILL_TAB_ORDER.map((tab) => [tab, true]))
}

function getFeatureVariant(feature: FeatureDefinition): 'skill' | 'subHit' {
  return feature.variant === 'subHit' ? 'subHit' : 'skill'
}

function getSubHitLabel(entry: SkillMenuEntry): string {
  return entry.featureLabel
}

function formatNumber(raw: number): string {
  if (!Number.isFinite(raw) || raw === 0) {
    return '0'
  }

  const rounded = Math.floor(raw)
  if (rounded >= 1e9) return `${(rounded / 1e9).toFixed(1)}B`
  if (rounded >= 1e6) return `${(rounded / 1e6).toFixed(1)}M`
  return rounded.toLocaleString()
}

function sumTotals(entries: SimulationResult['perSkill']): NodeTotals {
  return entries.reduce(
    (total, entry) => {
      total.normal += entry.normal
      total.crit += entry.crit
      total.avg += entry.avg
      return total
    },
    { normal: 0, crit: 0, avg: 0 },
  )
}

function hasTotals(totals: NodeTotals): boolean {
  return totals.normal !== 0 || totals.crit !== 0 || totals.avg !== 0
}

function makeNodeId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}:${crypto.randomUUID()}`
  }

  return `${prefix}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`
}

function makeBlockNode(type: 'repeat' | 'uptime'): Extract<RotationNode, { type: 'repeat' | 'uptime' }> {
  if (type === 'repeat') {
    return {
      id: makeNodeId('rotation:repeat'),
      type: 'repeat',
      times: 1,
      items: [],
      enabled: true,
    }
  }

  return {
    id: makeNodeId('rotation:uptime'),
    type: 'uptime',
    ratio: 1,
    setup: [],
    items: [],
    enabled: true,
  }
}

function getNodeTotals(node: RotationNode, resultMap: Map<string, SimulationResult['perSkill']>): NodeTotals {
  if (node.type === 'feature') {
    return sumTotals(resultMap.get(node.id) ?? [])
  }

  if (node.type === 'condition') {
    return { normal: 0, crit: 0, avg: 0 }
  }

  const children = node.type === 'uptime' ? [...(node.setup ?? []), ...node.items] : node.items

  return children.reduce(
    (total, child) => {
      const childTotals = getNodeTotals(child, resultMap)
      total.normal += childTotals.normal
      total.crit += childTotals.crit
      total.avg += childTotals.avg
      return total
    },
    { normal: 0, crit: 0, avg: 0 },
  )
}

function getNodeMemberIcon(
  node: RotationNode,
  runtime: ResonatorRuntimeState,
  featureMetaById: Record<string, FeatureMeta>,
  conditionChoices: ConditionChoice[],
): NodeMemberIcon | null {
  if (node.type === 'condition') {
    const memberId =
        node.changes[0]?.resonatorId ??
        node.resonatorId ??
        conditionChoices.find((choice) => choice.state.path === node.changes[0]?.path)?.resonatorId
    const member = memberId ? seedResonatorsById[memberId] : null
    return member ? { name: member.name, profile: member.profile ?? '' } : null
  }

  if (runtime.rotation.view !== 'team') {
    return null
  }

  if (node.type === 'feature') {
    const memberId = node.resonatorId ?? featureMetaById[node.featureId]?.resonatorId ?? runtime.id
    const member = seedResonatorsById[memberId]
    return member ? { name: member.name, profile: member.profile ?? '' } : null
  }

  if (!node.resonatorId) {
    return null
  }

  const member = seedResonatorsById[node.resonatorId]
  return member ? { name: member.name, profile: member.profile ?? '' } : null
}

function updateRotationNode(
  items: RotationNode[],
  nodeId: string,
  updater: (node: RotationNode) => RotationNode,
): RotationNode[] {
  return items.map((item) => {
    if (item.id === nodeId) {
      return updater(item)
    }

    if (item.type === 'repeat') {
      return {
        ...item,
        items: updateRotationNode(item.items, nodeId, updater),
      }
    }

    if (item.type === 'uptime') {
      return {
        ...item,
        setup: item.setup ? updateRotationNode(item.setup, nodeId, updater) : item.setup,
        items: updateRotationNode(item.items, nodeId, updater),
      }
    }

    return item
  })
}

function removeRotationNode(items: RotationNode[], nodeId: string): RotationNode[] {
  return items
    .filter((item) => item.id !== nodeId)
    .map((item) => {
      if (item.type === 'repeat') {
        return {
          ...item,
          items: removeRotationNode(item.items, nodeId),
        }
      }

      if (item.type === 'uptime') {
        return {
          ...item,
          setup: item.setup ? removeRotationNode(item.setup, nodeId) : item.setup,
          items: removeRotationNode(item.items, nodeId),
        }
      }

      return item
    })
}

function canInsertNodeIntoBranch(
  node: RotationNode | null | undefined,
  branch: RotationBranch,
): boolean {
  if (!node) {
    return false
  }

  if (branch === 'setup') {
    return node.type === 'condition'
  }

  return true
}

function insertRotationNode(
  items: RotationNode[],
  target: RotationInsertTarget,
  node: RotationNode,
): RotationNode[] {
  if (!canInsertNodeIntoBranch(node, target.branch)) {
    return items
  }

  if (!target.parentId || target.branch === 'root') {
    const nextItems = [...items]
    nextItems.splice(target.index ?? nextItems.length, 0, node)
    return nextItems
  }

  return items.map((item) => {
    if (item.id === target.parentId) {
      if (target.branch === 'items' && (item.type === 'repeat' || item.type === 'uptime')) {
        const nextItems = [...item.items]
        nextItems.splice(target.index ?? nextItems.length, 0, node)
        return {
          ...item,
          items: nextItems,
        }
      }

      if (target.branch === 'setup' && item.type === 'uptime') {
        const nextSetup = [...(item.setup ?? [])]
        nextSetup.splice(target.index ?? nextSetup.length, 0, node)
        return {
          ...item,
          setup: nextSetup,
        }
      }
    }

    if (item.type === 'repeat') {
      return {
        ...item,
        items: insertRotationNode(item.items, target, node),
      }
    }

    if (item.type === 'uptime') {
      return {
        ...item,
        setup: item.setup ? insertRotationNode(item.setup, target, node) : item.setup,
        items: insertRotationNode(item.items, target, node),
      }
    }

    return item
  })
}

function insertRotationNodes(
  items: RotationNode[],
  target: RotationInsertTarget,
  nodes: RotationNode[],
): RotationNode[] {
  return nodes.reduce((nextItems, node, offset) => insertRotationNode(
    nextItems,
    {
      ...target,
      index: target.index === undefined ? undefined : target.index + offset,
    },
    node,
  ), items)
}

function findRotationNode(items: RotationNode[], nodeId: string): RotationNode | null {
  for (const item of items) {
    if (item.id === nodeId) {
      return item
    }

    if (item.type === 'repeat') {
      const found = findRotationNode(item.items, nodeId)
      if (found) {
        return found
      }
    }

    if (item.type === 'uptime') {
      const foundInSetup = item.setup ? findRotationNode(item.setup, nodeId) : null
      if (foundInSetup) {
        return foundInSetup
      }

      const foundInItems = findRotationNode(item.items, nodeId)
      if (foundInItems) {
        return foundInItems
      }
    }
  }

  return null
}

function nodeContainsId(node: RotationNode, targetId: string): boolean {
  if (node.id === targetId) {
    return true
  }

  if (node.type === 'repeat') {
    return node.items.some((item) => nodeContainsId(item, targetId))
  }

  if (node.type === 'uptime') {
    return [...(node.setup ?? []), ...node.items].some((item) => nodeContainsId(item, targetId))
  }

  return false
}

interface RotationNodeLocation {
  parentId: string | null
  branch: RotationBranch
  index: number
  node: RotationNode
}

function findNodeLocation(
  items: RotationNode[],
  nodeId: string,
  parentId: string | null = null,
  branch: RotationBranch = 'root',
): RotationNodeLocation | null {
  for (const [index, item] of items.entries()) {
    if (item.id === nodeId) {
      return { parentId, branch, index, node: item }
    }

    if (item.type === 'repeat') {
      const found = findNodeLocation(item.items, nodeId, item.id, 'items')
      if (found) {
        return found
      }
    }

    if (item.type === 'uptime') {
      const foundInSetup = item.setup ? findNodeLocation(item.setup, nodeId, item.id, 'setup') : null
      if (foundInSetup) {
        return foundInSetup
      }

      const foundInItems = findNodeLocation(item.items, nodeId, item.id, 'items')
      if (foundInItems) {
        return foundInItems
      }
    }
  }

  return null
}

function detachRotationNode(
  items: RotationNode[],
  nodeId: string,
): { node: RotationNode | null; items: RotationNode[] } {
  let detachedNode: RotationNode | null = null

  const nextItems = items
    .filter((item) => {
      if (item.id === nodeId) {
        detachedNode = item
        return false
      }

      return true
    })
    .map((item) => {
      if (item.type === 'repeat') {
        const detached = detachRotationNode(item.items, nodeId)
        if (detached.node) {
          detachedNode = detached.node
          return {
            ...item,
            items: detached.items,
          }
        }
      }

      if (item.type === 'uptime') {
        const detachedFromSetup = item.setup ? detachRotationNode(item.setup, nodeId) : null
        if (detachedFromSetup?.node) {
          detachedNode = detachedFromSetup.node
          return {
            ...item,
            setup: detachedFromSetup.items,
          }
        }

        const detachedFromItems = detachRotationNode(item.items, nodeId)
        if (detachedFromItems.node) {
          detachedNode = detachedFromItems.node
          return {
            ...item,
            items: detachedFromItems.items,
          }
        }
      }

      return item
    })

  return {
    node: detachedNode,
    items: nextItems,
  }
}

function insertNodeAtTarget(items: RotationNode[], target: RotationDropTarget, node: RotationNode): RotationNode[] {
  if (!canInsertNodeIntoBranch(node, target.branch)) {
    return items
  }

  if (!target.parentId || target.branch === 'root') {
    const nextItems = [...items]
    nextItems.splice(target.index, 0, node)
    return nextItems
  }

  return items.map((item) => {
    if (item.id === target.parentId) {
      if (target.branch === 'items' && (item.type === 'repeat' || item.type === 'uptime')) {
        const nextItems = [...item.items]
        nextItems.splice(target.index, 0, node)
        return {
          ...item,
          items: nextItems,
        }
      }

      if (target.branch === 'setup' && item.type === 'uptime') {
        const nextSetup = [...(item.setup ?? [])]
        nextSetup.splice(target.index, 0, node)
        return {
          ...item,
          setup: nextSetup,
        }
      }
    }

    if (item.type === 'repeat') {
      return {
        ...item,
        items: insertNodeAtTarget(item.items, target, node),
      }
    }

    if (item.type === 'uptime') {
      return {
        ...item,
        setup: item.setup ? insertNodeAtTarget(item.setup, target, node) : item.setup,
        items: insertNodeAtTarget(item.items, target, node),
      }
    }

    return item
  })
}

function getAdjacentSkillId(skillId?: string): string | null {
  if (!skillId || !/^\d+$/.test(skillId)) {
    return null
  }

  return String(Number(skillId) + 1)
}

function getPreviousSkillId(skillId?: string): string | null {
  if (!skillId || !/^\d+$/.test(skillId)) {
    return null
  }

  return String(Number(skillId) - 1)
}

function getBranchLength(items: RotationNode[], parentId: string | null, branch: RotationBranch): number {
  if (!parentId || branch === 'root') {
    return items.length
  }

  const parent = findRotationNode(items, parentId)
  if (!parent) {
    return items.length
  }

  if (branch === 'setup' && parent.type === 'uptime') {
    return parent.setup?.length ?? 0
  }

  if (branch === 'items' && (parent.type === 'repeat' || parent.type === 'uptime')) {
    return parent.items.length
  }

  return 0
}

function moveRotationNode(items: RotationNode[], draggedId: string, target: RotationDropTarget): RotationNode[] {
  const source = findNodeLocation(items, draggedId)
  if (!source) {
    return items
  }

  if (!canInsertNodeIntoBranch(source.node, target.branch)) {
    return items
  }

  if (source.parentId === target.parentId && source.branch === target.branch && source.index === target.index) {
    return items
  }

  if (target.parentId) {
    const draggedNode = source.node
    if (nodeContainsId(draggedNode, target.parentId)) {
      return items
    }
  }

  const detached = detachRotationNode(items, draggedId)
  if (!detached.node) {
    return items
  }

  let nextIndex = target.index
  if (source.parentId === target.parentId && source.branch === target.branch && source.index < target.index) {
    nextIndex -= 1
  }

  return insertNodeAtTarget(detached.items, {
    ...target,
    index: Math.max(0, nextIndex),
  }, detached.node)
}

function buildConditionValue(definition: SourceStateDefinition): string | number | boolean {
  if (definition.defaultValue !== undefined) {
    return definition.defaultValue
  }

  if (definition.kind === 'toggle') {
    return true
  }

  if (definition.kind === 'select') {
    return definition.options?.[0]?.id ?? ''
  }

  return Math.max(definition.min ?? 0, definition.kind === 'stack' ? 1 : 0)
}

function renderConditionValueField(
  definition: SourceStateDefinition,
  value: string | number | boolean,
  onChange: (value: string | number | boolean) => void,
) {
  if (definition.kind === 'toggle') {
    const checked = value === true

    return (
      <div className="feature-condition-boolean-stack" role="group" aria-label={`${definition.label} value`}>
        <button
          type="button"
          className={`feature-condition-boolean-stack__btn${checked ? ' is-active' : ''}`}
          aria-pressed={checked}
          onClick={() => onChange(true)}
        >
          True
        </button>
        <button
          type="button"
          className={`feature-condition-boolean-stack__btn${!checked ? ' is-active' : ''}`}
          aria-pressed={!checked}
          onClick={() => onChange(false)}
        >
          False
        </button>
      </div>
    )
  }

  if (definition.kind === 'select') {
    return (
      <LiquidSelect
        value={String(value)}
        options={(definition.options ?? []).map((option) => ({
          value: option.id,
          label: option.label,
        }))}
        onChange={(nextValue) => onChange(nextValue)}
        ariaLabel={`${definition.label} value`}
      />
    )
  }

  return (
    <input
      type="number"
      min={definition.min ?? 0}
      max={definition.max}
      step={definition.kind === 'stack' ? 1 : 0.1}
      className="resonator-level-input"
      value={typeof value === 'number' ? value : Number(value) || 0}
      onChange={(event) => {
        const raw = Number(event.target.value)
        onChange(definition.kind === 'stack' ? Math.floor(raw || 0) : raw || 0)
      }}
    />
  )
}

function formatStateValue(definition: SourceStateDefinition, value: string | number | boolean | undefined): string {
  if (definition.kind === 'toggle') {
    return value === true ? 'True' : 'False'
  }

  if (definition.kind === 'select') {
    return definition.options?.find((option) => option.id === value)?.label ?? String(value ?? '')
  }

  return String(value ?? '')
}

function formatConditionChange(change: RuntimeChange, choice?: ConditionChoice | null): string {
  if (!choice) {
    return formatRuntimeChange(change)
  }

  if (change.type === 'set') {
    if (typeof change.value === "number" && !Number.isNaN(change.value)) {
      return `${choice.label} at ${formatStateValue(choice.state, change.value)} stack${(change.value ?? 0) !== 1 ? 's' : ''}`
    } else if (typeof change.value === "boolean") {
      return `${choice.label} ${change.value ? 'active' : 'inactive'}`
    }
    return `Let ${choice.label} be ${formatStateValue(choice.state, change.value)}`
  }


  if (change.type === 'add') {
    return `${choice.label} + ${String(change.value)}`
  }

  return `${choice.label} = ${formatStateValue(choice.state, change.value ?? true)}`
}

function getConditionChoiceForChange(
  choices: ConditionChoice[],
  change: RuntimeChange | undefined,
  fallbackResonatorId?: string,
): ConditionChoice | null {
  if (!change) {
    return null
  }

  return choices.find(
    (choice) => {
      if (choice.changeTarget === 'enemy') {
        return choice.state.path === change.path
      }

      return choice.resonatorId === (change.resonatorId ?? fallbackResonatorId) &&
        choice.state.path === change.path
    },
  ) ?? null
}

function isNumericConditionState(state: SourceStateDefinition): boolean {
  return state.kind === 'stack' || state.kind === 'number'
}

function normalizeFeatureConditionAction(
  action: FeatureConditionActionType,
  choice: ConditionChoice | null | undefined,
): FeatureConditionActionType {
  return action === 'add' && choice && !isNumericConditionState(choice.state) ? 'set' : action
}

function makeFeatureConditionDraftRow(
  choice: ConditionChoice | undefined,
  action: FeatureConditionActionType = 'set',
): FeatureConditionDraftRow {
  const normalizedAction = normalizeFeatureConditionAction(action, choice)
  return {
    id: makeNodeId('rotation:feature-condition'),
    action: normalizedAction,
    choiceId: choice?.id ?? '',
    value: normalizedAction === 'add' ? 1 : choice ? buildConditionValue(choice.state) : true,
  }
}

function makeFeatureConditionDraftFromChange(
  change: RuntimeChange,
  choices: ConditionChoice[],
  fallbackResonatorId?: string,
): FeatureConditionDraftRow {
  const choice = getConditionChoiceForChange(choices, change, fallbackResonatorId)
  const action = normalizeFeatureConditionAction(change.type === 'add' ? 'add' : 'set', choice)

  return {
    id: makeNodeId('rotation:feature-condition'),
    action,
    choiceId: choice?.id ?? '',
    value: action === 'add'
      ? typeof change.value === 'number'
        ? change.value
        : 1
      : change.type === 'toggle'
        ? (change.value ?? true)
        : change.value,
  }
}

function serializeFeatureConditionDraftRows(
  rows: FeatureConditionDraftRow[],
  choices: ConditionChoice[],
): RuntimeChange[] {
  return rows.reduce<RuntimeChange[]>((changes, row) => {
    const choice = choices.find((entry) => entry.id === row.choiceId)
    if (!choice) {
      return changes
    }

    const action = normalizeFeatureConditionAction(row.action, choice)
    if (action === 'add') {
      const value = Number(row.value)
      const change: RuntimeChange = {
        type: 'add',
        path: choice.state.path,
        value: Number.isFinite(value) ? value : 0,
      }
      if (choice.changeTarget !== 'enemy') {
        change.resonatorId = choice.resonatorId
      }
      changes.push(change)
      return changes
    }

    const change: RuntimeChange = {
      type: 'set',
      path: choice.state.path,
      value: row.value,
    }
    if (choice.changeTarget !== 'enemy') {
      change.resonatorId = choice.resonatorId
    }
    changes.push(change)
    return changes
  }, [])
}

function makeRotationConditionNodeFromChange(
  change: RuntimeChange,
  choices: ConditionChoice[],
  options: {
    id?: string
    enabled?: boolean
    fallbackResonatorId?: string
  } = {},
): Extract<RotationNode, { type: 'condition' }> {
  const choice = getConditionChoiceForChange(choices, change, options.fallbackResonatorId)

  return {
    id: options.id ?? makeNodeId('rotation:condition'),
    type: 'condition',
    resonatorId: change.resonatorId ?? choice?.resonatorId ?? options.fallbackResonatorId,
    label: choice?.label,
    enabled: options.enabled ?? true,
    changes: [change],
  }
}

function formatConditionChoiceLabel(choice: ConditionChoice): string {
  if (!choice.sourceName || choice.label === choice.sourceName || choice.label.startsWith(`${choice.sourceName} `)) {
    return choice.label
  }

  return `${choice.sourceName} · ${choice.label}`
}

function makeConditionChoice(
  member: Pick<RotationMemberEntry, 'id' | 'name' | 'runtime'>,
  state: SourceStateDefinition,
  options?: {
    id?: string
    label?: string
    description?: string
    descriptionParams?: Array<string | number>
    changeTarget?: 'runtime' | 'enemy'
  },
): ConditionChoice {
  const display = getSourceStateDisplay(state)
  const weaponDescriptionParams =
    state.source.type === 'weapon'
      ? (() => {
          const weapon = getWeaponById(state.source.id)
          return weapon ? resolvePassiveParams(weapon.passive.params, member.runtime.build.weapon.rank) : undefined
        })()
      : undefined

  return {
    id: options?.id ?? `${member.id}:${state.controlKey}`,
    resonatorId: member.id,
    resonatorName: member.name,
    sourceName: display.sourceName ?? member.name,
    label: options?.label ?? display.label,
    description: options?.description ?? display.description,
    descriptionParams: options?.descriptionParams ?? weaponDescriptionParams,
    state,
    changeTarget: options?.changeTarget,
  }
}

function parseOptionalIntegerInput(rawValue: string, minimum: number): number | null {
  const trimmed = rawValue.trim()
  if (!trimmed) {
    return null
  }

  const value = Number(trimmed)
  if (!Number.isFinite(value)) {
    return null
  }

  return Math.max(minimum, Math.floor(value))
}

function RotationValues({
  totals,
  aggregationType,
}: {
  totals: NodeTotals
  aggregationType?: SkillAggregationType
}) {
  if (!hasTotals(totals)) {
    return null
  }

  const supportStyle = getSupportStyle(aggregationType)

  if (supportStyle) {
    return (
      <div className="rotation-values">
        <div className="value-cell">
          <span className="value-label value-label--support" style={{ color: supportStyle.color }}>
            {supportStyle.label}
          </span>
          <span className="value value-support-dash" style={{ color: supportStyle.color }}>
            -
          </span>
          <span className="value avg value--support" style={{ color: supportStyle.color }}>
            {formatNumber(totals.avg)}
          </span>
        </div>
      </div>
    )
  }

  return (
    <div className="rotation-values">
      <div className="value-cell">
        <span className="value-label">Normal</span>
        <span className="value">{formatNumber(totals.normal)}</span>
      </div>
      <div className="value-cell">
        <span className="value-label">Crit</span>
        <span className="value">{formatNumber(totals.crit)}</span>
      </div>
      <div className="value-cell">
        <span className="value-label">Avg</span>
        <span className="value avg">{formatNumber(totals.avg)}</span>
      </div>
    </div>
  )
}

function isEntryNode(
  node: RotationNode | null | undefined,
): node is Extract<RotationNode, { type: 'feature' | 'condition' }> {
  return node?.type === 'feature' || node?.type === 'condition'
}

let transparentDragImage: HTMLCanvasElement | null = null

function getTransparentDragImage(): HTMLCanvasElement | null {
  if (typeof document === 'undefined') {
    return null
  }

  if (!transparentDragImage) {
    const canvas = document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    transparentDragImage = canvas
  }

  return transparentDragImage
}

function RotationDragPreview({
  runtime,
  node,
  resultMap,
  featureMetaById,
  conditionChoices,
  compact = false,
}: {
  runtime: ResonatorRuntimeState
  node: Extract<RotationNode, { type: 'feature' | 'condition' }>
  resultMap: Map<string, SimulationResult['perSkill']>
  featureMetaById: Record<string, FeatureMeta>
  conditionChoices: ConditionChoice[]
  compact?: boolean
}) {
  const memberIcon = getNodeMemberIcon(node, runtime, featureMetaById, conditionChoices)

  if (node.type === 'feature') {
    const meta = featureMetaById[node.featureId]
    const totals = getNodeTotals(node, resultMap)
    const attachedChanges = node.changes ?? []

    return (
      <article className={`rotation-item rotation-drag-preview ui-surface-card ui-surface-card--inner ${compact ? 'compact' : ''}`}>
        <div className="rotation-header">
          <div className="rotation-entry-main">
            <span
              className="entry-name rotation-skill-name"
              style={{ color: getFeatureLabelColor(meta) }}
            >
              {meta?.label ?? node.featureId}
            </span>
            <span className="rotation-entry-sub">{meta?.skillTypeLabel ?? 'Feature'}</span>
          </div>
          {memberIcon ? (
            <span className="rotation-node-member-icon" title={memberIcon.name}>
              <img src={memberIcon.profile} alt="" />
            </span>
          ) : null}
        </div>
        {attachedChanges.length > 0 ? (
          <div className="rotation-condition-list">
            {attachedChanges.map((change, changeIndex) => (
              <span key={`${change.path}:${changeIndex}`} className="rotation-condition-chip">
                {formatConditionChange(change, getConditionChoiceForChange(conditionChoices, change, node.resonatorId))}
              </span>
            ))}
          </div>
        ) : null}
        {!compact ? (
          <div className="rotation-footer">
            <RotationValues totals={totals} aggregationType={meta?.aggregationType} />
          </div>
        ) : null}
      </article>
    )
  }

  const displayedChange = node.changes[0]
  const conditionChoice = getConditionChoiceForChange(conditionChoices, displayedChange, node.resonatorId)

  return (
    <article className={`rotation-item rotation-condition rotation-drag-preview ui-surface-card ui-surface-card--inner ${compact ? 'compact' : ''}`}>
      <div className="rotation-header">
        <div className="rotation-entry-main">
          <span className="entry-name">{node.label ?? conditionChoice?.label ?? 'Condition'}</span>
        </div>
        {memberIcon ? (
          <span className="rotation-node-member-icon" title={memberIcon.name}>
            <img src={memberIcon.profile} alt="" />
          </span>
        ) : null}
      </div>
      {displayedChange ? (
        <div className="rotation-condition-list">
          <span className="rotation-condition-chip">{formatConditionChange(displayedChange, conditionChoice)}</span>
        </div>
      ) : null}
    </article>
  )
}

function RotationModalFrame({
  visible,
  open,
  closing = false,
  portalTarget,
  title,
  width = 'regular',
  bodyClassName,
  onClose,
  children,
  footer,
}: {
  visible: boolean
  open: boolean
  closing?: boolean
  portalTarget: HTMLElement | null
  title: string
  width?: 'regular' | 'wide'
  bodyClassName?: string
  onClose: () => void
  children: React.ReactNode
  footer?: React.ReactNode
}) {
  if (!visible || !portalTarget) {
    return null
  }

  return (
    <AppDialog
      visible={visible}
      open={open}
      closing={closing}
      portalTarget={portalTarget}
      overlayClassName="skills-modal-overlay"
      contentClassName={`app-modal-panel skills-modal-content rotation-editor-modal ${width === 'wide' ? 'rotation-editor-modal--wide' : ''}`}
      ariaLabel={title}
      onClose={onClose}
    >
      <div className="app-modal-header">
        <div className="app-modal-header-top">
          <div>
            <div className="panel-overline">Rotation</div>
            <h3 className="panel-heading-title">{title}</h3>
          </div>
          <ModalCloseButton onClick={onClose} />
        </div>
      </div>
      <div
          className={['skills-modal-content-area', 'rotation-editor-modal-body', bodyClassName]
              .filter(Boolean)
              .join(' ')}
      >
        {children}
      </div>
      {footer ? <div className="rotation-modal-footer">{footer}</div> : null}
    </AppDialog>
  )
}

function RotationSkillMenu({
  visible,
  open,
  closing = false,
  portalTarget,
  members,
  activeMemberId,
  defaultShowSubHits = false,
  onActiveMemberChange,
  onClose,
  onSelectSkill,
}: {
  visible: boolean
  open: boolean
  closing?: boolean
  portalTarget: HTMLElement | null
  members: RotationMemberEntry[]
  activeMemberId: string
  defaultShowSubHits?: boolean
  onActiveMemberChange: (resonatorId: string) => void
  onClose: () => void
  onSelectSkill: (entry: SkillMenuEntry) => void
}) {
  const showSubHitsPreference = useAppStore((state) => state.ui.showSubHits)
  const [expandedTabs, setExpandedTabs] = useState<Record<string, boolean>>(() => makeDefaultExpandedTabs())
  const [showSubHits, setShowSubHits] = useState(() => defaultShowSubHits || showSubHitsPreference)

  const activeMember = members.find((member) => member.id === activeMemberId) ?? null
  const activeRuntime = activeMember?.runtime ?? null
  const activeMemberName = activeMember?.name ?? 'Active Member'
  const resolvedSkillsById = useMemo(() => {
    if (!activeMember || !activeRuntime) {
      return {}
    }

    return Object.fromEntries(
      activeMember.skills.map((skill) => [skill.id, resolveSkill(activeRuntime, skill)]),
    ) as Record<string, SkillDefinition>
  }, [activeMember, activeRuntime])
  const entries = useMemo<SkillMenuEntry[]>(() => {
    if (!activeMember) {
      return []
    }

    return activeMember.features.reduce<SkillMenuEntry[]>((list, feature) => {
        const skill = resolvedSkillsById[feature.skillId]
        if (!skill || (activeRuntime && !isSkillVisible(activeRuntime, skill))) {
          return list
        }

        list.push({
          featureId: feature.id,
          resonatorId: activeMember.id,
          resonatorName: activeMember.name,
          featureLabel: feature.label,
          feature,
          skill,
          variant: getFeatureVariant(feature),
          hitIndex: typeof feature.hitIndex === 'number' ? feature.hitIndex : undefined,
        })

        return list
      }, [])
  }, [activeMember, activeRuntime, resolvedSkillsById])

  const groupedEntries = useMemo(() => {
    const grouped: Partial<Record<SkillTabKey, SkillMenuGroup[]>> = {}
    const featuresBySkillId = new Map<string, SkillMenuEntry[]>()

    for (const entry of entries) {
      const current = featuresBySkillId.get(entry.skill.id) ?? []
      current.push(entry)
      featuresBySkillId.set(entry.skill.id, current)
    }

    for (const rawSkill of activeMember?.skills ?? []) {
      const skill = resolvedSkillsById[rawSkill.id] ?? rawSkill
      if (activeRuntime && !isSkillVisible(activeRuntime, skill)) {
        continue
      }

      const skillEntries = featuresBySkillId.get(skill.id) ?? []
      if (skillEntries.length === 0) {
        continue
      }

      const totalEntry = skillEntries.find((entry) => entry.variant === 'skill') ?? skillEntries[0] ?? null
      const subHitEntries = skillEntries
        .filter((entry) => entry.variant === 'subHit')
        .sort((left, right) => (left.hitIndex ?? 0) - (right.hitIndex ?? 0))
      const tabKey = skill.tab as SkillTabKey
      grouped[tabKey] = [
        ...(grouped[tabKey] ?? []),
        {
          resonatorId: activeMember?.id ?? activeMemberId,
          resonatorName: activeMember?.name ?? activeMemberName,
          skill,
          totalEntry,
          subHitEntries,
        },
      ]
    }

    return grouped
  }, [activeMember, activeMemberId, activeMemberName, activeRuntime, entries, resolvedSkillsById])
  const hasSubHitEntries = useMemo(() => entries.some((entry) => entry.variant === 'subHit'), [entries])
  const visibleSkillCount = useMemo(
    () =>
      Object.values(groupedEntries).reduce(
        (total, groups) =>
          total
          + (groups?.reduce((groupTotal, group) => {
            const visibleSubHitCount = showSubHits || !group.totalEntry ? group.subHitEntries.length : 0
            return groupTotal + (group.totalEntry ? 1 : 0) + visibleSubHitCount
          }, 0) ?? 0),
        0,
      ),
    [groupedEntries, showSubHits],
  )

  const toggleTab = (tab: SkillTabKey) => {
    setExpandedTabs((prev) => ({
      ...prev,
      [tab]: !(prev[tab] ?? true),
    }))
  }

  if (!visible || !portalTarget) {
    return null
  }

  return (
    <AppDialog
      visible={visible}
      open={open}
      closing={closing}
      portalTarget={portalTarget}
      contentClassName="app-modal-panel skill-menu-panel"
      ariaLabel="Select a skill"
      onClose={onClose}
    >
      <div onClick={(event) => event.stopPropagation()}>
        <div className="pane-section app-modal-header menu-header-with-buttons">
          <div className="app-modal-header-top">
            <div className="menu-header">
              <div className="panel-overline">Rotation</div>
              <h3 className="panel-heading-title">Add Feature Step</h3>
            </div>
            <div className="skill-menu-summary">
              <div className="picker-modal__summary-pill checkbox">
                <span className="picker-modal__summary-label">Sub-Hits</span>
                <input
                  type="checkbox"
                  className="picker-modal__summary-value"
                  checked={showSubHits}
                  disabled={!hasSubHitEntries}
                  onChange={(event) => setShowSubHits(event.target.checked)}
                />
              </div>
              {members.length > 1 ? (
                <div className="picker-modal__summary-pill">
                  <span className="picker-modal__summary-label">Member</span>
                  <span className="picker-modal__summary-value">{activeMemberName}</span>
                </div>
              ) : null}
              <div className="picker-modal__summary-pill">
                <span className="picker-modal__summary-label">Skills</span>
                <span className="picker-modal__summary-value">{visibleSkillCount}</span>
              </div>
              <ModalCloseButton onClick={onClose} />
            </div>
          </div>
          {members.length > 1 ? (
            <div className="rotation-view-toggle skill-menu-member-toggle">
              {members.map((member) => (
                <button
                  key={member.id}
                  type="button"
                  className={member.id === activeMemberId ? 'view-toggle-button active' : 'view-toggle-button'}
                  onClick={() => onActiveMemberChange(member.id)}
                >
                  {member.name}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className="skill-menu-list">
          {ROTATION_SKILL_TAB_ORDER.map((tabKey) => {
            const groups = groupedEntries[tabKey]
            if (!groups?.length) {
              return null
            }

            return (
              <div key={tabKey} className={`skill-tab-section ${expandedTabs[tabKey] ? 'open' : 'closed'}`}>
                <button type="button" className="skill-tab-label collapsible-label" onClick={() => toggleTab(tabKey)}>
                  <span>{SKILL_TAB_LABELS[tabKey]}</span>
                  <span className={expandedTabs[tabKey] ? 'sequence-card-status active' : 'sequence-card-status'}>
                    {groups.length} {groups.length === 1 ? 'Skill' : 'Skills'}
                  </span>
                </button>

                <div className={`skill-tab-content ${expandedTabs[tabKey] ? 'open' : 'closed'}`}>
                  {groups.map((group) => {
                    const meta = getSkillTypeDisplay(group.skill.skillType)
                    const shouldShowSubHitEntries = showSubHits || !group.totalEntry

                    return (
                      <div key={`${group.resonatorId}:${group.skill.id}`} className="skill-option-group">
                        {group.totalEntry ? (
                          <button
                            type="button"
                            className="skill-option"
                            onClick={() => onSelectSkill(group.totalEntry!)}
                          >
                            <div className="dropdown-item-content">
                              <div className="dropdown-main">
                                <span style={{ color: getSkillMenuLabelColor(group.skill) }}>
                                  {group.skill.label}
                                </span>
                              </div>
                              {group.subHitEntries.length ? (
                                <span className="dropdown-icons">
                                  {group.subHitEntries.length} Hits
                                </span>
                              ) : null}
                              <div className="dropdown-icons">
                                {meta.icon ? (
                                  <img
                                    src={meta.icon}
                                    alt=""
                                    aria-hidden="true"
                                    className="skill-type-icon"
                                  />
                                ) : null}
                                <span>{meta.label}</span>
                              </div>
                            </div>
                          </button>
                        ) : null}

                        {shouldShowSubHitEntries && group.subHitEntries.length ? (
                          <div className="skill-subhit-list">
                            {group.subHitEntries.map((entry) => (
                              <button
                                key={`${entry.resonatorId}:${entry.featureId}`}
                                type="button"
                                className="skill-option skill-option--subhit"
                                onClick={() => onSelectSkill(entry)}
                              >
                                <div className="dropdown-item-content">
                                  <div className="dropdown-main">
                                    <span style={{ color: getSkillMenuLabelColor(entry.skill) }}>
                                      {getSubHitLabel(entry)}
                                    </span>
                                  </div>
                                </div>
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </AppDialog>
  )
}

function FeatureConditionsModal({
  visible,
  open,
  closing = false,
  portalTarget,
  choices,
  initialChanges,
  featureLabel,
  eyebrow = 'Feature Conditions',
  emptyText = 'Select a state from the picker to attach a condition.',
  onClose,
  onSave,
}: {
  visible: boolean
  open: boolean
  closing?: boolean
  portalTarget: HTMLElement | null
  choices: ConditionChoice[]
  initialChanges: RuntimeChange[]
  featureLabel: string
  eyebrow?: string
  emptyText?: string
  onClose: () => void
  onSave: (changes: RuntimeChange[]) => void
}) {
  const [rows, setRows] = useState<FeatureConditionDraftRow[]>([])
  const [activeRowId, setActiveRowId] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  useEffect(() => {
    if (!visible) {
      return
    }

    const nextRows = initialChanges.map((change) => makeFeatureConditionDraftFromChange(change, choices))
    setRows(nextRows)
    setActiveRowId(nextRows[0]?.id ?? null)
    setQuery('')
  }, [choices, initialChanges, visible])

  const activeRow = rows.find((row) => row.id === activeRowId) ?? null
  const normalizedQuery = query.trim().toLowerCase()
  const filteredChoices = useMemo(() => {
    if (!normalizedQuery) {
      return choices
    }

    return choices.filter((choice) =>
      [
        choice.label,
        choice.sourceName,
        choice.resonatorName,
        formatConditionChoiceLabel(choice),
      ].some((value) => value.toLowerCase().includes(normalizedQuery)),
    )
  }, [choices, normalizedQuery])
  const groupedChoices = useMemo(() => {
    const groups: Array<{ key: string; label: string; choices: ConditionChoice[] }> = []
    const groupByKey = new Map<string, { key: string; label: string; choices: ConditionChoice[] }>()

    for (const choice of filteredChoices) {
      const key = `${choice.resonatorId}:${choice.sourceName}`
      const label = choice.sourceName === choice.resonatorName
        ? choice.resonatorName
        : `${choice.resonatorName} · ${choice.sourceName}`
      let group = groupByKey.get(key)
      if (!group) {
        group = { key, label, choices: [] }
        groupByKey.set(key, group)
        groups.push(group)
      }
      group.choices.push(choice)
    }

    return groups
  }, [filteredChoices])

  const updateRow = (rowId: string, updater: (row: FeatureConditionDraftRow) => FeatureConditionDraftRow) => {
    setRows((current) => current.map((row) => (row.id === rowId ? updater(row) : row)))
  }

  const addRow = () => {
    const nextRow = makeFeatureConditionDraftRow(choices[0])
    setRows((current) => [...current, nextRow])
    setActiveRowId(nextRow.id)
  }

  const removeRow = (rowId: string) => {
    setRows((current) => {
      const nextRows = current.filter((row) => row.id !== rowId)
      if (activeRowId === rowId) {
        setActiveRowId(nextRows[0]?.id ?? null)
      }
      return nextRows
    })
  }

  const selectChoiceForActiveRow = (choice: ConditionChoice) => {
    if (!activeRow) {
      const nextRow = makeFeatureConditionDraftRow(choice)
      setRows((current) => [...current, nextRow])
      setActiveRowId(nextRow.id)
      return
    }

    updateRow(activeRow.id, (row) => {
      const action = normalizeFeatureConditionAction(row.action, choice)
      return {
        ...row,
        action,
        choiceId: choice.id,
        value: action === 'add' ? 1 : buildConditionValue(choice.state),
      }
    })
  }

  const renderRowValueField = (row: FeatureConditionDraftRow, choice: ConditionChoice | undefined) => {
    if (!choice) {
      return <span className="feature-conditions-row__missing">Select a state</span>
    }

    if (row.action === 'add') {
      return (
        <input
          type="number"
          className="resonator-level-input feature-conditions-row__value"
          step={choice.state.kind === 'stack' ? 1 : 0.1}
          value={typeof row.value === 'number' ? row.value : Number(row.value) || 0}
          onChange={(event) => {
            const raw = Number(event.target.value)
            updateRow(row.id, (current) => ({
              ...current,
              value: choice.state.kind === 'stack' ? Math.floor(raw || 0) : raw || 0,
            }))
          }}
        />
      )
    }

    return renderConditionValueField(choice.state, row.value, (value) => {
      updateRow(row.id, (current) => ({
        ...current,
        value,
      }))
    })
  }

  if (!visible || !portalTarget) {
    return null
  }

  return (
    <AppDialog
      visible={visible}
      open={open}
      closing={closing}
      portalTarget={portalTarget}
      contentClassName="app-modal-panel feature-conditions-modal"
      ariaLabel="Set feature conditions"
      onClose={onClose}
    >
      <div className="feature-conditions-root">
        <div className="feature-conditions-header">
          <div>
            <span className="feature-conditions-eyebrow">{eyebrow}</span>
            <h2 className="feature-conditions-title">{featureLabel}</h2>
          </div>
          <ModalCloseButton onClick={onClose} />
        </div>

        <div className="feature-conditions-body">
          <section className="feature-conditions-panel feature-conditions-panel--rows">
            <div className="feature-conditions-panel-head">
              <span>Attached Conditions</span>
              <button
                type="button"
                className="block-icon-button"
                title="Add condition"
                onClick={addRow}
                disabled={choices.length === 0}
              >
                <Plus size={15} />
              </button>
            </div>

            <div className="feature-conditions-row-list">
              {rows.length === 0 ? (
                <div className="soft-empty feature-conditions-empty">
                  {emptyText}
                </div>
              ) : (
                rows.map((row, rowIndex) => {
                  const choice = choices.find((entry) => entry.id === row.choiceId)
                  const canAdd = choice ? isNumericConditionState(choice.state) : false
                  const action = normalizeFeatureConditionAction(row.action, choice)
                  const isActive = activeRowId === row.id
                  const hasDescription = Boolean(choice?.description)

                  return (
                    <article
                      key={row.id}
                      className={`feature-conditions-row${isActive ? ' active' : ''}${isActive && hasDescription ? ' expanded' : ''}`}
                      onClick={() => setActiveRowId(row.id)}
                    >
                      <div className="feature-conditions-row__top">
                        <button
                          type="button"
                          className="feature-conditions-row__state"
                          onClick={() => setActiveRowId(row.id)}
                        >
                          <span className="feature-conditions-row__index">#{rowIndex + 1}</span>
                          <strong>{choice ? formatConditionChoiceLabel(choice) : 'Select a state'}</strong>
                        </button>
                        <button
                          type="button"
                          className="block-icon-button delete"
                          title="Remove condition"
                          onClick={(event) => {
                            event.stopPropagation()
                            removeRow(row.id)
                          }}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>

                      <div className="feature-conditions-row__controls">
                        <div className="feature-conditions-action-toggle" aria-label="Condition action">
                          <button
                            type="button"
                            className={action === 'set' ? 'active' : ''}
                            onClick={(event) => {
                              event.stopPropagation()
                              updateRow(row.id, (current) => ({
                                ...current,
                                action: 'set',
                                value: choice ? buildConditionValue(choice.state) : true,
                              }))
                            }}
                          >
                            Set
                          </button>
                          <button
                            type="button"
                            className={action === 'add' ? 'active' : ''}
                            disabled={!canAdd}
                            onClick={(event) => {
                              event.stopPropagation()
                              updateRow(row.id, (current) => ({
                                ...current,
                                action: 'add',
                                value: 1,
                              }))
                            }}
                          >
                            Add
                          </button>
                        </div>
                        {renderRowValueField({ ...row, action }, choice)}
                      </div>

                      {isActive && choice?.description ? (
                        <div
                          className="feature-conditions-row__description"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <RichDescription description={choice.description} params={choice.descriptionParams} />
                        </div>
                      ) : null}
                    </article>
                  )
                })
              )}
            </div>
          </section>

          <section className="feature-conditions-panel feature-conditions-panel--picker">
            <div className="feature-conditions-panel-head">
              <div className="feature-conditions-panel-head__head">
                <span>State Picker</span>
                <small>{activeRow ? 'Editing selected row' : 'Choose a state to add'}</small>
              </div>
              <div className="feature-conditions-search">
                <Search size={14} />
                <input
                    type="search"
                    value={query}
                    placeholder="Search states"
                    onChange={(event) => setQuery(event.target.value)}
                />
              </div>
            </div>

            <div className="feature-conditions-picker-list">
              {choices.length === 0 ? (
                <div className="soft-empty feature-conditions-empty">
                  No states are available for this rotation.
                </div>
              ) : groupedChoices.length === 0 ? (
                <div className="soft-empty feature-conditions-empty">
                  No states match that search.
                </div>
              ) : (
                groupedChoices.map((group) => (
                  <div key={group.key} className="feature-conditions-choice-group">
                    <span className="feature-conditions-choice-group__label">{group.label}</span>
                    <div className="feature-conditions-choice-grid">
                      {group.choices.map((choice) => (
                        <button
                          key={choice.id}
                          type="button"
                          className={activeRow?.choiceId === choice.id ? 'feature-conditions-choice active' : 'feature-conditions-choice'}
                          onClick={() => selectChoiceForActiveRow(choice)}
                        >
                          <strong>{formatConditionChoiceLabel(choice)}</strong>
                        </button>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>

        <div className="feature-conditions-footer">
          <button type="button" className="rotation-button clear" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="rotation-button"
            onClick={() => onSave(serializeFeatureConditionDraftRows(rows, choices))}
          >
            Save
          </button>
        </div>
      </div>
    </AppDialog>
  )
}

function NegativeEffectConfigModal({
  visible,
  open,
  closing = false,
  portalTarget,
  initialNode,
  featureMeta,
  onClose,
  onSave,
}: {
  visible: boolean
  open: boolean
  closing?: boolean
  portalTarget: HTMLElement | null
  initialNode: Extract<RotationNode, { type: 'feature' }> | null
  featureMeta?: FeatureMeta
  onClose: () => void
  onSave: (config: {
    negativeEffectInstances?: number
    negativeEffectStableWidth?: number
  }) => void
}) {
  const [draft, setDraft] = useState(() => createNegativeEffectConfigDraft(initialNode))

  const attribute = getNegativeEffectAttribute(featureMeta?.archetype)
  const instancesPreview = parseOptionalIntegerInput(draft.instancesInput, 1)
    ?? initialNode?.negativeEffectInstances
    ?? 1
  const stableWidthPreview = parseOptionalIntegerInput(draft.stableWidthInput, 1)
    ?? initialNode?.negativeEffectStableWidth
    ?? 1

  return (
    <RotationModalFrame
      visible={visible}
      open={open}
      closing={closing}
      portalTarget={portalTarget}
      title="Negative Effect Series"
      bodyClassName="rotation-editor-modal-body--condition"
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="rotation-button clear" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="rotation-button"
            onClick={() => {
              onSave(serializeNegativeEffectConfigDraft(draft))
            }}
          >
            Save
          </button>
        </>
      )}
    >
      <div className="rotation-condition-modal">
        <div className="rotation-condition-panel">
          <div className="rotation-condition-grid rotation-negative-effect-grid">
            <div className="rotation-inline-field rotation-inline-field--wide ui-inline-field ui-inline-field--wide">
              <span>Instances</span>
              <input
                type="number"
                min={1}
                step={1}
                className="resonator-level-input"
                value={draft.instancesInput}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    instancesInput: event.target.value,
                    instancesTouched: true,
                  }))
                }
              />
            </div>
            <div className="rotation-inline-field rotation-inline-field--wide ui-inline-field ui-inline-field--wide">
              <span>Stable Width</span>
              <input
                type="number"
                min={1}
                step={1}
                className="resonator-level-input"
                value={draft.stableWidthInput}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    stableWidthInput: event.target.value,
                    stableWidthTouched: true,
                  }))
                }
              />
            </div>
          </div>
        </div>

        <div className="rotation-condition-panel rotation-condition-panel--description">
          <div className="rotation-negative-effect-summary">
            {attribute ? (
              <span className="rotation-negative-effect-summary__icon">
                <img src={`/assets/attributes/attributes alt/${attribute}.webp`} alt="" aria-hidden="true" />
              </span>
            ) : null}
            <div className="rotation-negative-effect-summary__copy">
              <strong>{featureMeta?.label ?? 'Negative Effect'}</strong>
              <span>
                Count {instancesPreview} instance{instancesPreview === 1 ? '' : 's'} and keep each stack value for {stableWidthPreview} instance{stableWidthPreview === 1 ? '' : 's'} before lowering it.
              </span>
            </div>
          </div>
        </div>
      </div>
    </RotationModalFrame>
  )
}

function BlockPickerModal({
  visible,
  open,
  closing = false,
  portalTarget,
  onClose,
  onSelect,
}: {
  visible: boolean
  open: boolean
  closing?: boolean
  portalTarget: HTMLElement | null
  onClose: () => void
  onSelect: (type: 'repeat' | 'uptime') => void
}) {
  return (
    <RotationModalFrame
      visible={visible}
      open={open}
      closing={closing}
      portalTarget={portalTarget}
      title="Add Block"
      onClose={onClose}
    >
      <div className="rotation-block-picker">
        <button type="button" className="rotation-block-choice" onClick={() => onSelect('repeat')}>
          <strong>Repeat</strong>
          <span>Repeat a nested list a fixed number of times.</span>
        </button>
        <button type="button" className="rotation-block-choice" onClick={() => onSelect('uptime')}>
          <strong>Uptime</strong>
          <span>Run a weighted branch with optional setup nodes.</span>
        </button>
      </div>
    </RotationModalFrame>
  )
}

const ROTATION_INLINE_ADD_MENU_WIDTH = 168
const ROTATION_INLINE_ADD_MENU_OFFSET = 8
const ROTATION_INLINE_ADD_MENU_VIEWPORT_PADDING = 12

function RotationInlineAddMenu({
  portalTarget,
  allowFeature = true,
  allowCondition = true,
  allowBlock = true,
  onAddFeature,
  onAddCondition,
  onAddBlock,
}: {
  portalTarget: HTMLElement | null
  allowFeature?: boolean
  allowCondition?: boolean
  allowBlock?: boolean
  onAddFeature: () => void
  onAddCondition: () => void
  onAddBlock: () => void
}) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const frameRef = useRef<number | null>(null)
  const [open, setOpen] = useState(false)
  const [placement, setPlacement] = useState<'up' | 'down'>('down')
  const [menuLayout, setMenuLayout] = useState<CSSProperties>({
    left: `${ROTATION_INLINE_ADD_MENU_VIEWPORT_PADDING}px`,
    top: `${ROTATION_INLINE_ADD_MENU_VIEWPORT_PADDING}px`,
    width: `${ROTATION_INLINE_ADD_MENU_WIDTH}px`,
  })
  const visibleOptionCount = [allowFeature, allowCondition, allowBlock].filter(Boolean).length
  const resolvedPortalTarget = portalTarget ?? getBodyPortalTarget()

  const closeMenu = useCallback(() => {
    setOpen(false)
  }, [])

  const clearMeasureFrame = useCallback(() => {
    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current)
      frameRef.current = null
    }
  }, [])

  const measureMenu = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) {
      return
    }

    const estimatedHeight = 18 + visibleOptionCount * 42
    const spaceBelow = window.innerHeight - rect.bottom - ROTATION_INLINE_ADD_MENU_VIEWPORT_PADDING
    const spaceAbove = rect.top - ROTATION_INLINE_ADD_MENU_VIEWPORT_PADDING
    const openUpward = spaceBelow < estimatedHeight && spaceAbove > spaceBelow
    const width = Math.min(
      ROTATION_INLINE_ADD_MENU_WIDTH,
      window.innerWidth - ROTATION_INLINE_ADD_MENU_VIEWPORT_PADDING * 2,
    )
    const left = Math.min(
      Math.max(ROTATION_INLINE_ADD_MENU_VIEWPORT_PADDING, rect.right - width),
      Math.max(
        ROTATION_INLINE_ADD_MENU_VIEWPORT_PADDING,
        window.innerWidth - ROTATION_INLINE_ADD_MENU_VIEWPORT_PADDING - width,
      ),
    )

    setPlacement(openUpward ? 'up' : 'down')
    setMenuLayout({
      left: `${left}px`,
      width: `${width}px`,
      top: openUpward ? undefined : `${rect.bottom + ROTATION_INLINE_ADD_MENU_OFFSET}px`,
      bottom: openUpward ? `${window.innerHeight - rect.top + ROTATION_INLINE_ADD_MENU_OFFSET}px` : undefined,
    })
  }, [visibleOptionCount])

  const scheduleMeasureMenu = useCallback(() => {
    clearMeasureFrame()
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null
      measureMenu()
    })
  }, [clearMeasureFrame, measureMenu])

  useEffect(() => {
    if (!open) {
      return
    }

    scheduleMeasureMenu()
    menuRef.current?.focus()

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return
      }

      closeMenu()
    }

    const handleWindowChange = () => {
      scheduleMeasureMenu()
    }

    document.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('scroll', handleWindowChange, true)
    window.addEventListener('resize', handleWindowChange)

    return () => {
      clearMeasureFrame()
      document.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('scroll', handleWindowChange, true)
      window.removeEventListener('resize', handleWindowChange)
    }
  }, [clearMeasureFrame, closeMenu, open, scheduleMeasureMenu])

  useEffect(() => clearMeasureFrame, [clearMeasureFrame])

  const handleSelect = useCallback((action: () => void) => {
    closeMenu()
    action()
  }, [closeMenu])

  const menu =
    open && resolvedPortalTarget
      ? createPortal(
          <div
            ref={menuRef}
            className="rotation-inline-add-popover"
            data-placement={placement}
            style={menuLayout}
            tabIndex={-1}
            role="menu"
            onKeyDown={(event) => {
              if (event.key === 'Escape' || event.key === 'Tab') {
                closeMenu()
              }
            }}
          >
            <button
              type="button"
              className="rotation-inline-add-option"
              role="menuitem"
              disabled={!allowFeature}
              onClick={() => handleSelect(onAddFeature)}
            >
              <span>Feature</span>
              <span className="rotation-inline-add-option__hint">Skill step</span>
            </button>
            <button
              type="button"
              className="rotation-inline-add-option"
              role="menuitem"
              disabled={!allowCondition}
              onClick={() => handleSelect(onAddCondition)}
            >
              <span>Condition</span>
              <span className="rotation-inline-add-option__hint">State change</span>
            </button>
            <button
              type="button"
              className="rotation-inline-add-option"
              role="menuitem"
              disabled={!allowBlock}
              onClick={() => handleSelect(onAddBlock)}
            >
              <span>Block</span>
              <span className="rotation-inline-add-option__hint">Repeat or uptime</span>
            </button>
          </div>,
          resolvedPortalTarget,
        )
      : null

  return (
    <div ref={rootRef} className="rotation-inline-add-menu">
      <button
        ref={triggerRef}
        type="button"
        className={`block-icon-button${open ? ' active' : ''}`}
        title="Add below"
        aria-label="Add below this rotation item"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          if (open) {
            closeMenu()
          } else {
            scheduleMeasureMenu()
            setOpen(true)
          }
        }}
      >
        <GrLinkDown size={15} />
      </button>
      {menu}
    </div>
  )
}

function RotationNodeCard({
  children,
  depth,
  disabled,
  draggable = false,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
  isDragOver = false,
  isDragging = false,
}: {
  children: React.ReactNode
  depth: number
  disabled?: boolean
  draggable?: boolean
  onDragStart?: (event: React.DragEvent<HTMLDivElement>) => void
  onDragEnd?: () => void
  onDragOver?: (event: React.DragEvent<HTMLDivElement>) => void
  onDragLeave?: () => void
  onDrop?: (event: React.DragEvent<HTMLDivElement>) => void
  isDragOver?: boolean
  isDragging?: boolean
}) {
  const style = {
    '--rotation-depth': depth,
  } as CSSProperties

  return (
    <div
      className={`rotation-item-wrapper ${disabled ? 'disabled' : ''} ${isDragOver ? 'drag-over' : ''} ${isDragging ? 'dragging' : ''}`}
      style={style}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {children}
    </div>
  )
}

function RotationTreeNode({
  portalTarget,
  runtime,
  runtimesById,
  treeItems,
  node,
  depth,
  parentId,
  branch,
  index,
  resultMap,
  featureMetaById,
  adjacentFeatureById,
  previousFeatureById,
  conditionChoices,
  collapsedIds,
  defaultFeatureMemberId,
  draggedId,
  draggedNode,
  dragOverKey,
  dragOverArea,
  onDragStart,
  onDragEnd,
  onDragOverTarget,
  onMoveNode,
  onToggleCollapse,
  onDeleteNode,
  onOpenFeatureMenu,
  onOpenNegativeEffectConfig,
  onOpenConditionEditor,
  onOpenFeatureConditionEditor,
  onOpenBlockPicker,
  onUpdateNode,
  onInsertNodeAt,
}: {
  portalTarget: HTMLElement | null
  runtime: ResonatorRuntimeState
  runtimesById: Record<string, ResonatorRuntimeState>
  treeItems: RotationNode[]
  node: RotationNode
  depth: number
  parentId: string | null
  branch: RotationBranch
  index: number
  resultMap: Map<string, SimulationResult['perSkill']>
  featureMetaById: Record<string, FeatureMeta>
  adjacentFeatureById: Record<string, string | undefined>
  previousFeatureById: Record<string, string | undefined>
  conditionChoices: ConditionChoice[]
  collapsedIds: Record<string, boolean>
  defaultFeatureMemberId: string
  draggedId: string | null
  draggedNode: RotationNode | null
  dragOverKey: string | null
  dragOverArea: RotationDragArea | null
  onDragStart: (nodeId: string) => void
  onDragEnd: () => void
  onDragOverTarget: (key: string | null, area: RotationDragArea | null) => void
  onMoveNode: (draggedNodeId: string, target: RotationDropTarget) => void
  onToggleCollapse: (nodeId: string) => void
  onDeleteNode: (nodeId: string) => void
  onOpenFeatureMenu: (state: FeatureMenuState) => void
  onOpenNegativeEffectConfig: (state: NegativeEffectConfigState) => void
  onOpenConditionEditor: (state: ConditionEditorState) => void
  onOpenFeatureConditionEditor: (state: FeatureConditionEditorState) => void
  onOpenBlockPicker: (target: RotationInsertTarget) => void
  onUpdateNode: (nodeId: string, updater: (node: RotationNode) => RotationNode) => void
  onInsertNodeAt: (target: RotationDropTarget, node: RotationNode) => void
}) {
  const collapsed = collapsedIds[node.id] ?? false
  const totals = getNodeTotals(node, resultMap)
  const dragKey = `${parentId ?? 'root'}:${branch}:${index}`
  const isDragOver = dragOverKey === dragKey
  const dragArea: RotationDragArea = branch === 'setup' ? 'block-setup' : branch === 'items' ? 'block-items' : 'root'
  const disabled = !(node.enabled ?? true)
  const canDropDraggedNodeHere = canInsertNodeIntoBranch(draggedNode, branch)
  const addBelowTarget: RotationInsertTarget = {
    parentId,
    branch,
    index: index + 1,
  }
  const allowAddFeatureBelow = branch !== 'setup'
  const allowAddBlockBelow = branch !== 'setup'
  const conditionChoice =
    node.type === 'condition'
      ? conditionChoices.find(
          (choice) =>
            choice.resonatorId === (node.changes[0]?.resonatorId ?? node.resonatorId) &&
            choice.state.path === node.changes[0]?.path,
        )
      : null

  const sharedDragProps = {
    draggable: draggedId !== node.id,
    onDragStart: (event: React.DragEvent<HTMLDivElement>) => {
      event.stopPropagation()
      event.dataTransfer.effectAllowed = 'move'
      const dragImage = getTransparentDragImage()
      if (dragImage) {
        event.dataTransfer.setDragImage(dragImage, 0, 0)
      }
      onDragStart(node.id)
    },
    onDragEnd,
    onDragOver: (event: React.DragEvent<HTMLDivElement>) => {
      if (!canDropDraggedNodeHere) {
        return
      }

      event.preventDefault()
      event.stopPropagation()
      onDragOverTarget(dragKey, dragArea)
    },
    onDragLeave: () => onDragOverTarget(null, null),
    onDrop: (event: React.DragEvent<HTMLDivElement>) => {
      if (!canDropDraggedNodeHere) {
        return
      }

      event.preventDefault()
      event.stopPropagation()
      if (!draggedId || draggedId === node.id) {
        return
      }

      onMoveNode(draggedId, {
        parentId,
        branch,
        index,
        key: dragKey,
      })
    },
  }

  if (node.type === 'feature') {
    const meta = featureMetaById[node.featureId]
    const orphaned = !meta
    const adjacentFeatureId = adjacentFeatureById[node.featureId]
    const previousFeatureId = previousFeatureById[node.featureId]
    const memberIcon = getNodeMemberIcon(node, runtime, featureMetaById, conditionChoices)
    const isNegativeEffectFeature = meta?.tab === 'negativeEffect'
    const usesFixedNegativeEffectStacks = Boolean(meta?.fixedStacks)
    const negativeEffectAttribute = getNegativeEffectAttribute(meta?.archetype)
    const attachedChanges = node.changes ?? []

    if (orphaned) {
      return (
        <RotationNodeCard depth={depth} disabled={disabled} isDragOver={isDragOver} isDragging={draggedId === node.id} {...sharedDragProps}>
          <article className="rotation-item rotation-item--orphaned">
            <div className="rotation-entry-main">
              <span className="entry-name rotation-skill-name">Invalid Feature</span>
            </div>
            <div className="rotation-node-actions">
              <button type="button" className="block-icon-button delete" title="Delete" onClick={() => onDeleteNode(node.id)}>
                <Trash2 size={15} />
              </button>
            </div>
          </article>
        </RotationNodeCard>
      )
    }

    return (
      <RotationNodeCard depth={depth} disabled={disabled} isDragOver={isDragOver} isDragging={draggedId === node.id} {...sharedDragProps}>
        <article className="rotation-item">
          <div className="rotation-header">
            <div className="rotation-entry-main">
              <span
                className="entry-name rotation-skill-name"
                style={{ color: getFeatureLabelColor(meta) }}
              >
                {meta?.label ?? node.featureId}
              </span>
            </div>
            <div className="rotation-node-actions">
              {previousFeatureId ? (
                <button
                  type="button"
                  className="block-icon-button"
                  title="Replace with previous skill"
                  onClick={() =>
                    onUpdateNode(node.id, (current) =>
                      current.type === 'feature'
                        ? {
                            ...current,
                            featureId: previousFeatureId,
                            resonatorId: current.resonatorId ?? meta?.resonatorId ?? runtime.id,
                          }
                        : current,
                    )
                  }
                >
                  <ChevronsLeft size={15} />
                </button>
              ) : null}
              {adjacentFeatureId ? (
                <>
                  <button
                    type="button"
                    className="block-icon-button"
                    title="Add adjacent skill"
                    onClick={() =>
                      onInsertNodeAt(
                        {
                          parentId,
                          branch,
                          index: index + 1,
                          key: `${parentId ?? 'root'}:${branch}:${index + 1}:adjacent`,
                        },
                        {
                          id: makeNodeId('rotation:feature'),
                          type: 'feature',
                          resonatorId: node.resonatorId ?? meta?.resonatorId ?? runtime.id,
                          featureId: adjacentFeatureId,
                          multiplier: 1,
                          enabled: true,
                        },
                      )
                    }
                  >
                    <ChevronsDown size={15} />
                  </button>
                  <button
                    type="button"
                    className="block-icon-button"
                    title="Replace with adjacent skill"
                    onClick={() =>
                      onUpdateNode(node.id, (current) =>
                        current.type === 'feature'
                          ? {
                              ...current,
                              featureId: adjacentFeatureId,
                              resonatorId: current.resonatorId ?? meta?.resonatorId ?? runtime.id,
                            }
                          : current,
                      )
                    }
                  >
                    <ChevronsRight size={15} />
                  </button>
                </>
              ) : null}
              <button
                type="button"
                className="block-icon-button"
                title="Edit feature"
                onClick={() =>
                  onOpenFeatureMenu({
                    mode: 'edit',
                    nodeId: node.id,
                    activeMemberId: node.resonatorId ?? runtime.id,
                  })
                }
              >
                <Pencil size={15} />
              </button>
              {isNegativeEffectFeature && !usesFixedNegativeEffectStacks ? (
                <button
                  type="button"
                  className="block-icon-button rotation-negative-effect-button"
                  title="Configure negative effect series"
                  onClick={() => onOpenNegativeEffectConfig({ nodeId: node.id })}
                >
                  {negativeEffectAttribute ? (
                    <img
                      src={`/assets/attributes/attributes alt/${negativeEffectAttribute}.webp`}
                      alt=""
                      aria-hidden="true"
                      className="rotation-negative-effect-button__icon"
                    />
                  ) : (
                    <span className="entry-detail-text">DOT</span>
                  )}
                </button>
              ) : null}
              <button
                  type="button"
                  className="block-icon-button"
                  onClick={() => onOpenFeatureConditionEditor({ nodeId: node.id })}
                  aria-label="Set/Add Condition"
                  title="Set/Add Condition"
              >
                <PiPlusBold />
              </button>
              <RotationInlineAddMenu
                portalTarget={portalTarget}
                allowFeature={allowAddFeatureBelow}
                allowCondition
                allowBlock={allowAddBlockBelow}
                onAddFeature={() =>
                  onOpenFeatureMenu({
                    mode: 'add',
                    activeMemberId: node.resonatorId ?? meta?.resonatorId ?? defaultFeatureMemberId,
                    target: addBelowTarget,
                  })
                }
                onAddCondition={() => onOpenConditionEditor({ mode: 'add', target: addBelowTarget })}
                onAddBlock={() => onOpenBlockPicker(addBelowTarget)}
              />
              <button
                type="button"
                className="block-icon-button power"
                title={disabled ? 'Enable feature' : 'Disable feature'}
                onClick={() => onUpdateNode(node.id, (current) => ({ ...current, enabled: !(current.enabled ?? true) }))}
              >
                {disabled ? <PowerOff size={16} /> : <Power size={16} />}
              </button>
              <button type="button" className="block-icon-button delete" title="Delete" onClick={() => onDeleteNode(node.id)}>
                <Trash2 size={15} />
              </button>
              {memberIcon ? (
                  <span className="rotation-node-member-icon" title={memberIcon.name}>
                  <img src={memberIcon.profile} alt="" />
                </span>
              ) : null}
            </div>
          </div>
          <div className="rotation-footer">
            <RotationValues totals={totals} aggregationType={meta?.aggregationType} />
            <div className="rotation-inline-field ui-inline-field">
              <span className="entry-detail-text rotation-skill-type-label">{meta?.skillTypeLabel ?? 'Feature'}</span>
              <span className="rotation-multiplier-symbol">×</span>
              <input
                type="number"
                min={1}
                step={1}
                className="resonator-level-input"
                value={Math.max(1, Math.floor(node.multiplier ?? 1))}
                onChange={(event) => {
                  const nextValue = Math.max(1, Math.floor(Number(event.target.value) || 1))
                  onUpdateNode(node.id, (current) =>
                    current.type === 'feature'
                      ? {
                          ...current,
                          multiplier: nextValue,
                        }
                      : current,
                  )
                }}
              />
            </div>
          </div>
          {attachedChanges.length > 0 ? (
              <div className="rotation-condition-list">
                {attachedChanges.map((change, changeIndex) => (
                    <span key={`${change.path}:${changeIndex}`} className="rotation-condition-chip">
                  {formatConditionChange(
                      change,
                      getConditionChoiceForChange(conditionChoices, change, node.resonatorId ?? meta?.resonatorId ?? runtime.id),
                  )}
                </span>
                ))}
              </div>
          ) : null}
        </article>
      </RotationNodeCard>
    )
  }

  if (node.type === 'condition') {
    const displayedChange = node.changes[0]
    const memberIcon = getNodeMemberIcon(node, runtime, featureMetaById, conditionChoices)
    const orphanedCondition = displayedChange && !conditionChoice

    if (orphanedCondition) {
      return (
        <RotationNodeCard depth={depth} disabled={disabled} isDragOver={isDragOver} isDragging={draggedId === node.id} {...sharedDragProps}>
          <div className="rotation-item rotation-condition rotation-item--orphaned">
            <div className="rotation-entry-main">
              <span className="entry-name">Invalid Condition</span>
            </div>
            <div className="rotation-node-actions">
              <button type="button" className="block-icon-button delete" title="Delete" onClick={() => onDeleteNode(node.id)}>
                <Trash2 size={15} />
              </button>
            </div>
          </div>
        </RotationNodeCard>
      )
    }

   /* const conditionActive = (() => {
      if (displayedChange.type === 'set') {
        if (typeof displayedChange.value === "number" && !Number.isNaN(displayedChange.value)) {
          return displayedChange.value > 0
        }
        if (typeof displayedChange.value === "boolean") {
          return displayedChange.value
        }
      }
      return true
    })()*/

    return (
      <RotationNodeCard depth={depth} disabled={disabled} isDragOver={isDragOver} isDragging={draggedId === node.id} {...sharedDragProps}>
        <div className="rotation-item rotation-condition">
          <div className="rotation-header">
            <div className="rotation-entry-main">
              <span className="entry-name">{formatConditionChange(displayedChange, conditionChoice) ?? node.label ?? conditionChoice?.label ?? 'Condition'}</span>
            </div>
            <div className="rotation-node-actions">
              <button
                type="button"
                className="block-icon-button"
                title="Edit condition"
                onClick={() => onOpenConditionEditor({ mode: 'edit', nodeId: node.id })}
              >
                <Pencil size={15} />
              </button>
              <RotationInlineAddMenu
                portalTarget={portalTarget}
                allowFeature={allowAddFeatureBelow}
                allowCondition
                allowBlock={allowAddBlockBelow}
                onAddFeature={() =>
                  onOpenFeatureMenu({
                    mode: 'add',
                    activeMemberId: node.resonatorId ?? conditionChoice?.resonatorId ?? defaultFeatureMemberId,
                    target: addBelowTarget,
                  })
                }
                onAddCondition={() => onOpenConditionEditor({ mode: 'add', target: addBelowTarget })}
                onAddBlock={() => onOpenBlockPicker(addBelowTarget)}
              />
              <button
                type="button"
                className="block-icon-button power"
                title={disabled ? 'Enable condition' : 'Disable condition'}
                onClick={() => onUpdateNode(node.id, (current) => ({ ...current, enabled: !(current.enabled ?? true) }))}
              >
                {disabled ? <PowerOff size={16} /> : <Power size={16} />}
              </button>
              <button type="button" className="block-icon-button delete" title="Delete" onClick={() => onDeleteNode(node.id)}>
                <Trash2 size={15} />
              </button>
              {memberIcon ? (
                  <span className="rotation-node-member-icon" title={memberIcon.name}>
                  <img src={memberIcon.profile} alt="" />
                </span>
              ) : null}
            </div>
          </div>
        </div>
      </RotationNodeCard>
    )
  }

  const itemsBranchKey = `${node.id}:items:end`
  const setupBranchKey = `${node.id}:setup:end`
  const nextDepth = depth + 1
  const memberIcon = getNodeMemberIcon(node, runtime, featureMetaById, conditionChoices)
  const draggedEntryNode = isEntryNode(draggedNode) ? draggedNode : null
  const canDropIntoSetupBranch = canInsertNodeIntoBranch(draggedNode, 'setup')
  const setupDragKeys = (node.type === 'uptime' ? node.setup ?? [] : []).map((_, childIndex) => `${node.id}:setup:${childIndex}`)
  const itemsDragKeys = node.items.map((_, childIndex) => `${node.id}:items:${childIndex}`)
  const isSetupBranchDragOver =
    dragOverArea === 'block-setup' &&
    (dragOverKey === setupBranchKey || setupDragKeys.includes(dragOverKey ?? ''))
  const isItemsBranchDragOver =
    dragOverArea === 'block-items' &&
    (dragOverKey === itemsBranchKey || itemsDragKeys.includes(dragOverKey ?? ''))
  const renderDraggedPlaceholder = (placeholderKey: string) =>
    draggedEntryNode ? (
      <div key={placeholderKey} className="rotation-drop-indicator" />
    ) : null

  return (
    <RotationNodeCard depth={depth} disabled={disabled} isDragOver={isDragOver} isDragging={draggedId === node.id} {...sharedDragProps}>
      <div
        className={`rotation-item rotation-block ${isSetupBranchDragOver || isItemsBranchDragOver ? 'drag-hovered' : ''} ${collapsed && isItemsBranchDragOver ? 'drag-over' : ''}`}
        onDragOver={collapsed ? (event) => {
          event.preventDefault()
          event.stopPropagation()
          onDragOverTarget(itemsBranchKey, 'block-items')
        } : undefined}
        onDragLeave={collapsed ? () => onDragOverTarget(null, null) : undefined}
        onDrop={collapsed ? (event) => {
          event.preventDefault()
          event.stopPropagation()
          if (!draggedId) {
            return
          }

          onMoveNode(draggedId, {
            parentId: node.id,
            branch: 'items',
            index: getBranchLength(treeItems, node.id, 'items'),
            key: itemsBranchKey,
          })
        } : undefined}
      >
        <div className="block-header">
          <div className="rotation-entry-main">
            <h4 className="entry-name">{node.type === 'repeat' ? 'Repeat' : 'Uptime'}</h4>
          </div>
          <div className="rotation-node-actions">
            {node.type === 'repeat' ? (
                <div className="rotation-inline-field ui-inline-field">
                  <span className="rotation-multiplier-symbol">×</span>
                  <input
                      type="number"
                      min={1}
                      step={1}
                      className="resonator-level-input"
                      value={Math.max(1, Math.floor(typeof node.times === 'number' ? node.times : 1))}
                      onChange={(event) => {
                        const nextValue = Math.max(1, Math.floor(Number(event.target.value) || 1))
                        onUpdateNode(node.id, (current) =>
                            current.type === 'repeat'
                                ? {
                                  ...current,
                                  times: nextValue,
                                }
                                : current,
                        )
                      }}
                  />
                </div>
            ) : (
                <div className="rotation-inline-field ui-inline-field">
                  <span className="rotation-multiplier-text">Uptime</span>
                  <input
                      type="number"
                      min={0}
                      max={100}
                      step={1}
                      className="resonator-level-input"
                      value={Math.round((typeof node.ratio === 'number' ? node.ratio : 1) * 100)}
                      onChange={(event) => {
                        const nextValue = Math.max(0, Math.min(100, Math.floor(Number(event.target.value) || 0))) / 100
                        onUpdateNode(node.id, (current) =>
                            current.type === 'uptime'
                                ? {
                                  ...current,
                                  ratio: nextValue,
                                }
                                : current,
                        )
                      }}
                  />
                </div>
            )}
            <button type="button" className="rotation-collapse-button" onClick={() => onToggleCollapse(node.id)}>
              {collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
            </button>
            <RotationInlineAddMenu
              portalTarget={portalTarget}
              allowFeature={allowAddFeatureBelow}
              allowCondition
              allowBlock={allowAddBlockBelow}
              onAddFeature={() =>
                onOpenFeatureMenu({
                  mode: 'add',
                  activeMemberId: node.resonatorId ?? defaultFeatureMemberId,
                  target: addBelowTarget,
                })
              }
              onAddCondition={() => onOpenConditionEditor({ mode: 'add', target: addBelowTarget })}
              onAddBlock={() => onOpenBlockPicker(addBelowTarget)}
            />
            <button
              type="button"
              className="block-icon-button power"
              title={disabled ? 'Enable block' : 'Disable block'}
              onClick={() => onUpdateNode(node.id, (current) => ({ ...current, enabled: !(current.enabled ?? true) }))}
            >
              {disabled ? <PowerOff size={16} /> : <Power size={16} />}
            </button>
            <button type="button" className="block-icon-button delete" title="Delete" onClick={() => onDeleteNode(node.id)}>
              <Trash2 size={15} />
            </button>
            {memberIcon ? (
                <span className="rotation-node-member-icon" title={memberIcon.name}>
                <img src={memberIcon.profile} alt="" />
              </span>
            ) : null}
          </div>
        </div>

        {!collapsed ? (
          <div className="block-body expanded">
            {node.type === 'uptime' ? (
              <div
                className={`rotation-block-setup ${isSetupBranchDragOver ? 'drag-over' : ''}`}
                onDragOver={(event) => {
                  if (!canDropIntoSetupBranch) {
                    return
                  }

                  event.preventDefault()
                  event.stopPropagation()
                  onDragOverTarget(setupBranchKey, 'block-setup')
                }}
                onDragLeave={() => onDragOverTarget(null, null)}
                onDrop={(event) => {
                  if (!canDropIntoSetupBranch) {
                    return
                  }

                  event.preventDefault()
                  event.stopPropagation()
                  if (!draggedId) {
                    return
                  }
                  onMoveNode(draggedId, {
                    parentId: node.id,
                    branch: 'setup',
                    index: getBranchLength(treeItems, node.id, 'setup'),
                    key: setupBranchKey,
                  })
                }}
              >
                <div className="rotation-block-section-header">
                  <div className="rotation-block-section-title">Setup</div>
                  <div className="rotation-toolbar-group compact">
                    <button
                      type="button"
                      className="rotation-button mini"
                      onClick={() => onOpenConditionEditor({ mode: 'add', target: { parentId: node.id, branch: 'setup' } })}
                    >
                      <Plus size={14} />
                      Condition
                    </button>
                  </div>
                </div>
                {node.setup?.length ? (
                  node.setup.map((child, childIndex) => {
                    const childDragKey = `${node.id}:setup:${childIndex}`
                    return (
                      <React.Fragment key={child.id}>
                        {dragOverKey === childDragKey ? renderDraggedPlaceholder(`setup-preview:${child.id}`) : null}
                        <RotationTreeNode
                          portalTarget={portalTarget}
                          runtime={runtime}
                          runtimesById={runtimesById}
                          treeItems={treeItems}
                          node={child}
                          depth={nextDepth}
                          parentId={node.id}
                          branch="setup"
                          index={childIndex}
                          resultMap={resultMap}
                          featureMetaById={featureMetaById}
                          adjacentFeatureById={adjacentFeatureById}
                          previousFeatureById={previousFeatureById}
                          conditionChoices={conditionChoices}
                          collapsedIds={collapsedIds}
                          defaultFeatureMemberId={defaultFeatureMemberId}
                          draggedId={draggedId}
                          draggedNode={draggedNode}
                          dragOverKey={dragOverKey}
                          dragOverArea={dragOverArea}
                          onDragStart={onDragStart}
                          onDragEnd={onDragEnd}
                          onDragOverTarget={onDragOverTarget}
                          onMoveNode={onMoveNode}
                          onToggleCollapse={onToggleCollapse}
                          onDeleteNode={onDeleteNode}
                          onOpenFeatureMenu={onOpenFeatureMenu}
                          onOpenNegativeEffectConfig={onOpenNegativeEffectConfig}
                          onOpenConditionEditor={onOpenConditionEditor}
                          onOpenFeatureConditionEditor={onOpenFeatureConditionEditor}
                          onOpenBlockPicker={onOpenBlockPicker}
                          onUpdateNode={onUpdateNode}
                          onInsertNodeAt={onInsertNodeAt}
                        />
                      </React.Fragment>
                    )
                  })
                ) : (
                  <div className="soft-empty compact">No setup conditions.</div>
                )}
                {dragOverKey === setupBranchKey ? renderDraggedPlaceholder(`setup-preview:${node.id}:end`) : null}
              </div>
            ) : null}

            <div
              className={`block-entries-list ${isItemsBranchDragOver ? 'drag-over' : ''}`}
              onDragOver={(event) => {
                event.preventDefault()
                event.stopPropagation()
                onDragOverTarget(itemsBranchKey, 'block-items')
              }}
              onDragLeave={() => onDragOverTarget(null, null)}
              onDrop={(event) => {
                event.preventDefault()
                event.stopPropagation()
                if (!draggedId) {
                  return
                }
                onMoveNode(draggedId, {
                  parentId: node.id,
                  branch: 'items',
                  index: getBranchLength(treeItems, node.id, 'items'),
                  key: itemsBranchKey,
                })
              }}
            >
              <div className="rotation-block-section-header">
                <div className="rotation-block-section-title">Items</div>
                <div className="rotation-toolbar-group compact">
                  <button
                    type="button"
                    className="rotation-button mini"
                    onClick={() =>
                      onOpenFeatureMenu({
                        mode: 'add',
                        activeMemberId: defaultFeatureMemberId,
                        target: { parentId: node.id, branch: 'items' },
                      })
                    }
                  >
                    <Plus size={14} />
                    Feature
                  </button>
                  <button
                    type="button"
                    className="rotation-button mini"
                    onClick={() => onOpenConditionEditor({ mode: 'add', target: { parentId: node.id, branch: 'items' } })}
                  >
                    <Plus size={14} />
                    Condition
                  </button>
                  <button
                    type="button"
                    className="rotation-button mini"
                    onClick={() => onOpenBlockPicker({ parentId: node.id, branch: 'items' })}
                  >
                    <Plus size={14} />
                    Block
                  </button>
                </div>
              </div>

              {node.items.length ? (
                node.items.map((child, childIndex) => {
                  const childDragKey = `${node.id}:items:${childIndex}`
                  return (
                    <React.Fragment key={child.id}>
                      {dragOverKey === childDragKey ? renderDraggedPlaceholder(`items-preview:${child.id}`) : null}
                      <RotationTreeNode
                        portalTarget={portalTarget}
                        runtime={runtime}
                        runtimesById={runtimesById}
                        treeItems={treeItems}
                        node={child}
                        depth={nextDepth}
                        parentId={node.id}
                        branch="items"
                        index={childIndex}
                        resultMap={resultMap}
                        featureMetaById={featureMetaById}
                        adjacentFeatureById={adjacentFeatureById}
                        previousFeatureById={previousFeatureById}
                        conditionChoices={conditionChoices}
                        collapsedIds={collapsedIds}
                        defaultFeatureMemberId={defaultFeatureMemberId}
                        draggedId={draggedId}
                        draggedNode={draggedNode}
                        dragOverKey={dragOverKey}
                        dragOverArea={dragOverArea}
                        onDragStart={onDragStart}
                        onDragEnd={onDragEnd}
                        onDragOverTarget={onDragOverTarget}
                        onMoveNode={onMoveNode}
                        onToggleCollapse={onToggleCollapse}
                        onDeleteNode={onDeleteNode}
                        onOpenFeatureMenu={onOpenFeatureMenu}
                        onOpenNegativeEffectConfig={onOpenNegativeEffectConfig}
                        onOpenConditionEditor={onOpenConditionEditor}
                        onOpenFeatureConditionEditor={onOpenFeatureConditionEditor}
                        onOpenBlockPicker={onOpenBlockPicker}
                        onUpdateNode={onUpdateNode}
                        onInsertNodeAt={onInsertNodeAt}
                      />
                    </React.Fragment>
                  )
                })
              ) : (
                <div className="soft-empty compact">No items in this block.</div>
              )}
              {dragOverKey === itemsBranchKey ? renderDraggedPlaceholder(`items-preview:${node.id}:end`) : null}
            </div>
          </div>
        ) : null}

        <div className="block-footer rotation-values">
          <RotationValues totals={totals} />
        </div>
      </div>
    </RotationNodeCard>
  )
}

function SavedRotationSnapshotSummary({
                                        entry,
                                        resolveResonatorName,
                                      }: {
  entry: InventoryRotationEntry
  resolveResonatorName?: (id: ResonatorId) => string | undefined
}) {
  const extracted = useMemo(() => extractRotationStats(entry.items), [entry.items])

  const totals = entry.summary?.total
  const avg = totals?.avg ?? 0
  const crit = totals?.crit ?? 0
  const normal = totals?.normal ?? 0

  const teamNames = useMemo(() => {
    return (entry.team ?? [])
        .flatMap((value) => {
          if (typeof value !== 'string' || value.length === 0) {
            return []
          }

          return [resolveResonatorName?.(value) ?? value]
        })
  }, [entry.team, resolveResonatorName])

  const members = useMemo(() => {
    const source = entry.summary?.members ?? []
    return [...source]
        .map((member) => ({
          ...member,
          share: avg > 0 ? (member.contribution.avg / avg) * 100 : 0,
        }))
        .sort((a, b) => b.contribution.avg - a.contribution.avg)
  }, [entry.summary?.members, avg])

  const previewCoveredCount = extracted.preview.reduce((sum, group) => sum + group.count, 0)
  const previewRemainingCount = Math.max(0, extracted.totalNodes - previewCoveredCount)

  return (
    <div className="rotation-snapshot-v2">
      <div className="rotation-snapshot-v2__head">
        <div className="rotation-snapshot-v2__title-wrap">
          <span className="team-state-config-title">Saved Snapshot</span>
          <div className="rotation-snapshot-v2__title-row">
            <strong className="rotation-snapshot-v2__title">{entry.name}</strong>
            <span className="rotation-snapshot__team">{entry.mode === 'team' ? '‷ team' : '‷ personal'}</span>
          </div>
        </div>

        <div className="rotation-snapshot-v2__meta">
          {teamNames.length > 0 ? (
            <div className="overview-inline-buffs">
              {teamNames.map((name) => (
                <span key={name} className="overview-inline-buff">{name}</span>
              ))}
            </div>
          ) : null}
          <span className="overview-inline-buff">{formatDateShort(entry.updatedAt)}</span>
        </div>
      </div>

      {totals ? (
        <div className="rotation-snapshot-v2__main-grid">
          <div className="rotation-snapshot-v2__hero">
            <div className="rotation-snapshot-v2__hero-kpi">
              <span className="rotation-snapshot-v2__hero-label">AVG</span>
              <strong className="rotation-snapshot-v2__hero-value avg">
                {formatCompactNumber(avg)}
              </strong>
            </div>

            <div className="rotation-snapshot-v2__hero-side">
              <div className="overview-tree-leaf">
                <span className="overview-tree-leaf-label">Crit</span>
                <strong className="overview-tree-leaf-value">{formatCompactNumber(crit)}</strong>
              </div>
              <div className="overview-tree-leaf">
                <span className="overview-tree-leaf-label">Normal</span>
                <strong className="overview-tree-leaf-value">{formatCompactNumber(normal)}</strong>
              </div>
            </div>
          </div>

          {members.length > 0 ? (
            <div className="rotation-snapshot__contribution">
              <div className="overview-cell--rotation rotation-snapshot-v2__member-list">
                <div className="overview-rotation-grid-header">
                  <span className="rotation-snapshot-v2__section-title">Contribution</span>
                  <span>Normal</span>
                  <span>Crit</span>
                  <span>Avg</span>
                </div>
                {members.map((member) => (
                  <div key={member.id} className="overview-rotation-grid-row">
                    <div className="rotation-snapshot-v2__member-name">
                      <strong>{member.name}</strong>
                      <sup>{formatPercent(member.share)}</sup>
                    </div>

                    <div className="rotation-snapshot-v2__member-values">
                      <span>{formatCompactNumber(member.contribution.normal)}</span>
                      <span>{formatCompactNumber(member.contribution.crit)}</span>
                      <span className="avg">{formatCompactNumber(member.contribution.avg)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : (
          <div className="team-state-empty">No saved damage totals.</div>
      )}

      <div className="rotation-snapshot__data">
        <div className="overview-tree-branch-head">Rotation Meta</div>
        <div className="overview-tree-children overview-tree-children--grid">
          <div className="overview-tree-leaf">
            <span className="overview-tree-leaf-label">Top Level Nodes</span>
            <strong className="overview-tree-leaf-value">{extracted.topLevelNodes}</strong>
          </div>
          <div className="overview-tree-leaf">
            <span className="overview-tree-leaf-label">Total Nodes</span>
            <strong className="overview-tree-leaf-value">{extracted.totalNodes}</strong>
          </div>
          <div className="overview-tree-leaf">
            <span className="overview-tree-leaf-label">Setup Nodes</span>
            <strong className="overview-tree-leaf-value">{extracted.setupNodes}</strong>
          </div>
          <div className="overview-tree-leaf">
            <span className="overview-tree-leaf-label">Repeat Nodes</span>
            <strong className="overview-tree-leaf-value">{extracted.repeatNodes}</strong>
          </div>
          <div className="overview-tree-leaf">
            <span className="overview-tree-leaf-label">Conditions Nodes</span>
            <strong className="overview-tree-leaf-value">{extracted.conditionNodes}</strong>
          </div>
          <div className="overview-tree-leaf">
            <span className="overview-tree-leaf-label">Feature Nodes</span>
            <strong className="overview-tree-leaf-value">{extracted.featureNodes}</strong>
          </div>
          <div className="overview-tree-leaf">
            <span className="overview-tree-leaf-label">Depth</span>
            <strong className="overview-tree-leaf-value">{extracted.deepestDepth}</strong>
          </div>
          <div className="overview-tree-leaf">
            <span className="overview-tree-leaf-label">Members</span>
            <strong className="overview-tree-leaf-value">{teamNames.length || (entry.mode === 'team' ? 1 : 0)}</strong>
          </div>
        </div>
      </div>

      {(teamNames.length > 0 || extracted.preview.length > 0) ? (
        <div className="rotation-snapshot-v2__foot">
          {extracted.preview.length > 0 ? (
            <div className="rotation-snapshot-v2__section">
              <div className="rotation-snapshot-v2__section-head">
                <span className="rotation-snapshot-v2__section-title">Action Preview</span>
              </div>
              <div className="overview-inline-buffs">
                {extracted.preview.map((group, index) => (
                  <React.Fragment key={`${group.kind}-${index}`}>
                    <span className="overview-inline-buff">
                      {group.label}
                    </span>
                    {index < extracted.preview.length - 1 ? (
                      <span className="node-arrow">⇢</span>
                    ) : null}
                  </React.Fragment>
                ))}
                {previewRemainingCount > 0 ? (
                    <>                      <span className="node-arrow">⇢</span>
                      <span className="overview-inline-buff">
                    +{previewRemainingCount} Other Actions
                  </span>

                    </>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export function RotationPane({ runtime, runtimesById, simulation, onRuntimeUpdate }: RotationPaneProps) {
  const ensureTeamMemberRuntime = useAppStore((state) => state.ensureTeamMemberRuntime)
  const loadResonatorProfile = useAppStore((state) => state.loadResonatorProfile)
  const switchToResonator = useAppStore((state) => state.switchToResonator)
  const updateResonatorRuntime = useAppStore((state) => state.updateResonatorRuntime)
  const inventoryRotations = useAppStore((state) => state.calculator.inventoryRotations)
  const addRotationToInventory = useAppStore((state) => state.addRotationToInventory)
  const updateInventoryRotation = useAppStore((state) => state.updateInventoryRotation)
  const removeInventoryRotation = useAppStore((state) => state.removeInventoryRotation)
  const clearInventoryRotations = useAppStore((state) => state.clearInventoryRotations)
  const savedRotationPreferences = useAppStore((state) => state.ui.savedRotationPreferences)
  const setSavedRotationPreferences = useAppStore((state) => state.setSavedRotationPreferences)
  const confirmation = useConfirmation()
  const importFileInputRef = useRef<HTMLInputElement | null>(null)
  const showToast = useToastStore((s) => s.show)
  const seed = seedResonatorsById[runtime.id]
  const [collapsedIds, setCollapsedIds] = useState<Record<string, boolean>>({})
  const featureMenuModal = useAnimatedModalValue<FeatureMenuState>()
  const conditionEditorModal = useAnimatedModalValue<ConditionEditorState>()
  const featureConditionEditorModal = useAnimatedModalValue<FeatureConditionEditorState>()
  const negativeEffectConfigModal = useAnimatedModalValue<NegativeEffectConfigState>()
  const blockPickerModal = useAnimatedModalValue<BlockPickerState>()
  const actionListModal = useAnimatedModalValue<InventoryRotationEntry>()
  const loadChoiceModal = useAnimatedModalValue<InventoryRotationEntry>()
  const [savedSearchInput, setSavedSearchInput] = useState(() =>
    savedRotationPreferences.autoSearchActiveResonator ? seed.name : '',
  )
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [dragOverKey, setDragOverKey] = useState<string | null>(null)
  const [dragOverArea, setDragOverArea] = useState<RotationDragArea | null>(null)
  const [dragPointer, setDragPointer] = useState<{ x: number; y: number } | null>(null)
  const [selectedAppendSourceId, setSelectedAppendSourceId] = useState<string>('')
  const [editingRotationId, setEditingRotationId] = useState<string | null>(null)
  const [editingRotationName, setEditingRotationName] = useState('')
  const portalTarget = getMainContentPortalTarget()
  const currentMode = runtime.rotation.view === 'team' ? 'team' : 'personal'
  const savedSortBy = savedRotationPreferences.sortBy
  const savedSortOrder = savedRotationPreferences.sortOrder
  const savedFilterMode = savedRotationPreferences.filterMode
  const auto = savedRotationPreferences.autoSearchActiveResonator
  const savedSearchQuery = savedSearchInput

  function slugifyFileName(value: string): string {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
  }

  function buildRotationExportPayload(entry: InventoryRotationEntry) {
    return {
      source: 'wuwa-calculator',
      kind: 'rotation-export',
      version: 1,
      exportedAt: new Date().toISOString(),
      rotation: {
        name: entry.name,
        mode: entry.mode,
        resonatorId: entry.resonatorId,
        resonatorName: entry.resonatorName,
        team: entry.team ?? [],
        items: cloneRotationNodes(entry.items),
        snapshot: entry.snapshot ?? null,
        summary: entry.summary ?? null,
      },
    }
  }

  function downloadJsonFile(filename: string, data: unknown) {
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
  }

  function normalizeImportedRotation(
      raw: unknown,
  ): {
    name: string
    mode: 'personal' | 'team'
    resonatorId: string
    resonatorName: string
    team?: ResonatorRuntimeState['build']['team']
    items: RotationNode[]
    snapshot?: InventoryRotationEntry['snapshot']
    summary?: InventoryRotationEntry['summary']
  } | null {
    if (!raw || typeof raw !== 'object') {
      return null
    }

    const value = raw as Record<string, unknown>

    const mode =
        value.mode === 'team'
            ? 'team'
            : value.mode === 'personal'
                ? 'personal'
                : null

    const resonatorId = typeof value.resonatorId === 'string' ? value.resonatorId : null
    const resonatorName = typeof value.resonatorName === 'string' ? value.resonatorName : null
    const name = typeof value.name === 'string' ? value.name : null
    const items = Array.isArray(value.items)
        ? cloneRotationNodes(value.items as RotationNode[], { freshIds: true })
        : null

    if (!mode || !resonatorId || !resonatorName || !name || !items) {
      return null
    }

    const team = Array.isArray(value.team)
        ? value.team.filter((entry): entry is string => typeof entry === 'string')
        : undefined

    return {
      name,
      mode,
      resonatorId,
      resonatorName,
      ...(team ? { team: team as ResonatorRuntimeState['build']['team'] } : {}),
      items,
      ...(value.snapshot ? { snapshot: value.snapshot as InventoryRotationEntry['snapshot'] } : {}),
      ...(value.summary ? { summary: value.summary as InventoryRotationEntry['summary'] } : {}),
    }
  }

  const handleExportRotation = useCallback((entry: InventoryRotationEntry) => {
    const payload = buildRotationExportPayload(entry)
    const filename = `${slugifyFileName(entry.name || entry.resonatorName || 'rotation')}.json`
    downloadJsonFile(filename, payload)

    showToast({
      content: `Exported "${entry.name}"`,
      variant: 'success',
      duration: 2500,
    })
  }, [showToast])

  const handleImportRotations = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }

    try {
      const text = await file.text()
      const parsed = JSON.parse(text) as unknown

      let candidates: unknown[] = []

      if (
          parsed &&
          typeof parsed === 'object' &&
          'kind' in parsed &&
          (parsed as Record<string, unknown>).kind === 'rotation-export'
      ) {
        const wrapped = parsed as Record<string, unknown>

        if (Array.isArray(wrapped.rotations)) {
          candidates = wrapped.rotations
        } else if ('rotation' in wrapped) {
          candidates = [wrapped.rotation]
        }
      } else if (Array.isArray(parsed)) {
        candidates = parsed
      } else {
        candidates = [parsed]
      }

      const imported = candidates
          .map((entry) => normalizeImportedRotation(entry))
          .filter((entry): entry is NonNullable<ReturnType<typeof normalizeImportedRotation>> => Boolean(entry))

      if (imported.length === 0) {
        showToast({
          content: 'No valid rotation data found in that file.',
          variant: 'error',
          duration: 3500,
        })
        return
      }

      for (const entry of imported) {
        addRotationToInventory(entry)
      }

      showToast({
        content: `Imported ${imported.length} rotation${imported.length === 1 ? '' : 's'}.`,
        variant: 'success',
        duration: 3000,
      })
    } catch {
      showToast({
        content: 'Failed to import file. Make sure it is valid JSON.',
        variant: 'error',
        duration: 3500,
      })
    } finally {
      event.target.value = ''
    }
  }, [addRotationToInventory, showToast])

  const currentTeamMemberIds = useMemo(
    () => Array.from(new Set([runtime.id, ...runtime.build.team.filter((member): member is string => Boolean(member))])),
    [runtime.build.team, runtime.id],
  )

  const resultMap = useMemo(() => {
    const map = new Map<string, SimulationResult['perSkill']>()

    for (const entry of simulation?.rotations[currentMode].entries ?? []) {
      const key = entry.nodeId ?? entry.id
      const current = map.get(key) ?? []
      current.push(entry)
      map.set(key, current)
    }

    return map
  }, [currentMode, simulation])

  const availableMembers = useMemo<RotationMemberEntry[]>(() => {
    const ids = Array.from(
      new Set([runtime.id, ...runtime.build.team.filter((member): member is string => Boolean(member))]),
    )
    return ids
      .map((resonatorId) => {
        const seed = seedResonatorsById[resonatorId]
        const memberRuntime = resonatorId === runtime.id ? runtime : runtimesById[resonatorId]
        if (!seed || !memberRuntime) {
          return null
        }

        const catalog = buildRuntimeSourceCatalog(memberRuntime)

        return {
          id: seed.id,
          name: seed.name,
          profile: seed.profile,
          attribute: seed.attribute,
          runtime: memberRuntime,
          skills: catalog.skills,
          features: catalog.features,
          states: listRotationMemberStates(memberRuntime, runtime),
        }
      })
      .filter((entry): entry is RotationMemberEntry => Boolean(entry))
  }, [runtime, runtimesById])

  const editableMembers = useMemo(() => {
    if (runtime.rotation.view === 'team') {
      return availableMembers
    }

    const activeMember = availableMembers.find((member) => member.id === runtime.id)
    return activeMember ? [activeMember] : []
  }, [availableMembers, runtime.id, runtime.rotation.view])

  const featureMetaById = useMemo(() => {
    const lookup: Record<string, FeatureMeta> = {}

    for (const member of availableMembers) {
      for (const feature of member.features) {
        const skill = member.skills.find((entry) => entry.id === feature.skillId)
        const resolvedSkill = skill ? resolveSkill(member.runtime, skill) : null
        const negativeEffectCombatKey = getNegativeEffectCombatKey(resolvedSkill?.archetype)
        const fixedStacks = negativeEffectCombatKey
          ? getNegativeEffectEntryForRuntime(member.runtime, negativeEffectCombatKey)?.stackMode === 'fixedMax'
          : false
        lookup[feature.id] = {
          label: resolvedSkill?.tab === 'negativeEffect' ? resolvedSkill.label : feature.label,
          skillId: feature.skillId,
          tab: resolvedSkill?.tab ?? skill?.tab ?? 'feature',
          archetype: resolvedSkill?.archetype ?? skill?.archetype,
          section: resolvedSkill?.sectionTitle ?? skill?.sectionTitle,
          skillTypeLabel: getSkillTypeDisplay(resolvedSkill?.skillType?.[0] ?? skill?.skillType?.[0]).label,
          element: resolvedSkill?.element ?? skill?.element ?? member.attribute,
          aggregationType: resolvedSkill?.aggregationType ?? skill?.aggregationType ?? 'damage',
          resonatorId: member.id,
          resonatorName: member.name,
          variant: getFeatureVariant(feature),
          hitIndex: typeof feature.hitIndex === 'number' ? feature.hitIndex : undefined,
          fixedStacks,
        }
      }
    }

    return lookup
  }, [availableMembers])

  const adjacentFeatureById = useMemo(() => {
    const lookup: Record<string, string | undefined> = {}

    for (const member of availableMembers) {
      const primaryFeatureBySkillId = new Map<string, string>()

      for (const feature of member.features) {
        if (feature.variant === 'subHit' || !feature.skillId) {
          continue
        }

        if (!primaryFeatureBySkillId.has(feature.skillId)) {
          primaryFeatureBySkillId.set(feature.skillId, feature.id)
        }
      }

      for (const feature of member.features) {
        const adjacentSkillId = getAdjacentSkillId(feature.skillId)
        lookup[feature.id] = adjacentSkillId ? primaryFeatureBySkillId.get(adjacentSkillId) : undefined
      }
    }

    return lookup
  }, [availableMembers])

  const previousFeatureById = useMemo(() => {
    const lookup: Record<string, string | undefined> = {}

    for (const member of availableMembers) {
      const primaryFeatureBySkillId = new Map<string, string>()

      for (const feature of member.features) {
        if (feature.variant === 'subHit' || !feature.skillId) {
          continue
        }

        if (!primaryFeatureBySkillId.has(feature.skillId)) {
          primaryFeatureBySkillId.set(feature.skillId, feature.id)
        }
      }

      for (const feature of member.features) {
        const previousSkillId = getPreviousSkillId(feature.skillId)
        lookup[feature.id] = previousSkillId ? primaryFeatureBySkillId.get(previousSkillId) : undefined
      }
    }

    return lookup
  }, [availableMembers])

  const conditionChoices = useMemo<ConditionChoice[]>(() => {
    const memberChoices = availableMembers.flatMap((member) => {
      const stateChoices = member.states.map((state) => makeConditionChoice(member, state))

      const targetChoices = member.states.flatMap((state) => {
        const targetMode = getStateTeamTargetMode(state)
        if (!targetMode) {
          return []
        }

        const options = getTeamTargetOptions(runtime, member.id, targetMode)
        if (options.length === 0) {
          return []
        }

        const display = getSourceStateDisplay(state)

        return [makeConditionChoice(
          member,
          {
            id: `${state.id}:target`,
            label: `${display.label} Target`,
            source: state.source,
            ownerKey: state.ownerKey,
            controlKey: `${state.controlKey}:target`,
            path: `runtime.routing.selectedTargetsByOwnerKey.${state.ownerKey}`,
            kind: 'select' as const,
            options: options.map((option) => ({
              id: option.value,
              label: option.label,
            })),
            defaultValue: options[0]?.value ?? '',
            description:
              targetMode === 'activeOther'
                ? 'Select which other teammate receives this buff during the rotation.'
                : 'Select which team member receives this active-targeted buff during the rotation.',
          },
          {
            id: `${member.id}:${state.controlKey}:target`,
            label: `${display.label} Target`,
            description:
              targetMode === 'activeOther'
                ? 'Select which other teammate receives this buff during the rotation.'
                : 'Select which team member receives this active-targeted buff during the rotation.',
          },
        )]
      })

      return [...stateChoices, ...targetChoices]
    })

    return [...memberChoices, ...buildEnemyStatusConditionChoices(runtime)]
  }, [availableMembers, runtime])

  const savedRotationEntries = useMemo(() => {
    const query = savedSearchQuery.trim().toLowerCase()
    const filtered = inventoryRotations.filter((entry) => {
      if (savedFilterMode !== 'all' && entry.mode !== savedFilterMode) return false
      return !(query && !entry.name.toLowerCase().includes(query) && !entry.resonatorName.toLowerCase().includes(query));

    })
    filtered.sort((a, b) => {
      let cmp = 0
      switch (savedSortBy) {
        case 'name':
          cmp = a.name.localeCompare(b.name)
          break
        case 'avg':
          cmp = (a.summary?.total.avg ?? 0) - (b.summary?.total.avg ?? 0)
          break
        case 'date':
        default:
          cmp = a.updatedAt - b.updatedAt
          break
      }
      return savedSortOrder === 'desc' ? -cmp : cmp
    })
    return filtered
  }, [inventoryRotations, savedSortBy, savedSortOrder, savedFilterMode, savedSearchQuery])
  const eligibleSavedPersonalRotations = useMemo(
    () =>
      inventoryRotations.filter(
        (entry) => entry.mode === 'personal' && currentTeamMemberIds.includes(entry.resonatorId),
      ),
    [currentTeamMemberIds, inventoryRotations],
  )

  const appendSourceOptions = useMemo(() => {
    const options: Array<{ value: string; label: string; items: RotationNode[] }> = []

    if (runtime.rotation.personalItems.length > 0) {
      options.push({
        value: `live:${runtime.id}`,
        label: `${seed.name} · Current Personal Rotation · Live`,
        items: runtime.rotation.personalItems,
      })
    }

    for (const entry of eligibleSavedPersonalRotations) {
      options.push({
        value: `saved:${entry.id}`,
        label: `${entry.resonatorName} · ${entry.name} · Personal`,
        items: entry.items,
      })
    }

    return options
  }, [eligibleSavedPersonalRotations, runtime.id, runtime.rotation.personalItems, seed.name])

  const resolvedAppendSourceId = useMemo(() => {
    if (appendSourceOptions.some((entry) => entry.value === selectedAppendSourceId)) {
      return selectedAppendSourceId
    }

    return appendSourceOptions[0]?.value ?? ''
  }, [appendSourceOptions, selectedAppendSourceId])

  const currentItems = currentMode === 'team' ? runtime.rotation.teamItems : runtime.rotation.personalItems
  const draggedNode = useMemo(
    () => (draggedId ? findRotationNode(currentItems, draggedId) : null),
    [currentItems, draggedId],
  )
  const editedFeatureNode = featureMenuModal.value?.nodeId
    ? (() => {
        const found = findRotationNode(currentItems, featureMenuModal.value.nodeId)
        return found?.type === 'feature' ? found : null
      })()
    : null

  const editedConditionNode = conditionEditorModal.value?.nodeId
    ? (() => {
        const found = findRotationNode(currentItems, conditionEditorModal.value.nodeId)
        return found?.type === 'condition' ? found : null
      })()
    : null
  const editedFeatureConditionNode = featureConditionEditorModal.value?.nodeId
    ? (() => {
        const found = findRotationNode(currentItems, featureConditionEditorModal.value.nodeId)
        return found?.type === 'feature' ? found : null
      })()
    : null

  const editedNegativeEffectFeatureNode = negativeEffectConfigModal.value?.nodeId
    ? (() => {
        const found = findRotationNode(currentItems, negativeEffectConfigModal.value.nodeId)
        return found?.type === 'feature' ? found : null
      })()
    : null
  const editedNegativeEffectMeta = editedNegativeEffectFeatureNode
    ? featureMetaById[editedNegativeEffectFeatureNode.featureId]
    : undefined

  const setRotationView = (view: ResonatorRuntimeState['rotation']['view']) => {
    onRuntimeUpdate((prev) => ({
      ...prev,
      rotation: {
        ...prev.rotation,
        view,
      },
    }))
  }

  const updateCurrentItems = (updater: (items: RotationNode[]) => RotationNode[]) => {
    onRuntimeUpdate((prev) => ({
      ...prev,
      rotation: {
        ...prev.rotation,
        ...(prev.rotation.view === 'team'
          ? { teamItems: updater(prev.rotation.teamItems) }
          : { personalItems: updater(prev.rotation.personalItems) }),
      },
    }))
  }

  const updateCurrentNode = (nodeId: string, updater: (node: RotationNode) => RotationNode) => {
    updateCurrentItems((items) => updateRotationNode(items, nodeId, updater))
  }

  const deleteCurrentNode = (nodeId: string) => {
    updateCurrentItems((items) => removeRotationNode(items, nodeId))
  }

  const insertCurrentNode = (target: RotationInsertTarget, node: RotationNode) => {
    updateCurrentItems((items) => insertRotationNode(items, target, node))
  }

  const insertCurrentNodes = (target: RotationInsertTarget, nodes: RotationNode[]) => {
    updateCurrentItems((items) => insertRotationNodes(items, target, nodes))
  }

  const handleDragOverTarget = useCallback((key: string | null, area: RotationDragArea | null) => {
    setDragOverKey(key)
    setDragOverArea(area)
  }, [])

  const handleMoveNode = (draggedNodeId: string, target: RotationDropTarget) => {
    updateCurrentItems((items) => moveRotationNode(items, draggedNodeId, target))
    setDraggedId(null)
    setDragOverKey(null)
    setDragOverArea(null)
    setDragPointer(null)
  }

  useEffect(() => {
    if (!draggedId) {
      document.body.style.cursor = ''
      return
    }

    const handleDragOver = (event: DragEvent) => {
      if (event.clientX === 0 && event.clientY === 0) {
        return
      }

      setDragPointer({
        x: event.clientX,
        y: event.clientY,
      })
    }

    document.body.style.cursor = 'grabbing'
    window.addEventListener('dragover', handleDragOver)

    return () => {
      document.body.style.cursor = ''
      window.removeEventListener('dragover', handleDragOver)
    }
  }, [draggedId])

  const saveRotation = () => {
    const countForMode =
      inventoryRotations.filter((entry) => entry.mode === currentMode && entry.resonatorId === seed.id).length + 1
    let name: string
    if (currentMode === 'team') {
      const seen = new Set<string>()
      const memberNames: string[] = []
      for (const id of [runtime.id, ...runtime.build.team]) {
        if (!id || seen.has(id)) continue
        seen.add(id)
        const n = seedResonatorsById[id]?.name
        if (n) memberNames.push(n)
      }
      name = `${memberNames.join('/')} Rotation ${countForMode}`
    } else {
      name = `${seed.name} Rotation ${countForMode}`
    }

    const profile = useAppStore.getState().calculator.profiles[runtime.id] ?? undefined
    const rotationGroup = currentMode === 'team' ? simulation?.rotations.team : simulation?.rotations.personal
    const summary = rotationGroup ? (() => {
      const total = { normal: rotationGroup.total.normal, avg: rotationGroup.total.avg, crit: rotationGroup.total.crit }
      if (currentMode !== 'team') return { total }
      const members = buildMemberContributions(rotationGroup.entries)
      return { total, members }
    })() : undefined

    addRotationToInventory({
      name,
      mode: currentMode,
      resonatorId: seed.id,
      resonatorName: seed.name,
      ...(currentMode === 'team' ? { team: [...runtime.build.team] as ResonatorRuntimeState['build']['team'] } : {}),
      items: currentItems,
      snapshot: profile,
      summary,
    })

    showToast({
      content: `Saved "${name}"~ ദ്ദി ˉ꒳ˉ )✧`,
      variant: 'success',
      duration: 3000,
    })
  }

  const applyRotationToResonator = (entry: RotationLoadPayload, targetId: string) => {
    if (entry.mode === 'team' && entry.team) {
      for (const memberId of entry.team) {
        if (!memberId) continue
        const memberSeed = seedResonatorsById[memberId]
        if (memberSeed && memberId !== targetId) {
          ensureTeamMemberRuntime(memberSeed)
        }
      }
    }

    const updater = (prev: ResonatorRuntimeState): ResonatorRuntimeState => ({
      ...prev,
      build: {
        ...prev.build,
        team:
          entry.mode === 'team' && entry.team
            ? [...entry.team] as ResonatorRuntimeState['build']['team']
            : prev.build.team,
      },
      rotation: {
        ...prev.rotation,
        view: entry.mode,
        ...(entry.mode === 'team'
          ? { teamItems: cloneRotationNodes(entry.items) }
          : { personalItems: cloneRotationNodes(entry.items) }),
      },
    })

    if (targetId === runtime.id) {
      onRuntimeUpdate(updater)
    } else {
      updateResonatorRuntime(targetId, updater)
    }
  }

  const loadSavedRotation = (entry: InventoryRotationEntry, withSnapshot?: boolean) => {
    const apply = () => {
      if (entry.resonatorId !== runtime.id) {
        switchToResonator(entry.resonatorId)
      }
      if (withSnapshot && entry.snapshot) {
        loadResonatorProfile(entry.snapshot)
      }
      applyRotationToResonator(entry, entry.resonatorId)
    }

    if (entry.resonatorId !== runtime.id) {
      confirmation.confirm({
        title: `Switch to ${entry.resonatorName}?`,
        message: `This rotation belongs to ${entry.resonatorName}. Loading it will switch the active resonator and apply the rotation.`,
        confirmLabel: 'Switch & Load',
        variant: 'info',
        onConfirm: apply,
      })
      return
    }

    apply()
  }

  const appendRotationNodesToTeam = useCallback((items: RotationNode[]) => {
    if (items.length === 0) {
      return
    }

    onRuntimeUpdate((prev) => ({
      ...prev,
      rotation: {
        ...prev.rotation,
        view: 'team',
        teamItems: [...prev.rotation.teamItems, ...cloneRotationNodes(items, { freshIds: true })],
      },
    }))
  }, [onRuntimeUpdate])

  const appendSelectedRotationSource = useCallback(() => {
    const selectedEntry = appendSourceOptions.find((entry) => entry.value === resolvedAppendSourceId)
    if (!selectedEntry) {
      return
    }

    appendRotationNodesToTeam(selectedEntry.items)
  }, [appendRotationNodesToTeam, appendSourceOptions, resolvedAppendSourceId])

  if (!seed) {
    return (
      <section className="calc-pane rotation-pane">
        <div>
          <div className="panel-overline">Simulation</div>
          <h3>Rotations</h3>
        </div>
        <div className="soft-empty">No active resonator data is available.</div>
      </section>
    )
  }

  const rootDropKey = `${runtime.rotation.view}:root:end`
  const emptyMessage =
    currentMode === 'team'
      ? 'Add features, conditions, or blocks to build a team rotation.'
      : 'Add features, conditions, or blocks to build a personal rotation.'
  const defaultFeatureMemberId = featureMenuModal.value?.activeMemberId ?? runtime.id
  const defaultShowFeatureSubHits =
    featureMenuModal.value?.mode === 'edit' && editedFeatureNode
      ? featureMetaById[editedFeatureNode.featureId]?.variant === 'subHit'
      : false
  const actionListSequence = useMemo(() => {
    return actionListModal.value
      ? buildRotationActionSequence({
          items: actionListModal.value.items,
          initialCombat: actionListModal.value.snapshot?.runtime.local.combat,
          resonatorId: actionListModal.value.resonatorId,
        })
      : null
  }, [actionListModal.value])
  const showEditor = runtime.rotation.view !== 'saved'
  const draggedEntryNode = isEntryNode(draggedNode) ? draggedNode : null
  const showDragPreview =
    draggedNode != null &&
    dragPointer != null &&
    (dragPointer.x !== 0 || dragPointer.y !== 0)
  const dragPreviewPortalTarget = getBodyPortalTarget()



  return (
    <section className="calc-pane rotation-pane">
      <div>
        <div className="panel-overline">Simulation</div>
        <h3>Rotations</h3>
      </div>

      <div className="rotation-view-toggle">
        <button
          type="button"
          className={runtime.rotation.view === 'personal' ? 'view-toggle-button active' : 'view-toggle-button'}
          onClick={() => setRotationView('personal')}
        >
          Personal
        </button>
        <button
          type="button"
          className={runtime.rotation.view === 'team' ? 'view-toggle-button active' : 'view-toggle-button'}
          onClick={() => setRotationView('team')}
        >
          Team
        </button>
        <button
          type="button"
          className={runtime.rotation.view === 'saved' ? 'view-toggle-button active' : 'view-toggle-button'}
          onClick={() => setRotationView('saved')}
        >
          Saved
        </button>
      </div>

      {showEditor ? (
        <>
          <div className="pane-section rotation-pane-controls">
            <div className="rotation-toolbar">
              <div className="rotation-toolbar-group">
                <button
                  type="button"
                  className="rotation-button"
                  onClick={() =>
                    featureMenuModal.show({
                      mode: 'add',
                      activeMemberId: runtime.id,
                      target: { parentId: null, branch: 'root' },
                    })
                  }
                >
                  <Plus size={14} />
                  Feature
                </button>
                <button
                  type="button"
                  className="rotation-button"
                  onClick={() =>
                    conditionEditorModal.show({
                      mode: 'add',
                      target: { parentId: null, branch: 'root' },
                    })
                  }
                >
                  <Plus size={14} />
                  Condition
                </button>
                <button
                  type="button"
                  className="rotation-button"
                  onClick={() => blockPickerModal.show({ target: { parentId: null, branch: 'root' } })}
                >
                  <Plus size={14} />
                  Block
                </button>
              </div>

              <div className="rotation-toolbar-group">
                {currentMode === 'personal' && (
                  <button type="button" className="rotation-button" onClick={() => {
                    if (runtime.rotation.personalItems.length <= 0) {
                      const defaultRotation = seed.rotations?.[0] ?? listResonatorRotations(seed.id)[0]
                      if (!defaultRotation) return
                      updateCurrentItems(() => structuredClone(defaultRotation.items))
                    } else confirmation.confirm({
                      title: 'You sure about that? ( · ❛ ֊ ❛)',
                      message: 'This will overwrite your current entries with the preset rotation.',
                      confirmLabel: 'Load',
                      variant: 'danger',
                      onConfirm: () => {
                        const defaultRotation = seed.rotations?.[0] ?? listResonatorRotations(seed.id)[0]
                        if (!defaultRotation) return
                        updateCurrentItems(() => structuredClone(defaultRotation.items))
                      },
                    })
                  }}>
                    <RotateCcw size={14} />
                    Preset
                  </button>
                )}
                <button type="button" className="rotation-button" onClick={saveRotation}>
                  <Save size={14} />
                  Save
                </button>
                <button type="button" className="rotation-button clear" onClick={() => confirmation.confirm({
                  title: 'You sure about that? ( · ❛ ֊ ❛)',
                  message: 'This will remove all items from the current rotation.',
                  confirmLabel: 'Clear',
                  variant: 'danger',
                  onConfirm: () => updateCurrentItems(() => []),
                })}>
                  Clear
                </button>
              </div>
            </div>

            {(runtime.rotation.view === 'team' && appendSourceOptions.length > 0) ? (
              <div className="rotation-toolbar rotation-toolbar--footer rotation-toolbar--append">
                <div className="rotation-toolbar-group rotation-toolbar-group--append">
                  <div className="rotation-toolbar-field ui-inline-field ui-inline-field--wide">
                    <LiquidSelect
                      value={resolvedAppendSourceId}
                      options={appendSourceOptions}
                      onChange={setSelectedAppendSourceId}
                      disabled={appendSourceOptions.length === 0}
                      placeholder="No eligible rotations"
                      ariaLabel="Rotation source"
                    />
                  </div>
                  <button
                    type="button"
                    className="rotation-button"
                    disabled={!resolvedAppendSourceId}
                    onClick={appendSelectedRotationSource}
                  >
                    Append
                  </button>
                </div>
              </div>
            ) : null}
          </div>

          <div className="rotation-entries-list">
            <div
              className={`rotation-list-container ${dragOverKey === rootDropKey ? 'drag-over' : ''}`}
              onDragOver={(event) => {
                event.preventDefault()
                handleDragOverTarget(rootDropKey, 'root')
              }}
              onDragLeave={() => {
                if (dragOverKey === rootDropKey) {
                  handleDragOverTarget(null, null)
                }
              }}
              onDrop={(event) => {
                event.preventDefault()
                if (!draggedId) {
                  return
                }
                handleMoveNode(draggedId, {
                  parentId: null,
                  branch: 'root',
                  index: currentItems.length,
                  key: rootDropKey,
                })
              }}
            >
              {currentItems.length ? (
                currentItems.map((node, index) => (
                  <RotationTreeNode
                    key={node.id}
                    portalTarget={portalTarget}
                    runtime={runtime}
                    runtimesById={runtimesById}
                    treeItems={currentItems}
                    node={node}
                    depth={0}
                    parentId={null}
                    branch="root"
                    index={index}
                    resultMap={resultMap}
                    featureMetaById={featureMetaById}
                    adjacentFeatureById={adjacentFeatureById}
                    previousFeatureById={previousFeatureById}
                    conditionChoices={conditionChoices}
                    collapsedIds={collapsedIds}
                    defaultFeatureMemberId={defaultFeatureMemberId}
                    draggedId={draggedId}
                    draggedNode={draggedNode}
                    dragOverKey={dragOverKey}
                    dragOverArea={dragOverArea}
                    onDragStart={(nodeId) => {
                      setDraggedId(nodeId)
                      setDragOverKey(null)
                      setDragOverArea(null)
                    }}
                    onDragEnd={() => {
                      setDraggedId(null)
                      setDragOverKey(null)
                      setDragOverArea(null)
                      setDragPointer(null)
                    }}
                    onDragOverTarget={handleDragOverTarget}
                    onMoveNode={handleMoveNode}
                    onToggleCollapse={(nodeId) =>
                      setCollapsedIds((prev) => ({
                        ...prev,
                        [nodeId]: !(prev[nodeId] ?? false),
                      }))
                    }
                    onDeleteNode={deleteCurrentNode}
                    onOpenFeatureMenu={featureMenuModal.show}
                    onOpenNegativeEffectConfig={negativeEffectConfigModal.show}
                    onOpenConditionEditor={conditionEditorModal.show}
                    onOpenFeatureConditionEditor={featureConditionEditorModal.show}
                    onOpenBlockPicker={(target) => blockPickerModal.show({ target })}
                    onUpdateNode={updateCurrentNode}
                    onInsertNodeAt={(target, node) => updateCurrentItems((items) => insertNodeAtTarget(items, target, node))}
                  />
                ))
              ) : (
                <div className="soft-empty">{emptyMessage}</div>
              )}
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="pane-section rotation-pane-controls saved-rotations">
            <div className="rotation-toolbar">
              <div className="rotation-toolbar-group">
                <LiquidSelect
                  value={savedSortBy}
	                  options={[
	                    { value: 'date', label: 'Date' },
	                    { value: 'name', label: 'Name' },
	                    { value: 'avg', label: 'Avg DMG' },
	                  ]}
                  onChange={(nextValue) =>
                    setSavedRotationPreferences((current) => ({
                      ...current,
                      sortBy: nextValue as typeof current.sortBy,
                    }))
                  }
                  ariaLabel="Sort by"
                  portalTarget={portalTarget}
                />
                <button
                  type="button"
                  className="rotation-button"
                  onClick={() =>
                    setSavedRotationPreferences((current) => ({
                      ...current,
                      sortOrder: current.sortOrder === 'asc' ? 'desc' : 'asc',
                    }))
                  }
                  title={savedSortOrder === 'desc' ? 'Descending' : 'Ascending'}
                >
                  {savedSortOrder === 'desc' ? '↓' : '↑'}
                </button>

              </div>
	              <div className="rotation-toolbar-group">
	                <button
	                  type="button"
	                  className="rotation-button"
	                  onClick={() => importFileInputRef.current?.click()}
	                >
	                  Import
	                </button>
	                <button
	                  type="button"
	                  className="rotation-button clear"
	                  disabled={savedRotationEntries.length === 0}
	                  onClick={() => confirmation.confirm({
	                    title: 'You sure about that? ( · ❛ ֊ ❛)',
	                    message: 'This will delete all saved rotations. This cannot be undone.',
	                    confirmLabel: 'Clear All',
	                    variant: 'danger',
	                    onConfirm: clearInventoryRotations,
	                  })}
	                >
	                  Clear
	                </button>
	              </div>
            </div>

            <div className="rotation-toolbar rotation-toolbar--footer">
              <div className="rotation-saved-filters">
                <span className="rotation-saved-filters__label">Filter:</span>
                <div className="rotation-saved-filters__toggles">
                  <button
                    type="button"
                    className={`rotation-saved-filters__toggle${savedFilterMode === 'personal' ? ' on' : ''}`}
                    onClick={() =>
                      setSavedRotationPreferences((current) => ({
                        ...current,
                        filterMode: current.filterMode === 'personal' ? 'all' : 'personal',
                      }))
                    }
                  >
                    Personal
                  </button>
                  <button
                    type="button"
                    className={`rotation-saved-filters__toggle${savedFilterMode === 'team' ? ' on' : ''}`}
                    onClick={() =>
                      setSavedRotationPreferences((current) => ({
                        ...current,
                        filterMode: current.filterMode === 'team' ? 'all' : 'team',
                      }))
                    }
                  >
                    Team
                  </button>
	                </div>
                <div className="rotation-saved-filters__search">
                  <Search size={13} className="rotation-saved-filters__search-icon" />
                  <input
                    type="text"
                    className="rotation-saved-filters__search-input"
                    placeholder="Search..."
                    value={savedSearchQuery}
                    onChange={(e) => {
                      setSavedSearchInput(e.target.value)
                    }}
                  />
                </div>
                ⇠
                <button
                    type="button"
                    className={`rotation-saved-filters__toggle${auto ? ' on' : ''}`}
                    onClick={() => {
                      if (auto) {
                        setSavedRotationPreferences((current) => ({
                          ...current,
                          autoSearchActiveResonator: false,
                        }))
                        return
                      }

                      setSavedSearchInput(seed.name)
                      setSavedRotationPreferences((current) => ({
                        ...current,
                        autoSearchActiveResonator: true,
                      }))
                    }}
                >
                  Auto
                </button>
              </div>
            </div>
          </div>
          <div className="rotation-entries-list">
            <div className="rotation-saved-list">
              {savedRotationEntries.length ? (
                savedRotationEntries.map((entry) => (
                <Expandable
                  key={entry.id}
                  as="div"
                  className="rotation-saved-item"
                  chevronContainerClassName="rotation-button mini rotation-saved-chevron"
                  chevronSize={11}
                  header={
                    <div className="rotation-saved-item-header">
                      <div className="rotation-saved-copy">
                        {editingRotationId === entry.id ? (
                          <input
                            className="rotation-saved-name-input"
                            value={editingRotationName}
                            onChange={(e) => setEditingRotationName(e.target.value)}
                            onBlur={() => {
                              const trimmed = editingRotationName.trim()
                              if (trimmed && trimmed !== entry.name) {
                                updateInventoryRotation(entry.id, { name: trimmed })
                              }
                              setEditingRotationId(null)
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                (e.target as HTMLInputElement).blur()
                              } else if (e.key === 'Escape') {
                                setEditingRotationId(null)
                              }
                            }}
                            onClick={(e) => e.stopPropagation()}
                            autoFocus
                          />
                        ) : (
                          <strong>{entry.name}</strong>
                        )}
                        <span>
                          {entry.resonatorName} · {entry.mode === 'team' ? 'Team' : 'Personal'}
                          {entry.summary && (
                            <>
                              {' · '}
                              <span className="value avg">
                                {Math.round(entry.summary.total.avg).toLocaleString()}
                              </span>{' '}
                              avg
                            </>
                          )}
                        </span>
                    </div>
                    <div className="rotation-saved-actions">
                      <button
                        type="button"
                        title="Actions"
                        className="rotation-button mini"
                        onClick={(e) => {
                          e.stopPropagation()
                          actionListModal.show(entry)
                        }}
                      >
                        <CgListTree size={11} />
                      </button>
                      <button
                        type="button"
                        className="rotation-button mini"
                        onClick={(e) => {
                          e.stopPropagation()
                          setEditingRotationId(entry.id)
                          setEditingRotationName(entry.name)
                        }}
                        title="Rename"
                      >
                        <Pencil size={11} />
                      </button>
                      <button
                          type="button"
                          className="rotation-button mini"
                          title="Export"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleExportRotation(entry)
                          }}
                      >
                        <PiUploadSimpleBold size={11} />
                      </button>
                          <button
                        type="button"
                        className="rotation-button mini"
                        title="Load"
                        onClick={(e) => {
                          e.stopPropagation()
                          loadChoiceModal.show(entry)
                        }}
                      >
                        <PiDownloadSimpleBold size={11} />
                      </button>
                      <button
                        type="button"
                        title="Delete"
                        className="rotation-button clear mini"
                        onClick={(e) => {
                          e.stopPropagation()
                          confirmation.confirm({
                            title: 'You sure about that? ( · ❛ ֊ ❛)',
                            message: `Delete "${entry.name}" from your saved rotations?`,
                            confirmLabel: 'Delete',
                            variant: 'danger',
                            onConfirm: () => removeInventoryRotation(entry.id),
                          })
                        }}
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  </div>
                  }
                >
                  {entry ? (
                      <SavedRotationSnapshotSummary
                          entry={entry}
                          resolveResonatorName={(id) => getResonatorSeedById(id)?.name ?? id}
                      />
                  ) : (
                      <div className="team-state-empty">
                        No saved rotation snapshot yet.
                      </div>
                  )}
                </Expandable>
                ))
              ) : (
                <div className="soft-empty">No saved rotations yet.</div>
              )}
            </div>
          </div>
        </>
      )}

      {showDragPreview && dragPreviewPortalTarget
        ? createPortal(
            <div
                className={`rotation-drag-overlay ${dragOverArea === 'block-items' || dragOverArea === 'block-setup' ? 'over-block' : ''}`}
                style={{
                  left: dragPointer.x + 18,
                  top: dragPointer.y + 12,
                }}
              >
                {draggedEntryNode ? (
                  <RotationDragPreview
                    runtime={runtime}
                    node={draggedEntryNode}
                    resultMap={resultMap}
                    featureMetaById={featureMetaById}
                    conditionChoices={conditionChoices}
                  />
                ) : draggedNode && (draggedNode.type === 'repeat' || draggedNode.type === 'uptime') ? (
                  <article className="rotation-item rotation-block rotation-drag-preview ui-surface-card ui-surface-card--inner">
                    <div className="block-header">
                      <div className="rotation-entry-main">
                        <h4 className="highlight">{draggedNode.type === 'repeat' ? 'Repeat' : 'Uptime'}</h4>
                        <span className="rotation-entry-sub">
                          {draggedNode.type === 'repeat'
                            ? `${typeof draggedNode.times === 'number' ? draggedNode.times : '?'}× · ${draggedNode.items.length} item${draggedNode.items.length !== 1 ? 's' : ''}`
                            : `${Math.round((typeof draggedNode.ratio === 'number' ? draggedNode.ratio : 1) * 100)}% · ${draggedNode.items.length} item${draggedNode.items.length !== 1 ? 's' : ''}`}
                        </span>
                      </div>
                    </div>
                  </article>
                ) : null}
              </div>,
            dragPreviewPortalTarget,
          )
        : null}

      <input
          ref={importFileInputRef}
          type="file"
          accept="application/json,.json"
          style={{ display: 'none' }}
          onChange={handleImportRotations}
      />

      <RotationSkillMenu
        key={featureMenuModal.value ? `${featureMenuModal.value.mode}:${featureMenuModal.value.nodeId ?? 'new'}` : 'skill-menu:closed'}
        visible={featureMenuModal.visible}
        open={featureMenuModal.open}
        closing={featureMenuModal.closing}
        portalTarget={portalTarget}
        members={editableMembers}
        activeMemberId={featureMenuModal.value?.activeMemberId ?? runtime.id}
        defaultShowSubHits={defaultShowFeatureSubHits}
        onActiveMemberChange={(resonatorId) =>
          featureMenuModal.update((prev) => ({ ...prev, activeMemberId: resonatorId }))
        }
        onClose={featureMenuModal.hide}
        onSelectSkill={(entry) => {
          const memberSeed = seedResonatorsById[entry.resonatorId]
          if (memberSeed && entry.resonatorId !== runtime.id) {
            ensureTeamMemberRuntime(memberSeed)
          }

          if (featureMenuModal.value?.mode === 'edit' && featureMenuModal.value.nodeId) {
            updateCurrentNode(featureMenuModal.value.nodeId, (current) =>
              current.type === 'feature'
                ? {
                    ...current,
                    featureId: entry.featureId,
                    resonatorId: entry.resonatorId,
                  }
                : current,
            )
          } else {
            insertCurrentNode(featureMenuModal.value?.target ?? { parentId: null, branch: 'root' }, {
              id: makeNodeId('rotation:feature'),
              type: 'feature',
              resonatorId: entry.resonatorId,
              featureId: entry.featureId,
              multiplier: 1,
              enabled: true,
            })
          }

          featureMenuModal.hide()
        }}
      />

      <FeatureConditionsModal
        key={conditionEditorModal.value ? `${conditionEditorModal.value.mode}:${conditionEditorModal.value.nodeId ?? 'new'}` : 'condition-editor:closed'}
        visible={conditionEditorModal.visible}
        open={conditionEditorModal.open}
        closing={conditionEditorModal.closing}
        portalTarget={portalTarget}
        choices={conditionChoices}
        initialChanges={editedConditionNode?.changes ?? EMPTY_FEATURE_CONDITION_CHANGES}
        featureLabel={conditionEditorModal.value?.mode === 'edit' ? 'Edit Condition' : 'Add Conditions'}
        eyebrow="Rotation Conditions"
        emptyText="Select states from the picker to add a condition to the rotation list."
        onClose={conditionEditorModal.hide}
        onSave={(changes) => {
          for (const change of changes) {
            const memberSeed = change.resonatorId ? seedResonatorsById[change.resonatorId] : null
            if (memberSeed && change.resonatorId !== runtime.id) {
              ensureTeamMemberRuntime(memberSeed)
            }
          }

          if (conditionEditorModal.value?.mode === 'edit' && conditionEditorModal.value.nodeId) {
            const nodeId = conditionEditorModal.value.nodeId
            if (changes.length === 0) {
              deleteCurrentNode(nodeId)
              conditionEditorModal.hide()
              return
            }

            const replacementNodes = changes.map((change, index) => makeRotationConditionNodeFromChange(
              change,
              conditionChoices,
              {
                id: index === 0 ? nodeId : undefined,
                enabled: editedConditionNode?.enabled ?? true,
                fallbackResonatorId: editedConditionNode?.resonatorId,
              },
            ))

            updateCurrentItems((items) => {
              const nextItems = updateRotationNode(items, nodeId, () => replacementNodes[0])
              const location = findNodeLocation(nextItems, nodeId)
              if (!location) {
                return nextItems
              }

              return insertRotationNodes(
                nextItems,
                {
                  parentId: location.parentId,
                  branch: location.branch,
                  index: location.index + 1,
                },
                replacementNodes.slice(1),
              )
            })
            conditionEditorModal.hide()
            return
          }

          const nodes = changes.map((change) => makeRotationConditionNodeFromChange(change, conditionChoices))
          insertCurrentNodes(conditionEditorModal.value?.target ?? { parentId: null, branch: 'root' }, nodes)
          conditionEditorModal.hide()
        }}
      />

      <FeatureConditionsModal
        key={featureConditionEditorModal.value?.nodeId ?? 'feature-condition-editor:closed'}
        visible={featureConditionEditorModal.visible}
        open={featureConditionEditorModal.open}
        closing={featureConditionEditorModal.closing}
        portalTarget={portalTarget}
        choices={conditionChoices}
        initialChanges={editedFeatureConditionNode?.changes ?? EMPTY_FEATURE_CONDITION_CHANGES}
        featureLabel={
          editedFeatureConditionNode
            ? featureMetaById[editedFeatureConditionNode.featureId]?.label ?? editedFeatureConditionNode.featureId
            : 'Feature'
        }
        onClose={featureConditionEditorModal.hide}
        onSave={(changes) => {
          if (!featureConditionEditorModal.value?.nodeId) {
            return
          }

          for (const change of changes) {
            const memberSeed = change.resonatorId ? seedResonatorsById[change.resonatorId] : null
            if (memberSeed && change.resonatorId !== runtime.id) {
              ensureTeamMemberRuntime(memberSeed)
            }
          }

          updateCurrentNode(featureConditionEditorModal.value.nodeId, (current) =>
            current.type === 'feature'
              ? (() => {
                  const { changes: _removedChanges, ...featureNode } = current
                  void _removedChanges
                  return changes.length > 0 ? { ...featureNode, changes } : featureNode
                })()
              : current,
          )
          featureConditionEditorModal.hide()
        }}
      />

      <NegativeEffectConfigModal
        key={negativeEffectConfigModal.value?.nodeId ?? 'negative-effect-config:closed'}
        visible={negativeEffectConfigModal.visible}
        open={negativeEffectConfigModal.open}
        closing={negativeEffectConfigModal.closing}
        portalTarget={portalTarget}
        initialNode={editedNegativeEffectFeatureNode}
        featureMeta={editedNegativeEffectMeta}
        onClose={negativeEffectConfigModal.hide}
        onSave={(config) => {
          if (!negativeEffectConfigModal.value?.nodeId) {
            return
          }

          updateCurrentNode(negativeEffectConfigModal.value.nodeId, (current) =>
            current.type === 'feature'
              ? (() => {
                  const { negativeEffectStacks: _removedStacks, ...featureNode } = current
                  void _removedStacks
                  return {
                    ...featureNode,
                    ...config,
                  }
                })()
              : current,
          )
          negativeEffectConfigModal.hide()
        }}
      />

      <BlockPickerModal
        visible={blockPickerModal.visible}
        open={blockPickerModal.open}
        closing={blockPickerModal.closing}
        portalTarget={portalTarget}
        onClose={blockPickerModal.hide}
        onSelect={(type) => {
          insertCurrentNode(blockPickerModal.value?.target ?? { parentId: null, branch: 'root' }, makeBlockNode(type))
          blockPickerModal.hide()
        }}
      />

      <ConfirmationModal
        visible={confirmation.visible}
        open={confirmation.open}
        closing={confirmation.closing}
        portalTarget={portalTarget}
        title={confirmation.title}
        message={confirmation.message}
        confirmLabel={confirmation.confirmLabel}
        cancelLabel={confirmation.cancelLabel}
        variant={confirmation.variant}
        onConfirm={confirmation.onConfirm}
        onCancel={confirmation.onCancel}
      />

      <AppDialog
        visible={actionListModal.visible}
        open={actionListModal.open}
        closing={actionListModal.closing}
        portalTarget={portalTarget}
        contentClassName="app-modal-panel confirmation-modal confirmation-modal--info rotation-action-list-modal"
        ariaLabel="Saved rotation action sequence"
        onClose={actionListModal.hide}
      >
        <div className="confirmation-modal__body rotation-action-list-modal__body">
          <div className="rotation-action-list-modal__head">
            <h2 className="confirmation-modal__title">{actionListModal.value?.name ?? 'Saved Rotation'}</h2>
            <ModalCloseButton onClick={actionListModal.hide} />
          </div>
          <div className="rotation-action-list-modal__list">
            {actionListSequence ? (
              <RotationActionSequenceList
                actions={actionListSequence.actions}
                conditionChoices={conditionChoices}
                entries={actionListSequence.entries}
                spans={actionListSequence.spans}
              />
            ) : null}
          </div>
        </div>
      </AppDialog>

      <AppDialog
        visible={loadChoiceModal.visible}
        open={loadChoiceModal.open}
        closing={loadChoiceModal.closing}
        portalTarget={portalTarget}
        contentClassName="app-modal-panel confirmation-modal confirmation-modal--info"
        ariaLabel="Load rotation"
        onClose={loadChoiceModal.hide}
      >
        <div className="confirmation-modal__body">
          <h2 className="confirmation-modal__title">
            Load "{loadChoiceModal.value?.name}"
          </h2>
          <div className="confirmation-modal__message">
            Choose how to load this saved rotation.
          </div>
        </div>
        <div className="confirmation-modal__actions rotation-load-choice-actions">
          <button
            type="button"
            className="confirmation-modal__btn confirmation-modal__btn--cancel"
            onClick={loadChoiceModal.hide}
          >
            Cancel
          </button>
          <button
            type="button"
            className="confirmation-modal__btn confirmation-modal__btn--confirm"
            onClick={() => {
              if (loadChoiceModal.value) loadSavedRotation(loadChoiceModal.value)
              loadChoiceModal.hide()
            }}
          >
            Rotation Only
          </button>
          <button
            type="button"
            className="confirmation-modal__btn confirmation-modal__btn--confirm"
            disabled={!loadChoiceModal.value?.snapshot}
            title={loadChoiceModal.value?.snapshot ? undefined : 'No build snapshot saved with this entry'}
            onClick={() => {
              if (loadChoiceModal.value) loadSavedRotation(loadChoiceModal.value, true)
              loadChoiceModal.hide()
            }}
          >
            Full Build
          </button>
        </div>
      </AppDialog>
    </section>
  )
}
