/*
  Author: Runor Ewhro
  Description: Evaluates source-state top-stat operations while preserving the
               formula terms used by the combat pipeline.
*/

import type { EnemyProfile } from '@/domain/entities/appState'
import type { EffectScope, FormExpr, SourceState } from '@/domain/gameData/contracts'
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
    return term(formula.value, scope)
  }

  return fmtNum(evalForm(formula, scope))
}

/** Serializes the evaluated operands without changing formula order. */
export function formulaMath(formula: FormExpr, scope: EffectScope): string {
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
  simulation: SimResult | null,
): EffectScope {
  const base = mkSrcSttScp(runtime, runtime, state, runtime)
  const finalStats = simulation?.finalStats

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
 * Returns every matching top-stat operation with its evaluated operands.
 * Inactive operations retain their formula but contribute zero.
 */
export function topStatMath(
  runtime: ResRuntime,
  state: SourceState,
  enemy: EnemyProfile,
  simulation: SimResult | null,
  stat: 'dmgVuln' | 'finalDmg',
): MathTerm[] {
  const scope = mkEffectScope(runtime, state, enemy, simulation)

  return listFfctForO(state.ownerKey).flatMap((effect) => {
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
