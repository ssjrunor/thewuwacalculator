/*
  Author: Runor Ewhro
  Description: Defines inventory storage entities and helper utilities for
               cloning, comparing, and creating saved echoes, builds, and rotations.
*/

import type { EchoInstance, ResonatorId, TeamSlots, WeaponState } from './runtime'
import type { CombatScenario, ScenarioTeamMember } from './combatScenario'
import { contextScenarioMember } from './combatScenario'
import type { RotationNode } from '@/domain/gameData/contracts'
import { makeEchoUid } from './runtime'

export interface SavedEcho {
  id: string
  echo: EchoInstance
  createdAt: number
  updatedAt: number
}

export interface SavedBuildSnap {
  weapon: WeaponState
  echoes: Array<EchoInstance | null>
}

export interface SavedBuild {
  id: string
  name: string
  resonatorId: ResonatorId
  resonatorName: string
  build: SavedBuildSnap
  createdAt: number
  updatedAt: number
}

export interface SavedRotation {
  id: string
  name: string
  duration: number
  note: string
  /** Exact, immutable authored combat state represented by this saved run. */
  scenario: CombatScenario
  migration?: {
    source: 'advanced-sequence'
    acknowledged: boolean
  }
  createdAt: number
  updatedAt: number
}

export interface SavedScenario {
  id: string
  name: string
  note: string
  /** Exact immutable combat-state snapshot; its live identity is remapped on load. */
  scenario: CombatScenario
  createdAt: number
  updatedAt: number
}

export interface SavedArtifactLibrary {
  echoes: SavedEcho[]
  builds: SavedBuild[]
  rotations: SavedRotation[]
  scenarios: SavedScenario[]
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
export function cloneRotationNodes(
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
    if ('note' in clonedNode && clonedNode.note && options?.freshIds) {
      clonedNode.note.id = makeRotNodeId('note')
    }
    if (clonedNode.type === 'feature') {
      return {
        ...clonedNode,
        id: nextId,
        ...(clonedNode.attached
          ? {
            attached: {
              conditions: cloneNodes(clonedNode.attached.conditions) as Extract<
                RotationNode,
                { type: 'condition' }
              >[],
              features: cloneNodes(clonedNode.attached.features) as Extract<
                RotationNode,
                { type: 'feature' }
              >[],
            },
          }
          : {}),
      }
    }

    if (clonedNode.type === 'condition') {
      return {
        ...clonedNode,
        id: nextId,
      }
    }

    if (clonedNode.type === 'note') {
      return { ...clonedNode, id: nextId }
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
      if (clonedNode.kind === 'start' && clonedNode.passForks) {
        const passForks: Record<string, RotationNode[]> = {}
        for (const [key, body] of Object.entries(clonedNode.passForks)) {
          passForks[key] = cloneNodes(body)
        }
        return {
          ...clonedNode,
          id: nextId,
          loopId,
          passForks,
        }
      }
      return {
        ...clonedNode,
        id: nextId,
        loopId,
      }
    }

    if (clonedNode.type === 'uptime') {
      return {
        ...clonedNode,
        id: nextId,
        setup: clonedNode.setup ? cloneNodes(clonedNode.setup) : clonedNode.setup,
        items: cloneNodes(clonedNode.items),
      }
    }

    return clonedNode
  })

  return cloneNodes(items)
}

// clone an echo for a specific slot
export function cloneEchoFor(echo: EchoInstance, slotIndex: number): EchoInstance {
  return cloneEchoNst(echo, slotIndex)
}

// compare echoes by uid only
export function sameEchoUid(
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
  return echoes.map((echo, index) => (echo ? cloneEchoNst(echo, index) : null))
}

export interface SaveEchoResult {
  savedCount: number
  nextEchoes: Array<EchoInstance | null> | null
}

/** Save selected slots and replace local entries when inventory assigns new identity. */
export function saveEchoSlots(
  echoes: Array<EchoInstance | null>,
  slotIndexes: readonly number[],
  addEcho: (echo: EchoInstance) => SavedEcho | null | undefined,
): SaveEchoResult {
  let savedCount = 0
  let nextEchoes: Array<EchoInstance | null> | null = null

  for (const slotIndex of slotIndexes) {
    const echo = echoes[slotIndex]
    if (!echo) continue

    const saved = addEcho(echo)
    if (!saved) continue
    savedCount += 1

    if (!sameEchoUid(saved.echo, echo)) {
      nextEchoes ??= [...echoes]
      nextEchoes[slotIndex] = cloneEchoFor(saved.echo, slotIndex)
    }
  }

  return { savedCount, nextEchoes }
}

// clone a saved build snapshot
export function cloneBuildSnapshot(build: SavedBuildSnap): SavedBuildSnap {
  return {
    weapon: { ...build.weapon },
    echoes: cloneEchoLoadout(build.echoes),
  }
}

// keep saved rotation duration numeric and treat non-positive values as unset
export function normalizeDuration(value: unknown): number {
  const numericValue = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numericValue) && numericValue > 0 ? numericValue : 0
}

// keep saved rotation notes string-backed without forcing trimmed content
export function normalizeRotNote(value: unknown): string {
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

export function getEchoSignature(echo: EchoInstance): string {
  return normCmprEcho(echo)
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
export function equalEchoes(
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
export function equalBuildSnapshots(
    left: SavedBuildSnap,
    right: SavedBuildSnap,
): boolean {
  return getBuildSig(left) === getBuildSig(right)
}

// returns the entries with uids made unique within the bag. a uid identifies one
// physical echo, and loadout slots reference their inventory echo by uid (see
// indexEquippedEchoes). when entries share a uid, the one whose stats match an equipped
// loadout echo keeps it and the rest receive new uids.
export function dedupeEchoUids(
    entries: SavedEcho[],
    equippedEchoes?: Iterable<EchoInstance | null | undefined>,
): SavedEcho[] {
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
export function makeSavedEcho(echo: EchoInstance, now = Date.now()): SavedEcho {
  return {
    id: makeStoreId(),
    echo: cloneEchoNst(echo),
    createdAt: now,
    updatedAt: now,
  }
}

// create an inventory build entry
export function makeSavedBuild(input: {
  name: string
  resonatorId: ResonatorId
  resonatorName: string
  build: SavedBuildSnap
}, now = Date.now()): SavedBuild {
  return {
    id: makeStoreId(),
    name: input.name,
    resonatorId: input.resonatorId,
    resonatorName: input.resonatorName,
    build: cloneBuildSnapshot(input.build),
    createdAt: now,
    updatedAt: now,
  }
}

// create an inventory rotation entry
export function makeSavedRotation(input: {
  name: string
  duration?: number
  note?: string
  scenario: CombatScenario
}, now = Date.now()): SavedRotation {
  return {
    id: makeStoreId(),
    name: input.name,
    duration: normalizeDuration(input.duration),
    note: normalizeRotNote(input.note),
    scenario: structuredClone(input.scenario),
    createdAt: now,
    updatedAt: now,
  }
}

export function makeSavedScenario(input: {
  name: string
  note?: string
  scenario: CombatScenario
}, now = Date.now()): SavedScenario {
  return {
    id: makeStoreId(),
    name: input.name,
    note: normalizeRotNote(input.note),
    scenario: structuredClone(input.scenario),
    createdAt: now,
    updatedAt: now,
  }
}

export function savedScenarioContextMember(entry: SavedScenario): ScenarioTeamMember {
  return contextScenarioMember(entry.scenario)
}

export function savedRotationContextMember(rotation: SavedRotation): ScenarioTeamMember {
  return contextScenarioMember(rotation.scenario)
}

export function savedRotationResonatorId(rotation: SavedRotation): ResonatorId {
  return savedRotationContextMember(rotation).resonatorId
}

export function savedRotationTeam(rotation: SavedRotation): TeamSlots {
  const members = rotation.scenario.team.members
  return [
    members[0]?.resonatorId ?? null,
    members[1]?.resonatorId ?? null,
    members[2]?.resonatorId ?? null,
  ]
}

export function savedRotationItems(rotation: SavedRotation): RotationNode[] {
  return rotation.scenario.program.program
}

// check whether a build snapshot is effectively empty
export function isEmptyBuild(build: SavedBuildSnap): boolean {
  return build.echoes.every((echo) => echo == null) && (build.weapon.id == null || build.weapon.id === '0')
}
