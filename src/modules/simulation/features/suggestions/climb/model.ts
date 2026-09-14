/*
  Author: Runor Ewhro
  Description: Normalizes main-stat, set-plan, and weapon suggestions against
               their own baselines and materializes candidates for application.
*/

import type { EchoInstance, ResRuntime } from '@/domain/entities/runtime.ts'
import { ECHO_MAIN_STATS, ECHO_SIDE_STATS } from '@/data/gameData/catalog/echoStats.ts'
import { getSntSetClr, getSntSetIco, getSntSetNam } from '@/data/gameData/catalog/sonataSets.ts'
import { clrSrcCtrls } from '@/domain/state/sourceStateInit.ts'
import { applySetPlan } from '@/engine/suggestions/mutate.ts'
import { applyMainSta } from '@/engine/suggestions/mainStat-suggestion/utils.ts'
import type {
  MainStatSugg,
  SetPlanDisplayEntry,
  SetPlanSuggest,
  WeaponEntry,
} from '@/engine/suggestions/types.ts'
import { formatStatKeyLabel, formatStatKeyValue } from '@/modules/simulation/model/statsView.ts'
import { getRarityColor } from '@/modules/simulation/model/display.ts'
import { statIconSrc } from '@/modules/simulation/workspace/ui.tsx'
import { getEchoById } from '@/domain/services/echoCatalogService.ts'
import {
  setPlnsQl,
  sortRecipes,
  type SetPlanSmmrE,
} from '@/modules/simulation/features/suggestions/lib/suggestions.ts'
import type { SuggKind } from '@/modules/simulation/features/suggestions/lib/useSuggRuns.ts'

export type ClimbKind = 'mainStats' | 'setPlans' | 'weapons'

export const CLIMB_KINDS: ClimbKind[] = ['mainStats', 'setPlans', 'weapons']

export const CLIMB_KIND_NAME: Record<ClimbKind, string> = {
  mainStats: 'Main Stats',
  setPlans: 'Sonata Sets',
  weapons: 'Weapons',
}

export function isClimbKind(mode: SuggKind): mode is ClimbKind {
  return mode === 'mainStats' || mode === 'setPlans' || mode === 'weapons'
}

export interface ClimbMark {
  key: string
  icon: string | null
  text: string
  cost: string | null
  sup: string | null
  color: string | null
}

export interface ClimbTray {
  key: string
  color: string | null
  title: string
  lead: string
  leadUnit: string
  coins: Array<string | null>
  name: string | null
  primary: { icon: string | null; value: string } | null
  secondary: { icon: string | null; value: string } | null
  held: boolean
}

export interface ClimbRow {
  key: string
  rank: number
  now: boolean
  color: string | null
  damage: number
  delta: number
  marks: ClimbMark[]
  trays: ClimbTray[]
  /** Materialized Echo candidate; weapon-only results leave it unchanged. */
  echoes: Array<EchoInstance | null> | null
  weapon: WeaponEntry | null
}

const pctDelta = (damage: number, base: number) => (base > 0 ? (damage / base - 1) * 100 : 0)

/* Recipes have no slot identity, so compare equipped main stats as a multiset. */
export function wornMainStats(echoes: Array<EchoInstance | null>): Array<{ cost: number, key: string }> {
  const out: Array<{ cost: number, key: string }> = []
  for (const echo of echoes) {
    if (!echo) continue
    const cost = getEchoById(echo.id)?.cost
    if (!cost) continue
    out.push({ cost, key: echo.mainStats.primary.key })
  }
  return out
}

function statMark(key: string, cost: number): ClimbMark {
  const value = ECHO_MAIN_STATS[cost]?.[key] ?? 0
  return {
    key: `${cost}:${key}`,
    icon: statIconSrc(key),
    text: `Cost ${cost}, ${formatStatKeyLabel(key)} ${formatStatKeyValue(key, value)}`,
    cost: `${cost}c`,
    sup: null,
    color: null,
  }
}

function statTray(key: string, cost: number, held: boolean): ClimbTray {
  const value = ECHO_MAIN_STATS[cost]?.[key] ?? 0
  const side = ECHO_SIDE_STATS[cost]
  return {
    key: `${cost}:${key}`,
    color: null,
    title: `Cost ${cost}, ${formatStatKeyLabel(key)} ${formatStatKeyValue(key, value)}`,
    lead: String(cost),
    leadUnit: 'c',
    coins: [],
    name: null,
    primary: { icon: statIconSrc(key), value: formatStatKeyValue(key, value) },
    secondary: side
      ? { icon: statIconSrc(side.key), value: formatStatKeyValue(side.key, side.value) }
      : null,
    held,
  }
}

/* Consume matching multiset entries so repeated cost/stat pairs remain distinct. */
function mainStatRows(
  results: MainStatSugg[],
  base: number,
  echoes: Array<EchoInstance | null>,
  worn: Array<{ cost: number, key: string }>,
): ClimbRow[] {
  return results.map((result, index) => {
    const have = new Map<string, number>()
    for (const entry of worn) {
      const key = `${entry.cost}:${entry.key}`
      have.set(key, (have.get(key) ?? 0) + 1)
    }

    const recipes = sortRecipes(result.recipes)
    const marks: ClimbMark[] = []
    const trays: ClimbTray[] = []

    for (const recipe of recipes) {
      const key = `${recipe.cost}:${recipe.primaryKey}`
      const left = have.get(key) ?? 0
      const held = left > 0
      if (held) have.set(key, left - 1)
      if (!held) marks.push(statMark(recipe.primaryKey, recipe.cost))
      trays.push(statTray(recipe.primaryKey, recipe.cost, held))
    }

    return {
      key: `main:${index}`,
      rank: index + 1,
      now: marks.length === 0 && recipes.length === worn.length,
      color: null,
      damage: result.damage,
      delta: pctDelta(result.damage, base),
      marks,
      trays,
      echoes: applyMainSta(result.recipes, echoes),
      weapon: null,
    }
  })
}

function setPlanRows(
  results: SetPlanSuggest[],
  base: number,
  echoes: Array<EchoInstance | null>,
  worn: SetPlanSmmrE[],
): ClimbRow[] {
  return results.map((result, index) => {
    const have = new Map<number, number>()
    for (const entry of worn) {
      have.set(entry.setId, (have.get(entry.setId) ?? 0) + entry.pieces)
    }

    const plan = result.displayPlan ?? result.setPlan.map((entry) => ({
      setIds: [entry.setId],
      pieces: entry.pieces,
    }))
    const displayPlan = resolveSetDisplayPlan(plan, have)

    const marks: ClimbMark[] = []
    const trays: ClimbTray[] = []

    for (const entry of displayPlan) {
      const lead = entry.setIds[0]
      const held = (have.get(lead) ?? 0) >= entry.pieces
      if (held) have.set(lead, (have.get(lead) ?? 0) - entry.pieces)
      const color = getSntSetClr(lead)
      if (!held) {
        marks.push({
          key: `${lead}:${entry.pieces}`,
          icon: getSntSetIco(lead),
          text: `${entry.setIds.map((id) => getSntSetNam(id)).join(' or ')}, ${entry.pieces}pc`,
          cost: null,
          sup: String(entry.pieces),
          color,
        })
      }
      trays.push({
        key: `${lead}:${entry.pieces}`,
        color,
        title: `${entry.pieces}pc ${entry.setIds.map((id) => getSntSetNam(id)).join(' or ')}`,
        lead: String(entry.pieces),
        leadUnit: 'pc',
        coins: entry.setIds.map((id) => getSntSetIco(id)),
        name: null,
        primary: null,
        secondary: null,
        held,
      })
    }

    return {
      key: `sets:${index}`,
      rank: index + 1,
      now: setPlnsQl(
        result.setPlan.map((entry) => ({ setId: entry.setId, pieces: entry.pieces })),
        worn,
      ),
      color: null,
      damage: result.avgDamage,
      delta: pctDelta(result.avgDamage, base),
      marks,
      trays,
      echoes: applySetPlan(result.setPlan, echoes),
      weapon: null,
    }
  })
}

/* Repeated effect-equivalent slots arrive with the same alternative pool. Pick
   one distinct representative per slot, preferring sets the build already
   wears. Walking backwards lets an earlier slot keep its first choice while
   the matching path moves a later slot to another compatible set. */
function resolveSetDisplayPlan(
  plan: SetPlanDisplayEntry[],
  have: Map<number, number>,
): SetPlanDisplayEntry[] {
  const choices = plan.map((entry) => [...entry.setIds].sort((left, right) => {
    const leftHeld = (have.get(left) ?? 0) >= entry.pieces
    const rightHeld = (have.get(right) ?? 0) >= entry.pieces
    return Number(rightHeld) - Number(leftHeld)
  }))
  const slotBySet = new Map<number, number>()
  const leadBySlot: Array<number | undefined> = Array(plan.length)

  const assign = (slot: number, seen: Set<number>): boolean => {
    for (const setId of choices[slot]) {
      if (seen.has(setId)) continue
      seen.add(setId)
      const occupied = slotBySet.get(setId)
      if (occupied === undefined || assign(occupied, seen)) {
        slotBySet.set(setId, slot)
        leadBySlot[slot] = setId
        return true
      }
    }
    return false
  }

  for (let slot = plan.length - 1; slot >= 0; slot -= 1) {
    assign(slot, new Set<number>())
  }

  return plan.map((entry, slot) => {
    const lead = leadBySlot[slot] ?? choices[slot][0] ?? entry.setIds[0]
    return {
      ...entry,
      setIds: lead === undefined
        ? entry.setIds
        : [lead, ...entry.setIds.filter((setId) => setId !== lead)],
    }
  })
}

/* Apply the exact candidate the engine scored. In particular, a state omitted
   by weapon config stays omitted instead of being restored by global weapon
   initialization before the scored controls are merged. */
export function materializeWeaponSuggestion(
  runtime: ResRuntime,
  plan: WeaponEntry,
): ResRuntime {
  const controls = { ...runtime.state.controls }
  clrSrcCtrls(controls, { type: 'weapon', id: runtime.build.weapon.id })
  clrSrcCtrls(controls, { type: 'weapon', id: plan.weaponId })
  Object.assign(controls, plan.controls)

  return {
    ...runtime,
    build: {
      ...runtime.build,
      weapon: {
        id: plan.weaponId,
        level: plan.level,
        rank: plan.rank,
        baseAtk: plan.baseAtk,
      },
    },
    state: {
      ...runtime.state,
      controls,
    },
  }
}

function sameWeaponCandidate(
  runtime: ResRuntime,
  plan: WeaponEntry,
  base: number,
): boolean {
  const weapon = runtime.build.weapon
  if (
    weapon.id !== plan.weaponId
    || weapon.level !== plan.level
    || weapon.rank !== plan.rank
    || weapon.baseAtk !== plan.baseAtk
  ) {
    return false
  }

  const tolerance = Math.max(1e-6, Math.abs(base) * 1e-6)
  if (Math.abs(plan.damage - base) > tolerance) return false

  for (const [key, value] of Object.entries(plan.controls)) {
    if (runtime.state.controls[key] !== value) return false
  }

  const prefix = `weapon:${plan.weaponId}:`
  return Object.entries(runtime.state.controls).every(([key, value]) => (
    !key.startsWith(prefix)
    || Object.hasOwn(plan.controls, key)
    || value === false
    || value === 0
    || value === ''
  ))
}

/* Fold passive variants by weapon while keeping the configured ranking variant first. */
function weaponRows(
  results: WeaponEntry[],
  base: number,
  runtime: ResRuntime,
): ClimbRow[] {
  const byWeapon: WeaponEntry[][] = []
  for (const plan of results) {
    const last = byWeapon[byWeapon.length - 1]
    if (last && last[0].weaponId === plan.weaponId) last.push(plan)
    else byWeapon.push([plan])
  }

  return byWeapon.map((plans, index) => {
    const lead = plans[0]
    const now = sameWeaponCandidate(runtime, lead, base)
    const color = getRarityColor(lead.rarity) ?? null
    return {
      key: `weapon:${index}:${lead.weaponId}`,
      rank: index + 1,
      now,
      color,
      damage: lead.damage,
      delta: pctDelta(lead.damage, base),
      marks: [{
        key: lead.weaponId,
        icon: lead.icon,
        text: lead.name,
        cost: null,
        sup: null,
        color,
      }],
      trays: plans.map((plan) => ({
        key: `${plan.weaponId}:${plan.mode}`,
        color: null,
        title: `${plan.mode === 'max' ? 'Stacked' : 'Resting'} passive, ${plan.pssvName}`,
        lead: plan.mode === 'max' ? 'MAX' : 'REST',
        leadUnit: '',
        coins: [],
        name: null,
        primary: { icon: null, value: `${plan.damage > base ? '+' : ''}${pctDelta(plan.damage, base).toFixed(1)}%` },
        secondary: null,
        held: false,
      })),
      echoes: null,
      weapon: lead,
    }
  })
}

export function climbRows({
  kind,
  mainStatRslt,
  setPlanRslt,
  wpnRslt,
  base,
  echoes,
  worn,
  wornSetPlan,
  runtime,
}: {
  kind: ClimbKind
  mainStatRslt: MainStatSugg[]
  setPlanRslt: SetPlanSuggest[]
  wpnRslt: WeaponEntry[]
  base: number
  echoes: Array<EchoInstance | null>
  worn: Array<{ cost: number, key: string }>
  wornSetPlan: SetPlanSmmrE[]
  runtime: ResRuntime
}): ClimbRow[] {
  if (kind === 'mainStats') return mainStatRows(mainStatRslt, base, echoes, worn)
  if (kind === 'setPlans') return setPlanRows(setPlanRslt, base, echoes, wornSetPlan)
  return weaponRows(wpnRslt, base, runtime)
}
