/*
  Author: Runor Ewhro
  Description: Reads everything that makes the target take more damage, from
               whichever side authored it, into one list the console can print.

               Three sources say the same thing in three shapes: an enemy
               passive that is simply true, an enemy state the fight switches
               on, and a combat state the resonator brings. What matters to the
               reader is not which of those a line came from, it is how much
               damage it is worth right now and whether it is on, so they are
               gathered into one row type and asked those two questions.

               Two buckets, because the pipeline keeps two: dmgVuln and
               finalDmg multiply damage separately (see damage.ts), and a
               vulnerability written against a skill type only pays out on that
               type, so it is kept aside rather than summed into the whole.
*/

import type { EnemyProfile } from '@/domain/entities/appState'
import type { EffectScope, EffectDef, SourceState } from '@/domain/gameData/contracts'
import type { ResRuntime } from '@/domain/entities/runtime'
import type { SimResult } from '@/engine/pipeline/types'
import { getResDtlsBy } from '@/data/gameData/resonators/resonatorDataStore'
import { listEffectsFor, listFfctForO, listStatesFor } from '@/data/catalog/gameDataService'
import { isStateVisible, mkSrcSttScp } from '@/engine/services/sourceStateService'
import { getStateText } from '@/modules/simulation/model/sourceStateDisplay'
import { fmtSkllKey, skllLblMap } from '@/modules/simulation/features/resonator/lib/panel.ts'
import { evalCond, evalForm } from '@/engine/effects/evaluator'

/** which multiplier a line lands in, since the pipeline keeps them apart */
export type VulnStat = 'dmgVuln' | 'finalDmg'

export interface VulnRow {
  id: string
  label: string
  /** the game's own words for it, glossed on the name */
  description: string | null
  params: Array<string | number>
  stat: VulnStat
  /** the skill type this only pays out on, when it is written against one */
  scope: string | null
  /** what it is worth right now, in percent */
  value: number
  active: boolean
  state: SourceState | null
  /** which side authored it: the target, or the team standing in front of it */
  side: 'target' | 'team'
}

export interface VulnRead {
  rows: VulnRow[]
  /** everything unscoped, in percent, per bucket */
  dmgVuln: number
  finalDmg: number
  /** what a scoped line adds, on the type it names */
  scoped: Array<{ label: string; scope: string; value: number }>
}

/* the scope an effect is read in. it asks only where the effect came from, so
   a passive with no control of its own can be read the same way a state is. */
function scopeOf(
  runtime: ResRuntime,
  from: Pick<SourceState, 'source' | 'displayScope'>,
  enemy: EnemyProfile,
  simulation: SimResult | null,
): EffectScope {
  const base = mkSrcSttScp(runtime, runtime, from, runtime)
  const finalStats = simulation?.finalStats

  return {
    ...base,
    sourceFinalStats: finalStats,
    finalStats,
    context: { ...base.context, sourceFinalStats: finalStats, finalStats, enemy },
  }
}

function skillTypeLabel(types: unknown): string | null {
  const list = Array.isArray(types) ? types : typeof types === 'string' ? [types] : []
  const named = list
    .map((key) => skllLblMap[key as keyof typeof skllLblMap] ?? fmtSkllKey(String(key)))
    .filter(Boolean)

  return named.length > 0 ? named.join(' / ') : null
}

/*
  one effect, read for what it is worth. an operation that names no stat we
  care about contributes nothing and is not an error: most effects on an owner
  are about something else entirely.
*/
function readEffect(effect: EffectDef, scope: EffectScope, active: boolean): {
  stat: VulnStat
  scope: string | null
  value: number
} | null {
  for (const operation of effect.operations ?? []) {
    if (operation.type === 'add_top_stat'
      && (operation.stat === 'dmgVuln' || operation.stat === 'finalDmg')) {
      return {
        stat: operation.stat,
        scope: null,
        value: active ? evalForm(operation.value, scope) : 0,
      }
    }

    if (operation.type === 'add_skilltype_mod' && operation.mod === 'dmgVuln') {
      return {
        stat: 'dmgVuln',
        scope: skillTypeLabel(operation.skillType),
        value: active ? evalForm(operation.value, scope) : 0,
      }
    }
  }

  return null
}

function targetPassives(
  runtime: ResRuntime,
  enemy: EnemyProfile,
  simulation: SimResult | null,
): VulnRow[] {
  const scope = scopeOf(
    runtime,
    { source: { type: 'enemy', id: enemy.id } },
    enemy,
    simulation,
  )

  return listEffectsFor('enemy', enemy.id).flatMap((effect) => {
    if (effect.condition) {
      return []
    }

    const read = readEffect(effect, scope, true)
    if (!read) {
      return []
    }

    return [{
      id: effect.id,
      label: effect.label,
      description: effect.description ?? null,
      params: [],
      stat: read.stat,
      scope: read.scope,
      value: read.value,
      active: true,
      state: null,
      side: 'target' as const,
    }]
  })
}

/* a state's own effects, summed: one control can drive more than one line */
function stateRow(
  runtime: ResRuntime,
  state: SourceState,
  enemy: EnemyProfile,
  simulation: SimResult | null,
  side: VulnRow['side'],
  value: unknown,
): VulnRow | null {
  const scope = scopeOf(runtime, state, enemy, simulation)
  const effects = listFfctForO(state.ownerKey)
  let total = 0
  let stat: VulnStat = 'dmgVuln'
  let scoped: string | null = null
  let found = false

  for (const effect of effects) {
    // the owner's unconditional effects are the target's own, printed as those
    if (!effect.condition) continue
    const on = evalCond(effect.condition, scope)
    const read = readEffect(effect, scope, on)
    if (!read) continue
    found = true
    stat = read.stat
    scoped = read.scope ?? scoped
    total += read.value
  }

  if (!found) {
    return null
  }

  const text = getStateText(state)
  // Select controls are active when their selected branch produces an effect;
  // their stored option has no numeric activation threshold.
  const active = state.kind === 'toggle'
    ? value === true
    : state.kind === 'select'
      ? total !== 0
      : Number(value) > Number(state.min ?? 0)

  return {
    id: state.controlKey,
    label: text.label ?? state.label,
    description: text.description ?? state.description ?? null,
    params: [],
    stat,
    scope: scoped,
    value: total,
    active,
    state,
    side,
  }
}

/**
 * Every line that makes this target take more damage, and the two totals they
 * add up to. `readEnemyState` reads the enemy's own status bag; the resonator's
 * combat states are read from its runtime.
 */
export function readVulns(
  runtime: ResRuntime,
  enemy: EnemyProfile,
  simulation: SimResult | null,
  readEnemyState: (field: string) => unknown,
  readRtState: (state: SourceState) => unknown,
): VulnRead {
  const enemyStates = listStatesFor('enemy', enemy.id)
  const rows: VulnRow[] = []

  rows.push(...targetPassives(runtime, enemy, simulation))

  for (const state of enemyStates) {
    const row = stateRow(runtime, state, enemy, simulation, 'target', readEnemyState(state.id))
    if (row) rows.push(row)
  }

  /*
    the resonator's combat states are authored on the resonator but they are
    about the target, which is why the pane draws them here and so does this.
  */
  const details = getResDtlsBy()[runtime.id]
  const resStates = new Map(
    listStatesFor('resonator', runtime.id).map((state) => [state.controlKey, state]),
  )

  for (const entry of details?.combatStates ?? []) {
    const keys = entry.stateKeys ?? entry.controls.map((control) => control.key)
    for (const key of keys) {
      const state = resStates.get(key)
      if (!state || !isStateVisible(runtime, runtime, state, runtime)) continue
      const row = stateRow(runtime, state, enemy, simulation, 'team', readRtState(state))
      if (row) rows.push({ ...row, label: entry.title || row.label })
    }
  }

  const live = rows.filter((row) => row.active && !row.scope)

  return {
    rows,
    dmgVuln: live.filter((row) => row.stat === 'dmgVuln').reduce((n, row) => n + row.value, 0),
    finalDmg: live.filter((row) => row.stat === 'finalDmg').reduce((n, row) => n + row.value, 0),
    scoped: rows
      .filter((row) => row.active && row.scope)
      .map((row) => ({ label: row.label, scope: row.scope as string, value: row.value })),
  }
}
