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
import { initResCat, initResDtls } from '@/data/gameData/resonators/resonatorDataStore'
import { initWpnData } from '@/data/gameData/weapons/weaponDataStore'

const GAME_DATA_KEY = '__wuwaGameDataState__'

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
}

function getGameDataG(): GameDataGlbl {
  const scope = globalThis as typeof globalThis & {
    [GAME_DATA_KEY]?: GameDataGlbl
  }

  const existing = scope[GAME_DATA_KEY]
  if (existing) {
    return existing
  }

  const created: GameDataGlbl = {
    registry: null,
    initializationPromise: null,
    mode: null,
  }

  scope[GAME_DATA_KEY] = created
  return created
}

export function hydrGameData(registry: GameDataReg, mode: GameDataMode = DEF_GAME_DATA_MODE): void {
  const state = getGameDataG()
  state.registry = registry
  state.initializationPromise = Promise.resolve()
  state.mode = mode
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

// load and cache all game data, then build the registry
export async function initGameData(options: { mode?: GameDataMode } = {}): Promise<void> {
  const state = getGameDataG()
  const mode = options.mode ?? DEF_GAME_DATA_MODE

  if (state.registry && state.mode === mode) {
    return
  }

  if (state.initializationPromise && state.mode !== mode) {
    await state.initializationPromise.catch(() => undefined)
  }

  if (state.registry && state.mode !== mode) {
    state.registry = null
    state.initializationPromise = null
  }

  if (!state.initializationPromise) {
    state.mode = mode
    const dataUrls = makeDataUrls(mode)
    state.initializationPromise = (async () => {
      const [
        resSrcs,
        resDamageEntries,
        echoSources,
        enemySources,
        weaponSources,
        weaponData,
        resCat,
        resDtls,
        echoCatalog,
        echoStats,
        sonataSets,
        echoSetDefs,
      ] =
        await Promise.all([
          fetch(dataUrls.resonatorSources).then((r) => r.json() as Promise<SrcPkg[]>),
          fetch(dataUrls.resonatorDamageEntries).then((r) => r.json() as Promise<SkillDamageEntry[]>),
          fetch(dataUrls.echoSources).then((r) => r.json() as Promise<SrcPkg[]>),
          fetch(dataUrls.enemySources).then((r) => r.json() as Promise<SrcPkg[]>),
          fetch(dataUrls.weaponSources).then((r) => r.json() as Promise<SrcPkg[]>),
          fetch(dataUrls.weaponCatalog).then((r) => r.json() as Promise<GenWpn[]>),
          fetch(dataUrls.resonatorCatalog).then((r) => r.json() as Promise<ResSeed[]>),
          fetch(dataUrls.resonatorDetails).then((r) => r.json() as Promise<Record<string, ResDtls>>),
          fetch(dataUrls.echoCatalog).then((r) => r.json() as Promise<EchoDef[]>),
          fetch(dataUrls.echoStats).then((r) => r.json() as Promise<EchoSttsCatD>),
          fetch(dataUrls.sonataSets).then((r) => r.json() as Promise<SntSetDef[]>),
          fetch(dataUrls.sonataEffects).then((r) => r.json() as Promise<SetDef[]>),
        ])

      initResCat(resCat)
      initResDtls(resDtls)
      initWpnData(weaponData)
      initEchoCat(normEchoCat(echoCatalog))
      initEchoStts(echoStats)
      initSntSets(sonataSets)
      initEchoSetD(echoSetDefs)

      const damageEntriesByResonatorId = new Map<string, SkillDamageEntry[]>()
      for (const entry of resDamageEntries) {
        const entries = damageEntriesByResonatorId.get(entry.resonatorId) ?? []
        entries.push(entry)
        damageEntriesByResonatorId.set(entry.resonatorId, entries)
      }
      const resonatorSources = resSrcs.map((source) => ({
        ...source,
        damageEntries: damageEntriesByResonatorId.get(source.source.id) ?? [],
      }))

      const allSources: SrcPkg[] = [
        ...resonatorSources,
        ...echoSources,
        ...enemySources,
        ...weaponSources,
        ...sntSetSrcs,
      ]

      getGameDataG().registry = mkGameDataRe(allSources, {
        resonatorStatesById: materializeResonatorStatesById(resDtls),
      })
    })().catch((error) => {
      const nextState = getGameDataG()
      nextState.initializationPromise = null
      if (!nextState.registry) {
        nextState.mode = null
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
