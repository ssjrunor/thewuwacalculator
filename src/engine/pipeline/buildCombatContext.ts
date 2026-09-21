/*
  Author: Runor Ewhro
  Description: builds cached combat contexts and pre/post-stats final stats for
               optimizer and simulation systems by combining runtime buffs,
               echo stats, weapon stats, manual buffs, and runtime data effects.
*/

import type {
  CombatContext,
  GrphCmbtCtxN,
} from '@/engine/pipeline/types'
import {
  mkNfdBuffPoo,
  mrgBaseStatB,
  mergeModBuff,
} from '@/engine/resolvers/buffPool'
import { applyMnlBffs } from '@/engine/manualBuffs'
import type { UnifiedBuffPool } from '@/domain/entities/stats'
import { isNoWeaponId, type EchoInstance, type ResRuntime } from '@/domain/entities/runtime'
import { getWpnById } from '@/data/catalog/weaponCatalogService'
import type { AttributeKey } from '@/domain/entities/stats'
import type { EnemyProfile } from '@/domain/entities/appState'
import type { CombatGraph, SlotId } from '@/domain/entities/combatGraph'
import {
  createNumericTeam,
  materializeNumericContext,
  type NumericTeamState,
} from '@/engine/effects/numericTeam.ts'
import { applyEnvironmentTargetModifiers } from '@/engine/runtime/scenarioEnvironment'

// echo stat keys that should be routed into elemental damage bonus buckets
const TTRBECHOSTAT = new Set<string>([
  'aero', 'glacio', 'electro', 'fusion', 'havoc', 'spectro', 'physical',
])

// echo stat keys that should be routed into skill-type damage bonus buckets
const SKLLTYPEECHO = new Set<string>([
  'basicAtk', 'heavyAtk', 'resonanceSkill', 'resonanceLiberation',
])

// cache of full combat contexts keyed by graph -> enemy -> target slot
// this avoids rebuilding the same slot context multiple times in one graph state
const cmbtCtxCch = new WeakMap<CombatGraph, WeakMap<EnemyProfile, Partial<Record<SlotId, CombatContext>>>>()

// One compiled Simulation program owns all three participant lanes. Contexts
// are merely cold projections of these arrays for existing UI consumers.
const numericTeamCache = new WeakMap<CombatGraph, WeakMap<EnemyProfile, NumericTeamState>>()

// read a value from a graph/enemy nested weakmap cache
function getGrphEnemy<T>(
    cache: WeakMap<CombatGraph, WeakMap<EnemyProfile, T>>,
    graph: CombatGraph,
    enemy: EnemyProfile,
): T | null {
  return cache.get(graph)?.get(enemy) ?? null
}

// write a value into a graph/enemy nested weakmap cache, creating the inner map if needed
function setGrphEnemy<T>(
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
function applyEchoSta(pool: UnifiedBuffPool, key: string, value: number): void {
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
  else if (key === 'tuneBreakBoost') pool.tuneBreakBoost += value
  else if (TTRBECHOSTAT.has(key)) pool.attribute[key as AttributeKey].dmgBonus += value
  else if (SKLLTYPEECHO.has(key)) pool.skillType[key as keyof UnifiedBuffPool['skillType']].dmgBonus += value
}

// apply all equipped echo stats into the unified buff pool
// this includes primary, secondary, and every substat on each non-null echo
export function applyEchoStt(pool: UnifiedBuffPool, echoes: Array<EchoInstance | null>): void {
  for (const echo of echoes) {
    if (!echo) continue

    applyEchoSta(pool, echo.mainStats.primary.key, echo.mainStats.primary.value)
    applyEchoSta(pool, echo.mainStats.secondary.key, echo.mainStats.secondary.value)

    for (const [key, value] of Object.entries(echo.substats)) {
      applyEchoSta(pool, key, value)
    }
  }
}

// counts equipped pieces per sonata. within one sonata a repeated echo id counts
// once; the same echo id assigned to two sonatas counts toward each. e.g.
// hyvatia+glamoth on set A plus hyvatia+glamoth on set B yields 2pc + 2pc.
export function countEchoSets(echoes: Array<EchoInstance | null>): Record<string, number> {
  const counts: Record<string, number> = {}
  const seenIdsBySet: Record<string, Set<string>> = {}

  for (const echo of echoes) {
    if (!echo) continue

    const key = String(echo.set)
    const seenIds = seenIdsBySet[key] ?? (seenIdsBySet[key] = new Set<string>())
    if (seenIds.has(echo.id)) continue

    seenIds.add(echo.id)
    counts[key] = (counts[key] ?? 0) + 1
  }

  return counts
}

// build the runtime buff pool before echo stats are applied
// this includes trace nodes, combat-state derived effects, weapon secondary stats,
// and manual buffs, but intentionally excludes equipped echo stat lines
export function mkRtSttcBuff(runtime: ResRuntime): UnifiedBuffPool {
  const pool = mkNfdBuffPoo()
  const traceNodes = runtime.base.traceNodes
  const manualBuffs = runtime.state.manualBuffs
  const combatState = runtime.state.combat

  // merge trace-node atk/hp/def buffs into the pool
  mrgBaseStatB(pool.atk, {
    percent: traceNodes.atk.percent,
    flat: traceNodes.atk.flat,
  })

  mrgBaseStatB(pool.hp, {
    percent: traceNodes.hp.percent,
    flat: traceNodes.hp.flat,
  })

  mrgBaseStatB(pool.def, {
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
  pool.defShred += combatState.havocBane * 2

  // apply weapon secondary stat if a real weapon is equipped
  const weaponId = runtime.build.weapon.id
  if (!isNoWeaponId(weaponId)) {
    const weaponDef = getWpnById(weaponId)

    if (weaponDef) {
      const weaponLevel = runtime.build.weapon.level
      const scndStatVl = weaponDef.statsByLevel[weaponLevel]?.secondaryStatValue ?? weaponDef.statValue
      const statKey = weaponDef.statKey

      if (statKey === 'atkPercent') pool.atk.percent += scndStatVl
      else if (statKey === 'hpPercent') pool.hp.percent += scndStatVl
      else if (statKey === 'defPercent') pool.def.percent += scndStatVl
      else if (statKey === 'critRate') pool.critRate += scndStatVl
      else if (statKey === 'critDmg') pool.critDmg += scndStatVl
      else if (statKey === 'energyRegen') pool.energyRegen += scndStatVl
      else if (statKey === 'tuneBreakBoost') pool.tuneBreakBoost += scndStatVl
    }
  }

  // apply user-entered manual buffs last so they are included in the static pool baseline
  applyMnlBffs(pool, manualBuffs)

  return pool
}

// build the runtime buff pool including equipped echo stats
// this is the main "base pool" used before pre-stats and post-stats runtime effects are applied
export function mkRtBaseBuff(runtime: ResRuntime): UnifiedBuffPool {
  const pool = mkRtSttcBuff(runtime)
  applyEchoStt(pool, runtime.build.echoes)
  return pool
}

// build the full combat context for one target slot
// this performs a two-stage effect pass:
// 1. pre-stats effects to produce a pre-stats final snapshot
// 2. post-stats effects that may depend on those final stats
export function getNumericCombatTeam(input: GrphCmbtCtxN): NumericTeamState {
  let team = getGrphEnemy(numericTeamCache, input.graph, input.enemy)
  if (!team) {
    const basePools: Partial<Record<SlotId, UnifiedBuffPool>> = {}
    for (const participant of Object.values(input.graph.participants)) {
      const pool = mkRtBaseBuff(participant.runtime)
      const environmentBuffs = input.graph.environmentBuffsByMemberId?.[participant.memberId]
      if (environmentBuffs) applyMnlBffs(pool, environmentBuffs)
      if (input.graph.environmentTargetModifiers) {
        applyEnvironmentTargetModifiers(pool, input.graph.environmentTargetModifiers)
      }
      basePools[participant.slotId] = pool
    }
    team = createNumericTeam({ graph: input.graph, enemy: input.enemy, basePools })
    setGrphEnemy(numericTeamCache, input.graph, input.enemy, team)
  }
  return team
}

export function makeCombatEnv(input: GrphCmbtCtxN): CombatContext {
  const cachedBySlot = getGrphEnemy(cmbtCtxCch, input.graph, input.enemy)
  const cchdCtx = cachedBySlot?.[input.targetSlotId]
  if (cchdCtx) {
    return cchdCtx
  }

  const team = getNumericCombatTeam(input)

  const context = materializeNumericContext(team, input.graph, input.targetSlotId, input.enemy)

  // store this slot context in the cache for future reuse
  const nextCchdBySl = cachedBySlot ?? {}
  nextCchdBySl[input.targetSlotId] = context
  setGrphEnemy(cmbtCtxCch, input.graph, input.enemy, nextCchdBySl)

  return context
}
