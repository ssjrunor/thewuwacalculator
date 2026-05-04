import type { RotationNode, RotationValue, RuntimeChange } from '@/domain/gameData/contracts'
import type { CombatState } from '@/domain/entities/runtime'
import type { AttributeKey } from '@/domain/entities/stats'
import {
  getNegativeEffectCombatKey,
  NEGATIVE_EFFECT_ORDER,
  type NegativeEffectKey,
} from '@/domain/gameData/negativeEffects'
import { formatFormulaExpression } from '@/shared/lib/formatGameData'
import { seedResonatorsById } from '@/modules/calculator/model/seedData'
import {
  getRotationNodeItems,
  getRotationNodeSetup,
} from '@/modules/calculator/model/rotationAnalytics'
import { resolveRotationFeatureMeta } from '@/modules/calculator/model/rotationFeatureMeta'

export interface RotationSequenceActionEntry {
  key: string
  label: string
  multiplier: number
  resonatorId: string | null
  resonatorName: string | null
  profile: string | null
  attribute: AttributeKey | null
  missing: boolean
  negativeEffectStacks?: number
  rules: RotationSequenceRule[]
}

export type RotationSequenceRule = { type: 'change'; change: RuntimeChange }

export type RotationSequenceEntry =
  | { type: 'action'; key: string; action: RotationSequenceActionEntry; phase?: 'setup' | 'body' }
  | {
      type: 'condition'
      key: string
      label: string
      depth: number
      enabled: boolean
      rules: RotationSequenceRule[]
      phase?: 'setup' | 'body'
    }

export interface RotationSequenceSpan {
  key: string
  kind: 'repeat' | 'uptime'
  label: string
  depth: number
  startIndex: number
  endIndex: number
  rules: RotationSequenceRule[]
}

export interface RotationSequenceInput {
  items: RotationNode[]
  initialCombat?: Partial<CombatState> | null
  resonatorId?: string | null
}

export interface RotationSequenceResult {
  actions: RotationSequenceActionEntry[]
  entries: RotationSequenceEntry[]
  spans: RotationSequenceSpan[]
}

function getFeatureMultiplier(node: RotationNode): number {
  return node.type === 'feature' && typeof node.multiplier === 'number' && Number.isFinite(node.multiplier)
    ? Math.max(1, node.multiplier)
    : 1
}

function getFeatureParticipantId(
  node: Extract<RotationNode, { type: 'feature' }>,
  fallbackResonatorId: string | null | undefined,
  meta: ReturnType<typeof resolveRotationFeatureMeta>,
): string | null {
  return meta?.resonatorId ?? node.resonatorId ?? fallbackResonatorId ?? null
}

function getFeatureActionLabel(
  node: Extract<RotationNode, { type: 'feature' }>,
  meta: ReturnType<typeof resolveRotationFeatureMeta>,
): string {
  if (meta?.skill?.tab === 'negativeEffect') {
    return meta.skill.label
  }

  return meta?.feature.label ?? meta?.skill?.label ?? node.featureId
}

const NEGATIVE_EFFECT_KEY_SET = new Set<string>(NEGATIVE_EFFECT_ORDER)

function isNegativeEffectKey(value: string): value is NegativeEffectKey {
  return NEGATIVE_EFFECT_KEY_SET.has(value)
}

function normalizeStackValue(value: string | number | boolean | undefined): number {
  if (typeof value === 'boolean') {
    return value ? 1 : 0
  }

  const numericValue = typeof value === 'number' ? value : Number(value ?? 0)
  return Number.isFinite(numericValue) ? Math.max(0, Math.floor(numericValue)) : 0
}

function makeCombatState(initialCombat: Partial<CombatState> | null | undefined): CombatState {
  return {
    spectroFrazzle: normalizeStackValue(initialCombat?.spectroFrazzle),
    aeroErosion: normalizeStackValue(initialCombat?.aeroErosion),
    fusionBurst: normalizeStackValue(initialCombat?.fusionBurst),
    havocBane: normalizeStackValue(initialCombat?.havocBane),
    glacioChafe: normalizeStackValue(initialCombat?.glacioChafe),
    electroFlare: normalizeStackValue(initialCombat?.electroFlare),
    electroRage: normalizeStackValue(initialCombat?.electroRage),
  }
}

function getCombatKeyForRuntimePath(path: string): NegativeEffectKey | null {
  const prefixes = [
    'enemy.combat.',
    'context.enemy.combat.',
    'runtime.state.combat.',
    'state.combat.',
  ]

  for (const prefix of prefixes) {
    if (!path.startsWith(prefix)) {
      continue
    }

    const key = path.slice(prefix.length)
    return isNegativeEffectKey(key) ? key : null
  }

  return null
}

function applyCombatChange(combatState: CombatState, change: RuntimeChange): void {
  const key = getCombatKeyForRuntimePath(change.path)
  if (!key) {
    return
  }

  if (change.type === 'add') {
    combatState[key] = normalizeStackValue((combatState[key] ?? 0) + change.value)
    return
  }

  combatState[key] = normalizeStackValue(change.type === 'toggle' ? change.value ?? true : change.value)
}

function applyCombatChanges(combatState: CombatState, changes: RuntimeChange[] | undefined): void {
  for (const change of changes ?? []) {
    applyCombatChange(combatState, change)
  }
}

function getActionNegativeEffectStacks(
  node: Extract<RotationNode, { type: 'feature' }>,
  meta: ReturnType<typeof resolveRotationFeatureMeta>,
  combatState: CombatState,
): number | undefined {
  const key = getNegativeEffectCombatKey(meta?.skill?.archetype)
  if (!key) {
    return undefined
  }

  const hasAttachedStackChange = (node.changes ?? []).some((change) => getCombatKeyForRuntimePath(change.path) === key)
  if (
    !hasAttachedStackChange &&
    typeof node.negativeEffectStacks === 'number' &&
    Number.isFinite(node.negativeEffectStacks)
  ) {
    return normalizeStackValue(node.negativeEffectStacks)
  }

  return normalizeStackValue(combatState[key])
}

function makeActionEntry(
  node: Extract<RotationNode, { type: 'feature' }>,
  fallbackResonatorId: string | null | undefined,
  combatState: CombatState,
): RotationSequenceActionEntry {
  const meta = resolveRotationFeatureMeta(node)
  const participantId = getFeatureParticipantId(node, fallbackResonatorId, meta)
  const participantSeed = participantId ? seedResonatorsById[participantId] : null
  const negativeEffectStacks = getActionNegativeEffectStacks(node, meta, combatState)

  return {
    key: `${node.id}:${node.featureId}`,
    label: getFeatureActionLabel(node, meta),
    multiplier: getFeatureMultiplier(node),
    resonatorId: participantId,
    resonatorName: participantSeed?.name ?? meta?.resonatorName ?? participantId,
    profile: participantSeed?.profile ?? null,
    attribute: participantSeed?.attribute ?? null,
    missing: !participantSeed && Boolean(participantId),
    negativeEffectStacks,
    rules: node.changes?.map((change): RotationSequenceRule => ({ type: 'change', change })) ?? [],
  }
}

function formatRotationValue(value: RotationValue): string {
  return typeof value === 'number' ? formatNumber(value) : formatFormulaExpression(value)
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, '')
}

function formatUptimeValue(value: RotationValue): string {
  return typeof value === 'number' ? `${formatNumber(value * 100)}% uptime` : `${formatFormulaExpression(value)} uptime`
}

function formatRepeatValue(value: RotationValue): string {
  const text = formatRotationValue(value)
  return `${text} ${text === '1' ? 'time' : 'times'}`
}

function getConditionRules(node: Extract<RotationNode, { type: 'condition' }>): RotationSequenceRule[] {
  return node.changes.map((change): RotationSequenceRule => ({ type: 'change', change }))
}

function collectSetupRules(nodes: RotationNode[]): RotationSequenceRule[] {
  const rules: RotationSequenceRule[] = []

  for (const node of nodes) {
    if (node.type === 'condition') {
      rules.push(...getConditionRules(node))
    }

    if (node.type === 'uptime') {
      rules.push(...collectSetupRules(node.setup ?? []))
    }

    rules.push(...collectSetupRules(getRotationNodeItems(node)))
  }

  return rules
}

export function buildRotationActionSequence(input: RotationSequenceInput): RotationSequenceResult {
  const actions: RotationSequenceActionEntry[] = []
  const entries: RotationSequenceEntry[] = []
  const spans: RotationSequenceSpan[] = []
  const combatState = makeCombatState(input.initialCombat)

  const visit = (nodes: RotationNode[], depth = 1, phase: 'setup' | 'body' = 'body') => {
    for (const node of nodes) {
      if (node.type === 'feature') {
        if (node.enabled ?? true) {
          applyCombatChanges(combatState, node.changes)
        }

        const action = makeActionEntry(node, input.resonatorId, combatState)
        actions.push(action)
        entries.push({ type: 'action', key: action.key, action, phase })
      }

      if (node.type === 'condition') {
        const enabled = node.enabled ?? true
        entries.push({
          type: 'condition',
          key: node.id,
          label: node.label ?? 'Condition',
          depth,
          enabled,
          rules: getConditionRules(node),
          phase,
        })

        if (enabled) {
          applyCombatChanges(combatState, node.changes)
        }
      }

      if (node.type === 'repeat' || node.type === 'uptime') {
        const startIndex = entries.length
        const setupRules = node.type === 'uptime' ? collectSetupRules(node.setup ?? []) : []

        visit(getRotationNodeSetup(node), depth + 1, 'setup')
        visit(getRotationNodeItems(node), depth + 1, 'body')

        const endIndex = entries.length - 1
        if (endIndex >= startIndex) {
          spans.push({
            key: node.id,
            kind: node.type,
            label: node.type === 'repeat' ? `Repeat ${formatRepeatValue(node.times)}` : formatUptimeValue(node.ratio),
            depth,
            startIndex,
            endIndex,
            rules: setupRules,
          })
        }
      }
    }
  }

  visit(input.items)

  return { actions, entries, spans }
}
