/*
  Author: Runor Ewhro
  description: the leaderboard's names, faces and number formats: resonators
               come from the seed catalog, regions from the uid's first digit.
*/

import { getResSeedBy } from '@/data/catalog/resonatorSeedService'
import { getWpnById } from '@/data/catalog/weaponCatalogService'
import { ATTR_COLORS } from '@/modules/simulation/model/display'
import { getBuildEvaluationTone } from '@/modules/simulation/model/buildEvaluationDisplay'
import { getWeightObj } from '@/data/scoring/charStatWeights'
import { formatTrunc, formatTruncCompact } from '@/shared/lib/number'

// the uid's first digit names the server
export const SERVERS: Record<string, { name: string; code: string }> = {
  5: { name: 'America', code: 'NA' },
  6: { name: 'Europe', code: 'EU' },
  7: { name: 'Asia', code: 'AS' },
  8: { name: 'HMT', code: 'HMT' },
  9: { name: 'SEA', code: 'SEA' },
}

export const resName = (id: string) => getResSeedBy(id)?.name ?? id
export const resFace = (id: string) => getResSeedBy(id)?.profile ?? '/assets/game/default.webp'
export const resAttr = (id: string) => getResSeedBy(id)?.attribute ?? 'physical'
export const resColor = (id: string) => ATTR_COLORS[resAttr(id)] ?? ATTR_COLORS.physical ?? '#8c8c8c'
export const wpnOf = (id: string) => getWpnById(id)

// the base stat a resonator's damage grows with
export type ScaleStat = 'atk' | 'hp' | 'def'
export const SCALE_LABEL: Record<ScaleStat, string> = { atk: 'ATK', hp: 'HP', def: 'DEF' }
// read from the resonator's generated echo weights, so conversions count (Jingran's HP feeds her ATK): the percent
// stat weighted highest, ATK on a tie or with no weights
export function scaleStat(id: string): ScaleStat {
  const w = getWeightObj(id)
  const atk = w.atkPercent ?? 0, hp = w.hpPercent ?? 0, def = w.defPercent ?? 0
  return atk >= hp && atk >= def ? 'atk' : hp >= def ? 'hp' : 'def'
}

// simulation values (damage, stats, scores, shares) are truncated, never rounded up
export const grp = (n: number) => formatTrunc(n)
// a count in a few characters: 940, 2.8k, 14k, 1.4m
export const compact = (n: number) => n >= 1e6 ? `${+(n / 1e6).toFixed(1)}m` : n >= 1e4 ? `${Math.round(n / 1e3)}k` : n >= 1e3 ? `${+(n / 1e3).toFixed(1)}k` : String(n)
export const score1 = (v: number) => `${formatTruncCompact(v, 1)}%`
// the build score's grade colour, matching the card's score
export const scoreInk = (v: number) => ({ color: getBuildEvaluationTone(v).color })
export const pct1 = (v: number) => `${formatTruncCompact(v, 1)}%`
export const cmp = (n: number) => n >= 1e6 ? `${formatTruncCompact(n / 1e6, 2)}M` : n >= 1e3 ? `${formatTruncCompact(n / 1e3, 1)}K` : formatTruncCompact(n, 0)
export const counted = (n: number) => n >= 1000 ? `${Math.round(n / 1000)}K` : String(n)

// a rank as the share of its board above it: "Top 0.25%"
export function topText(rank: number, of: number): string {
  const p = rank / Math.max(1, of) * 100
  return `Top ${p < 0.1 ? p.toFixed(3) : p < 1 ? p.toFixed(2) : p.toFixed(1)}%`
}

export const dayText = (at: number) => new Date(at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

// "4h" / "2d" since a moment
export function agoText(at: number, now = Date.now()): string {
  const m = Math.max(0, Math.round((now - at) / 60000))
  if (m < 60) return `${Math.max(1, m)}m`
  const h = Math.round(m / 60)
  return h < 24 ? `${h}h` : `${Math.round(h / 24)}d`
}

export const regionOf = (uid: string | null, region: string | null) => region ?? (uid ? uid[0] : null)
// a hidden uid has no text at all: nothing says one is being withheld
export const uidText = (uid: string | null) => uid ? `UID ${uid}` : null
export const monthDay = (at: number) => new Date(at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
export const regionCode = (region: string | null) => region && SERVERS[region] ? SERVERS[region].code : null
