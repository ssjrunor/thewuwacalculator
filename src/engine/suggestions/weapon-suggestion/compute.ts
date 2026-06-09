/*
  Author: Runor Ewhro
  Description: Scores compatible weapon candidates for suggestions by applying
               weapon stat and passive overlays onto a neutral suggestion
               context before reusing the packed evaluator.
*/

import type { DataSrcRef, EffectContext, SourceState } from '@/domain/gameData/contracts'
import type { ResRuntime, WeaponState } from '@/domain/entities/runtime'
import type { UnifiedBuffPool, SkillDef } from '@/domain/entities/stats'
import type { GenWpn } from '@/domain/entities/weapon'
import type { WeaponPlanSet, WpnStCfg } from '@/domain/entities/suggestions'
import { listWpnsByTy } from '@/domain/services/weaponCatalogService'
import {
  resolveWeaponRank,
  weaponRarityVisible,
  weaponStatsAt,
} from '@/domain/services/weaponPlan'
import { listStatesFor } from '@/domain/services/gameDataService'
import { makeTeamComp } from '@/domain/gameData/teamComposition'
import { countEchoSets } from '@/engine/pipeline/buildCombatContext'
import { calcFinalStats } from '@/engine/formulas/finalStats'
import { applyCandRt, applyCandSk } from '@/engine/effects/dataEffects'
import { makeOptContext } from '@/engine/optimizer/context/compiled'
import { packTargetCtx } from '@/engine/optimizer/context/pack'
import { CTX_FLOATS } from '@/engine/optimizer/config/constants'
import { selOptTgtSkl } from '@/engine/optimizer/target/selectedSkill'
import { evalSuggChs } from '@/engine/suggestions/shared'
import type {
  DrctSuggCtx,
  PrepWeaponPlan,
  RotSuggCtx,
  SuggestContext,
  WeaponEntry,
} from '@/engine/suggestions/types'

type WpnMode = 'default' | 'max'

interface WpnStat {
  atk: number
  statVal: number
}

// choose which passive variants are part of the active search space.
function resModes(input: PrepWeaponPlan): WpnMode[] {
  if (input.settings.mode === 'default') return ['default']
  if (input.settings.mode === 'max') return ['max']
  return input.settings.target === 'default' ? ['default', 'max'] : ['max', 'default']
}

// select the variant that should rank a weapon card when both variants are shown.
function resTgtMode(input: PrepWeaponPlan): WpnMode {
  if (input.settings.mode === 'default') return 'default'
  if (input.settings.mode === 'max') return 'max'
  return input.settings.target
}

// resolve rank-specific passive params for inspect copy.
function resParams(wpn: GenWpn, rank: number): string[] {
  const ndx = Math.max(0, Math.min(rank - 1, 4))
  return wpn.passive.params.map((group) => group[ndx] ?? '')
}

function resWpnStat(wpn: GenWpn, input: PrepWeaponPlan): WpnStat {
  return weaponStatsAt(wpn, input.level)
}

// resolve the authored default value for one passive state
// default weapon variants should still include enabled states, just at their normal value.
function defCtrlVal(st: SourceState): boolean | number | string {
  if (st.defaultValue != null) return st.defaultValue
  if (st.kind === 'toggle') return false
  if (st.kind === 'select') return st.options?.[0]?.id ?? ''
  return st.min ?? 0
}

// resolve the authored max value for one passive state
// this is the fallback when the user has not overridden the max search value.
function maxCtrlVal(st: SourceState): boolean | number | string {
  if (st.kind === 'toggle') return true
  if (st.kind === 'stack' || st.kind === 'number') return st.max ?? st.defaultValue ?? st.min ?? 0
  return st.defaultValue ?? st.options?.[0]?.id ?? ''
}

// clamp a stored max override back into the authored control domain
// stale or invalid values fall back to the state's normal max value.
function clmpCtrlVal(
    st: SourceState,
    value: boolean | number | string,
): boolean | number | string {
  if (st.kind === 'toggle') {
    return true
  }

  if (st.kind === 'stack' || st.kind === 'number') {
    const num = Number(value)
    if (!Number.isFinite(num)) {
      return maxCtrlVal(st)
    }

    const min = st.min ?? 0
    const max = st.max ?? num
    return Math.max(min, Math.min(max, num))
  }

  const opts = st.options ?? []
  const str = String(value)
  return opts.some((option) => option.id === str) ? str : maxCtrlVal(st)
}

// read the sparse config entry for a weapon state
// missing entries mean the state is enabled and uses authored values.
function stCfgFor(
    settings: WeaponPlanSet,
    id: string,
    st: SourceState,
): WpnStCfg | undefined {
  return settings.states?.[id]?.[st.controlKey]
}

// choose the candidate value for one authored weapon control
function ctrlVal(
    st: SourceState,
    mode: WpnMode,
    cfg?: WpnStCfg,
): boolean | number | string | null {
  if (cfg?.off) {
    return null
  }

  if (mode === 'default') {
    return defCtrlVal(st)
  }

  return cfg?.max == null ? maxCtrlVal(st) : clmpCtrlVal(st, cfg.max)
}

// materialize the control overlay used by one weapon variant
function mkCtrls(
    id: string,
    mode: WpnMode,
    settings: WeaponPlanSet,
): Record<string, boolean | number | string> {
  const vals: Record<string, boolean | number | string> = {}

  for (const st of listStatesFor('weapon', id)) {
    const val = ctrlVal(st, mode, stCfgFor(settings, id, st))
    if (val == null) {
      continue
    }

    vals[st.controlKey] = val
  }

  return vals
}

// apply one weapon secondary stat into a candidate pool
function addSecStat(pool: UnifiedBuffPool, key: string, val: number): void {
  if (key === 'atkPercent') pool.atk.percent += val
  else if (key === 'hpPercent') pool.hp.percent += val
  else if (key === 'defPercent') pool.def.percent += val
  else if (key === 'critRate') pool.critRate += val
  else if (key === 'critDmg') pool.critDmg += val
  else if (key === 'energyRegen') pool.energyRegen += val
  else if (key === 'tuneBreakBoost') pool.tuneBreakBoost += val
}

// clone a pool so one candidate cannot leak stat mutations into another
function clnPool(pool: UnifiedBuffPool): UnifiedBuffPool {
  return structuredClone(pool) as UnifiedBuffPool
}

// build the transient runtime view used for candidate conditions
function mkCandRt(
    rt: ResRuntime,
    wpn: WeaponState,
    ctrls: Record<string, boolean | number | string>,
): ResRuntime {
  return {
    ...rt,
    build: {
      ...rt.build,
      weapon: wpn,
    },
    state: {
      ...rt.state,
      controls: {
        ...rt.state.controls,
        ...ctrls,
      },
    },
  }
}

// build a single-source effect context for the candidate weapon
function mkFxCtx(
    rt: ResRuntime,
    ctx: SuggestContext,
    input: PrepWeaponPlan,
): EffectContext {
  return {
    team: makeTeamComp([rt.id]),
    source: { type: 'resonator', id: rt.id },
    target: { type: 'resonator', id: rt.id },
    sourceRuntime: rt,
    targetRuntime: rt,
    activeRuntime: rt,
    targetRuntimeId: rt.id,
    activeResonatorId: rt.id,
    teamMemberIds: [rt.id],
    echoSetCounts: countEchoSets(input.qppdChs),
    selectedTargetsByOwnerKey: {},
    baseStats: ctx.sourceBaseStats,
    enemy: ctx.enemy,
  }
}

// apply candidate passive effects and return the resulting final stats and skills
function prepWpnFx(
    wpn: GenWpn,
    mode: WpnMode,
    ctx: SuggestContext,
    input: PrepWeaponPlan,
): {
  rt: ResRuntime
  pool: UnifiedBuffPool
  sklls: SkillDef[]
} {
  const stats = resWpnStat(wpn, input)
  const ctrls = mkCtrls(wpn.id, mode, input.settings)
  const wpnSt: WeaponState = {
    id: wpn.id,
    level: input.level,
    rank: resolveWeaponRank(wpn, input.settings),
    baseAtk: stats.atk,
  }
  const rt = mkCandRt(ctx.runtime, wpnSt, ctrls)
  const pool = clnPool(ctx.pool)
  const baseCtx = mkFxCtx(rt, ctx, input)
  const source: DataSrcRef = { type: 'weapon', id: wpn.id }

  addSecStat(pool, wpn.statKey, stats.statVal)

  const cand = {
    baseCtx,
    source,
    srcRt: rt,
    tgtRt: rt,
    baseStats: ctx.sourceBaseStats,
    enemy: ctx.enemy,
  }

  applyCandRt(pool, cand, 'preStats')
  const preFin = calcFinalStats(ctx.sourceBaseStats, pool, stats.atk)

  applyCandRt(pool, {
    ...cand,
    finalStats: preFin,
    srcFinal: preFin,
  }, 'postStats')

  const fin = calcFinalStats(ctx.sourceBaseStats, pool, stats.atk)
  const src = {
    ...cand,
    finalStats: fin,
    srcFinal: fin,
  }

  const baseSklls = ctx.mode === 'target' ? [ctx.skll] : ctx.sklls
  const sklls = baseSklls.map((skll) => applyCandSk(skll, src))

  return {
    rt,
    pool,
    sklls,
  }
}

// pack one direct target context for a weapon candidate
function mkDrctCtx(
    base: DrctSuggCtx,
    wpn: GenWpn,
    mode: WpnMode,
    input: PrepWeaponPlan,
): DrctSuggCtx {
  const prep = prepWpnFx(wpn, mode, base, input)
  const skll = prep.sklls[0] ?? base.skll
  const stats = resWpnStat(wpn, input)
  const fin = calcFinalStats(base.sourceBaseStats, prep.pool, stats.atk)
  const comp = makeOptContext({
    resonatorId: prep.rt.id,
    runtime: prep.rt,
    skill: skll,
    finalStats: fin,
    enemy: base.enemy,
    combatState: prep.rt.state.combat,
  })
  const combo = Math.max(1, input.qppdChs.filter((echo) => echo != null).length)

  return {
    ...base,
    runtime: prep.rt,
    selectedSkill: selOptTgtSkl(skll),
    sourceFinals: fin,
    pool: prep.pool,
    skll,
    pckdCtx: packTargetCtx({
      compiled: comp,
      skill: skll,
      runtime: prep.rt,
      comboN: combo,
      comboK: combo,
      comboCount: 1,
      comboBaseIndex: 0,
      lockEchoIdx: -1,
      setRtMask: base.setRtMask,
    }),
  }
}

// pack all rotation target contexts for a weapon candidate
function mkRotCtx(
    base: RotSuggCtx,
    wpn: GenWpn,
    mode: WpnMode,
    input: PrepWeaponPlan,
): RotSuggCtx {
  const prep = prepWpnFx(wpn, mode, base, input)
  const stats = resWpnStat(wpn, input)
  const fin = calcFinalStats(base.sourceBaseStats, prep.pool, stats.atk)
  const contexts = new Float32Array(base.contextCount * CTX_FLOATS)

  for (let ndx = 0; ndx < base.contextCount; ndx += 1) {
    const skll = prep.sklls[ndx] ?? base.sklls[ndx] ?? base.sklls[0]
    if (!skll) continue

    const comp = makeOptContext({
      resonatorId: base.resIds[ndx] ?? prep.rt.id,
      runtime: prep.rt,
      skill: skll,
      finalStats: fin,
      enemy: base.enemy,
      combatState: prep.rt.state.combat,
    })

    const pckd = packTargetCtx({
      compiled: comp,
      skill: skll,
      runtime: prep.rt,
      comboN: 5,
      comboK: 5,
      comboCount: 1,
      comboBaseIndex: 0,
      lockEchoIdx: -1,
      setRtMask: base.setRtMask,
    })

    contexts.set(pckd, ndx * CTX_FLOATS)
  }

  return {
    ...base,
    runtime: prep.rt,
    selectedSkill: prep.sklls[0] ? selOptTgtSkl(prep.sklls[0]) : base.selectedSkill,
    sourceFinals: fin,
    pool: prep.pool,
    sklls: prep.sklls,
    contexts,
  }
}

// score one weapon candidate variant
function scoreWpn(
    wpn: GenWpn,
    mode: WpnMode,
    input: PrepWeaponPlan,
): WeaponEntry {
  const ctx = input.context.mode === 'target'
      ? mkDrctCtx(input.context, wpn, mode, input)
      : mkRotCtx(input.context, wpn, mode, input)
  const stats = resWpnStat(wpn, input)
  const ctrls = mkCtrls(wpn.id, mode, input.settings)

  return {
    damage: evalSuggChs(ctx, input.qppdChs),
    weaponId: wpn.id,
    name: wpn.name,
    rarity: wpn.rarity,
    icon: wpn.icon,
    level: input.level,
    rank: resolveWeaponRank(wpn, input.settings),
    baseAtk: stats.atk,
    statKey: wpn.statKey,
    statValue: stats.statVal,
    mode,
    controls: ctrls,
    pssvName: wpn.passive.name,
    pssvDesc: wpn.passive.desc,
    params: resParams(wpn, resolveWeaponRank(wpn, input.settings)),
  }
}

// run weapon suggestions over all compatible weapons and both passive variants
export function runPrepWpn(
    input: PrepWeaponPlan,
): WeaponEntry[] {
  const groups: WeaponEntry[][] = []
  const modes = resModes(input)
  const tgtMode = resTgtMode(input)

  for (const wpn of listWpnsByTy(input.weaponType)) {
    if (!weaponRarityVisible(wpn, input.settings)) {
      continue
    }

    groups.push(modes.map((mode) => scoreWpn(wpn, mode, input)))
  }

  groups.sort((left, right) => {
    const leftTgt = left.find((entry) => entry.mode === tgtMode) ?? left[0]
    const rightTgt = right.find((entry) => entry.mode === tgtMode) ?? right[0]
    return (rightTgt?.damage ?? 0) - (leftTgt?.damage ?? 0)
  })

  return groups.slice(0, input.topK ?? 30).flat()
}
