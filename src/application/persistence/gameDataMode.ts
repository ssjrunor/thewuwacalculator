/*
  Author: Runor Ewhro
  Description: Reads the persisted game-data mode before the app bootstraps the
               game-data registry.
*/

import { DEF_UI_PREFS } from '@/domain/entities/preferences'
import { gameDataModeFromBeta, type GameDataMode } from '@/domain/entities/gameDataMode'
import { APP_STORAGE_KEY, APPSTOREUILY } from '@/application/persistence/storageKeys'

function readBetaFlag(raw: string | null): boolean | null {
  if (!raw) {
    return null
  }

  try {
    const parsed = JSON.parse(raw) as {
      ui?: {
        preferences?: {
          gameBetaData?: unknown
        }
      }
    }
    const value = parsed.ui?.preferences?.gameBetaData
    return typeof value === 'boolean' ? value : null
  } catch {
    return null
  }
}

export function readPersistedGameDataMode(): GameDataMode {
  if (typeof localStorage === 'undefined') {
    return gameDataModeFromBeta(DEF_UI_PREFS.gameBetaData)
  }

  const layoutFlag = readBetaFlag(localStorage.getItem(APPSTOREUILY))
  if (layoutFlag !== null) {
    return gameDataModeFromBeta(layoutFlag)
  }

  const monolithFlag = readBetaFlag(localStorage.getItem(APP_STORAGE_KEY))
  if (monolithFlag !== null) {
    return gameDataModeFromBeta(monolithFlag)
  }

  return gameDataModeFromBeta(DEF_UI_PREFS.gameBetaData)
}
