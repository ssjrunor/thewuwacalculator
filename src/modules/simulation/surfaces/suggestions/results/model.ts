/*
  Author: Runor Ewhro
  description: normalizes main-stat, set-plan, and weapon suggestions against
               their own baselines and materializes candidates for application.
*/

import type { EchoInstance, ResRuntime } from '@/domain/entities/runtime.ts'
import { ECHO_MAIN_STATS, ECHO_SIDE_STATS } from '@/data/gameData/catalog/echoStats.ts'
import { getSntSetClr, getSntSetIco, getSntSetNam } from '@/data/gameData/catalog/sonataSets.ts'
import { applySetPlan, mkEchoMainSt } from '@/engine/suggestions/mutate.ts'
import { applyMainSta } from '@/engine/suggestions/mainStat/utils.ts'
import type { CompactSetPlanSuggest, MainStatSugg, WeaponEntry } from '@/engine/suggestions/types.ts'
import type { SetPlanEntry } from '@/engine/search/combos/setPlans.ts'
import type { MainStatRecipe } from '@/engine/suggestions/mainStat/utils.ts'
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
import { formatTruncCompact } from '@/shared/lib/number'

export { materializeWeaponSuggestion } from '../lib/results.ts'

export type Kind = 'mainStats' | 'setPlans' | 'weapons'

export const KINDS: Kind[] = ['mainStats', 'setPlans', 'weapons']

export const KIND_NAME: Record<Kind, string> = {
  mainStats: 'Main Stats',
  setPlans: 'Sonata Sets',
  weapons: 'Weapons',
}

export function isKind(mode: SuggKind): mode is Kind {
  return mode === 'mainStats' || mode === 'setPlans' || mode === 'weapons'
}

export interface Change {
  key: string
  icon: string | null
  text: string
  cost: string | null
  sup: string | null
  color: string | null
}

export interface EchoSlot {
  key: string
  color: string | null
  title: string
  lead: string
  leadUnit: string
  coins: Array<string | null>
  // one semantic label per alternative represented by `coins`
  names: string[]
  name: string | null
  primary: { icon: string | null; value: string } | null
  secondary: { icon: string | null; value: string } | null
  held: boolean
}

// the lead passive-state variant determines a weapon row's rank
export interface WeaponVariant {
  mode: WeaponEntry['mode']
  damage: number
  delta: number
}

// the Main Echo and concrete set-plan slot used by candidate scoring
export interface RowEcho {
  id: string
  name: string
  icon: string | null
  color: string | null
  worn: boolean
  // index into `trays`, or -1 when the scored Echo belongs to no plan entry
  seat: number
}

export interface Row {
  key: string
  rank: number
  now: boolean
  // already on the build: the worn recipe or set plan, or the weapon in hand
  equipped: boolean
  color: string | null
  damage: number
  delta: number
  marks: Change[]
  trays: EchoSlot[]
  recipe: MainStatRecipe[] | null
  setPlan: SetPlanEntry[] | null
  mainEchoId?: string
  mainEchoSetId?: number
  echo?: RowEcho | null
  weapon: WeaponEntry | null
  variants: WeaponVariant[]
}

export interface WornMainStat {
  cost: number
  key: string
  value: number
  secondary: { key: string, value: number }
}

// recipes have no slot identity, so compare equipped main stats as a multiset
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

function statMark(key: string, cost: number): Change {
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

function statTray(key: string, cost: number, held: boolean): EchoSlot {
  const value = ECHO_MAIN_STATS[cost]?.[key] ?? 0
  const side = ECHO_SIDE_STATS[cost]
  return {
    key: `${cost}:${key}`,
    color: null,
    title: `Cost ${cost}, ${formatStatKeyLabel(key)} ${formatStatKeyValue(key, value)}`,
    lead: String(cost),
    leadUnit: 'c',
    coins: [],
    names: [formatStatKeyLabel(key)],
    name: null,
    primary: { icon: statIconSrc(key), value: formatStatKeyValue(key, value) },
    secondary: side
      ? { icon: statIconSrc(side.key), value: formatStatKeyValue(side.key, side.value) }
      : null,
    held,
  }
}

// consume matching multiset entries so repeated cost/stat pairs remain distinct
function mainStatRows(
  results: MainStatSugg[],
  base: number,
  echoes: Array<EchoInstance | null>,
  worn: WornMainStat[],
): Row[] {
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
    const marks: Change[] = []
    const trays: EchoSlot[] = []

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
      recipe: result.recipes,
      setPlan: null,
      weapon: null,
      variants: [],
    }
  })
}

function setPlanRows(
  results: CompactSetPlanSuggest[],
  base: number,
  worn: SetPlanSmmrE[],
  echoes: Array<EchoInstance | null>,
): Row[] {
  return results.map((result, index) => {
    const have = new Map<number, number>()
    for (const entry of worn) {
      have.set(entry.setId, (have.get(entry.setId) ?? 0) + entry.pieces)
    }

    // materialize the scored plan; displayPlan contains only score-equivalent alternatives
    const setPlan = result.setPlan
    const displayPlan = getSetPlanDisplay(result)

    const marks: Change[] = []
    const trays: EchoSlot[] = []

    // the concrete plan used for mutation comes from the scored plan
    for (const entry of setPlan) {
      const held = (have.get(entry.setId) ?? 0) >= entry.pieces
      if (held) have.set(entry.setId, (have.get(entry.setId) ?? 0) - entry.pieces)
      if (!held) {
        marks.push({
          key: `${entry.setId}:${entry.pieces}`,
          icon: getSntSetIco(entry.setId),
          text: `${getSntSetNam(entry.setId)}, ${entry.pieces}pc`,
          cost: null,
          sup: String(entry.pieces),
          color: getSntSetClr(entry.setId),
        })
      }
    }

    const trayHave = new Map<number, number>()
    for (const entry of worn) {
      trayHave.set(entry.setId, (trayHave.get(entry.setId) ?? 0) + entry.pieces)
    }
    for (const entry of displayPlan) {
      const lead = entry.setIds.find((setId) => (trayHave.get(setId) ?? 0) >= entry.pieces)
        ?? entry.setIds[0]
      const held = (trayHave.get(lead) ?? 0) >= entry.pieces
      if (held) trayHave.set(lead, (trayHave.get(lead) ?? 0) - entry.pieces)
      const color = getSntSetClr(lead)
      trays.push({
        key: `${lead}:${entry.pieces}`,
        color,
        title: `${entry.pieces}pc ${entry.setIds.map((id) => getSntSetNam(id)).join(' or ')}`,
        lead: String(entry.pieces),
        leadUnit: 'pc',
        coins: entry.setIds.map((id) => getSntSetIco(id)),
        names: entry.setIds.map((id) => getSntSetNam(id)),
        name: getSntSetNam(lead),
        primary: null,
        secondary: null,
        held,
      })
    }

    const mainDef = result.mainEchoId ? getEchoById(result.mainEchoId) : null
    const seatPieces = result.setPlan.find((entry) => entry.setId === result.mainEchoSetId)?.pieces
    const echo: RowEcho | null = mainDef ? {
      id: mainDef.id,
      name: mainDef.name,
      icon: mainDef.icon,
      color: result.mainEchoSetId != null ? getSntSetClr(result.mainEchoSetId) : null,
      worn: mainDef.id === (echoes.find((entry) => entry?.mainEcho) ?? echoes[0])?.id,
      seat: displayPlan.findIndex((entry) => entry.pieces === seatPieces
        && result.mainEchoSetId != null && entry.setIds.includes(result.mainEchoSetId)),
    } : null

    const now = sameSetPlanCandidate(result, worn, base)
      && (!result.mainEchoId || result.mainEchoId === echoes[0]?.id)
      && (result.mainEchoSetId == null || result.mainEchoSetId === echoes[0]?.set)
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
      recipe: null,
      setPlan,
      mainEchoId: result.mainEchoId,
      mainEchoSetId: result.mainEchoSetId,
      echo,
      weapon: null,
      variants: [],
    }
  })
}

// fold passive variants by weapon while keeping the configured ranking variant first
function weaponRows(
  results: WeaponEntry[],
  base: number,
  runtime: ResRuntime,
): Row[] {
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
        names: [],
        name: null,
        primary: { icon: null, value: `${plan.damage > base ? '+' : ''}${formatTruncCompact(percentDiff(plan.damage, base), 1)}%` },
        secondary: null,
        held: false,
      })),
      recipe: null,
      setPlan: null,
      weapon: lead,
      variants: plans.map((plan) => ({
        mode: plan.mode,
        damage: plan.damage,
        delta: percentDiff(plan.damage, base),
      })),
    }
  })
}

export function buildRows({
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
  kind: Kind
  mainStatRslt: MainStatSugg[]
  setPlanRslt: CompactSetPlanSuggest[]
  wpnRslt: WeaponEntry[]
  base: number
  echoes: Array<EchoInstance | null>
  worn: WornMainStat[]
  wornSetPlan: SetPlanSmmrE[]
  runtime: ResRuntime
}): Row[] {
  if (kind === 'mainStats') return mainStatRows(mainStatRslt, base, echoes, worn)
  if (kind === 'setPlans') return setPlanRows(setPlanRslt, base, wornSetPlan, echoes)
  return weaponRows(wpnRslt, base, runtime)
}

export function materializeRowEchoes(row: Row, echoes: Array<EchoInstance | null>): Array<EchoInstance | null> | null {
  if (row.recipe) return applyMainSta(row.recipe, echoes)
  if (row.setPlan) {
    const mainEchoChoice = row.mainEchoId && row.mainEchoSetId != null
      ? { id: row.mainEchoId, setId: row.mainEchoSetId }
      : undefined
    return applySetPlan(row.setPlan, echoes, mainEchoChoice)
  }
  return null
}
