/*
  Author: Runor Ewhro
  Description: Defines inventory storage entities and helper utilities for
               cloning, comparing, and creating saved echoes, builds, and rotations.
*/

import type { EchoInstance, ResonatorId, TeamSlots, WeaponBuildState } from './runtime'
import type { ResonatorProfile } from './profile'
import type { RotationNode } from '@/domain/gameData/contracts'
import { createEchoUid } from './runtime'

export interface InventoryEchoEntry {
  id: string
  echo: EchoInstance
  createdAt: number
  updatedAt: number
}

export interface SavedBuildSnapshot {
  weapon: WeaponBuildState
  echoes: Array<EchoInstance | null>
}

export interface InventoryBuildEntry {
  id: string
  name: string
  resonatorId: ResonatorId
  resonatorName: string
  build: SavedBuildSnapshot
  createdAt: number
  updatedAt: number
}

export interface DamageTotalsSnapshot {
  normal: number
  avg: number
  crit: number
}

export interface TeamMemberContribution {
  id: ResonatorId
  name: string
  contribution: DamageTotalsSnapshot
}

export interface RotationEntrySummary {
  total: DamageTotalsSnapshot
  members?: TeamMemberContribution[]
}

export interface InventoryRotationEntry {
  id: string
  name: string
  mode: 'personal' | 'team'
  resonatorId: ResonatorId
  resonatorName: string
  team?: TeamSlots
  items: RotationNode[]
  snapshot?: ResonatorProfile
  summary?: RotationEntrySummary
  createdAt: number
  updatedAt: number
}

// memoized comparison signatures
const echoComparisonSignatureCache = new WeakMap<EchoInstance, string>()
const echoLoadoutSignatureCache = new WeakMap<Array<EchoInstance | null>, string>()
const buildSnapshotSignatureCache = new WeakMap<SavedBuildSnapshot, string>()

// create a storage-safe unique id
function createStorageId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

// clone an echo instance and optionally force its main slot flag
function cloneEchoInstance(echo: EchoInstance, slotIndex?: number): EchoInstance {
  return {
    uid: echo.uid ?? createEchoUid(),
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
function createRotationNodeId(prefix = 'rotation'): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}:${crypto.randomUUID()}`
  }

  return `${prefix}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 10)}`
}

// deep clone rotation nodes and optionally regenerate ids
export function cloneRotationNodes(
    items: RotationNode[],
    options?: { freshIds?: boolean },
): RotationNode[] {
  return items.map((node) => {
    const clonedNode = structuredClone(node) as RotationNode
    const nextId = options?.freshIds ? createRotationNodeId(clonedNode.type) : clonedNode.id
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
        items: cloneRotationNodes(clonedNode.items, options),
      }
    }

    return {
      ...clonedNode,
      id: nextId,
      setup: clonedNode.setup ? cloneRotationNodes(clonedNode.setup, options) : clonedNode.setup,
      items: cloneRotationNodes(clonedNode.items, options),
    }
  })
}

// clone an echo for a specific slot
export function cloneEchoForSlot(echo: EchoInstance, slotIndex: number): EchoInstance {
  return cloneEchoInstance(echo, slotIndex)
}

// compare echoes by uid only
export function areSameEchoInstance(
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
export function cloneEchoLoadout(echoes: Array<EchoInstance | null>): Array<EchoInstance | null> {
  return echoes.map((echo, index) => (echo ? cloneEchoInstance(echo, index) : null))
}

// clone a saved build snapshot
export function cloneBuildSnapshot(build: SavedBuildSnapshot): SavedBuildSnapshot {
  return {
    weapon: { ...build.weapon },
    echoes: cloneEchoLoadout(build.echoes),
  }
}

// build a comparable signature for an echo
function normalizeComparableEcho(echo: EchoInstance) {
  const cached = echoComparisonSignatureCache.get(echo)
  if (cached) {
    return cached
  }

  const substatSignature = Object.keys(echo.substats)
      .sort((left, right) => left.localeCompare(right))
      .map((key) => `${key}:${echo.substats[key]}`)
      .join('|')

  const signature = [
    echo.id,
    echo.set,
    `${echo.mainStats.primary.key}:${echo.mainStats.primary.value}`,
    `${echo.mainStats.secondary.key}:${echo.mainStats.secondary.value}`,
    substatSignature,
  ].join('::')

  echoComparisonSignatureCache.set(echo, signature)
  return signature
}

// build a comparable signature for an echo loadout
function getEchoLoadoutSignature(echoes: Array<EchoInstance | null>): string {
  const cached = echoLoadoutSignatureCache.get(echoes)
  if (cached) {
    return cached
  }

  const signature = echoes
      .filter((echo): echo is EchoInstance => echo != null)
      .map((echo) => normalizeComparableEcho(echo))
      .sort()
      .join('||')

  echoLoadoutSignatureCache.set(echoes, signature)
  return signature
}

// build a comparable signature for a saved build
export function getBuildSnapshotSignature(build: SavedBuildSnapshot): string {
  const cached = buildSnapshotSignatureCache.get(build)
  if (cached) {
    return cached
  }

  const signature = [
    build.weapon.id ?? '',
    build.weapon.level,
    build.weapon.rank,
    build.weapon.baseAtk,
    getEchoLoadoutSignature(build.echoes),
  ].join('::')

  buildSnapshotSignatureCache.set(build, signature)
  return signature
}

// compare two echo instances by their comparable fields
export function areEchoInstancesEquivalent(
    left: EchoInstance | null | undefined,
    right: EchoInstance | null | undefined,
): boolean {
  if (left === right) {
    return true
  }

  if (!left || !right) {
    return false
  }

  return normalizeComparableEcho(left) === normalizeComparableEcho(right)
}

// compare two saved build snapshots
export function areBuildSnapshotsEquivalent(
    left: SavedBuildSnapshot,
    right: SavedBuildSnapshot,
): boolean {
  return getBuildSnapshotSignature(left) === getBuildSnapshotSignature(right)
}

// create an inventory echo entry
export function createInventoryEchoEntry(echo: EchoInstance, now = Date.now()): InventoryEchoEntry {
  return {
    id: createStorageId(),
    echo: cloneEchoInstance(echo),
    createdAt: now,
    updatedAt: now,
  }
}

// create an inventory build entry
export function createInventoryBuildEntry(input: {
  name: string
  resonatorId: ResonatorId
  resonatorName: string
  build: SavedBuildSnapshot
}, now = Date.now()): InventoryBuildEntry {
  return {
    id: createStorageId(),
    name: input.name,
    resonatorId: input.resonatorId,
    resonatorName: input.resonatorName,
    build: cloneBuildSnapshot(input.build),
    createdAt: now,
    updatedAt: now,
  }
}

// create an inventory rotation entry
export function createInventoryRotationEntry(input: {
  name: string
  mode: 'personal' | 'team'
  resonatorId: ResonatorId
  resonatorName: string
  team?: TeamSlots
  items: RotationNode[]
  snapshot?: ResonatorProfile
  summary?: RotationEntrySummary
}, now = Date.now()): InventoryRotationEntry {
  return {
    id: createStorageId(),
    name: input.name,
    mode: input.mode,
    resonatorId: input.resonatorId,
    resonatorName: input.resonatorName,
    ...(input.team ? { team: [...input.team] as TeamSlots } : {}),
    items: cloneRotationNodes(input.items),
    ...(input.snapshot ? { snapshot: structuredClone(input.snapshot) } : {}),
    ...(input.summary ? { summary: structuredClone(input.summary) } : {}),
    createdAt: now,
    updatedAt: now,
  }
}

// check whether a build snapshot is effectively empty
export function isEmptyBuildSnapshot(build: SavedBuildSnapshot): boolean {
  return build.echoes.every((echo) => echo == null) && (build.weapon.id == null || build.weapon.id === '0')
}
