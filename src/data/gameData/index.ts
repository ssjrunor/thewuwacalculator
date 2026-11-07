/*
  Author: Runor Ewhro
  description: builds and caches the full game-data source package list
               and the derived registry used across simulation tools.
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
import { decodeCoreWeaponCatalog, type CoreWeaponCatalog } from '@/data/gameData/weapons/coreCatalog'

const GAME_DATA_KEY = '__wuwaGameDataState__'

/* whether the host still needs the full calculation data. the browser app
   registers a route check at startup; workers, node and server runtimes keep
   the default and never release. */
// the host supplies route-dependent retention policy; non-browser hosts retain calculation data by default.
let keepCalculationData: () => boolean = () => true

/** let the host decide when the full calculation data may be released. */
export function setCalculationDataPolicy(keep: () => boolean): void {
  keepCalculationData = keep
}

/** manages registry subscriptions and delayed release around the hmr-safe data state. */
export class GameDataSession {
  private readonly registryListeners = new Set<() => void>()
  private nonSimulationReleaseTimer: ReturnType<typeof setTimeout> | null = null
  private trimTimer: ReturnType<typeof setTimeout> | null = null

  getState(): GameDataGlbl {
    const scope = globalThis as typeof globalThis & { [GAME_DATA_KEY]?: GameDataGlbl }
    const existing = scope[GAME_DATA_KEY]
    if (existing) {
      // development hot reload can retain an older singleton shape.
      existing.commonSources ??= null
      existing.commonRegistry ??= null
      existing.coreCatalogs ??= null
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
      commonRegistry: null,
      coreCatalogs: null,
      knownFeatureIds: null,
      bundles: new Map(),
      pendingBundles: new Map(),
      retainedIds: new Set(),
      leases: new Map(),
    }
    scope[GAME_DATA_KEY] = created
    return created
  }

  hydrate(registry: GameDataReg, mode: GameDataMode): void {
    const state = this.getState()
    this.installRegistry(state, registry)
    state.initializationPromise = Promise.resolve()
    state.mode = mode
    state.resonatorScope = null
    state.commonSources = null
    state.commonRegistry = null
    state.coreCatalogs = null
    state.releaseRequested = false
    state.knownFeatureIds = null
    state.bundles.clear()
    state.pendingBundles.clear()
    state.retainedIds.clear()
    state.leases.clear()
  }

  mode(): GameDataMode { return this.getState().mode ?? DEF_GAME_DATA_MODE }

  onChange(listener: () => void): () => void {
    this.registryListeners.add(listener)
    return () => { this.registryListeners.delete(listener) }
  }

  installRegistry(state: GameDataGlbl, registry: GameDataReg): void {
    state.registry = registry
    for (const listener of this.registryListeners) listener()
  }

  cancelRelease(): void {
    if (this.nonSimulationReleaseTimer !== null) clearTimeout(this.nonSimulationReleaseTimer)
    this.nonSimulationReleaseTimer = null
  }

  scheduleRelease(state: GameDataGlbl): void {
    if (keepCalculationData()) return
    this.cancelRelease()
    this.nonSimulationReleaseTimer = setTimeout(() => {
      this.nonSimulationReleaseTimer = null
      if (this.getState() === state && !keepCalculationData()) this.releaseCalculationData()
    }, 1_200)
  }

  scheduleTrim(state: GameDataGlbl): void {
    if (this.trimTimer !== null) clearTimeout(this.trimTimer)
    this.trimTimer = setTimeout(() => {
      this.trimTimer = null
      if (this.getState() === state) this.retain([...state.retainedIds])
    }, 0)
  }

  hold(state: GameDataGlbl, ids: readonly string[]): () => void {
    const lease = {}
    state.leases.set(lease, ids)
    return () => {
      state.leases.delete(lease)
      if (state.releaseRequested && state.leases.size === 0) {
        // allow a draft's cleanup/setup pair to settle before releasing kits.
        setTimeout(() => {
          if (this.getState() === state && state.releaseRequested && state.leases.size === 0) {
            this.releaseCalculationData()
          }
        }, 0)
        return
      }
      this.scheduleTrim(state)
    }
  }

  releaseCalculationData(): void {
    this.cancelRelease()
    const state = this.getState()
    if (state.coreOnly || !state.registry) return
    state.releaseRequested = true
    if (state.leases.size > 0) return
    const sourceKeys = state.coreCatalogs?.sourceStubs
      ?? Object.values(state.registry.sourcesByKey).map((source) => ({ source: source.source })) as SrcPkg[]
    const retained = new Map([...state.bundles].filter(([id]) => state.retainedIds.has(id)))
    state.bundles = retained
    if (state.coreCatalogs) state.coreCatalogs.bundles = new Map(retained)
    if (state.coreCatalogs) initWpnData(state.coreCatalogs.weapons)
    initResKitSeeds(Object.fromEntries([...retained].flatMap(([id, bundle]) => bundle.seed ? [[id, bundle.seed]] : [])))
    initResDtls(Object.fromEntries([...retained].flatMap(([id, bundle]) => bundle.details ? [[id, bundle.details]] : [])))
    state.commonSources = null
    state.commonRegistry = null
    state.coreOnly = true
    state.releaseRequested = false
    state.resonatorScope = `core:${[...retained.keys()].sort().join(',')}`
    this.installRegistry(state, mkGameDataRe(sourceKeys))
  }

  retain(ids: readonly string[]): void {
    const state = this.getState()
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

  async ensureResonators(ids: readonly string[]): Promise<void> {
    const state = this.getState()
    if (!state.registry) throw new Error('Game data is not initialized')
    if (state.coreOnly) {
      await initGameData({ mode: state.mode ?? DEF_GAME_DATA_MODE, resonatorIds: [...new Set([...state.retainedIds, ...ids])] })
      this.scheduleRelease(state)
      return
    }
    if (state.commonSources === null) return
    const release = this.hold(state, ids)
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
          const response = await fetchGameData(gameDataUrl(state.mode!, `resonators/worker-bundles/${encodeURIComponent(id)}.json`))
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
    setTimeout(release, 0)
    this.scheduleRelease(state)
    const failed = results.find((result) => result.status === 'rejected')
    if (failed?.status === 'rejected') throw failed.reason
  }

  async initialize(options: {
    mode?: GameDataMode
    resonatorIds?: readonly string[]
    calculationOnly?: boolean
    weaponIds?: readonly string[]
  } = {}): Promise<void> {
    const state = this.getState()
    this.cancelRelease()
    state.releaseRequested = false
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

    const fallbackCoreRegistry = state.coreOnly && state.mode === mode ? state.registry : null
    const fallbackCoreScope = fallbackCoreRegistry ? state.resonatorScope : null

    if (state.registry && (state.mode !== mode || state.resonatorScope !== resonatorScope)) {
      state.registry = null
      state.initializationPromise = null
    }

    if (!state.initializationPromise) {
      state.mode = mode
      state.resonatorScope = resonatorScope
      const dataUrls = makeDataUrls(mode)
      const core = state.coreCatalogs?.mode === mode ? state.coreCatalogs : null
      state.initializationPromise = (async () => {
        const featureIdsRequest = resonatorIds && !calculationOnly
          ? core ? Promise.resolve(core.featureIds)
            : fetchGameData(gameDataUrl(mode, 'resonators/feature-ids.json')).then((r) => r.json() as Promise<string[]>)
          : Promise.resolve<string[]>([])
        const runtimeBundles = calculationOnly ? Promise.all(resonatorIds!.map(async (id) => {
          const response = await fetchGameData(gameDataUrl(mode, `resonators/runtime-bundles/${encodeURIComponent(id)}.json`))
          if (!response.ok) throw new Error(`Resonator runtime data unavailable: ${id}`)
          return response.json() as Promise<ResonatorWorkerBundle>
        })) : null
        const weaponBundles = calculationOnly ? Promise.all(weaponIds.map(async (id) => {
          const response = await fetchGameData(gameDataUrl(mode, `weapons/runtime-bundles/${encodeURIComponent(id)}.json`))
          if (!response.ok) throw new Error(`Weapon runtime data unavailable: ${id}`)
          return response.json() as Promise<{ weapon: GenWpn; source: SrcPkg | null }>
        })) : null
        const resCatRequest = runtimeBundles
          ? runtimeBundles.then((bundles) => bundles.flatMap((bundle) => bundle.seed ? [bundle.seed] : []))
          : core && resonatorIds ? Promise.resolve(core.seeds)
            : fetchGameData(resonatorIds ? dataUrls.resonatorPickerCatalog : dataUrls.resonatorCatalog).then((r) => r.json() as Promise<ResSeed[]>)
        const resonatorData = resonatorIds
          ? (runtimeBundles ?? resCatRequest.then((catalog) => Promise.all(resonatorIds.filter((id) => catalog.some((seed) => seed.id === id)).map(async (id): Promise<ResonatorWorkerBundle> => {
            const cached = core?.bundles.get(id)
            if (cached) return cached
            const response = await fetchGameData(`${dataUrls.resonatorSources.replace(/sources\.json$/, '')}worker-bundles/${encodeURIComponent(id)}.json`)
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
            fetchGameData(dataUrls.resonatorSources).then((r) => r.json() as Promise<SrcPkg[]>),
            fetchGameData(dataUrls.resonatorDamageEntries).then((r) => r.json() as Promise<SkillDamageEntry[]>),
            fetchGameData(dataUrls.resonatorDetails).then((r) => r.json() as Promise<Record<string, ResDtls>>),
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
          coreWeaponData,
          resCat,
          echoCatalog,
          echoStats,
          sonataSets,
          echoSetDefs,
          featureIds,
          sourceManifest,
        ] =
          await Promise.all([
            resonatorData,
            fetchGameData(dataUrls.echoSources).then((r) => r.json() as Promise<SrcPkg[]>),
            fetchGameData(dataUrls.enemySources).then((r) => r.json() as Promise<SrcPkg[]>),
            weaponBundles ? weaponBundles.then((bundles) => bundles.flatMap((bundle) => bundle.source ? [bundle.source] : [])) : fetchGameData(dataUrls.weaponSources).then((r) => r.json() as Promise<SrcPkg[]>),
            weaponBundles ? weaponBundles.then((bundles) => bundles.map((bundle) => bundle.weapon)) : fetchGameData(dataUrls.weaponCatalog).then((r) => r.json() as Promise<GenWpn[]>),
            calculationOnly ? Promise.resolve<GenWpn[]>([])
              : core ? Promise.resolve(core.weapons)
                : fetchGameData(dataUrls.weaponCoreCatalog).then((r) => r.json() as Promise<CoreWeaponCatalog>).then(decodeCoreWeaponCatalog),
            resCatRequest,
            core ? Promise.resolve(core.echoes) : fetchGameData(dataUrls.echoCatalog).then((r) => r.json() as Promise<EchoDef[]>),
            core ? Promise.resolve(core.echoStats) : fetchGameData(dataUrls.echoStats).then((r) => r.json() as Promise<EchoSttsCatD>),
            core ? Promise.resolve(core.sonataSets) : fetchGameData(dataUrls.sonataSets).then((r) => r.json() as Promise<SntSetDef[]>),
            core ? Promise.resolve(core.echoSets) : fetchGameData(dataUrls.sonataEffects).then((r) => r.json() as Promise<SetDef[]>),
            featureIdsRequest,
            core ? Promise.resolve({ sources: core.sourceStubs.map((stub) => stub.source), featureIds: core.featureIds })
              : fetchGameData(dataUrls.sourceManifest).then((r) => r.json() as Promise<SourceManifest>),
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
        state.commonRegistry = resonatorIds ? mkGameDataRe(commonSources) : null
        state.retainedIds = new Set(resonatorIds ?? [])
        state.bundles.clear()
        if (resonatorIds) {
          for (const source of resonators.sources) {
            state.bundles.set(source.source.id, { source, details: resonators.details[source.source.id] ?? null, seed: resonators.seeds[source.source.id] })
          }
        }
        state.coreCatalogs = {
          mode,
          sourceStubs: sourceManifest.sources.map((source) => ({ source })),
          seeds: resCat,
          bundles: new Map([...state.bundles]),
          weapons: coreWeaponData,
          echoes: echoCatalog,
          echoStats,
          sonataSets,
          echoSets: echoSetDefs,
          featureIds: [...state.knownFeatureIds],
        }
        this.installRegistry(state, mkGameDataRe(resonatorIds ? resonators.sources : [...resonators.sources, ...commonSources], {
          resonatorStatesById: materializeResonatorStatesById(resonators.details),
          base: state.commonRegistry ?? undefined,
        }))
        state.coreOnly = false
      })().catch((error) => {
        const nextState = this.getState()
        nextState.initializationPromise = null
        if (!nextState.registry && fallbackCoreRegistry) {
          nextState.mode = mode
          nextState.resonatorScope = fallbackCoreScope
          nextState.coreOnly = true
          this.installRegistry(nextState, fallbackCoreRegistry)
        } else if (!nextState.registry) {
          nextState.mode = null
          nextState.resonatorScope = null
        }
        throw error
      })
    }

    await state.initializationPromise
  }

  async initializeCore(options: { mode?: GameDataMode; resonatorIds?: readonly string[] } = {}): Promise<void> {
    const state = this.getState()
    const mode = options.mode ?? DEF_GAME_DATA_MODE
    if (state.registry && state.mode === mode) return
    if (state.initializationPromise) await state.initializationPromise.catch(() => undefined)
    if (state.registry && state.mode === mode) return
    const ids = [...new Set(options.resonatorIds ?? [])]
    state.mode = mode
    state.resonatorScope = `core:${ids.sort().join(',')}`
    const urls = makeDataUrls(mode)
    state.initializationPromise = (async () => {
      const [seeds, bundles, weapons, echoes, echoStats, sonataSets, echoSets, manifest] = await Promise.all([
        fetchGameData(urls.resonatorPickerCatalog).then((response) => response.json() as Promise<ResSeed[]>),
        Promise.all(ids.map(async (id) => {
          const response = await fetchGameData(gameDataUrl(mode, `resonators/worker-bundles/${encodeURIComponent(id)}.json`))
          if (!response.ok) throw new Error(`Resonator data unavailable: ${id}`)
          return response.json() as Promise<ResonatorWorkerBundle>
        })),
        fetchGameData(urls.weaponCoreCatalog).then((response) => response.json() as Promise<CoreWeaponCatalog>).then(decodeCoreWeaponCatalog),
        fetchGameData(urls.echoCatalog).then((response) => response.json() as Promise<EchoDef[]>),
        fetchGameData(urls.echoStats).then((response) => response.json() as Promise<EchoSttsCatD>),
        fetchGameData(urls.sonataSets).then((response) => response.json() as Promise<SntSetDef[]>),
        fetchGameData(urls.sonataEffects).then((response) => response.json() as Promise<SetDef[]>),
        fetchGameData(urls.sourceManifest).then((response) => response.json() as Promise<SourceManifest>),
      ])
      const details = Object.fromEntries(bundles.flatMap((bundle) => bundle.details ? [[bundle.source.source.id, bundle.details]] : []))
      initResCat(seeds)
      initResKitSeeds(Object.fromEntries(bundles.flatMap((bundle) => bundle.seed ? [[bundle.seed.id, bundle.seed]] : [])))
      initResDtls(details)
      initWpnData(weapons)
      initEchoCat(normEchoCat(echoes))
      initEchoStts(echoStats)
      initSntSets(sonataSets)
      initEchoSetD(echoSets)
      state.knownFeatureIds = new Set(manifest.featureIds)
      state.retainedIds = new Set(ids)
      state.bundles = new Map(bundles.map((bundle) => [bundle.source.source.id, bundle]))
      state.commonSources = null
      state.commonRegistry = null
      state.coreCatalogs = {
        mode,
        sourceStubs: manifest.sources.map((source) => ({ source })),
        seeds,
        bundles: new Map(bundles.map((bundle) => [bundle.source.source.id, bundle])),
        weapons,
        echoes,
        echoStats,
        sonataSets,
        echoSets,
        featureIds: manifest.featureIds,
      }
      state.coreOnly = true
      // source identities are sufficient for persisted-state validation. the
      // full source graph is rebuilt only when a calculation route is entered.
      this.installRegistry(state, mkGameDataRe(state.coreCatalogs.sourceStubs))
    })().catch((error) => {
      state.initializationPromise = null
      state.registry = null
      throw error
    })
    await state.initializationPromise
  }
}

const gameDataSession = new GameDataSession()

/** derived caches must release removed kits as soon as the registry changes. */
export function onGameDataChange(listener: () => void): () => void {
  return gameDataSession.onChange(listener)
}

function installRegistry(state: GameDataGlbl, registry: GameDataReg): void {
  gameDataSession.installRegistry(state, registry)
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
    weaponCoreCatalog: `${root}/weapons/core-catalog.json`,
    resonatorCatalog: `${root}/resonators/catalog.json`,
    resonatorPickerCatalog: `${root}/resonators/picker-catalog.json`,
    resonatorDetails: `${root}/resonators/details.json`,
    echoCatalog: `${root}/echoes/catalog.json`,
    echoStats: `${root}/echoes/stats.json`,
    sonataSets: `${root}/sonata/sets.json`,
    sonataEffects: `${root}/sonata/effects.json`,
    sourceManifest: `${root}/source-manifest.json`,
  } as const
}

type GameDataGlbl = {
  registry: GameDataReg | null
  initializationPromise: Promise<void> | null
  mode: GameDataMode | null
  resonatorScope: string | null
  commonSources: SrcPkg[] | null
  commonRegistry?: GameDataReg | null
  coreCatalogs?: CoreCatalogs | null
  knownFeatureIds: Set<string> | null
  bundles: Map<string, ResonatorWorkerBundle>
  pendingBundles: Map<string, Promise<void>>
  retainedIds: Set<string>
  leases: Map<object, readonly string[]>
  coreOnly?: boolean
  releaseRequested?: boolean
}

function getGameDataG(): GameDataGlbl {
  return gameDataSession.getState()
}

export function hydrGameData(registry: GameDataReg, mode: GameDataMode = DEF_GAME_DATA_MODE): void {
  gameDataSession.hydrate(registry, mode)
}

export function getGameDataMode(): GameDataMode {
  return gameDataSession.mode()
}

export function gameDataUrl(mode: GameDataMode, path: string): string {
  return `/data/${mode}/${path.replace(/^\/+/, '')}`
}

type GameDataReader = (url: string) => Promise<Response>

const fetchFromOrigin: GameDataReader = (url) => fetch(url)
// the default reader uses this origin; scoring hosts can supply a verified immutable snapshot reader.
let readGameData: GameDataReader = fetchFromOrigin

/** where game data files come from: the app's own /data/<mode>/ by default. a
    host with no such origin (the leaderboard scorer reads a ruleset's
    snapshot) supplies its own reader; null restores the default. */
export function setGameDataReader(reader: GameDataReader | null): void {
  readGameData = reader ?? fetchFromOrigin
}

/** fetch one game data file (a gameDataUrl) through the current reader. */
export function fetchGameData(url: string): Promise<Response> {
  return readGameData(url)
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

interface CoreCatalogs {
  mode: GameDataMode
  sourceStubs: SrcPkg[]
  seeds: ResSeed[]
  bundles: Map<string, ResonatorWorkerBundle>
  weapons: GenWpn[]
  echoes: EchoDef[]
  echoStats: EchoSttsCatD
  sonataSets: SntSetDef[]
  echoSets: SetDef[]
  featureIds: string[]
}

interface SourceManifest {
  sources: Array<SrcPkg['source']>
  featureIds: string[]
}

// omitted ids preserve the full registry for offline tools and migrations.
// browser and worker entry points request only their current team.
export function initGameData(options: {
  mode?: GameDataMode
  resonatorIds?: readonly string[]
  calculationOnly?: boolean
  weaponIds?: readonly string[]
} = {}): Promise<void> {
  return gameDataSession.initialize(options)
}

/** boot routes that only need catalogs and persisted-state validation without
 * constructing the calculation registry and all of its derived indexes. */
export function initCoreGameData(options: { mode?: GameDataMode; resonatorIds?: readonly string[] } = {}): Promise<void> {
  return gameDataSession.initializeCore(options)
}

// get the global game-data registry (must call initializeGameData first)
export function getGameData(): GameDataReg {
  const state = getGameDataG()
  if (!state.registry) {
    throw new Error('Game data not initialized, call initializeGameData() first')
  }

  return state.registry
}

// the browser keeps full picker metadata but only a bounded set of detailed
// kits. full initialization remains available to offline tools and migrations.
const RECENT_RESONATOR_LIMIT = 3

export function hasResonatorData(ids: readonly string[]): boolean {
  const state = getGameDataG()
  return Boolean(state.registry && !state.coreOnly && (state.commonSources === null || ids.every((id) => !getResCatByI()[id] || state.bundles.has(id))))
}

function rebuildScopedRegistry(state: GameDataGlbl): void {
  if (!state.commonSources || !state.commonRegistry) return
  const details: Record<string, ResDtls> = {}
  const seeds: Record<string, ResSeed> = {}
  const sources: SrcPkg[] = []
  for (const [id, bundle] of state.bundles) {
    sources.push(bundle.source)
    if (bundle.details) details[id] = bundle.details
    if (bundle.seed) seeds[id] = bundle.seed
  }
  initResKitSeeds(seeds)
  initResDtls(details)
  installRegistry(state, mkGameDataRe(sources, {
    resonatorStatesById: materializeResonatorStatesById(details),
    base: state.commonRegistry,
  }))
  state.resonatorScope = [...state.bundles.keys()].sort().join(',')
}

export async function ensureResonatorData(ids: readonly string[]): Promise<void> {
  return gameDataSession.ensureResonators(ids)
}

/** keep a kit resident while a detached modal or configuration draft uses it. */
export function holdResonatorData(ids: readonly string[]): () => void {
  return gameDataSession.hold(getGameDataG(), ids)
}

/** return to the catalog-only registry after leaving simulation. detached
 * modals can keep a kit lease and delay this release until they close. */
export function releaseCalculationGameData(): void {
  gameDataSession.releaseCalculationData()
}

export function retainResonatorData(ids: readonly string[]): void {
  gameDataSession.retain(ids)
}

/** validity metadata remains complete even when a detailed kit is not resident. */
export function getKnownFeatureIds(): ReadonlySet<string> {
  const state = getGameDataG()
  return state.knownFeatureIds ??= new Set(Object.values(getGameData().featuresBySourceKey).flatMap((features) => features.map((feature) => feature.id)))
}
