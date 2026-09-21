/*
  Author: Runor Ewhro
  Description: Updates picker-frequency state used for recent and frequent
               menu recommendations across pickers.
*/

import type {
  PckrFreqBktS,
  PckrFreqStt,
  PckrFreqUpd,
  PickFreqWeapon,
} from '@/domain/entities/appState'
import {
  PICK_FREQ_WEPS,
} from '@/domain/entities/appState'
import type { ResProf } from '@/domain/entities/profile'
import type { ResRuntime, TeamMemRtVie } from '@/domain/entities/runtime'
import { isNoWeaponId } from '@/domain/entities/runtime'
import { getResSeedBy } from '@/data/catalog/resonatorSeedService'

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function cleanIds(ids: unknown): string[] {
  if (!Array.isArray(ids)) {
    return []
  }

  // keep only stable string ids and preserve first-seen ordering.
  const nextIds: string[] = []

  for (const value of ids) {
    if (typeof value !== 'string' || !value.trim() || nextIds.includes(value)) {
      continue
    }

    nextIds.push(value)
  }

  return nextIds
}

function cleanPositiveInt(value: unknown): number | null {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : null
}

function cleanNonnegativeInt(value: unknown): number | null {
  return Number.isInteger(value) && Number(value) >= 0 ? Number(value) : null
}

function cleanDateString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function cleanId(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function dayKeyFromIso(value: string): string {
  return value.slice(0, 10)
}

function cleanUsesByDay(value: unknown): Record<string, number> {
  if (!isRecord(value)) {
    return {}
  }

  const next: Record<string, number> = {}
  for (const [day, count] of Object.entries(value)) {
    const cleanCount = cleanPositiveInt(count)
    if (!cleanCount || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      continue
    }

    next[day] = cleanCount
  }

  return next
}

function cleanUsesByActiveResonator(value: unknown): Record<string, number> {
  if (!isRecord(value)) {
    return {}
  }

  const next: Record<string, number> = {}
  for (const [resonatorId, count] of Object.entries(value)) {
    const cleanCount = cleanPositiveInt(count)
    if (!cleanCount || !cleanId(resonatorId)) {
      continue
    }

    next[resonatorId] = cleanCount
  }

  return next
}

export function mkEmptyPckrFreqBkt(): PckrFreqBktS {
  return {
    version: 2,
    totalUses: 0,
    firstUsedAt: null,
    lastUsedAt: null,
    order: [],
    items: {},
  }
}

function normV2FreqBkt(value: Record<string, unknown>): PckrFreqBktS {
  const rawItems = isRecord(value.items) ? value.items : {}
  const items: PckrFreqBktS['items'] = {}

  for (const [id, rawItem] of Object.entries(rawItems)) {
    if (!isRecord(rawItem)) {
      continue
    }

    const count = cleanPositiveInt(rawItem.count)
    if (!count) {
      continue
    }

    const firstUsedAt = cleanDateString(rawItem.firstUsedAt)
    const lastUsedAt = cleanDateString(rawItem.lastUsedAt)
    const usesByDay = cleanUsesByDay(rawItem.usesByDay)
    const usesByActiveResonator = cleanUsesByActiveResonator(rawItem.usesByActiveResonator)

    items[id] = {
      id,
      count,
      firstUsedAt,
      lastUsedAt,
      previousUsedAt: cleanDateString(rawItem.previousUsedAt),
      firstUseSeq: cleanNonnegativeInt(rawItem.firstUseSeq) ?? 0,
      lastUseSeq: cleanNonnegativeInt(rawItem.lastUseSeq) ?? 0,
      usesByDay: Object.keys(usesByDay).length > 0
        ? usesByDay
        : lastUsedAt
          ? { [dayKeyFromIso(lastUsedAt)]: count }
          : {},
      firstActiveResonatorId: cleanId(rawItem.firstActiveResonatorId),
      lastActiveResonatorId: cleanId(rawItem.lastActiveResonatorId),
      previousActiveResonatorId: cleanId(rawItem.previousActiveResonatorId),
      usesByActiveResonator,
    }
  }

  const orderedIds = cleanIds(value.order).filter((id) => !!items[id])
  const missingIds = Object.keys(items)
    .filter((id) => !orderedIds.includes(id))
    .sort((left, right) => {
      const seqDelta = items[right].lastUseSeq - items[left].lastUseSeq
      const countDelta = items[right].count - items[left].count
      return seqDelta || countDelta || left.localeCompare(right)
    })
  const order = [...orderedIds, ...missingIds]
  const countTotal = Object.values(items).reduce((sum, item) => sum + item.count, 0)
  const maxSeq = Object.values(items).reduce((max, item) => Math.max(max, item.lastUseSeq), 0)
  const savedTotal = cleanNonnegativeInt(value.totalUses) ?? 0

  return {
    version: 2,
    totalUses: Math.max(savedTotal, countTotal, maxSeq),
    firstUsedAt: cleanDateString(value.firstUsedAt),
    lastUsedAt: cleanDateString(value.lastUsedAt),
    order,
    items,
  }
}

function normLegacyFreqBkt(value: Record<string, unknown>): PckrFreqBktS {
  const counts = isRecord(value.counts) ? value.counts : {}
  const recentIds = cleanIds(value.ids)
  const countedIds = Object.entries(counts)
    .filter(([, count]) => !!cleanPositiveInt(count))
    .map(([id]) => id)
  const order = [
    ...recentIds.filter((id) => countedIds.includes(id)),
    ...countedIds
      .filter((id) => !recentIds.includes(id))
      .sort((left, right) => {
        const countDelta = Number(counts[right] ?? 0) - Number(counts[left] ?? 0)
        return countDelta || left.localeCompare(right)
      }),
  ]
  const items = Object.fromEntries(
    countedIds.map((id, index) => [
      id,
      {
        id,
        count: Number(counts[id]),
        firstUsedAt: null,
        lastUsedAt: null,
        previousUsedAt: null,
        firstUseSeq: index + 1,
        lastUseSeq: index + 1,
        usesByDay: {},
        firstActiveResonatorId: null,
        lastActiveResonatorId: null,
        previousActiveResonatorId: null,
        usesByActiveResonator: {},
      },
    ]),
  )
  const totalUses = countedIds.reduce((sum, id) => sum + Number(counts[id] ?? 0), 0)

  return {
    version: 2,
    totalUses,
    firstUsedAt: null,
    lastUsedAt: null,
    order,
    items,
  }
}

function normalizePckrFreqBkt(
    value: unknown,
    options: { preserveLegacy: boolean },
): PckrFreqBktS {
  if (!isRecord(value)) {
    return mkEmptyPckrFreqBkt()
  }

  if (value.version === 2) {
    return normV2FreqBkt(value)
  }

  return options.preserveLegacy
    ? normLegacyFreqBkt(value)
    : mkEmptyPckrFreqBkt()
}

export function normalizePckrFreqState(value: unknown): PckrFreqStt {
  const raw = isRecord(value) ? value : {}
  const rawWeapons = isRecord(raw.weaponByType) ? raw.weaponByType : {}
  const rawTeamSlots = isRecord(raw.resonatorByTeamSlot) ? raw.resonatorByTeamSlot : {}

  return {
    resonator: normalizePckrFreqBkt(raw.resonator, { preserveLegacy: true }),
    echo: normalizePckrFreqBkt(raw.echo, { preserveLegacy: false }),
    enemy: normalizePckrFreqBkt(raw.enemy, { preserveLegacy: false }),
    weaponByType: {
      broadblade: normalizePckrFreqBkt(rawWeapons.broadblade, { preserveLegacy: false }),
      sword: normalizePckrFreqBkt(rawWeapons.sword, { preserveLegacy: false }),
      pistols: normalizePckrFreqBkt(rawWeapons.pistols, { preserveLegacy: false }),
      gauntlets: normalizePckrFreqBkt(rawWeapons.gauntlets, { preserveLegacy: false }),
      rectifier: normalizePckrFreqBkt(rawWeapons.rectifier, { preserveLegacy: false }),
    },
    resonatorByTeamSlot: {
      active: normalizePckrFreqBkt(rawTeamSlots.active, { preserveLegacy: false }),
      teammate1: normalizePckrFreqBkt(rawTeamSlots.teammate1, { preserveLegacy: false }),
      teammate2: normalizePckrFreqBkt(rawTeamSlots.teammate2, { preserveLegacy: false }),
    },
  }
}

export function mkDefPckrFre(): PckrFreqStt {
  const weaponByType = {
    broadblade: mkEmptyPckrFreqBkt(),
    sword: mkEmptyPckrFreqBkt(),
    pistols: mkEmptyPckrFreqBkt(),
    gauntlets: mkEmptyPckrFreqBkt(),
    rectifier: mkEmptyPckrFreqBkt(),
  }
  const resByTeamSlo = {
    active: mkEmptyPckrFreqBkt(),
    teammate1: mkEmptyPckrFreqBkt(),
    teammate2: mkEmptyPckrFreqBkt(),
  }

  return {
    resonator: mkEmptyPckrFreqBkt(),
    echo: mkEmptyPckrFreqBkt(),
    enemy: mkEmptyPckrFreqBkt(),
    weaponByType,
    resonatorByTeamSlot: resByTeamSlo,
  }
}

function mrgBktStt(
  current: PckrFreqBktS,
  incoming: string[],
  activeResonatorId: string | null = null,
): PckrFreqBktS {
  const rdrdNcmn = cleanIds(incoming)
  const contextResonatorId = cleanId(activeResonatorId)

  if (rdrdNcmn.length === 0) {
    return current
  }

  const usedAt = new Date().toISOString()
  // New picks move to the front while older picks keep their relative order.
  // Unlike the old structure, this list is intentionally uncapped.
  const nextOrder = [
    ...rdrdNcmn,
    ...current.order.filter((value) => !rdrdNcmn.includes(value)),
  ]
  const nextItems = { ...current.items }
  let totalUses = current.totalUses
  const usedDay = dayKeyFromIso(usedAt)

  for (const id of rdrdNcmn) {
    const currentItem = current.items[id]
    const nextSeq = totalUses + 1
    totalUses = nextSeq
    const usesByActiveResonator = { ...(currentItem?.usesByActiveResonator ?? {}) }
    if (contextResonatorId) {
      usesByActiveResonator[contextResonatorId] = (usesByActiveResonator[contextResonatorId] ?? 0) + 1
    }

    nextItems[id] = {
      id,
      count: (currentItem?.count ?? 0) + 1,
      firstUsedAt: currentItem?.firstUsedAt ?? usedAt,
      lastUsedAt: usedAt,
      previousUsedAt: currentItem?.lastUsedAt ?? null,
      firstUseSeq: currentItem?.firstUseSeq ?? nextSeq,
      lastUseSeq: nextSeq,
      usesByDay: {
        ...(currentItem?.usesByDay ?? {}),
        [usedDay]: (currentItem?.usesByDay?.[usedDay] ?? 0) + 1,
      },
      firstActiveResonatorId: currentItem?.firstActiveResonatorId ?? contextResonatorId,
      lastActiveResonatorId: contextResonatorId ?? currentItem?.lastActiveResonatorId ?? null,
      previousActiveResonatorId: contextResonatorId
        ? currentItem?.lastActiveResonatorId ?? null
        : currentItem?.previousActiveResonatorId ?? null,
      usesByActiveResonator,
    }
  }

  return {
    version: 2,
    totalUses,
    firstUsedAt: current.firstUsedAt ?? usedAt,
    lastUsedAt: usedAt,
    order: nextOrder,
    items: nextItems,
  }
}

export function applyPckrFre(
    state: PckrFreqStt,
    updates: PckrFreqUpd[],
): PckrFreqStt {
  let nextState = state

  // preserve object identity for buckets that do not change so store selectors
  // avoid rerendering picker surfaces on unrelated runtime edits.
  for (const update of updates) {
    switch (update.bucket) {
      case 'resonator': {
        const nextBucket = mrgBktStt(nextState.resonator, update.ids)
        if (nextBucket === nextState.resonator) {
          continue
        }

        nextState = {
          ...nextState,
          resonator: nextBucket,
        }
        break
      }
      case 'echo': {
        const nextBucket = mrgBktStt(nextState.echo, update.ids, update.activeResonatorId ?? null)
        if (nextBucket === nextState.echo) {
          continue
        }

        nextState = {
          ...nextState,
          echo: nextBucket,
        }
        break
      }
      case 'enemy': {
        const nextBucket = mrgBktStt(nextState.enemy, update.ids, update.activeResonatorId ?? null)
        if (nextBucket === nextState.enemy) {
          continue
        }

        nextState = {
          ...nextState,
          enemy: nextBucket,
        }
        break
      }
      case 'weapon': {
        const current = nextState.weaponByType[update.weaponType]
        const nextBucket = mrgBktStt(current, update.ids, update.activeResonatorId ?? null)
        if (nextBucket === current) {
          continue
        }

        nextState = {
          ...nextState,
          weaponByType: {
            ...nextState.weaponByType,
            [update.weaponType]: nextBucket,
          },
        }
        break
      }
      case 'teamResonator': {
        const current = nextState.resonatorByTeamSlot[update.slot]
        const nextBucket = mrgBktStt(current, update.ids, update.activeResonatorId ?? null)
        if (nextBucket === current) {
          continue
        }

        nextState = {
          ...nextState,
          resonatorByTeamSlot: {
            ...nextState.resonatorByTeamSlot,
            [update.slot]: nextBucket,
          },
        }
      }
    }
  }

  return nextState
}

function mapWpnTypeTo(
    weaponType: number | null | undefined,
): PickFreqWeapon | null {
  switch (weaponType) {
    case 1:
      return 'broadblade'
    case 2:
      return 'sword'
    case 3:
      return 'pistols'
    case 4:
      return 'gauntlets'
    case 5:
      return 'rectifier'
    default:
      return null
  }
}

function mkChngEchoId(
    prevEchoes: Array<{ id: string } | null>,
    nextEchoes: Array<{ id: string } | null>,
): string[] {
  // only newly-equipped ids are recorded; rearranging the same echo between
  // slots should not make it appear more frequently picked.
  const nextIds: string[] = []
  const maxLength = Math.max(prevEchoes.length, nextEchoes.length)

  for (let index = 0; index < maxLength; index += 1) {
    const prevId = prevEchoes[index]?.id ?? null
    const nextId = nextEchoes[index]?.id ?? null

    if (!nextId || nextId === prevId || nextIds.includes(nextId)) {
      continue
    }

    nextIds.push(nextId)
  }

  return nextIds
}

function mybMkWpnUpd(
    resonatorId: string,
    prevWeaponId: string | null,
    nextWeaponId: string | null,
): PckrFreqUpd | null {
  if (!nextWeaponId || isNoWeaponId(nextWeaponId) || nextWeaponId === prevWeaponId) {
    return null
  }

  const seed = getResSeedBy(resonatorId)
  const weaponType = mapWpnTypeTo(seed?.weaponType)

  if (!weaponType) {
    return null
  }

  return {
    bucket: 'weapon',
    weaponType,
    ids: [nextWeaponId],
  }
}

export function mkRtPckrFreq(
    prev: ResRuntime,
    next: ResRuntime,
): PckrFreqUpd[] {
  const updates: PckrFreqUpd[] = []
  const weaponUpdate = mybMkWpnUpd(next.id, prev.build.weapon.id, next.build.weapon.id)

  if (weaponUpdate) {
    updates.push(weaponUpdate)
  }

  const nextEchoIds = mkChngEchoId(prev.build.echoes, next.build.echoes)
  if (nextEchoIds.length > 0) {
    updates.push({
      bucket: 'echo',
      ids: nextEchoIds,
    })
  }

  if (next.build.team[1] && next.build.team[1] !== prev.build.team[1]) {
    updates.push({
      bucket: 'teamResonator',
      slot: 'teammate1',
      ids: [next.build.team[1]],
    })
  }

  if (next.build.team[2] && next.build.team[2] !== prev.build.team[2]) {
    updates.push({
      bucket: 'teamResonator',
      slot: 'teammate2',
      ids: [next.build.team[2]],
    })
  }

  return updates
}

export function mkTeamMemVie(
    resonatorId: string,
    prev: TeamMemRtVie,
    next: TeamMemRtVie,
): PckrFreqUpd[] {
  const updates: PckrFreqUpd[] = []
  const weaponUpdate = mybMkWpnUpd(resonatorId, prev.build.weapon.id, next.build.weapon.id)

  if (weaponUpdate) {
    updates.push(weaponUpdate)
  }

  const nextEchoIds = mkChngEchoId(prev.build.echoes, next.build.echoes)
  if (nextEchoIds.length > 0) {
    updates.push({
      bucket: 'echo',
      ids: nextEchoIds,
    })
  }

  return updates
}

export function mkProfPckrFr(
    profiles: ResProf[],
): PckrFreqUpd[] {
  const resonatorIds: string[] = []
  const actSlotIds: string[] = []
  const teammate1Ids: string[] = []
  const teammate2Ids: string[] = []
  const echoIds: string[] = []
  const wpnIdsByType: Record<PickFreqWeapon, string[]> = {
    broadblade: [],
    sword: [],
    pistols: [],
    gauntlets: [],
    rectifier: [],
  }

  // profile backfills should count a saved id once per import pass, not once
  // per slot traversal, so each target list is deduped locally.
  const pushUnique = (target: string[], id: string | null | undefined) => {
    if (!id || target.includes(id)) {
      return
    }

    target.push(id)
  }

  for (const profile of profiles) {
    pushUnique(resonatorIds, profile.resonatorId)
    pushUnique(actSlotIds, profile.resonatorId)

    const actWpnUpd = mybMkWpnUpd(
      profile.resonatorId,
      null,
      profile.runtime.build.weapon.id,
    )
    if (actWpnUpd?.bucket === 'weapon') {
      for (const id of actWpnUpd.ids) {
        pushUnique(wpnIdsByType[actWpnUpd.weaponType], id)
      }
    }

    for (const id of mkChngEchoId([], profile.runtime.build.echoes)) {
      pushUnique(echoIds, id)
    }

    for (const [slotKey, slotIndex] of [['teammate1', 0], ['teammate2', 1]] as const) {
      const teammateId = profile.runtime.team[slotIndex + 1] ?? profile.runtime.teamRuntimes[slotIndex]?.id ?? null
      pushUnique(slotKey === 'teammate1' ? teammate1Ids : teammate2Ids, teammateId)

      const compactRuntime = profile.runtime.teamRuntimes[slotIndex]
      if (!compactRuntime) {
        continue
      }

      const mateWpnUpd = mybMkWpnUpd(
        compactRuntime.id,
        null,
        compactRuntime.build.weapon.id,
      )
      if (mateWpnUpd?.bucket === 'weapon') {
        for (const id of mateWpnUpd.ids) {
          pushUnique(wpnIdsByType[mateWpnUpd.weaponType], id)
        }
      }

      for (const id of mkChngEchoId([], compactRuntime.build.echoes)) {
        pushUnique(echoIds, id)
      }
    }
  }

  const updates: PckrFreqUpd[] = []

  if (resonatorIds.length > 0) {
    updates.push({
      bucket: 'resonator',
      ids: resonatorIds,
    })
  }

  if (actSlotIds.length > 0) {
    updates.push({
      bucket: 'teamResonator',
      slot: 'active',
      ids: actSlotIds,
    })
  }

  if (teammate1Ids.length > 0) {
    updates.push({
      bucket: 'teamResonator',
      slot: 'teammate1',
      ids: teammate1Ids,
    })
  }

  if (teammate2Ids.length > 0) {
    updates.push({
      bucket: 'teamResonator',
      slot: 'teammate2',
      ids: teammate2Ids,
    })
  }

  for (const weaponType of PICK_FREQ_WEPS) {
    if (wpnIdsByType[weaponType].length === 0) {
      continue
    }

    updates.push({
      bucket: 'weapon',
      weaponType,
      ids: wpnIdsByType[weaponType],
    })
  }

  if (echoIds.length > 0) {
    updates.push({
      bucket: 'echo',
      ids: echoIds,
    })
  }

  return updates
}
