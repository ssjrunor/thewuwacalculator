/*
  Author: Runor Ewhro
  Description: builds cached combat contexts and pre/post-stats final stats for
               optimizer and simulation systems by combining runtime buffs,
               echo stats, weapon stats, manual buffs, and runtime data effects.
*/

import type {
  CombatContext,
  GraphCombatContextInput,
} from '@/engine/pipeline/types'
import {
  makeUnifiedBuffPool,
  mergeBaseStatBuff,
  mergeModBuff,
} from '@/engine/resolvers/buffPool'
import { computeFinalStatsFromPool } from '@/engine/formulas/finalStats'
import { applyRuntimeDataEffects } from '@/engine/effects/dataEffects'
import { applyManualBuffsToPool } from '@/engine/manualBuffs'
import type { FinalStats, UnifiedBuffPool } from '@/domain/entities/stats'
import { isUnsetWeaponId, type EchoInstance, type ResonatorRuntimeState } from '@/domain/entities/runtime'
import { getWeaponById } from '@/domain/services/weaponCatalogService'
import type { AttributeKey } from '@/domain/entities/stats'
import type { EnemyProfile } from '@/domain/entities/appState'
import type { CombatGraph } from '@/domain/entities/combatGraph'
import type { SlotId } from '@/domain/entities/session'

// echo stat keys that should be routed into elemental damage bonus buckets
const ATTRIBUTE_ECHO_STAT_KEYS = new Set<string>([
  'aero', 'glacio', 'electro', 'fusion', 'havoc', 'spectro', 'physical',
])

// echo stat keys that should be routed into skill-type damage bonus buckets
const SKILL_TYPE_ECHO_STAT_KEYS = new Set<string>([
  'basicAtk', 'heavyAtk', 'resonanceSkill', 'resonanceLiberation',
])

// cache of "source pre-stats final stats" keyed first by graph, then by enemy
// used so repeated combat-context builds for the same graph/enemy pair do not
// recompute every participant's pre-stats final snapshot
const sourceFinalStatsCache = new WeakMap<CombatGraph, WeakMap<EnemyProfile, Record<string, FinalStats>>>()

// cache of full combat contexts keyed by graph -> enemy -> target slot
// this avoids rebuilding the same slot context multiple times in one graph state
const combatContextCache = new WeakMap<CombatGraph, WeakMap<EnemyProfile, Partial<Record<SlotId, CombatContext>>>>()

// read a value from a graph/enemy nested weakmap cache
function getGraphEnemyCacheValue<T>(
    cache: WeakMap<CombatGraph, WeakMap<EnemyProfile, T>>,
    graph: CombatGraph,
    enemy: EnemyProfile,
): T | null {
  return cache.get(graph)?.get(enemy) ?? null
}

// write a value into a graph/enemy nested weakmap cache, creating the inner map if needed
function setGraphEnemyCacheValue<T>(
    cache: WeakMap<CombatGraph, WeakMap<EnemyProfile, T>>,
    graph: CombatGraph,
    enemy: EnemyProfile,
    value: T,
): void {
  let enemyCache = cache.get(graph)
  if (!enemyCache) {
    enemyCache = new WeakMap<EnemyProfile, T>()
    cache.set(graph, enemyCache)
  }

  enemyCache.set(enemy, value)
}

// apply one echo stat entry into the unified buff pool
// each supported key is routed into its correct stat/buff bucket
function applyEchoStat(pool: UnifiedBuffPool, key: string, value: number): void {
  if (key === 'atkPercent') pool.atk.percent += value
  else if (key === 'atkFlat') pool.atk.flat += value
  else if (key === 'hpPercent') pool.hp.percent += value
  else if (key === 'hpFlat') pool.hp.flat += value
  else if (key === 'defPercent') pool.def.percent += value
  else if (key === 'defFlat') pool.def.flat += value
  else if (key === 'critRate') pool.critRate += value
  else if (key === 'critDmg') pool.critDmg += value
  else if (key === 'energyRegen') pool.energyRegen += value
  else if (key === 'healingBonus') pool.healingBonus += value
  else if (ATTRIBUTE_ECHO_STAT_KEYS.has(key)) pool.attribute[key as AttributeKey].dmgBonus += value
  else if (SKILL_TYPE_ECHO_STAT_KEYS.has(key)) pool.skillType[key as keyof UnifiedBuffPool['skillType']].dmgBonus += value
}

// apply all equipped echo stats into the unified buff pool
// this includes primary, secondary, and every substat on each non-null echo
export function applyEchoStatsToPool(pool: UnifiedBuffPool, echoes: Array<EchoInstance | null>): void {
  for (const echo of echoes) {
    if (!echo) continue

    applyEchoStat(pool, echo.mainStats.primary.key, echo.mainStats.primary.value)
    applyEchoStat(pool, echo.mainStats.secondary.key, echo.mainStats.secondary.value)

    for (const [key, value] of Object.entries(echo.substats)) {
      applyEchoStat(pool, key, value)
    }
  }
}

// count equipped set pieces while ignoring duplicate echo ids
// this matches the "unique echo id per set contribution" behavior used elsewhere
export function computeEchoSetCounts(echoes: Array<EchoInstance | null>): Record<string, number> {
  const counts: Record<string, number> = {}
  const seenIds = new Set<string>()

  for (const echo of echoes) {
    if (!echo) continue
    if (seenIds.has(echo.id)) continue

    seenIds.add(echo.id)
    const key = String(echo.set)
    counts[key] = (counts[key] ?? 0) + 1
  }

  return counts
}

// build the runtime buff pool before echo stats are applied
// this includes trace nodes, combat-state derived effects, weapon secondary stats,
// and manual buffs, but intentionally excludes equipped echo stat lines
export function buildRuntimeStaticBuffPool(runtime: ResonatorRuntimeState): UnifiedBuffPool {
  const pool = makeUnifiedBuffPool()
  const traceNodes = runtime.base.traceNodes
  const manualBuffs = runtime.state.manualBuffs
  const combatState = runtime.state.combat

  // merge trace-node atk/hp/def buffs into the pool
  mergeBaseStatBuff(pool.atk, {
    percent: traceNodes.atk.percent,
    flat: traceNodes.atk.flat,
  })

  mergeBaseStatBuff(pool.hp, {
    percent: traceNodes.hp.percent,
    flat: traceNodes.hp.flat,
  })

  mergeBaseStatBuff(pool.def, {
    percent: traceNodes.def.percent,
    flat: traceNodes.def.flat,
  })

  // merge all trace-node elemental modifiers
  const elementKeys = Object.keys(traceNodes.attribute) as Array<keyof typeof traceNodes.attribute>
  for (const key of elementKeys) {
    mergeModBuff(pool.attribute[key], traceNodes.attribute[key])
  }

  // apply remaining trace-node scalar bonuses
  pool.critRate += traceNodes.critRate
  pool.critDmg += traceNodes.critDmg
  pool.healingBonus += traceNodes.healingBonus

  // apply combat-state derived permanent-style effects stored on runtime state
  pool.attribute.all.defIgnore += combatState.havocBane * 2

  // apply weapon secondary stat if a real weapon is equipped
  const weaponId = runtime.build.weapon.id
  if (!isUnsetWeaponId(weaponId)) {
    const weaponDef = getWeaponById(weaponId)

    if (weaponDef) {
      const weaponLevel = runtime.build.weapon.level
      const secondaryStatValue = weaponDef.statsByLevel[weaponLevel]?.secondaryStatValue ?? weaponDef.statValue
      const statKey = weaponDef.statKey

      if (statKey === 'atkPercent') pool.atk.percent += secondaryStatValue
      else if (statKey === 'hpPercent') pool.hp.percent += secondaryStatValue
      else if (statKey === 'defPercent') pool.def.percent += secondaryStatValue
      else if (statKey === 'critRate') pool.critRate += secondaryStatValue
      else if (statKey === 'critDmg') pool.critDmg += secondaryStatValue
      else if (statKey === 'energyRegen') pool.energyRegen += secondaryStatValue
    }
  }

  // apply user-entered manual buffs last so they are included in the static pool baseline
  applyManualBuffsToPool(pool, manualBuffs)

  return pool
}

// build the runtime buff pool including equipped echo stats
// this is the main "base pool" used before pre-stats and post-stats runtime effects are applied
export function buildRuntimeBaseBuffPool(runtime: ResonatorRuntimeState): UnifiedBuffPool {
  const pool = buildRuntimeStaticBuffPool(runtime)
  applyEchoStatsToPool(pool, runtime.build.echoes)
  return pool
}

// compute each participant's final stats after only pre-stats effects have been applied
// these source snapshots are later used by cross-character effects that depend on source stats
export function buildSourcePreStatsFinalStatsById(input: GraphCombatContextInput): Record<string, FinalStats> {
  const cached = getGraphEnemyCacheValue(sourceFinalStatsCache, input.graph, input.enemy)
  if (cached) {
    return cached
  }

  const finalStatsById: Record<string, FinalStats> = {}

  for (const participant of Object.values(input.graph.participants)) {
    const sourcePool = buildRuntimeBaseBuffPool(participant.runtime)

    // apply only pre-stats data effects for the source participant
    const preStatsPool = applyRuntimeDataEffects(
        participant.runtime,
        sourcePool,
        {
          graph: input.graph,
          targetSlotId: participant.slotId,
          baseStats: participant.baseStats,
          enemy: input.enemy,
        },
        'preStats',
    )

    // convert the pre-stats pool into final stats so other effects can reference them
    finalStatsById[participant.resonatorId] = computeFinalStatsFromPool(
        participant.baseStats,
        preStatsPool,
        participant.runtime.build.weapon.baseAtk,
    )
  }

  setGraphEnemyCacheValue(sourceFinalStatsCache, input.graph, input.enemy, finalStatsById)
  return finalStatsById
}

// build the full combat context for one target slot
// this performs a two-stage effect pass:
// 1. pre-stats effects to produce a pre-stats final snapshot
// 2. post-stats effects that may depend on those final stats
export function buildCombatContext(input: GraphCombatContextInput): CombatContext {
  const cachedBySlot = getGraphEnemyCacheValue(combatContextCache, input.graph, input.enemy)
  const cachedContext = cachedBySlot?.[input.targetSlotId]
  if (cachedContext) {
    return cachedContext
  }

  const targetParticipant = input.graph.participants[input.targetSlotId]
  if (!targetParticipant) {
    throw new Error(`Missing combat graph participant for slot ${input.targetSlotId}`)
  }

  const runtime = targetParticipant.runtime
  const baseStats = targetParticipant.baseStats

  // start from the runtime's full base buff pool
  const pool = buildRuntimeBaseBuffPool(runtime)

  // gather cached/derived pre-stats final snapshots for all source participants
  const sourceFinalStatsById = buildSourcePreStatsFinalStatsById(input)

  // first pass: effects that alter the pool before final stat calculation
  const preStatsPool = applyRuntimeDataEffects(
      runtime,
      pool,
      {
        graph: input.graph,
        targetSlotId: input.targetSlotId,
        baseStats,
        sourceFinalStatsById,
        enemy: input.enemy,
      },
      'preStats',
  )

  // calculate final stats after the pre-stats pass so post-stats effects can reference them
  const preStatsFinalStats = computeFinalStatsFromPool(
      baseStats,
      preStatsPool,
      runtime.build.weapon.baseAtk,
  )

  // second pass: effects that need the already-computed final stats
  const effectAdjustedPool = applyRuntimeDataEffects(
      runtime,
      preStatsPool,
      {
        graph: input.graph,
        targetSlotId: input.targetSlotId,
        baseStats,
        finalStats: preStatsFinalStats,
        sourceFinalStatsById,
        enemy: input.enemy,
      },
      'postStats',
  )

  // recompute final stats from the post-stats-adjusted pool
  const finalStats = computeFinalStatsFromPool(
      baseStats,
      effectAdjustedPool,
      runtime.build.weapon.baseAtk,
  )

  const context = {
    runtime,
    baseStats,
    enemy: input.enemy,
    buffs: effectAdjustedPool,
    finalStats,
    graph: input.graph,
    targetSlotId: input.targetSlotId,
  }

  // store this slot context in the cache for future reuse
  const nextCachedBySlot = cachedBySlot ?? {}
  nextCachedBySlot[input.targetSlotId] = context
  setGraphEnemyCacheValue(combatContextCache, input.graph, input.enemy, nextCachedBySlot)

  return context
}