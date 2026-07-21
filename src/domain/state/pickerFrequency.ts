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
  PICK_FREQ_MAX,
  PICK_FREQ_WEPS,
} from '@/domain/entities/appState'
import type { ResProf } from '@/domain/entities/profile'
import type { ResRuntime, TeamMemRtVie } from '@/domain/entities/runtime'
import { isNoWeaponId } from '@/domain/entities/runtime'
import { getResSeedBy } from '@/domain/services/resonatorSeedService'

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

    if (nextIds.length >= PICK_FREQ_MAX) {
      break
    }
  }

  return nextIds
}

function makeEmptyBucket(): PckrFreqBktS {
  return {
    ids: [],
    counts: {},
  }
}

export function mkDefPckrFre(): PckrFreqStt {
  const weaponByType = {
    broadblade: makeEmptyBucket(),
    sword: makeEmptyBucket(),
    pistols: makeEmptyBucket(),
    gauntlets: makeEmptyBucket(),
    rectifier: makeEmptyBucket(),
  }
  const resByTeamSlo = {
    active: makeEmptyBucket(),
    teammate1: makeEmptyBucket(),
    teammate2: makeEmptyBucket(),
  }

  return {
    resonator: makeEmptyBucket(),
    echo: makeEmptyBucket(),
    enemy: makeEmptyBucket(),
    weaponByType,
    resonatorByTeamSlot: resByTeamSlo,
  }
}

function mrgBktStt(
  current: PckrFreqBktS,
  incoming: string[],
): PckrFreqBktS {
  const rdrdNcmn = cleanIds(incoming)

  if (rdrdNcmn.length === 0) {
    return current
  }

  // New picks move to the front while older picks keep their relative order.
  // Counts are intentionally kept beyond this short recent list so frequent
  // picks do not reset when a few other items are selected.
  const nextIds = [
    ...rdrdNcmn,
    ...current.ids.filter((value) => !rdrdNcmn.includes(value)),
  ].slice(0, PICK_FREQ_MAX)
  const nextCounts = { ...current.counts }

  for (const id of rdrdNcmn) {
    nextCounts[id] = (nextCounts[id] ?? 0) + 1
  }

  const idsUnchanged =
    nextIds.length === current.ids.length && nextIds.every((value, index) => value === current.ids[index])
  const cntsNchn =
    Object.keys(nextCounts).length === Object.keys(current.counts).length
    && Object.entries(nextCounts).every(([id, count]) => current.counts[id] === count)

  return idsUnchanged && cntsNchn
    ? current
    : {
      ids: nextIds,
      counts: nextCounts,
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
        const nextBucket = mrgBktStt(nextState.echo, update.ids)
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
        const nextBucket = mrgBktStt(nextState.enemy, update.ids)
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
        const nextBucket = mrgBktStt(current, update.ids)
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
        const nextBucket = mrgBktStt(current, update.ids)
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
