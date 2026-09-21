/*
  Author: Runor Ewhro
  Description: Scores compatible weapon candidates for suggestions by applying
               weapon stat and passive overlays onto a neutral suggestion
               context before reusing the packed evaluator.
*/

import type { SourceState } from '@/domain/gameData/contracts'
import type { ResRuntime, WeaponState } from '@/domain/entities/runtime'
import type { SkillDef } from '@/domain/entities/stats'
import type { GenWpn } from '@/domain/entities/weapon'
import type { WeaponPlanSet, WpnStCfg } from '@/domain/entities/suggestions'
import { listWpnsByTy } from '@/data/catalog/weaponCatalogService'
import {
  resolveWeaponRank,
  weaponRarityVisible,
  weaponStatsAt,
} from '@/domain/services/weaponPlan'
import { listStatesFor } from '@/data/catalog/gameDataService'
import { makeCombatEnv } from '@/engine/pipeline/buildCombatContext'
import { prepareNumericSkill } from '@/engine/effects/numericTeam.ts'
import { makeRuntimeMap } from '@/engine/runtime/runtimeAdapters'
import { makeCombatGraph } from '@/engine/runtime/combatGraph'
import { listRtSkills } from '@/engine/services/runtimeSourceService'
import { prprRtSkll } from '@/engine/pipeline/prepareRuntimeSkill'
import { makeOptContext } from '@/engine/optimizer/context/compiled'
import { packTargetCtx } from '@/engine/optimizer/context/pack'
import { selOptTgtSkl } from '@/engine/optimizer/target/selectedSkill'
import { evalSuggChs, resSuggDmg, runSuggSmlt } from '@/engine/suggestions/shared'
import type {
  DrctSuggCtx,
  PrepWeaponPlan,
  SuggestContext,
  WeaponEntry,
} from '@/engine/suggestions/types'

type WpnMode = 'default' | 'max'

interface WpnStat {
  atk: number
  statVal: number
}

function resModes(input: PrepWeaponPlan): WpnMode[] {
  if (input.settings.mode === 'default') return ['default']
  if (input.settings.mode === 'max') return ['max']
  return input.settings.target === 'default' ? ['default', 'max'] : ['max', 'default']
}

function resTgtMode(input: PrepWeaponPlan): WpnMode {
  if (input.settings.mode === 'default') return 'default'
  if (input.settings.mode === 'max') return 'max'
  return input.settings.target
}

function resParams(wpn: GenWpn, rank: number): string[] {
  const ndx = Math.max(0, Math.min(rank - 1, 4))
  return wpn.passive.params.map((group) => group[ndx] ?? '')
}

function resWpnStat(wpn: GenWpn, input: PrepWeaponPlan): WpnStat {
  return weaponStatsAt(wpn, input.level)
}

function mkWpnSt(wpn: GenWpn, input: PrepWeaponPlan): WeaponState {
  return {
    id: wpn.id,
    level: input.level,
    rank: resolveWeaponRank(wpn, input.settings),
    baseAtk: resWpnStat(wpn, input).atk,
  }
}

/* An enabled default variant uses the control's authored resting value. */
function defCtrlVal(st: SourceState): boolean | number | string {
  if (st.defaultValue != null) return st.defaultValue
  if (st.kind === 'toggle') return false
  if (st.kind === 'select') return st.options?.[0]?.id ?? ''
  return st.min ?? 0
}

/* A max variant falls back to the highest value allowed by the authored control. */
function maxCtrlVal(st: SourceState): boolean | number | string {
  if (st.kind === 'toggle') return true
  if (st.kind === 'stack' || st.kind === 'number') return st.max ?? st.defaultValue ?? st.min ?? 0
  return st.defaultValue ?? st.options?.[0]?.id ?? ''
}

/* Persisted overrides may outlive their source data, so constrain them again. */
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

/* Missing sparse entries mean enabled with authored values. */
function stCfgFor(
    settings: WeaponPlanSet,
    id: string,
    st: SourceState,
): WpnStCfg | undefined {
  return settings.states?.[id]?.[st.controlKey]
}

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

// rebuild the stripped candidate through the normal combat pipeline so
// post-stat conversions see the candidate weapon's base and secondary stats.
function mkCandCombat(
    rt: ResRuntime,
    input: PrepWeaponPlan,
): ReturnType<typeof makeCombatEnv> {
  const participants = makeRuntimeMap(rt, input.runtimesById)
  const graph = makeCombatGraph({
    actRt: rt,
    activeSeed: input.seed,
    partRts: participants,
    targetsByRes: {
      [rt.id]: input.selectedTargets ?? {},
    },
  })

  return makeCombatEnv({
    graph,
    targetSlotId: 'active',
    enemy: input.enemy,
  })
}

function prepCandSkill(
    rt: ResRuntime,
    combat: ReturnType<typeof makeCombatEnv>,
    skill: SkillDef,
): SkillDef {
  const raw = listRtSkills(rt).find((entry) => entry.id === skill.id)
  if (raw) {
    return prprRtSkll(rt, raw, combat)
  }

  return prepareNumericSkill(combat.numericTeam, combat.numericLane, skill)
}

function prepWpnFx(
    wpn: GenWpn,
    mode: WpnMode,
    ctx: SuggestContext,
    input: PrepWeaponPlan,
): {
  rt: ResRuntime
  combat: ReturnType<typeof makeCombatEnv>
  sklls: SkillDef[]
} {
  const ctrls = mkCtrls(wpn.id, mode, input.settings)
  const rt = mkCandRt(ctx.runtime, mkWpnSt(wpn, input), ctrls)
  const combat = mkCandCombat(rt, input)
  const baseSklls = ctx.mode === 'target' ? [ctx.skll] : ctx.sklls
  const sklls = baseSklls.map((skll) => prepCandSkill(rt, combat, skll))

  return {
    rt,
    combat,
    sklls,
  }
}

function mkDrctCtx(
    base: DrctSuggCtx,
    wpn: GenWpn,
    mode: WpnMode,
    input: PrepWeaponPlan,
): DrctSuggCtx {
  const prep = prepWpnFx(wpn, mode, base, input)
  const skll = prep.sklls[0] ?? base.skll
  const comp = makeOptContext({
    resonatorId: prep.rt.id,
    runtime: prep.rt,
    skill: skll,
    finalStats: prep.combat.finalStats,
    enemy: prep.combat.enemy,
    combatState: prep.rt.state.combat,
  })
  const combo = Math.max(1, input.qppdChs.filter((echo) => echo != null).length)

  return {
    ...base,
    runtime: prep.rt,
    selectedSkill: selOptTgtSkl(skll),
    sourceBaseStats: prep.combat.baseStats,
    sourceFinals: prep.combat.finalStats,
    pool: prep.combat.buffs,
    skll,
    enemy: prep.combat.enemy,
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

// Run each candidate through the complete rotation pipeline. Weapon
// passives can change setup effects and per-entry overlays, so applying them to
// the already-materialized baseline contexts understates the whole rotation.
function scoreRotWpn(
    wpn: GenWpn,
    mode: WpnMode,
    input: PrepWeaponPlan,
): number {
  const ctrls = mkCtrls(wpn.id, mode, input.settings)
  const runtime = mkCandRt(input.runtime, mkWpnSt(wpn, input), ctrls)
  const suggestionInput = {
    scenarioId: input.scenarioId,
    memberId: input.memberId,
    runtime,
    seed: input.seed,
    enemy: input.enemy,
    runtimesById: input.runtimesById,
    selectedTargets: input.selectedTargets,
    tgtFeatId: null,
    rotationMode: true,
    includeEchoAttacks: input.includeEchoAttacks,
  }

  return resSuggDmg(runSuggSmlt(suggestionInput), suggestionInput)
}

function scoreWpn(
    wpn: GenWpn,
    mode: WpnMode,
    input: PrepWeaponPlan,
): WeaponEntry {
  const stats = resWpnStat(wpn, input)
  const ctrls = mkCtrls(wpn.id, mode, input.settings)
  const damage = input.context.mode === 'target'
      ? evalSuggChs(mkDrctCtx(input.context, wpn, mode, input), input.qppdChs)
      : scoreRotWpn(wpn, mode, input)

  return {
    damage,
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
