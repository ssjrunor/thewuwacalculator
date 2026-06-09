/*
  Author: Runor Ewhro
  Description: Builds and caches the full game-data source package list
               and the derived registry used across the calculator.
*/

import { initEchoCat } from '@/data/gameData/catalog/echoes'
import { initEchoStts, type EchoSttsCatD } from '@/data/gameData/catalog/echoStats'
import { initSntSets, type SntSetDef } from '@/data/gameData/catalog/sonataSets'
import { initEchoSetD, sntSetSrcs, type SetDef } from '@/data/gameData/echoSets/effects'
import type { GameDataReg, SrcPkg } from '@/domain/gameData/contracts'
import { mkGameDataRe } from '@/domain/gameData/registry'
import { materializeResonatorStatesById } from '@/domain/gameData/resonatorStateGraph'
import type { EchoDef } from '@/domain/entities/catalog'
import type { ResSeed } from '@/domain/entities/runtime'
import type { ResDtls } from '@/domain/entities/resonator'
import type { GenWpn } from '@/domain/entities/weapon'
import { mkWpnSrcs } from '@/data/gameData/weapons/effects'
import { initResCat, initResDtls } from '@/data/gameData/resonators/resonatorDataStore'
import { initWpnData } from '@/data/gameData/weapons/weaponDataStore'

const GAME_DATA_KEY = '__wuwaGameDataState__'

type GameDataGlbl = {
  registry: GameDataReg | null
  initializationPromise: Promise<void> | null
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
  }

  scope[GAME_DATA_KEY] = created
  return created
}

export function hydrGameData(registry: GameDataReg): void {
  const state = getGameDataG()
  state.registry = registry
  state.initializationPromise = Promise.resolve()
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
export async function initGameData(): Promise<void> {
  const state = getGameDataG()

  if (state.registry) {
    return
  }

  if (!state.initializationPromise) {
    state.initializationPromise = (async () => {
      const [
        resSrcs,
        echoSources,
        enemySources,
        weaponData,
        resCat,
        resDtls,
        echoCatalog,
        echoStats,
        sonataSets,
        echoSetDefs,
      ] =
        await Promise.all([
          fetch('/data/resonator-sources.json').then((r) => r.json() as Promise<SrcPkg[]>),
          fetch('/data/echo-sources.json').then((r) => r.json() as Promise<SrcPkg[]>),
          fetch('/data/enemy-sources.json').then((r) => r.json() as Promise<SrcPkg[]>),
          fetch('/data/weapon-data.json').then((r) => r.json() as Promise<GenWpn[]>),
          fetch('/data/resonator-catalog.json').then((r) => r.json() as Promise<ResSeed[]>),
          fetch('/data/resonator-details.json').then((r) => r.json() as Promise<Record<string, ResDtls>>),
          fetch('/data/echo-catalog.json').then((r) => r.json() as Promise<EchoDef[]>),
          fetch('/data/echo-stats.json').then((r) => r.json() as Promise<EchoSttsCatD>),
          fetch('/data/sonata-sets.json').then((r) => r.json() as Promise<SntSetDef[]>),
          fetch('/data/sonata-set-defs.json').then((r) => r.json() as Promise<SetDef[]>),
        ])

      initResCat(resCat)
      initResDtls(resDtls)
      initWpnData(weaponData)
      initEchoCat(normEchoCat(echoCatalog))
      initEchoStts(echoStats)
      initSntSets(sonataSets)
      initEchoSetD(echoSetDefs)

      const allSources: SrcPkg[] = [
        ...resSrcs,
        ...echoSources,
        ...enemySources,
        ...mkWpnSrcs(weaponData),
        ...sntSetSrcs,
      ]

      getGameDataG().registry = mkGameDataRe(allSources, {
        resonatorStatesById: materializeResonatorStatesById(resDtls),
      })
    })().catch((error) => {
      const nextState = getGameDataG()
      nextState.initializationPromise = null
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
