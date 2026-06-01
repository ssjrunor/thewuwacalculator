/*
  Author: Runor Ewhro
  Description: Orders resonator picker entries and resolves recommendation
               badges from recent and frequent usage history.
*/

import type { ResMenuEnt } from '@/domain/entities/resonator'

type ResRcmmKind = 'last-active' | 'frequent'
const MAXFRQNRCMM = 2
const MAXLASTACTRC = 2
const MIN_FRQN_CNT = 5

export interface ResRcmm {
  kind: ResRcmmKind
  label: string
}

function getRcmmFrqnI(
  frequentIds: string[],
  frqnCnts: Record<string, number>,
): string[] {
  return frequentIds
    .filter((id) => (frqnCnts[id] ?? 0) >= MIN_FRQN_CNT)
    .slice(0, MAXFRQNRCMM)
}

function getRcmmLastU(lastUsedIds: string[]): string[] {
  return lastUsedIds.slice(0, MAXLASTACTRC)
}

function mkRcmmRankMa(
  lastUsedIds: string[],
  frequentIds: string[],
  frqnCnts: Record<string, number>,
): Map<string, number> {
  const rankById = new Map<string, number>()

  for (const id of getRcmmFrqnI(frequentIds, frqnCnts)) {
    if (!rankById.has(id)) {
      rankById.set(id, rankById.size)
    }
  }

  for (const id of getRcmmLastU(lastUsedIds)) {
    if (!rankById.has(id)) {
      rankById.set(id, rankById.size)
    }
  }

  return rankById
}

export function getRecs(
  resonatorId: string,
  lastUsedIds: string[],
  frequentIds: string[],
  frqnCnts: Record<string, number>,
): ResRcmm[] {
  const rcmm: ResRcmm[] = []

  if (getRcmmFrqnI(frequentIds, frqnCnts).includes(resonatorId)) {
    const count = frqnCnts[resonatorId] ?? 0
    rcmm.push({
      kind: 'frequent',
      label: `Active ${count === 1 ? 'once' : count === 2 ? 'twice' : `${count} times`}`,
    })
  }

  if (getRcmmLastU(lastUsedIds).includes(resonatorId)) {
    rcmm.push({
      kind: 'last-active',
      label: 'Last active',
    })
  }

  return rcmm
}

export function orderRecs(
  resonators: ResMenuEnt[],
  rcmmMenuTms: boolean,
  lastUsedIds: string[],
  frequentIds: string[],
  frqnCnts: Record<string, number>,
): ResMenuEnt[] {
  if (!rcmmMenuTms || (lastUsedIds.length === 0 && frequentIds.length === 0)) {
    return resonators
  }

  const rankById = mkRcmmRankMa(lastUsedIds, frequentIds, frqnCnts)

  return resonators
    .map((entry, index) => ({
      entry,
      index,
      rank: rankById.get(entry.id) ?? Number.POSITIVE_INFINITY,
    }))
    .sort((a, b) => {
      if (a.rank !== b.rank) {
        return a.rank - b.rank
      }

      return a.index - b.index
    })
    .map(({ entry }) => entry)
}
