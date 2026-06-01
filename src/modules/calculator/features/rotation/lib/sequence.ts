/*
  Author: Runor Ewhro
  Description: Provides shared sequence helpers for the rotation surface.
*/

import type { RotationNode, RotVl, RotWhenRule, RtChng } from '@/domain/gameData/contracts'
import type { CombatState } from '@/domain/entities/runtime'
import type { AttributeKey } from '@/domain/entities/stats'
import {
  getNegFfctCm,
  NEG_EFFECT_KEYS,
  type NegEffectKey,
} from '@/domain/gameData/negativeEffects'
import { fmtFormExpr } from '@/shared/lib/formatGameData'
import {featureMeta} from "@/modules/calculator/features/rotation/lib/features.ts";
import {seedRsntById} from "@/modules/calculator/features/resonator/lib/seedData.ts";
import {getRotNodeTm, getRotNodeSt} from "@/modules/calculator/features/rotation/lib/analytics.ts";
import { ROT_LOOP_COLORS, normLoopRuns } from "@/modules/calculator/features/rotation/lib/loops.ts";

export interface RotSqncCtnEn {
  key: string
  label: string
  multiplier: number
  resonatorId: string | null
  resName: string | null
  profile: string | null
  attribute: AttributeKey | null
  missing: boolean
  negEfxStck?: number
  rules: RotSqncRule[]
}

export type RotSqncRule = { type: 'change'; change: RtChng }

export type RotSqncLoopM = 'start' | 'end' | 'self'

export type RotSqncEnt =
  | {
      type: 'action'
      key: string
      action: RotSqncCtnEn
      phase?: 'setup' | 'body'
      when?: RotWhenRule
    }
  | {
      type: 'condition'
      key: string
      label: string
      depth: number
      enabled: boolean
      rules: RotSqncRule[]
      phase?: 'setup' | 'body'
      when?: RotWhenRule
    }
  | {
      type: 'loopMarker'
      key: string
      loopId: string
      kind: RotSqncLoopM
      label: string
      color: string
      runs: number
      depth: number
      enabled: boolean
      phase?: 'setup' | 'body'
      when?: RotWhenRule
    }

export interface RotSqncSpan {
  key: string
  kind: 'repeat' | 'uptime'
  label: string
  depth: number
  startIndex: number
  endIndex: number
  rules: RotSqncRule[]
}

export interface RotSqncNpt {
  items: RotationNode[]
  initialCombat?: Partial<CombatState> | null
  resonatorId?: string | null
}

export interface RotSqncRslt {
  actions: RotSqncCtnEn[]
  entries: RotSqncEnt[]
  spans: RotSqncSpan[]
}

function getFeatMltp(node: RotationNode): number {
  return node.type === 'feature' && typeof node.multiplier === 'number' && Number.isFinite(node.multiplier)
    ? Math.max(1, node.multiplier)
    : 1
}

function getFeatPartI(
  node: Extract<RotationNode, { type: 'feature' }>,
  fallbackResId: string | null | undefined,
  meta: ReturnType<typeof featureMeta>,
): string | null {
  return meta?.resonatorId ?? node.resonatorId ?? fallbackResId ?? null
}

function getFeatCtnLb(
  node: Extract<RotationNode, { type: 'feature' }>,
  meta: ReturnType<typeof featureMeta>,
): string {
  if (meta?.skill?.tab === 'negativeEffect') {
    return meta.skill.label
  }

  return meta?.feature.label ?? meta?.skill?.label ?? node.featureId
}

const NEGFFCTKEYSE = new Set<string>(NEG_EFFECT_KEYS)

function isNegFfctKey(value: string): value is NegEffectKey {
  return NEGFFCTKEYSE.has(value)
}

function normStckVl(value: string | number | boolean | undefined): number {
  // sequence summaries only need non-negative integer stacks, regardless of whether a condition came from toggle,
  // number, or string input.
  if (typeof value === 'boolean') {
    return value ? 1 : 0
  }

  const numericValue = typeof value === 'number' ? value : Number(value ?? 0)
  return Number.isFinite(numericValue) ? Math.max(0, Math.floor(numericValue)) : 0
}

function mkCmbtStt(initialCombat: Partial<CombatState> | null | undefined): CombatState {
  // create a complete combat-state object so later condition changes can mutate known keys without defensive checks.
  return {
    spectroFrazzle: normStckVl(initialCombat?.spectroFrazzle),
    aeroErosion: normStckVl(initialCombat?.aeroErosion),
    fusionBurst: normStckVl(initialCombat?.fusionBurst),
    havocBane: normStckVl(initialCombat?.havocBane),
    glacioChafe: normStckVl(initialCombat?.glacioChafe),
    electroFlare: normStckVl(initialCombat?.electroFlare),
    electroRage: normStckVl(initialCombat?.electroRage),
  }
}

function getCmbtKeyFo(path: string): NegEffectKey | null {
  // authored rotations have used several path prefixes over time; normalize all recognized variants into the current
  // combat key names.
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
    return isNegFfctKey(key) ? key : null
  }

  return null
}

function applyCmbtChn(combatState: CombatState, change: RtChng): void {
  const key = getCmbtKeyFo(change.path)
  if (!key) {
    return
  }

  // add changes accumulate stacks; set/toggle changes replace the tracked combat state for subsequent sequence rows.
  if (change.type === 'add') {
    combatState[key] = normStckVl((combatState[key] ?? 0) + change.value)
    return
  }

  combatState[key] = normStckVl(change.type === 'toggle' ? change.value ?? true : change.value)
}

function applyCombat(combatState: CombatState, changes: RtChng[] | undefined): void {
  for (const change of changes ?? []) {
    applyCmbtChn(combatState, change)
  }
}

function getCtnNegFfc(
  node: Extract<RotationNode, { type: 'feature' }>,
  meta: ReturnType<typeof featureMeta>,
  combatState: CombatState,
): number | undefined {
  const key = getNegFfctCm(meta?.skill?.archetype)
  if (!key) {
    return undefined
  }

  const hasTtchStckC = (node.changes ?? []).some((change) => getCmbtKeyFo(change.path) === key)
  if (
    !hasTtchStckC &&
    typeof node.negativeEffectStacks === 'number' &&
    Number.isFinite(node.negativeEffectStacks)
  ) {
    // legacy negative-effect nodes may store fixed stacks directly on the feature; use that value only when the node
    // does not already carry an explicit combat-state change.
    return normStckVl(node.negativeEffectStacks)
  }

  return normStckVl(combatState[key])
}

function mkCtnEnt(
  node: Extract<RotationNode, { type: 'feature' }>,
  fallbackResId: string | null | undefined,
  combatState: CombatState,
): RotSqncCtnEn {
  // action rows snapshot resolved member metadata and current negative-effect stacks before node-local changes advance
  // combat state for the next row.
  const meta = featureMeta(node)
  const partId = getFeatPartI(node, fallbackResId, meta)
  const partSeed = partId ? seedRsntById[partId] : null
  const negFfctStck = getCtnNegFfc(node, meta, combatState)

  return {
    key: `${node.id}:${node.featureId}`,
    label: getFeatCtnLb(node, meta),
    multiplier: getFeatMltp(node),
    resonatorId: partId,
    resName: partSeed?.name ?? meta?.resName ?? partId,
    profile: partSeed?.profile ?? null,
    attribute: partSeed?.attribute ?? null,
    missing: !partSeed && Boolean(partId),
    negEfxStck: negFfctStck,
    rules: node.changes?.map((change): RotSqncRule => ({ type: 'change', change })) ?? [],
  }
}

function fmtRotVl(value: RotVl): string {
  return typeof value === 'number' ? formatNumber(value) : fmtFormExpr(value)
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, '')
}

function fmtPtmVl(value: RotVl): string {
  return typeof value === 'number' ? `${formatNumber(value * 100)}% uptime` : `${fmtFormExpr(value)} uptime`
}

function fmtRptVl(value: RotVl): string {
  const text = fmtRotVl(value)
  return `${text} ${text === '1' ? 'time' : 'times'}`
}

function getCondRls(node: Extract<RotationNode, { type: 'condition' }>): RotSqncRule[] {
  return node.changes.map((change): RotSqncRule => ({ type: 'change', change }))
}

function cllcStpRls(nodes: RotationNode[]): RotSqncRule[] {
  const rules: RotSqncRule[] = []

  // uptime setup conditions behave as preconditions for the block body, so they are lifted into the span rules instead
  // of appearing as standalone body actions.
  for (const node of nodes) {
    if (node.type === 'condition') {
      rules.push(...getCondRls(node))
    }

    if (node.type === 'uptime') {
      rules.push(...cllcStpRls(node.setup ?? []))
    }

    rules.push(...cllcStpRls(getRotNodeTm(node)))
  }

  return rules
}

function hasMnngWhenR(when: RotWhenRule | undefined): boolean {
  if (!when) {
    return false
  }
  if (when.condition) {
    return true
  }
  return Array.isArray(when.loops) && when.loops.length > 0
}

function pickWhen(when: RotWhenRule | undefined): RotWhenRule | undefined {
  return hasMnngWhenR(when) ? when : undefined
}

interface OpenLoopRcrd {
  strtNtryIdx: number
  strtMrkrKey: string
  loopId: string
  label: string
  color: string
  runs: number
  depth: number
}

export function mkSqnc(input: RotSqncNpt): RotSqncRslt {
  const actions: RotSqncCtnEn[] = []
  const entries: RotSqncEnt[] = []
  const spans: RotSqncSpan[] = []
  const combatState = mkCmbtStt(input.initialCombat)
  let loopClrCrsr = 0

  const visit = (nodes: RotationNode[], depth = 1, phase: 'setup' | 'body' = 'body') => {
    const openLoops = new Map<string, OpenLoopRcrd>()

    for (const node of nodes) {
      if (node.type === 'feature') {
        if (node.enabled ?? true) {
          applyCombat(combatState, node.changes)
        }

        const action = mkCtnEnt(node, input.resonatorId, combatState)
        actions.push(action)
        entries.push({ type: 'action', key: action.key, action, phase, when: pickWhen(node.when) })
      }

      if (node.type === 'condition') {
        const enabled = node.enabled ?? true
        entries.push({
          type: 'condition',
          key: node.id,
          label: node.label ?? 'Condition',
          depth,
          enabled,
          rules: getCondRls(node),
          phase,
          when: pickWhen(node.when),
        })

        if (enabled) {
          applyCombat(combatState, node.changes)
        }
      }

      if (node.type === 'loop') {
        const enabled = node.enabled ?? true

        if (node.kind === 'start') {
          const color = node.color ?? ROT_LOOP_COLORS[loopClrCrsr % ROT_LOOP_COLORS.length]
          loopClrCrsr += 1
          const runs = normLoopRuns(node.runs ?? 1)
          const label = node.label ?? 'Loop'
          const markerKey = `${node.id}:start`
          const startEntNdx = entries.length

          entries.push({
            type: 'loopMarker',
            key: markerKey,
            loopId: node.loopId,
            kind: 'start',
            label,
            color,
            runs,
            depth,
            enabled,
            phase,
            when: pickWhen(node.when),
          })

          openLoops.set(node.loopId, {
            strtNtryIdx: startEntNdx,
            strtMrkrKey: markerKey,
            loopId: node.loopId,
            label,
            color,
            runs,
            depth,
          })
        }

        if (node.kind === 'end') {
          const open = openLoops.get(node.loopId)

          entries.push({
            type: 'loopMarker',
            key: `${node.id}:end`,
            loopId: node.loopId,
            kind: 'end',
            label: open?.label ?? 'Loop',
            color: open?.color ?? ROT_LOOP_COLORS[0],
            runs: open?.runs ?? 1,
            depth,
            enabled,
            phase,
          })

          if (open) {
            openLoops.delete(node.loopId)
          }
        }
      }

      if (node.type === 'repeat' || node.type === 'uptime') {
        const startIndex = entries.length
        const setupRules = node.type === 'uptime' ? cllcStpRls(node.setup ?? []) : []

        visit(getRotNodeSt(node), depth + 1, 'setup')
        visit(getRotNodeTm(node), depth + 1, 'body')

        const endIndex = entries.length - 1
        if (endIndex >= startIndex) {
          spans.push({
            key: node.id,
            kind: node.type,
            label: node.type === 'repeat' ? `Repeat ${fmtRptVl(node.times)}` : fmtPtmVl(node.ratio),
            depth,
            startIndex,
            endIndex,
            rules: setupRules,
          })
        }
      }
    }

    for (const open of openLoops.values()) {
      const entry = entries[open.strtNtryIdx]
      if (entry?.type === 'loopMarker') {
        entry.kind = 'self'
      }
    }
  }

  visit(input.items)

  return { actions, entries, spans }
}
