/*
  Author: Runor Ewhro
  Description: Builds the compact per-weapon stat overlays used by theory weapon
               search. Each visible weapon (max-passive mode) is swapped into the
               echo-stripped runtime and run through the SAME context compile
               that produces the base context, then only the weapon-varying
               packed slots (WEAPON_OVERLAY_SLOTS) are extracted. The combo space
               is weapon-independent, so this is a one-time setup cost; evaluation
               then scores each combo against every overlay and keeps the best.
*/

import type { OptStartPay } from '@/engine/optimizer/types.ts'
import type { ResRuntime, WeaponState } from '@/domain/entities/runtime.ts'
import type { GenWpn } from '@/domain/entities/weapon.ts'
import type { SourceState } from '@/domain/gameData/contracts.ts'
import { makeRuntimeMap } from '@/domain/state/runtimeAdapters.ts'
import { getWpnById, listWpnsByTy } from '@/domain/services/weaponCatalogService.ts'
import type { WeaponPlanSet } from '@/domain/entities/suggestions.ts'
import {
  resolveWeaponRank,
  weaponRarityVisible,
  weaponStatsAt,
} from '@/domain/services/weaponPlan.ts'
import { listStatesFor } from '@/domain/services/gameDataService.ts'
import { compOptTgtCt } from '@/engine/optimizer/target/context.ts'
import { packTargetCtx } from '@/engine/optimizer/context/pack.ts'
import { stripEchoes } from '@/engine/optimizer/compiler/shared.ts'
import {
  MAX_WEAPON_CANDIDATES,
  WEAPON_OVERLAY_SLOTS,
  WEAPON_OVERLAY_STRIDE,
} from '@/engine/optimizer/config/constants.ts'

export interface WeaponOverlays {
  // W × WEAPON_OVERLAY_STRIDE floats, row-major; row w holds the weapon-varying
  // packed-context slots (CTX_FLOATS layout, in WEAPON_OVERLAY_SLOTS order) for
  // weapon w. both CPU and GPU evaluators compose a full context as
  // base ⊕ overlay[w]; only these slots change per weapon.
  overlays: Float32Array

  // catalog id per row, parallel to `overlays`. used to tag results.
  weaponIds: string[]

  count: number
}


// the authored max value for one passive control (max search mode).
function maxControlValue(state: SourceState): boolean | number | string {
  if (state.kind === 'toggle') {
    return true
  }
  if (state.kind === 'stack' || state.kind === 'number') {
    return state.max ?? state.defaultValue ?? state.min ?? 0
  }
  return state.defaultValue ?? state.options?.[0]?.id ?? ''
}

// clamp a stored max override back into the control's authored domain.
function clampControlValue(state: SourceState, value: boolean | number | string): boolean | number | string {
  if (state.kind === 'toggle') {
    return true
  }
  if (state.kind === 'stack' || state.kind === 'number') {
    const num = Number(value)
    if (!Number.isFinite(num)) return maxControlValue(state)
    const min = state.min ?? 0
    const max = state.max ?? num
    return Math.max(min, Math.min(max, num))
  }
  const opts = state.options ?? []
  const str = String(value)
  return opts.some((option) => option.id === str) ? str : maxControlValue(state)
}

// the passive controls a weapon is searched with. each state is enabled at its
// max value, except those the plan turns off (skipped -> defaults to inactive)
// or overrides (clamped). mirrors mkCtrls(id,'max',plan) in the suggestion
// engine, so the optimizer honors the Passives tab the same way.
function maxControls(
    weaponId: string,
    plan?: WeaponPlanSet,
): Record<string, boolean | number | string> {
  const out: Record<string, boolean | number | string> = {}
  for (const state of listStatesFor('weapon', weaponId)) {
    const cfg = plan?.states?.[weaponId]?.[state.controlKey]
    if (cfg?.off) {
      continue
    }
    out[state.controlKey] = cfg?.max == null ? maxControlValue(state) : clampControlValue(state, cfg.max)
  }
  return out
}

// the weapon state + passive controls the search used for a candidate, so the
// optimizer's "equip" can reproduce exactly what was evaluated: id, the build's
// weapon level, the plan's rank, and the plan's passive config (max, minus the
// ones it turns off). returns null for an unknown id. mirrors buildWeaponOverlays.
export function weaponEquipState(
    weaponId: string,
    level: number,
    plan?: WeaponPlanSet,
): { weapon: WeaponState; controls: Record<string, boolean | number | string> } | null {
  const wpn = getWpnById(weaponId)
  if (!wpn) {
    return null
  }
  const stats = weaponStatsAt(wpn, level)
  return {
    weapon: { id: wpn.id, level, rank: resolveWeaponRank(wpn, plan), baseAtk: stats.atk },
    controls: maxControls(wpn.id, plan),
  }
}

// drop the currently-equipped weapon's passive controls so they do not leak into
// every candidate's context. runtimeWithWeapon merges controls, so without this
// the equipped weapon's passives would ride along on every candidate and make
// the whole search (and the chosen best weapon) depend on what is equipped.
export function stripWeaponControls(runtime: ResRuntime): ResRuntime {
  const equippedId = runtime.build.weapon.id
  const keys = equippedId
      ? listStatesFor('weapon', equippedId).map((state) => state.controlKey)
      : []
  if (keys.length === 0) {
    return runtime
  }
  const controls = { ...runtime.state.controls }
  for (const key of keys) {
    delete controls[key]
  }
  return { ...runtime, state: { ...runtime.state, controls } }
}

// swap one candidate weapon (and its max-mode passive controls) into the runtime.
function runtimeWithWeapon(
    runtime: ResRuntime,
    weapon: WeaponState,
    controls: Record<string, boolean | number | string>,
): ResRuntime {
  return {
    ...runtime,
    build: {
      ...runtime.build,
      weapon,
    },
    state: {
      ...runtime.state,
      controls: {
        ...runtime.state.controls,
        ...controls,
      },
    },
  }
}

// the searchable weapon candidates for this run, plus the level/plan needed to
// build each one's state. shared by both target overlay search and rotation
// per-weapon context search so they stay in lockstep on candidate selection.
export interface WeaponCandidateSet {
  candidates: GenWpn[]
  level: number
  plan?: WeaponPlanSet
}

// resolve the candidate weapon list for the active resonator's weapon type,
// honoring the plan's rarity visibility and the candidate cap. returns null when
// there is nothing searchable (caller then runs the single-weapon path).
export function resolveWeaponCandidates(input: OptStartPay): WeaponCandidateSet | null {
  const seed = input.resSeed
  const weaponType = seed?.weaponType
  if (weaponType == null) {
    return null
  }

  const level = input.runtime.build.weapon.level
  const plan = input.weaponPlan

  const candidates = listWpnsByTy(weaponType)
      .filter((wpn) => weaponRarityVisible(wpn, plan))
      .slice(0, MAX_WEAPON_CANDIDATES)

  if (candidates.length === 0) {
    return null
  }

  return { candidates, level, plan }
}

// swap one candidate weapon (at the run's level + plan rank + max-mode passives)
// into a runtime. the caller is responsible for first stripping echoes and the
// equipped weapon's controls (see stripWeaponControls).
export function withCandidateWeapon(
    runtime: ResRuntime,
    wpn: GenWpn,
    level: number,
    plan?: WeaponPlanSet,
): ResRuntime {
  const stats = weaponStatsAt(wpn, level)
  const weaponState: WeaponState = {
    id: wpn.id,
    level,
    rank: resolveWeaponRank(wpn, plan),
    baseAtk: stats.atk,
  }
  return runtimeWithWeapon(runtime, weaponState, maxControls(wpn.id, plan))
}

// build the per-weapon overlays for the current theory target. returns null when
// the resonator has no searchable weapons (caller then runs the W=1 path).
export function buildWeaponOverlays(input: OptStartPay): WeaponOverlays | null {
  const skillId = input.settings.targetSkillId
  if (!skillId) {
    return null
  }

  const seed = input.resSeed
  const weaponType = seed?.weaponType
  if (weaponType == null) {
    return null
  }

  const level = input.runtime.build.weapon.level
  const plan = input.weaponPlan

  const candidates = listWpnsByTy(weaponType)
      .filter((wpn) => weaponRarityVisible(wpn, plan))
      .slice(0, MAX_WEAPON_CANDIDATES)

  if (candidates.length === 0) {
    return null
  }

  // strip echoes (they come from the combo, not the equipped build) and the
  // equipped weapon's passive controls (so each candidate is scored only with
  // its own max-mode passives, independent of what weapon is equipped).
  const baseRuntime = stripWeaponControls(stripEchoes(input.runtime))

  const overlays = new Float32Array(candidates.length * WEAPON_OVERLAY_STRIDE)
  const weaponIds: string[] = []

  for (let w = 0; w < candidates.length; w += 1) {
    const wpn = candidates[w]!
    const stats = weaponStatsAt(wpn, level)
    const weaponState: WeaponState = {
      id: wpn.id,
      level,
      rank: resolveWeaponRank(wpn, plan),
      baseAtk: stats.atk,
    }
    const rt = runtimeWithWeapon(baseRuntime, weaponState, maxControls(wpn.id, plan))

    const target = compOptTgtCt({
      runtime: rt,
      resonatorId: input.resonatorId,
      resSeed: seed,
      skillId,
      enemy: input.enemyProfile,
      runtimesById: makeRuntimeMap(rt),
      selectedTargets: input.selectedTargets,
    })

    // GPU: compact overlay extracted from the packed (CTX_FLOATS) context
    const packed = packTargetCtx({
      compiled: target.compiled,
      skill: target.skill,
      runtime: rt,
      comboN: 1,
      comboK: 1,
      comboCount: 1,
      comboBaseIndex: 0,
      lockEchoIdx: -1,
      setRtMask: 0,
    })
    const overlayBase = w * WEAPON_OVERLAY_STRIDE
    for (let s = 0; s < WEAPON_OVERLAY_STRIDE; s += 1) {
      overlays[overlayBase + s] = packed[WEAPON_OVERLAY_SLOTS[s]!]!
    }

    weaponIds.push(wpn.id)
  }

  return {
    overlays,
    weaponIds,
    count: candidates.length,
  }
}
