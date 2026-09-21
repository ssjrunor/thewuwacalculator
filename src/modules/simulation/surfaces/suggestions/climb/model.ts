/*
  Author: Runor Ewhro
  Description: Normalizes main-stat, set-plan, and weapon suggestions against
               their own baselines and materializes candidates for application.
*/

import type { EchoInstance, ResRuntime } from '@/domain/entities/runtime.ts'
import { ECHO_MAIN_STATS, ECHO_SIDE_STATS } from '@/data/gameData/catalog/echoStats.ts'
import { getSntSetClr, getSntSetIco, getSntSetNam } from '@/data/gameData/catalog/sonataSets.ts'
import { applySetPlan, mkEchoMainSt } from '@/engine/suggestions/mutate.ts'
import { applyMainSta } from '@/engine/suggestions/mainStat-suggestion/utils.ts'
import type {
  MainStatSugg,
  SetPlanSuggest,
  WeaponEntry,
} from '@/engine/suggestions/types.ts'
import { formatStatKeyLabel, formatStatKeyValue } from '@/modules/simulation/model/statsView.ts'
import { getRarityColor } from '@/modules/simulation/model/display.ts'
import { statIconSrc } from '@/modules/simulation/workspace/ui.tsx'
import { getEchoById } from '@/data/catalog/echoCatalogService.ts'
import {
  recipeSig,
  percentDiff,
  sortRecipes,
  type SetPlanSmmrE,
} from '@/modules/simulation/surfaces/suggestions/lib/suggestions.ts'
import { getSetPlanDisplay, groupWeaponSuggestions, sameSetPlanCandidate } from '../lib/results.ts'
import type { SuggKind } from '@/modules/simulation/surfaces/suggestions/lib/useSuggRuns.ts'

export { materializeWeaponSuggestion } from '../lib/results.ts'

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

/* A weapon is scored per passive state; the lead variant ranks the row. */
export interface ClimbVariant {
  mode: WeaponEntry['mode']
  damage: number
  delta: number
}

export interface ClimbRow {
  key: string
  rank: number
  now: boolean
  /** Already on the build: the worn recipe or set plan, or the weapon in hand. */
  equipped: boolean
  color: string | null
  damage: number
  delta: number
  marks: ClimbMark[]
  trays: ClimbTray[]
  /** Materialized Echo candidate; weapon-only results leave it unchanged. */
  echoes: Array<EchoInstance | null> | null
  weapon: WeaponEntry | null
  variants: ClimbVariant[]
}

export interface WornMainStat {
  cost: number
  key: string
  value: number
  secondary: { key: string, value: number }
}

/* Recipes have no slot identity, so compare equipped main stats as a multiset. */
export function wornMainStats(echoes: Array<EchoInstance | null>): WornMainStat[] {
  const out: WornMainStat[] = []
  for (const echo of echoes) {
    if (!echo) continue
    const cost = getEchoById(echo.id)?.cost
    if (!cost) continue
    out.push({ cost, key: echo.mainStats.primary.key, value: echo.mainStats.primary.value, secondary: echo.mainStats.secondary })
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
  worn: WornMainStat[],
): ClimbRow[] {
  return results.map((result, index) => {
    const have = new Map<string, number>()
    for (const entry of worn) {
      const side = ECHO_SIDE_STATS[entry.cost]
      if (entry.value !== ECHO_MAIN_STATS[entry.cost]?.[entry.key]
        || entry.secondary.key !== side?.key || entry.secondary.value !== side?.value) continue
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

    const now = recipeSig(result.recipes) === mkEchoMainSt(echoes)
    return {
      key: `main:${index}`,
      rank: index + 1,
      now,
      equipped: now,
      color: null,
      damage: result.damage,
      delta: percentDiff(result.damage, base),
      marks,
      trays,
      echoes: applyMainSta(result.recipes, echoes),
      weapon: null,
      variants: [],
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

    const displayPlan = getSetPlanDisplay(result)

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
        name: getSntSetNam(lead),
        primary: null,
        secondary: null,
        held,
      })
    }

    const now = sameSetPlanCandidate(result, worn, base)
    return {
      key: `sets:${index}`,
      rank: index + 1,
      now,
      equipped: now,
      color: null,
      damage: result.avgDamage,
      delta: percentDiff(result.avgDamage, base),
      marks,
      trays,
      echoes: applySetPlan(result.setPlan, echoes),
      weapon: null,
      variants: [],
    }
  })
}

/* Fold passive variants by weapon while keeping the configured ranking variant first. */
function weaponRows(
  results: WeaponEntry[],
  base: number,
  runtime: ResRuntime,
): ClimbRow[] {
  return groupWeaponSuggestions(results).map(({ plans }, index) => {
    const lead = plans[0]
    const now = lead.weaponId === runtime.build.weapon.id
    const color = getRarityColor(lead.rarity) ?? null
    return {
      key: `weapon:${index}:${lead.weaponId}`,
      rank: index + 1,
      now,
      equipped: lead.weaponId === runtime.build.weapon.id,
      color,
      damage: lead.damage,
      delta: percentDiff(lead.damage, base),
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
        primary: { icon: null, value: `${plan.damage > base ? '+' : ''}${percentDiff(plan.damage, base).toFixed(1)}%` },
        secondary: null,
        held: false,
      })),
      echoes: null,
      weapon: lead,
      variants: plans.map((plan) => ({
        mode: plan.mode,
        damage: plan.damage,
        delta: percentDiff(plan.damage, base),
      })),
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
  worn: WornMainStat[]
  wornSetPlan: SetPlanSmmrE[]
  runtime: ResRuntime
}): ClimbRow[] {
  if (kind === 'mainStats') return mainStatRows(mainStatRslt, base, echoes, worn)
  if (kind === 'setPlans') return setPlanRows(setPlanRslt, base, echoes, wornSetPlan)
  return weaponRows(wpnRslt, base, runtime)
}
