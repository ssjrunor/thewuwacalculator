/*
  Author: Runor Ewhro
  description: evaluates source-state top-stat operations while preserving the
               formula terms used by the combat pipeline.
*/

import type { EnemyProfile } from '@/domain/entities/appState'
import type { EffectDef, EffectScope, FormExpr, SourceState } from '@/domain/gameData/contracts'
import type { ResRuntime } from '@/domain/entities/runtime'
import type { SimResult } from '@/engine/pipeline/types'
import { listFfctForO } from '@/data/catalog/gameDataService'
import { mkSrcSttScp } from '@/engine/services/sourceStateService'
import { evalCond, evalForm } from '@/engine/effects/evaluator'
import { formatTruncCompact } from '@/shared/lib/number'

export interface MathTerm {
  id: string
  label: string
  value: number
  equation: string
  active: boolean
}

function statePath(path: string): string {
  const normalized = path.replace(/^context\./, '').replace(/^(sourceRuntime|targetRuntime|activeRuntime)\./, 'runtime.')
  return /^(state|base|build)\./.test(normalized) ? `runtime.${normalized}` : normalized
}

/** match a control when either an activation condition or formula reads its path. */
export function effectReferencesState(effect: EffectDef, state: SourceState): boolean {
  const expected = statePath(state.path)
  function references(value: unknown): boolean {
    if (!value || typeof value !== 'object') return false
    if (Array.isArray(value)) return value.some(references)
    const record = value as Record<string, unknown>
    if (typeof record.path === 'string' && statePath(record.path) === expected) return true
    return Object.values(record).some(references)
  }
  return references(effect.condition) || references(effect.operations)
}

function fmtNum(value: number): string {
  return formatTruncCompact(Math.round(value * 100) / 100, 2)
}

function term(formula: FormExpr, scope: EffectScope): string {
  if (formula.type === 'const') {
    return fmtNum(formula.value)
  }

  if (formula.type === 'read') {
    const value = evalForm(formula, scope)
    const path = `${formula.from ?? ''}.${formula.path}`

    if (path.endsWith('finalStats.tbb') || path.endsWith('finalStats.tuneBreakBoost')) {
      return `TBB ${fmtNum(value)}`
    }

    if (path.endsWith('enemy.status.tuneStrain')) {
      return `Tune Strain ${fmtNum(value)}`
    }

    return `${formula.path.split('.').at(-1) ?? 'Value'} ${fmtNum(value)}`
  }

  if (formula.type === 'clamp') {
    // display the source operand without the clamp bounds.
    return term(formula.value, scope)
  }

  return fmtNum(evalForm(formula, scope))
}

/** serializes the evaluated operands without changing formula order. */
function formulaMath(formula: FormExpr, scope: EffectScope): string {
  if (formula.type === 'mul') {
    return formula.values.map((entry) => term(entry, scope)).join(' x ')
  }

  if (formula.type === 'add') {
    return formula.values.map((entry) => term(entry, scope)).join(' + ')
  }

  return term(formula, scope)
}

export function mkEffectScope(
  runtime: ResRuntime,
  state: Pick<SourceState, 'source' | 'displayScope'>,
  enemy: EnemyProfile,
  simulation: Pick<SimResult, 'finalStats'> | null,
): EffectScope {
  const base = mkSrcSttScp(runtime, runtime, state, runtime)
  const finalStats = simulation?.finalStats

  // source effects read both direct and context-prefixed final stats; the
  // target enemy is the current draft when the console has unsaved changes.
  return {
    ...base,
    sourceFinalStats: finalStats,
    finalStats,
    context: {
      ...base.context,
      sourceFinalStats: finalStats,
      finalStats,
      enemy,
    },
  }
}

/**
 * returns every matching top-stat operation with its evaluated operands.
 * inactive operations retain their formula but contribute zero.
 */
export function topStatMath(
  runtime: ResRuntime,
  state: SourceState | readonly SourceState[],
  enemy: EnemyProfile,
  simulation: Pick<SimResult, 'finalStats'> | null,
  stat: 'dmgVuln' | 'finalDmg',
): MathTerm[] {
  const states = 'ownerKey' in state ? [state] : state
  if (!states.length) return []
  const scope = mkEffectScope(runtime, states[0], enemy, simulation)
  const effects = new Map(states.flatMap((entry) => listFfctForO(entry.ownerKey)).map((effect) => [effect.id, effect]))

  return [...effects.values()].flatMap((effect) => {
    const active = evalCond(effect.condition, scope)

    return effect.operations.flatMap((operation, index) => {
      if (operation.type !== 'add_top_stat' || operation.stat !== stat) {
        return []
      }

      return [{
        id: `${effect.id}:${index}`,
        label: effect.label,
        value: active ? evalForm(operation.value, scope) : 0,
        equation: formulaMath(operation.value, scope),
        active,
      }]
    })
  })
}
