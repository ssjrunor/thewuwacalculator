/*
  Author: Runor Ewhro
  Description: Builds and caches the full game-data source package list
               and the derived registry used across the calculator.
*/

import { initEchoCatalog } from '@/data/gameData/catalog/echoes'
import { initEchoStatsCatalog, type EchoStatsCatalogData } from '@/data/gameData/catalog/echoStats'
import { initSonataSets, type SonataSetDefinition } from '@/data/gameData/catalog/sonataSets'
import { initEchoSetDefinitions, sonataSetSources, type SetDef } from '@/data/gameData/echoSets/effects'
import type { GameDataRegistry, SourcePackage } from '@/domain/gameData/contracts'
import { buildGameDataRegistry } from '@/domain/gameData/registry'
import type { EchoDefinition } from '@/domain/entities/catalog'
import type { ResonatorSeed } from '@/domain/entities/runtime'
import type { ResonatorDetails } from '@/domain/entities/resonator'
import type { GeneratedWeapon } from '@/domain/entities/weapon'
import { buildWeaponSources } from '@/data/gameData/weapons/effects'
import { initResonatorCatalog, initResonatorDetails } from '@/data/gameData/resonators/resonatorDataStore'
import { initWeaponData } from '@/data/gameData/weapons/weaponDataStore'

let gameDataRegistryCache: GameDataRegistry | null = null
let gameDataInitializationPromise: Promise<void> | null = null

export function hydrateGameDataRegistry(registry: GameDataRegistry): void {
  gameDataRegistryCache = registry
  gameDataInitializationPromise = Promise.resolve()
}

function normalizePublicAssetPath(path: string): string {
  return path.startsWith('/public/') ? path.slice('/public'.length) : path
}

function normalizeEchoCatalog(catalog: EchoDefinition[]): EchoDefinition[] {
  return catalog.map((echo) => ({
    ...echo,
    icon: normalizePublicAssetPath(echo.icon),
  }))
}

// load and cache all game data, then build the registry
export async function initializeGameData(): Promise<void> {
  if (gameDataRegistryCache) {
    return
  }

  if (!gameDataInitializationPromise) {
    gameDataInitializationPromise = (async () => {
      const [
        resonatorSources,
        echoSources,
        weaponData,
        resonatorCatalog,
        resonatorDetails,
        echoCatalog,
        echoStats,
        sonataSets,
        echoSetDefs,
      ] =
        await Promise.all([
          fetch('/data/resonator-sources.json').then((r) => r.json() as Promise<SourcePackage[]>),
          fetch('/data/echo-sources.json').then((r) => r.json() as Promise<SourcePackage[]>),
          fetch('/data/weapon-data.json').then((r) => r.json() as Promise<GeneratedWeapon[]>),
          fetch('/data/resonator-catalog.json').then((r) => r.json() as Promise<ResonatorSeed[]>),
          fetch('/data/resonator-details.json').then((r) => r.json() as Promise<Record<string, ResonatorDetails>>),
          fetch('/data/echo-catalog.json').then((r) => r.json() as Promise<EchoDefinition[]>),
          fetch('/data/echo-stats.json').then((r) => r.json() as Promise<EchoStatsCatalogData>),
          fetch('/data/sonata-sets.json').then((r) => r.json() as Promise<SonataSetDefinition[]>),
          fetch('/data/sonata-set-defs.json').then((r) => r.json() as Promise<SetDef[]>),
        ])

      initResonatorCatalog(resonatorCatalog)
      initResonatorDetails(resonatorDetails)
      initWeaponData(weaponData)
      initEchoCatalog(normalizeEchoCatalog(echoCatalog))
      initEchoStatsCatalog(echoStats)
      initSonataSets(sonataSets)
      initEchoSetDefinitions(echoSetDefs)

      const allSources: SourcePackage[] = [
        ...resonatorSources,
        ...echoSources,
        ...buildWeaponSources(weaponData),
        ...sonataSetSources,
      ]

      gameDataRegistryCache = buildGameDataRegistry(allSources)
    })().catch((error) => {
      gameDataInitializationPromise = null
      throw error
    })
  }

  await gameDataInitializationPromise
}

// get the global game-data registry (must call initializeGameData first)
export function getGameData(): GameDataRegistry {
  if (!gameDataRegistryCache) {
    throw new Error('Game data not initialized — call initializeGameData() first')
  }
  return gameDataRegistryCache
}
