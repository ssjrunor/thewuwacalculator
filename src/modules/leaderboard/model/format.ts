/*
  Author: Runor Ewhro
  description: the leaderboard's names, faces and number formats: resonators
               come from the seed catalog, regions from the uid's first digit.
*/

import { getResSeedBy } from '@/data/catalog/resonatorSeedService'
import { getWpnById } from '@/data/catalog/weaponCatalogService'
import { ATTR_COLORS } from '@/modules/simulation/model/display'
import { getBuildEvaluationTone } from '@/modules/simulation/model/buildEvaluationDisplay'

/** the uid's first digit names the server. */
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

export const grp = (n: number) => Math.round(n).toLocaleString('en-US')
/** a count in a few characters: 940, 2.8k, 14k, 1.4m. */
export const compact = (n: number) => n >= 1e6 ? `${+(n / 1e6).toFixed(1)}m` : n >= 1e4 ? `${Math.round(n / 1e3)}k` : n >= 1e3 ? `${+(n / 1e3).toFixed(1)}k` : String(n)
export const score1 = (v: number) => `${v.toFixed(1)}%`
/** the build score's grade colour, matching the card's score. */
export const scoreInk = (v: number) => ({ color: getBuildEvaluationTone(v).color })
export const pct1 = (v: number) => `${(Math.floor(v * 10) / 10).toFixed(1)}%`
export const cmp = (n: number) => n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(Math.round(n))
export const counted = (n: number) => n >= 1000 ? `${Math.round(n / 1000)}K` : String(n)

/** a rank as the share of its board above it: "Top 0.25%". */
export function topText(rank: number, of: number): string {
  const p = rank / Math.max(1, of) * 100
  return `Top ${p < 0.1 ? p.toFixed(3) : p < 1 ? p.toFixed(2) : p.toFixed(1)}%`
}

export const dayText = (at: number) => new Date(at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

/** "4h" / "2d" since a moment. */
export function agoText(at: number, now = Date.now()): string {
  const m = Math.max(0, Math.round((now - at) / 60000))
  if (m < 60) return `${Math.max(1, m)}m`
  const h = Math.round(m / 60)
  return h < 24 ? `${h}h` : `${Math.round(h / 24)}d`
}

export const regionOf = (uid: string | null, region: string | null) => region ?? (uid ? uid[0] : null)
/** a hidden uid has no text at all: nothing says one is being withheld. */
export const uidText = (uid: string | null) => uid ? `UID ${uid}` : null
export const monthDay = (at: number) => new Date(at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
export const regionCode = (region: string | null) => region && SERVERS[region] ? SERVERS[region].code : null
