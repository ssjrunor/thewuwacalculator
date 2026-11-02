/*
  Author: Runor Ewhro
  description: selects a catalog echo and compatible sonata set by combining
               image and set-icon scores for each candidate.
*/

import type { EchoDef } from '@/domain/entities/catalog'
import { getEchoNamFrmKey, isPhantomKey } from '@/engine/echoParser/imageMap'
import type { ArtAgreement, EchoMatch, SetMatch } from '@/engine/echoParser/imageMatching'

// reference cards support a set-to-art score weight between 4 and 5 at native
// and resized resolutions; 4.5 balances uncertain art against uncertain glyphs.
const SET_WEIGHT = 4.5

// cap the set-score gap because colour-family penalties can dominate soft glyphs.
const SET_GAP_CAP = 0.3

// apply a small penalty to phantom art because pale portraits can match other echoes.
const PHANTOM_PENALTY = 0.1

export interface EchoPick {
  echoName: string
  setName: string
  cost: number
}

export function pickEchoAndSet(
    echoRanks: EchoMatch[],
    setRanks: SetMatch[],
    catalog: EchoDef[],
    setIdByName: Record<string, number>,
    cost: number | null,
): EchoPick | null {
  const bestSet = setRanks[0]?.score
  if (bestSet === undefined || bestSet <= 0) return null
  const setScore = new Map<number, { name: string; score: number }>()
  for (const entry of setRanks) {
    const id = setIdByName[entry.name]
    if (id !== undefined) setScore.set(id, entry)
  }

  // retain every catalog candidate at the measured cost before applying set scores.
  const byName = new Map(catalog.map((echo) => [echo.name, echo]))
  const candidates = echoRanks.flatMap((match) => {
    const echo = byName.get(getEchoNamFrmKey(match.key) ?? '')
    if (!echo || (cost !== null && echo.cost !== cost)) return []
    const score = isPhantomKey(match.key) ? match.score * (1 + PHANTOM_PENALTY) : match.score
    return [{ echo, score }]
  })
  if (candidates.length === 0) return null
  const bestArt = Math.min(...candidates.map((entry) => entry.score))
  if (!(bestArt > 0)) return null

  // compare each echo against its best compatible set using relative score gaps.
  let best: { total: number; echo: EchoDef; set: string } | null = null
  for (const { echo, score } of candidates) {
    const sets = echo.sets.flatMap((id) => {
      const entry = setScore.get(id)
      return entry ? [entry] : []
    })
    if (sets.length === 0) continue
    const set = sets.reduce((left, right) => (right.score < left.score ? right : left))
    const total = (score / bestArt - 1) + SET_WEIGHT * Math.min(SET_GAP_CAP, set.score / bestSet - 1)
    if (!best || total < best.total) best = { total, echo, set: set.name }
  }

  return best ? { echoName: best.echo.name, setName: best.set, cost: best.echo.cost } : null
}

// the ranking always names a winner, so an echo missing from the catalog (a new patch's)
// would import as its nearest neighbour. measured over the reference cards at native, 1280x720
// q45 and 1120x630 q35, true matches never fell below lum 0.38, edge 0.097 or hue 0.08, while a
// catalog with the true echo held out left 102 of 107 winners under these floors; the rest were
// same-silhouette recolours (the herons, the kernel puppets, base and nightmare feilian)
const ART_FLOOR = { lum: 0.28, edge: 0.07, hue: 0 } as const

// whether any form of the picked echo agrees with the panel art well enough to keep it
export function artAgrees(forms: ArtAgreement[]): boolean {
  return forms.some((form) => form.lum >= ART_FLOOR.lum && form.edge >= ART_FLOOR.edge && form.hue >= ART_FLOOR.hue)
}
