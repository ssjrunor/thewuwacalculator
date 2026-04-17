import type { RotationNode, RotationValue, RuntimeChange } from '@/domain/gameData/contracts'
import type { AttributeKey } from '@/domain/entities/stats'
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
  return meta?.feature.label ?? meta?.skill?.label ?? node.featureId
}

function makeActionEntry(
  node: Extract<RotationNode, { type: 'feature' }>,
  fallbackResonatorId: string | null | undefined,
): RotationSequenceActionEntry {
  const meta = resolveRotationFeatureMeta(node)
  const participantId = getFeatureParticipantId(node, fallbackResonatorId, meta)
  const participantSeed = participantId ? seedResonatorsById[participantId] : null

  return {
    key: `${node.id}:${node.featureId}`,
    label: getFeatureActionLabel(node, meta),
    multiplier: getFeatureMultiplier(node),
    resonatorId: participantId,
    resonatorName: participantSeed?.name ?? meta?.resonatorName ?? participantId,
    profile: participantSeed?.profile ?? null,
    attribute: participantSeed?.attribute ?? null,
    missing: !participantSeed && Boolean(participantId),
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

  const visit = (nodes: RotationNode[], depth = 1, phase: 'setup' | 'body' = 'body') => {
    for (const node of nodes) {
      if (node.type === 'feature') {
        const action = makeActionEntry(node, input.resonatorId)
        actions.push(action)
        entries.push({ type: 'action', key: action.key, action, phase })
      }

      if (node.type === 'condition') {
        entries.push({
          type: 'condition',
          key: node.id,
          label: node.label ?? 'Condition',
          depth,
          enabled: node.enabled ?? true,
          rules: getConditionRules(node),
          phase,
        })
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
