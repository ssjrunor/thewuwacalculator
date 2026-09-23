/*
  Author: Runor Ewhro
  Description: Builds and caches the full game-data source package list
               and the derived registry used across Simulation tools.
*/

import { initEchoCat } from '@/data/gameData/catalog/echoes'
import { initEchoStts, type EchoSttsCatD } from '@/data/gameData/catalog/echoStats'
import { initSntSets, type SntSetDef } from '@/data/gameData/catalog/sonataSets'
import { initEchoSetD, sntSetSrcs, type SetDef } from '@/data/gameData/echoSets/effects'
import type { GameDataReg, SrcPkg } from '@/domain/gameData/contracts'
import { mkGameDataRe } from '@/data/gameData/registry'
import { materializeResonatorStatesById } from '@/domain/gameData/resonatorStateGraph'
import type { EchoDef } from '@/domain/entities/catalog'
import type { ResSeed } from '@/domain/entities/runtime'
import type { ResDtls } from '@/domain/entities/resonator'
import type { GenWpn } from '@/domain/entities/weapon'
import type { SkillDamageEntry } from '@/domain/entities/stats'
import { DEF_GAME_DATA_MODE, type GameDataMode } from '@/domain/entities/gameDataMode'
import { getResCatByI, initResCat, initResDtls, initResKitSeeds } from '@/data/gameData/resonators/resonatorDataStore'
import { initWpnData } from '@/data/gameData/weapons/weaponDataStore'

const GAME_DATA_KEY = '__wuwaGameDataState__'
const registryListeners = new Set<() => void>()

/** Derived caches must release removed kits as soon as the registry changes. */
export function onGameDataChange(listener: () => void): () => void {
  registryListeners.add(listener)
  return () => { registryListeners.delete(listener) }
}

function installRegistry(state: GameDataGlbl, registry: GameDataReg): void {
  state.registry = registry
  for (const listener of registryListeners) listener()
}

function makeDataUrls(mode: GameDataMode) {
  const root = `/data/${mode}`
  return {
    resonatorSources: `${root}/resonators/sources.json`,
    resonatorDamageEntries: `${root}/resonators/damage-entries.json`,
    echoSources: `${root}/echoes/sources.json`,
    enemySources: `${root}/enemies/sources.json`,
    weaponSources: `${root}/weapons/sources.json`,
    weaponCatalog: `${root}/weapons/catalog.json`,
    resonatorCatalog: `${root}/resonators/catalog.json`,
    resonatorPickerCatalog: `${root}/resonators/picker-catalog.json`,
    resonatorDetails: `${root}/resonators/details.json`,
    echoCatalog: `${root}/echoes/catalog.json`,
    echoStats: `${root}/echoes/stats.json`,
    sonataSets: `${root}/sonata/sets.json`,
    sonataEffects: `${root}/sonata/effects.json`,
  } as const
}

type GameDataGlbl = {
  registry: GameDataReg | null
  initializationPromise: Promise<void> | null
  mode: GameDataMode | null
  resonatorScope: string | null
  commonSources: SrcPkg[] | null
  knownFeatureIds: Set<string> | null
  bundles: Map<string, ResonatorWorkerBundle>
  pendingBundles: Map<string, Promise<void>>
  retainedIds: Set<string>
  leases: Map<object, readonly string[]>
}

function getGameDataG(): GameDataGlbl {
  const scope = globalThis as typeof globalThis & {
    [GAME_DATA_KEY]?: GameDataGlbl
  }

  const existing = scope[GAME_DATA_KEY]
  if (existing) {
    // Development hot reload can retain an older singleton shape.
    existing.commonSources ??= null
    existing.knownFeatureIds ??= null
    existing.bundles ??= new Map()
    existing.pendingBundles ??= new Map()
    existing.retainedIds ??= new Set()
    existing.leases ??= new Map()
    return existing
  }

  const created: GameDataGlbl = {
    registry: null,
    initializationPromise: null,
    mode: null,
    resonatorScope: null,
    commonSources: null,
    knownFeatureIds: null,
    bundles: new Map(),
    pendingBundles: new Map(),
    retainedIds: new Set(),
    leases: new Map(),
  }

  scope[GAME_DATA_KEY] = created
  return created
}

export function hydrGameData(registry: GameDataReg, mode: GameDataMode = DEF_GAME_DATA_MODE): void {
  const state = getGameDataG()
  installRegistry(state, registry)
  state.initializationPromise = Promise.resolve()
  state.mode = mode
  state.resonatorScope = null
  state.commonSources = null
  state.knownFeatureIds = null
  state.bundles.clear()
  state.pendingBundles.clear()
  state.retainedIds.clear()
  state.leases.clear()
}

export function getGameDataMode(): GameDataMode {
  return getGameDataG().mode ?? DEF_GAME_DATA_MODE
}

export function gameDataUrl(mode: GameDataMode, path: string): string {
  return `/data/${mode}/${path.replace(/^\/+/, '')}`
}

function normPblcSstP(path: string): string {
  return path.startsWith('/public/') ? path.slice('/public'.length) : path
}

function normEchoCat(catalog: EchoDef[]): EchoDef[] {
  return catalog.map((echo) => ({
    ...echo,
    icon: normPblcSstP(echo.icon),
  }))
}

interface ResonatorWorkerBundle {
  source: SrcPkg
  details: ResDtls | null
  seed?: ResSeed
}

// Omitted IDs preserve the full registry for offline tools and migrations.
// Browser and worker entry points request only their current team.
export async function initGameData(options: {
  mode?: GameDataMode
  resonatorIds?: readonly string[]
  calculationOnly?: boolean
  weaponIds?: readonly string[]
} = {}): Promise<void> {
  const state = getGameDataG()
  const mode = options.mode ?? DEF_GAME_DATA_MODE
  const resonatorIds = options.resonatorIds
    ? Array.from(new Set(options.resonatorIds)).sort()
    : null
  const weaponIds = [...new Set(options.weaponIds ?? [])].filter((id) => id && id !== '0').sort()
  const calculationOnly = Boolean(options.calculationOnly && resonatorIds)
  const resonatorScope = resonatorIds
    ? `${resonatorIds.join(',')}${calculationOnly ? `|calculation:${weaponIds.join(',')}` : ''}`
    : null

  if (state.registry && state.mode === mode && state.resonatorScope === resonatorScope) {
    return
  }

  if (state.initializationPromise && (state.mode !== mode || state.resonatorScope !== resonatorScope)) {
    await state.initializationPromise.catch(() => undefined)
  }

  if (state.registry && (state.mode !== mode || state.resonatorScope !== resonatorScope)) {
    state.registry = null
    state.initializationPromise = null
  }

  if (!state.initializationPromise) {
    state.mode = mode
    state.resonatorScope = resonatorScope
    const dataUrls = makeDataUrls(mode)
    state.initializationPromise = (async () => {
      const featureIdsRequest = resonatorIds && !calculationOnly
        ? fetch(gameDataUrl(mode, 'resonators/feature-ids.json')).then((r) => r.json() as Promise<string[]>)
        : Promise.resolve<string[]>([])
      const runtimeBundles = calculationOnly ? Promise.all(resonatorIds!.map(async (id) => {
        const response = await fetch(gameDataUrl(mode, `resonators/runtime-bundles/${encodeURIComponent(id)}.json`))
        if (!response.ok) throw new Error(`Resonator runtime data unavailable: ${id}`)
        return response.json() as Promise<ResonatorWorkerBundle>
      })) : null
      const weaponBundles = calculationOnly ? Promise.all(weaponIds.map(async (id) => {
        const response = await fetch(gameDataUrl(mode, `weapons/runtime-bundles/${encodeURIComponent(id)}.json`))
        if (!response.ok) throw new Error(`Weapon runtime data unavailable: ${id}`)
        return response.json() as Promise<{ weapon: GenWpn; source: SrcPkg | null }>
      })) : null
      const resCatRequest = runtimeBundles
        ? runtimeBundles.then((bundles) => bundles.flatMap((bundle) => bundle.seed ? [bundle.seed] : []))
        : fetch(resonatorIds ? dataUrls.resonatorPickerCatalog : dataUrls.resonatorCatalog).then((r) => r.json() as Promise<ResSeed[]>)
      const resonatorData = resonatorIds
        ? (runtimeBundles ?? resCatRequest.then((catalog) => Promise.all(resonatorIds.filter((id) => catalog.some((seed) => seed.id === id)).map(async (id): Promise<ResonatorWorkerBundle> => {
          const response = await fetch(`${dataUrls.resonatorSources.replace(/sources\.json$/, '')}worker-bundles/${encodeURIComponent(id)}.json`)
          if (!response.ok) throw new Error(`Resonator worker bundle unavailable: ${id}`)
          return response.json() as Promise<ResonatorWorkerBundle>
        })))).then((bundles) => ({
          sources: bundles.map((bundle) => bundle.source),
          seeds: Object.fromEntries(bundles.flatMap((bundle) => bundle.seed ? [[bundle.seed.id, bundle.seed]] : [])),
          details: Object.fromEntries(bundles.flatMap((bundle) => bundle.details
            ? [[bundle.source.source.id, bundle.details] as const]
            : [])),
        }))
        : Promise.all([
          fetch(dataUrls.resonatorSources).then((r) => r.json() as Promise<SrcPkg[]>),
          fetch(dataUrls.resonatorDamageEntries).then((r) => r.json() as Promise<SkillDamageEntry[]>),
          fetch(dataUrls.resonatorDetails).then((r) => r.json() as Promise<Record<string, ResDtls>>),
        ]).then(([sources, damageEntries, details]) => {
          const entriesById = new Map<string, SkillDamageEntry[]>()
          for (const entry of damageEntries) {
            const entries = entriesById.get(entry.resonatorId) ?? []
            entries.push(entry)
            entriesById.set(entry.resonatorId, entries)
          }
          return {
            seeds: {} as Record<string, ResSeed>,
            sources: sources.map((source) => ({
              ...source,
              damageEntries: entriesById.get(source.source.id) ?? [],
            })),
            details,
          }
        })
      const [
        resonators,
        echoSources,
        enemySources,
        weaponSources,
        weaponData,
        resCat,
        echoCatalog,
        echoStats,
        sonataSets,
        echoSetDefs,
        featureIds,
      ] =
        await Promise.all([
          resonatorData,
          fetch(dataUrls.echoSources).then((r) => r.json() as Promise<SrcPkg[]>),
          fetch(dataUrls.enemySources).then((r) => r.json() as Promise<SrcPkg[]>),
          weaponBundles ? weaponBundles.then((bundles) => bundles.flatMap((bundle) => bundle.source ? [bundle.source] : [])) : fetch(dataUrls.weaponSources).then((r) => r.json() as Promise<SrcPkg[]>),
          weaponBundles ? weaponBundles.then((bundles) => bundles.map((bundle) => bundle.weapon)) : fetch(dataUrls.weaponCatalog).then((r) => r.json() as Promise<GenWpn[]>),
          resCatRequest,
          fetch(dataUrls.echoCatalog).then((r) => r.json() as Promise<EchoDef[]>),
          fetch(dataUrls.echoStats).then((r) => r.json() as Promise<EchoSttsCatD>),
          fetch(dataUrls.sonataSets).then((r) => r.json() as Promise<SntSetDef[]>),
          fetch(dataUrls.sonataEffects).then((r) => r.json() as Promise<SetDef[]>),
          featureIdsRequest,
        ])

      initResCat(resCat)
      if (resonatorIds) initResKitSeeds(resonators.seeds)
      initResDtls(resonators.details)
      initWpnData(weaponData)
      initEchoCat(normEchoCat(echoCatalog))
      initEchoStts(echoStats)
      initSntSets(sonataSets)
      initEchoSetD(echoSetDefs)

      const commonSources: SrcPkg[] = [
        ...echoSources,
        ...enemySources,
        ...weaponSources,
        ...sntSetSrcs,
      ]

      state.knownFeatureIds = new Set([
        ...featureIds,
        ...commonSources.flatMap((source) => (source.features ?? []).map((feature) => feature.id)),
        ...resonators.sources.flatMap((source) => (source.features ?? []).map((feature) => feature.id)),
      ])
      state.commonSources = resonatorIds ? commonSources : null
      state.retainedIds = new Set(resonatorIds ?? [])
      state.bundles.clear()
      if (resonatorIds) {
        for (const source of resonators.sources) {
          state.bundles.set(source.source.id, { source, details: resonators.details[source.source.id] ?? null, seed: resonators.seeds[source.source.id] })
        }
      }
      installRegistry(state, mkGameDataRe([...resonators.sources, ...commonSources], {
        resonatorStatesById: materializeResonatorStatesById(resonators.details),
      }))
    })().catch((error) => {
      const nextState = getGameDataG()
      nextState.initializationPromise = null
      if (!nextState.registry) {
        nextState.mode = null
        nextState.resonatorScope = null
      }
      throw error
    })
  }

  await state.initializationPromise
}

// get the global game-data registry (must call initializeGameData first)
export function getGameData(): GameDataReg {
  const state = getGameDataG()
  if (!state.registry) {
    throw new Error('Game data not initialized, call initializeGameData() first')
  }

  return state.registry
}

// The browser keeps full picker metadata but only a bounded set of detailed
// kits. Full initialization remains available to offline tools and migrations.
const RECENT_RESONATOR_LIMIT = 3

export function hasResonatorData(ids: readonly string[]): boolean {
  const state = getGameDataG()
  return Boolean(state.registry && (state.commonSources === null || ids.every((id) => !getResCatByI()[id] || state.bundles.has(id))))
}

function rebuildScopedRegistry(state: GameDataGlbl): void {
  if (!state.commonSources) return
  const details: Record<string, ResDtls> = {}
  const seeds: Record<string, ResSeed> = {}
  const sources = [...state.commonSources]
  for (const [id, bundle] of state.bundles) {
    sources.push(bundle.source)
    if (bundle.details) details[id] = bundle.details
    if (bundle.seed) seeds[id] = bundle.seed
  }
  initResKitSeeds(seeds)
  initResDtls(details)
  installRegistry(state, mkGameDataRe(sources, {
    resonatorStatesById: materializeResonatorStatesById(details),
  }))
  state.resonatorScope = [...state.bundles.keys()].sort().join(',')
}

export async function ensureResonatorData(ids: readonly string[]): Promise<void> {
  const state = getGameDataG()
  if (!state.registry) throw new Error('Game data is not initialized')
  if (state.commonSources === null) return
  const release = holdResonatorData(ids)
  let changed = false
  const results = await Promise.allSettled([...new Set(ids)].filter((id) => getResCatByI()[id]).map(async (id) => {
    const existing = state.bundles.get(id)
    if (existing) {
      state.bundles.delete(id)
      state.bundles.set(id, existing)
      return
    }
    let pending = state.pendingBundles.get(id)
    if (!pending) {
      pending = (async () => {
        const response = await fetch(gameDataUrl(state.mode!, `resonators/worker-bundles/${encodeURIComponent(id)}.json`))
        if (!response.ok) throw new Error(`Resonator data unavailable: ${id}`)
        const bundle = await response.json() as ResonatorWorkerBundle
        if (bundle.source.source.id !== id) throw new Error(`Unexpected resonator data: ${id}`)
        state.bundles.set(id, bundle)
      })().finally(() => state.pendingBundles.delete(id))
      state.pendingBundles.set(id, pending)
    }
    await pending
    changed = true
  }))
  if (changed) rebuildScopedRegistry(state)
  // Callers normalize/commit their loaded data in the promise continuation.
  // Trim on the next task so canceled pickers and import reviews stay bounded too.
  setTimeout(release, 0)
  const failed = results.find((result) => result.status === 'rejected')
  if (failed?.status === 'rejected') throw failed.reason
}

/** Keep a kit resident while a detached modal or configuration draft uses it. */
export function holdResonatorData(ids: readonly string[]): () => void {
  const state = getGameDataG()
  const lease = {}
  state.leases.set(lease, ids)
  return () => {
    state.leases.delete(lease)
    scheduleResonatorTrim(state)
  }
}

let trimTimer: ReturnType<typeof setTimeout> | null = null
function scheduleResonatorTrim(state: GameDataGlbl): void {
  if (trimTimer !== null) clearTimeout(trimTimer)
  trimTimer = setTimeout(() => {
    trimTimer = null
    if (getGameDataG() === state) retainResonatorData([...state.retainedIds])
  }, 0)
}

export function retainResonatorData(ids: readonly string[]): void {
  const state = getGameDataG()
  if (!state.commonSources) return
  state.retainedIds = new Set(ids)
  const held = new Set([...state.retainedIds, ...[...state.leases.values()].flat()])
  const recent = [...state.bundles.keys()].filter((id) => !held.has(id))
  let changed = false
  for (const id of recent.slice(0, Math.max(0, recent.length - RECENT_RESONATOR_LIMIT))) {
    state.bundles.delete(id)
    changed = true
  }
  if (changed) rebuildScopedRegistry(state)
}

/** Validity metadata remains complete even when a detailed kit is not resident. */
export function getKnownFeatureIds(): ReadonlySet<string> {
  const state = getGameDataG()
  return state.knownFeatureIds ??= new Set(Object.values(getGameData().featuresBySourceKey).flatMap((features) => features.map((feature) => feature.id)))
}
