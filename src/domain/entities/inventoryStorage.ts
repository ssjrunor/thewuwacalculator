/*
  Author: Runor Ewhro
  Description: Defines inventory storage entities and helper utilities for
               cloning, comparing, and creating saved echoes, builds, and rotations.
*/

import type { EchoInstance, ResonatorId, TeamSlots, WeaponState } from './runtime'
import type { ResProf } from './profile'
import type { RotationNode } from '@/domain/gameData/contracts'
import { makeEchoUid } from './runtime'

export interface InvEchoEnt {
  id: string
  echo: EchoInstance
  createdAt: number
  updatedAt: number
}

export interface SavedBuildSnap {
  weapon: WeaponState
  echoes: Array<EchoInstance | null>
}

export interface InventoryEntry {
  id: string
  name: string
  resonatorId: ResonatorId
  resonatorName: string
  build: SavedBuildSnap
  createdAt: number
  updatedAt: number
}

export interface DmgTtlsSnap {
  normal: number
  avg: number
  crit: number
}

export interface TeamMemCntr {
  id: ResonatorId
  name: string
  contribution: DmgTtlsSnap
}

export interface RotEntSmmr {
  total: DmgTtlsSnap
  members?: TeamMemCntr[]
}

export interface InvRotEnt {
  id: string
  name: string
  mode: 'personal' | 'team'
  resonatorId: ResonatorId
  resonatorName: string
  duration: number
  note: string
  team?: TeamSlots
  items: RotationNode[]
  snapshot?: ResProf
  summary?: RotEntSmmr
  createdAt: number
  updatedAt: number
}

// memoized comparison signatures
const echoCmprSigC = new WeakMap<EchoInstance, string>()
const echoLdtSigCc = new WeakMap<Array<EchoInstance | null>, string>()
const buildSigCache = new WeakMap<SavedBuildSnap, string>()

// create a storage-safe unique id
function makeStoreId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

// clone an echo instance and optionally force its main slot flag
function cloneEchoNst(echo: EchoInstance, slotIndex?: number): EchoInstance {
  return {
    uid: echo.uid ?? makeEchoUid(),
    id: echo.id,
    set: echo.set,
    mainEcho: slotIndex != null ? slotIndex === 0 : echo.mainEcho,
    mainStats: {
      primary: { ...echo.mainStats.primary },
      secondary: { ...echo.mainStats.secondary },
    },
    substats: { ...echo.substats },
  }
}

// create a unique rotation node id
function makeRotNodeId(prefix = 'rotation'): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}:${crypto.randomUUID()}`
  }

  return `${prefix}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 10)}`
}

// deep clone rotation nodes and optionally regenerate ids
export function cloneRotNds(
    items: RotationNode[],
    options?: { freshIds?: boolean },
): RotationNode[] {
  const loopIdMap = new Map<string, string>()
  const getFrshLoopI = (loopId: string): string => {
    if (!options?.freshIds) {
      return loopId
    }

    const existing = loopIdMap.get(loopId)
    if (existing) {
      return existing
    }

    const nextLoopId = makeRotNodeId('rotation:loop')
    loopIdMap.set(loopId, nextLoopId)
    return nextLoopId
  }

  const cloneNodes = (nodes: RotationNode[]): RotationNode[] => nodes.map((node) => {
    const clonedNode = structuredClone(node) as RotationNode
    const nextId = options?.freshIds ? makeRotNodeId(clonedNode.type) : clonedNode.id
    delete (clonedNode as { condition?: unknown }).condition

    if (clonedNode.type === 'feature') {
      return {
        ...clonedNode,
        id: nextId,
      }
    }

    if (clonedNode.type === 'condition') {
      return {
        ...clonedNode,
        id: nextId,
      }
    }

    if (clonedNode.type === 'repeat') {
      return {
        ...clonedNode,
        id: nextId,
        items: cloneNodes(clonedNode.items),
      }
    }

    if (clonedNode.type === 'loop') {
      const loopId = getFrshLoopI(clonedNode.loopId)
      return {
        ...clonedNode,
        id: nextId,
        loopId,
      }
    }

    return {
      ...clonedNode,
      id: nextId,
      setup: clonedNode.setup ? cloneNodes(clonedNode.setup) : clonedNode.setup,
      items: cloneNodes(clonedNode.items),
    }
  })

  return cloneNodes(items)
}

// clone an echo for a specific slot
export function cloneEchoFor(echo: EchoInstance, slotIndex: number): EchoInstance {
  return cloneEchoNst(echo, slotIndex)
}

// compare echoes by uid only
export function areSameEchoN(
    left: EchoInstance | null | undefined,
    right: EchoInstance | null | undefined,
): boolean {
  if (left === right) {
    return true
  }

  if (!left || !right) {
    return false
  }

  return left.uid === right.uid
}

// clone an entire echo loadout
export function cloneEchoLdt(echoes: Array<EchoInstance | null>): Array<EchoInstance | null> {
  return echoes.map((echo, index) => (echo ? cloneEchoNst(echo, index) : null))
}

// clone a saved build snapshot
export function cloneBuildSnap(build: SavedBuildSnap): SavedBuildSnap {
  return {
    weapon: { ...build.weapon },
    echoes: cloneEchoLdt(build.echoes),
  }
}

// keep saved rotation duration numeric and treat non-positive values as unset
export function normInvRotDu(value: unknown): number {
  const numericValue = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numericValue) && numericValue > 0 ? numericValue : 0
}

// keep saved rotation notes string-backed without forcing trimmed content
export function normInvRotNo(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

// build a comparable signature for an echo
function normCmprEcho(echo: EchoInstance) {
  const cached = echoCmprSigC.get(echo)
  if (cached) {
    return cached
  }

  const sbstSig = Object.keys(echo.substats)
      .sort((left, right) => left.localeCompare(right))
      .map((key) => `${key}:${echo.substats[key]}`)
      .join('|')

  const signature = [
    echo.id,
    echo.set,
    `${echo.mainStats.primary.key}:${echo.mainStats.primary.value}`,
    `${echo.mainStats.secondary.key}:${echo.mainStats.secondary.value}`,
    sbstSig,
  ].join('::')

  echoCmprSigC.set(echo, signature)
  return signature
}

// build a comparable signature for an echo loadout
function getEchoLdtSi(echoes: Array<EchoInstance | null>): string {
  const cached = echoLdtSigCc.get(echoes)
  if (cached) {
    return cached
  }

  const signature = echoes
      .filter((echo): echo is EchoInstance => echo != null)
      .map((echo) => normCmprEcho(echo))
      .sort()
      .join('||')

  echoLdtSigCc.set(echoes, signature)
  return signature
}

// build a comparable signature for a saved build
export function getBuildSig(build: SavedBuildSnap): string {
  const cached = buildSigCache.get(build)
  if (cached) {
    return cached
  }

  const signature = [
    build.weapon.id ?? '',
    build.weapon.level,
    build.weapon.rank,
    getEchoLdtSi(build.echoes),
  ].join('::')

  buildSigCache.set(build, signature)
  return signature
}

// compare two echo instances by their comparable fields
export function areEchoNstnQ(
    left: EchoInstance | null | undefined,
    right: EchoInstance | null | undefined,
): boolean {
  if (left === right) {
    return true
  }

  if (!left || !right) {
    return false
  }

  return normCmprEcho(left) === normCmprEcho(right)
}

// compare two saved build snapshots
export function areMkSnpsQvl(
    left: SavedBuildSnap,
    right: SavedBuildSnap,
): boolean {
  return getBuildSig(left) === getBuildSig(right)
}

// returns the entries with uids made unique within the bag. a uid identifies one
// physical echo, and loadout slots reference their inventory echo by uid (see
// mkInvEchoSgB). when entries share a uid, the one whose stats match an equipped
// loadout echo keeps it and the rest receive new uids.
export function dedupeInvEchoUids(
    entries: InvEchoEnt[],
    equippedEchoes?: Iterable<EchoInstance | null | undefined>,
): InvEchoEnt[] {
  const idxByUid = new Map<string, number[]>()
  entries.forEach((entry, index) => {
    const uid = entry.echo.uid
    if (!uid) {
      return
    }
    const list = idxByUid.get(uid)
    if (list) {
      list.push(index)
    } else {
      idxByUid.set(uid, [index])
    }
  })

  const hasCollision = entries.some((entry) => !entry.echo.uid)
    || Array.from(idxByUid.values()).some((indexes) => indexes.length > 1)
  if (!hasCollision) {
    return entries
  }

  // map each equipped uid to the stat signatures actually equipped under it so
  // the kept entry stays the one a loadout points at.
  const equippedSigByUid = new Map<string, Set<string>>()
  for (const echo of equippedEchoes ?? []) {
    if (!echo?.uid) {
      continue
    }
    const sigs = equippedSigByUid.get(echo.uid)
    const signature = normCmprEcho(echo)
    if (sigs) {
      sigs.add(signature)
    } else {
      equippedSigByUid.set(echo.uid, new Set([signature]))
    }
  }

  const keepIndexByUid = new Map<string, number>()
  for (const [uid, indexes] of idxByUid) {
    if (indexes.length === 1) {
      keepIndexByUid.set(uid, indexes[0])
      continue
    }
    const equippedSigs = equippedSigByUid.get(uid)
    const preferred = equippedSigs
      ? indexes.find((index) => equippedSigs.has(normCmprEcho(entries[index].echo)))
      : undefined
    keepIndexByUid.set(uid, preferred ?? indexes[0])
  }

  const usedUids = new Set<string>()
  return entries.map((entry, index) => {
    const uid = entry.echo.uid
    if (uid && keepIndexByUid.get(uid) === index && !usedUids.has(uid)) {
      usedUids.add(uid)
      return entry
    }

    let freshUid = makeEchoUid()
    while (usedUids.has(freshUid)) {
      freshUid = makeEchoUid()
    }
    usedUids.add(freshUid)
    return { ...entry, echo: { ...entry.echo, uid: freshUid } }
  })
}

// create an inventory echo entry
export function makeInvEcho(echo: EchoInstance, now = Date.now()): InvEchoEnt {
  return {
    id: makeStoreId(),
    echo: cloneEchoNst(echo),
    createdAt: now,
    updatedAt: now,
  }
}

// create an inventory build entry
export function makeInvBuild(input: {
  name: string
  resonatorId: ResonatorId
  resonatorName: string
  build: SavedBuildSnap
}, now = Date.now()): InventoryEntry {
  return {
    id: makeStoreId(),
    name: input.name,
    resonatorId: input.resonatorId,
    resonatorName: input.resonatorName,
    build: cloneBuildSnap(input.build),
    createdAt: now,
    updatedAt: now,
  }
}

// create an inventory rotation entry
export function makeInvRot(input: {
  name: string
  mode: 'personal' | 'team'
  resonatorId: ResonatorId
  resonatorName: string
  duration?: number
  note?: string
  team?: TeamSlots
  items: RotationNode[]
  snapshot?: ResProf
  summary?: RotEntSmmr
}, now = Date.now()): InvRotEnt {
  return {
    id: makeStoreId(),
    name: input.name,
    mode: input.mode,
    resonatorId: input.resonatorId,
    resonatorName: input.resonatorName,
    duration: normInvRotDu(input.duration),
    note: normInvRotNo(input.note),
    ...(input.team ? { team: [...input.team] as TeamSlots } : {}),
    items: cloneRotNds(input.items),
    ...(input.snapshot ? { snapshot: structuredClone(input.snapshot) } : {}),
    ...(input.summary ? { summary: structuredClone(input.summary) } : {}),
    createdAt: now,
    updatedAt: now,
  }
}

// check whether a build snapshot is effectively empty
export function isEmptyBuild(build: SavedBuildSnap): boolean {
  return build.echoes.every((echo) => echo == null) && (build.weapon.id == null || build.weapon.id === '0')
}
