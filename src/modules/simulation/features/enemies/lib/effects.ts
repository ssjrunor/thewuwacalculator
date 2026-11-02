/*
  Author: Runor Ewhro
  description: reads enemy and team effects for the console, including
               vulnerability, resistance, immunity, and final damage.
*/

import type { EnemyProfile } from '@/domain/entities/appState'
import type { EffectDef, EffectScope, SourceState } from '@/domain/gameData/contracts'
import type { ResRuntime } from '@/domain/entities/runtime'
import type { SimResult } from '@/engine/pipeline/types'
import { getResDtlsBy } from '@/data/gameData/resonators/resonatorDataStore'
import { listEffectsFor, listFfctForO, listStatesFor } from '@/data/catalog/gameDataService'
import { isStateVisible } from '@/engine/services/sourceStateService'
import { getStateText } from '@/modules/simulation/model/sourceStateDisplay'
import { fmtSkllKey, skllLblMap } from '@/modules/simulation/features/resonator/lib/panel'
import { evalCond, evalForm } from '@/engine/effects/evaluator'
import { effectReferencesState, mkEffectScope } from './effectMath'

export type EffectStat = 'dmgVuln' | 'finalDmg'
/** one evaluated operation, including its condition and optional damage scope. */
export interface EffectReading {
  label?: string
  stat: EffectStat | 'resistance' | 'immunity'
  scope: string | null
  value: number
  active: boolean
}
/** one console control or unbound effect with all of its displayed operations. */
export interface EffectRow {
  id: string
  label: string
  description: string | null
  params: Array<string | number>
  stat: EffectStat | null
  scope: string | null
  value: number
  readings: EffectReading[]
  active: boolean
  state: SourceState | null
  side: 'target' | 'team'
}
/** unscoped damage totals and separately listed scoped effect readings. */
export interface EffectSummary {
  rows: EffectRow[]
  dmgVuln: number
  finalDmg: number
  scoped: Array<{ label: string; scope: string; value: number }>
}

const elementNames: Record<string, string> = {
  physical: 'Physical', glacio: 'Glacio', fusion: 'Fusion', electro: 'Electro',
  aero: 'Aero', spectro: 'Spectro', havoc: 'Havoc', all: 'All-Attribute',
}
function skillTypeLabel(types: string | readonly string[]): string {
  return (typeof types === 'string' ? [types] : types)
    .map((key) => skllLblMap[key as keyof typeof skllLblMap] ?? fmtSkllKey(key)).join(' / ')
}

function readEffect(effect: EffectDef, scope: EffectScope): EffectReading[] {
  const active = evalCond(effect.condition, scope)
  const readings: EffectReading[] = []
  for (const operation of effect.operations) {
    if (operation.type === 'add_top_stat' && (operation.stat === 'dmgVuln' || operation.stat === 'finalDmg')) {
      readings.push({ stat: operation.stat, scope: null, value: active ? evalForm(operation.value, scope) : 0, active })
    } else if (operation.type === 'add_skilltype_mod' && operation.mod === 'dmgVuln') {
      readings.push({ stat: 'dmgVuln', scope: skillTypeLabel(operation.skillType), value: active ? evalForm(operation.value, scope) : 0, active })
    } else if (operation.type === 'add_attribute_mod' && operation.mod === 'resShred') {
      for (const attribute of typeof operation.attribute === 'string' ? [operation.attribute] : operation.attribute) {
        readings.push({ stat: 'resistance', scope: `${elementNames[attribute]} RES`, value: active ? -evalForm(operation.value, scope) : 0, active })
      }
    } else if (operation.type === 'add_immunity') {
      const target = operation.scope
      const label = target.target === 'all' ? 'All damage'
        : target.target === 'element' ? target.keys.map((key) => elementNames[key]).join(' / ')
          : skillTypeLabel(target.keys)
      readings.push({ stat: 'immunity', scope: label, value: 0, active })
    }
  }
  // collapse equal per-element resistance changes into one all-attribute reading.
  const resistance = readings.filter((reading) => reading.stat === 'resistance')
  if (resistance.length === 7 && new Set(resistance.map((reading) => reading.scope)).size === 7
    && resistance.every((reading) => reading.value === resistance[0].value)) {
    return [...readings.filter((reading) => reading.stat !== 'resistance'), { ...resistance[0], scope: 'All-Attribute RES' }]
  }
  return readings
}

/** derives the row's simple value from its operations without dropping scoped readings. */
function setReadings(row: EffectRow): void {
  const first = row.readings[0]
  row.stat = first?.stat === 'dmgVuln' || first?.stat === 'finalDmg' ? first.stat : null
  row.scope = row.readings.length === 1 ? first.scope : null
  row.value = row.readings.filter((reading) => reading.stat === row.stat && reading.scope === row.scope)
    .reduce((sum, reading) => sum + reading.value, 0)
  if (row.readings.length) row.active = row.readings.some((reading) => reading.active
    && (reading.stat === 'immunity' || reading.value !== 0))
}

/** retain every control, including controls with no damage-stat operation. */
function sourceRows(
  runtime: ResRuntime, enemy: EnemyProfile, simulation: Pick<SimResult, 'finalStats'> | null,
  states: SourceState[], effects: EffectDef[], side: EffectRow['side'],
  readState: (state: SourceState) => unknown,
): EffectRow[] {
  const rows = states.map((state): EffectRow => {
    const text = getStateText(state)
    const current = readState(state) ?? state.defaultValue
    return {
      id: state.controlKey, label: text.label ?? state.label,
      description: text.description ?? state.description ?? null, params: [],
      stat: null, scope: null, value: 0, readings: [],
      active: state.kind === 'toggle' ? current === true : state.kind === 'select'
        ? Boolean(current) : Number(current) > (state.min ?? 0),
      state, side,
    }
  })
  for (const effect of effects) {
    const scope = mkEffectScope(runtime, { source: effect.source }, enemy, simulation)
    const readings = readEffect(effect, scope).map((reading) => ({ ...reading, label: effect.label }))
    if (!readings.length) continue
    // attach an effect only to the control whose state path its condition or formula reads.
    const owner = rows.find((row) => row.state && row.state.ownerKey === effect.ownerKey
      && effectReferencesState(effect, row.state))
    if (owner) owner.readings.push(...readings)
    else rows.push({
      id: effect.id, label: effect.label, description: effect.description ?? null,
      params: [], stat: null, scope: null, value: 0, readings,
      active: evalCond(effect.condition, scope), state: null, side,
    })
  }
  rows.forEach(setReadings)
  return rows
}

/** merge authored readings with resolved unscoped totals from the active simulation. */
export function readEffects(
  runtime: ResRuntime, enemy: EnemyProfile, simulation: Pick<SimResult, 'finalStats'> | null,
  readEnemyState: (field: string) => unknown, readRtState: (state: SourceState) => unknown,
): EffectSummary {
  const enemyStates = listStatesFor('enemy', enemy.id).filter((state) => isStateVisible(runtime, runtime, state, runtime))
  const rows = sourceRows(runtime, enemy, simulation, enemyStates, listEffectsFor('enemy', enemy.id), 'target',
    (state) => readEnemyState(state.id))
  const allStates = new Map(listStatesFor('resonator', runtime.id).map((state) => [state.controlKey, state]))
  const states = [...new Set((getResDtlsBy()[runtime.id]?.combatStates ?? [])
    .flatMap((entry) => entry.stateKeys ?? entry.controls.map((control) => control.key)))]
    .flatMap((key) => {
      const state = allStates.get(key)
      return state && isStateVisible(runtime, runtime, state, runtime) ? [state] : []
    })
  const effects = [...new Map(states.flatMap((state) => listFfctForO(state.ownerKey)).map((effect) => [effect.id, effect])).values()]
  rows.push(...sourceRows(runtime, enemy, simulation, states, effects, 'team', readRtState))
  // sequence, weapon, and manual modifiers may lack console controls; show the
  // difference between authored rows and the resolved simulation as one other row.
  for (const stat of ['dmgVuln', 'finalDmg'] as const) {
    const resolved = simulation?.finalStats[stat]
    if (resolved === undefined) continue
    const displayed = rows.flatMap((row) => row.readings)
      .filter((reading) => reading.stat === stat && !reading.scope)
      .reduce((sum, reading) => sum + reading.value, 0)
    const remaining = resolved - displayed
    if (Math.abs(remaining) < 1e-9) continue
    rows.push({
      id: `other:${stat}`, label: stat === 'finalDmg' ? 'Other Final DMG' : 'Other DMG Vulnerability',
      description: 'Other active modifiers from the current build and team.', params: [],
      stat, scope: null, value: remaining,
      readings: [{ stat, scope: null, value: remaining, active: true }],
      active: true, state: null, side: 'team',
    })
  }
  const readings = rows.flatMap((row) => row.readings.map((reading) => ({ ...reading, label: row.label })))
  return {
    rows,
    dmgVuln: readings.filter((reading) => reading.stat === 'dmgVuln' && !reading.scope).reduce((sum, reading) => sum + reading.value, 0),
    finalDmg: readings.filter((reading) => reading.stat === 'finalDmg' && !reading.scope).reduce((sum, reading) => sum + reading.value, 0),
    scoped: readings.filter((reading) => reading.stat === 'dmgVuln' && reading.scope)
      .map((reading) => ({ label: reading.label, scope: reading.scope!, value: reading.value })),
  }
}
