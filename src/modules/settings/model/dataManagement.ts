import type { PersistedAppState } from '@/domain/entities/appState'
import type { ResonatorProfile } from '@/domain/entities/profile'
import type { ResonatorSuggestionsState } from '@/domain/entities/suggestions'
import { createDefaultResonatorSuggestionsState } from '@/domain/state/defaults'
import type { AppStore } from '@/domain/state/store'
import { selectPersistedState } from '@/domain/state/serialization'
import { parsePersistedAppStateJson } from '@/infra/persistence/storage'

export type DataExportKind =
  | 'current-resonator'
  | 'profiles'
  | 'inventory'
  | 'settings'
  | 'session'

export interface DataExportAction {
  kind: DataExportKind
  label: string
}

interface DataExportBundleBase<TKind extends DataExportKind, TData> {
  exportFormat: 'wwcalc-data'
  version: 1
  kind: TKind
  exportedAt: string
  data: TData
}

type CurrentResonatorBundle = DataExportBundleBase<'current-resonator', {
  profile: ResonatorProfile
  suggestions: ResonatorSuggestionsState | null
}>

type ProfilesBundle = DataExportBundleBase<'profiles', {
  activeResonatorId: string | null
  profiles: PersistedAppState['calculator']['profiles']
  suggestionsByResonatorId: PersistedAppState['calculator']['suggestionsByResonatorId']
  optimizerContext: PersistedAppState['calculator']['optimizerContext']
}>

type InventoryBundle = DataExportBundleBase<'inventory', {
  inventoryEchoes: PersistedAppState['calculator']['inventoryEchoes']
  inventoryBuilds: PersistedAppState['calculator']['inventoryBuilds']
  inventoryRotations: PersistedAppState['calculator']['inventoryRotations']
}>

type SettingsBundle = DataExportBundleBase<'settings', {
  ui: PersistedAppState['ui']
}>

type SessionBundle = DataExportBundleBase<'session', {
  session: PersistedAppState['calculator']['session']
}>

type DataExportBundle =
  | CurrentResonatorBundle
  | ProfilesBundle
  | InventoryBundle
  | SettingsBundle
  | SessionBundle

export interface ExportedDataFile {
  fileName: string
  raw: string
  label: string
}

export interface ResolvedImportedData {
  label: string
  snapshot: PersistedAppState
}

export const DATA_EXPORT_ACTIONS: DataExportAction[] = [
  { kind: 'current-resonator', label: 'Current Resonator' },
  { kind: 'profiles', label: 'Resonators' },
  { kind: 'inventory', label: 'Inventory' },
  { kind: 'settings', label: 'Settings' },
  { kind: 'session', label: 'Session' },
]

function buildTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function buildBundle<TKind extends DataExportKind, TData>(
  kind: TKind,
  data: TData,
): DataExportBundleBase<TKind, TData> {
  return {
    exportFormat: 'wwcalc-data',
    version: 1,
    kind,
    exportedAt: new Date().toISOString(),
    data,
  }
}

function isDataExportBundle(value: unknown): value is DataExportBundle {
  return (
    isRecord(value)
    && value.exportFormat === 'wwcalc-data'
    && value.version === 1
    && typeof value.kind === 'string'
    && 'data' in value
  )
}

function resolveActiveResonatorId(
  preferredId: string | null | undefined,
  profiles: PersistedAppState['calculator']['profiles'],
  fallbackId: string | null,
): string | null {
  if (preferredId && profiles[preferredId]) {
    return preferredId
  }

  if (fallbackId && profiles[fallbackId]) {
    return fallbackId
  }

  return Object.keys(profiles)[0] ?? null
}

function parseBundleJson(raw: string): DataExportBundle {
  let parsed: unknown

  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('Import is not valid JSON.')
  }

  if (!isDataExportBundle(parsed)) {
    throw new Error('Import did not match a supported export format.')
  }

  return parsed
}

export function buildDataExportFile(state: AppStore, kind: DataExportKind): ExportedDataFile {
  const persistedState = selectPersistedState(state)
  const stamp = buildTimestamp()

  switch (kind) {
    case 'current-resonator': {
      const activeResonatorId = state.calculator.session.activeResonatorId
      const profile = activeResonatorId ? state.calculator.profiles[activeResonatorId] : null
      if (!activeResonatorId || !profile) {
        throw new Error('No active resonator is available to export.')
      }

      const raw = JSON.stringify(
        buildBundle('current-resonator', {
          profile: structuredClone(profile),
          suggestions: structuredClone(state.calculator.suggestionsByResonatorId[activeResonatorId] ?? null),
        }),
        null,
        2,
      )

      return {
        fileName: `wwcalc-current-resonator-${activeResonatorId}-${stamp}.json`,
        raw,
        label: 'current resonator backup',
      }
    }
    case 'profiles': {
      const raw = JSON.stringify(
        buildBundle('profiles', {
          activeResonatorId: persistedState.calculator.session.activeResonatorId,
          profiles: structuredClone(persistedState.calculator.profiles),
          suggestionsByResonatorId: structuredClone(persistedState.calculator.suggestionsByResonatorId),
          optimizerContext: structuredClone(persistedState.calculator.optimizerContext),
        }),
        null,
        2,
      )

      return {
        fileName: `wwcalc-resonators-${stamp}.json`,
        raw,
        label: 'resonator backup',
      }
    }
    case 'inventory': {
      const raw = JSON.stringify(
        buildBundle('inventory', {
          inventoryEchoes: structuredClone(persistedState.calculator.inventoryEchoes),
          inventoryBuilds: structuredClone(persistedState.calculator.inventoryBuilds),
          inventoryRotations: structuredClone(persistedState.calculator.inventoryRotations),
        }),
        null,
        2,
      )

      return {
        fileName: `wwcalc-inventory-${stamp}.json`,
        raw,
        label: 'inventory backup',
      }
    }
    case 'settings': {
      const raw = JSON.stringify(
        buildBundle('settings', {
          ui: structuredClone(persistedState.ui),
        }),
        null,
        2,
      )

      return {
        fileName: `wwcalc-settings-${stamp}.json`,
        raw,
        label: 'settings backup',
      }
    }
    case 'session': {
      const raw = JSON.stringify(
        buildBundle('session', {
          session: structuredClone(persistedState.calculator.session),
        }),
        null,
        2,
      )

      return {
        fileName: `wwcalc-session-${stamp}.json`,
        raw,
        label: 'session backup',
      }
    }
  }
}

export function resolveImportedData(raw: string, currentState: AppStore): ResolvedImportedData {
  try {
    return {
      label: 'full snapshot',
      snapshot: parsePersistedAppStateJson(raw),
    }
  } catch {
    const bundle = parseBundleJson(raw)
    const snapshot = structuredClone(selectPersistedState(currentState))

    switch (bundle.kind) {
      case 'current-resonator': {
        const profile = bundle.data.profile
        if (!profile?.resonatorId) {
          throw new Error('Current resonator backup is missing a resonator profile.')
        }

        snapshot.calculator.profiles[profile.resonatorId] = structuredClone(profile)
        snapshot.calculator.suggestionsByResonatorId[profile.resonatorId] = structuredClone(
          bundle.data.suggestions ?? createDefaultResonatorSuggestionsState(),
        )
        snapshot.calculator.session.activeResonatorId = profile.resonatorId
        return {
          label: 'current resonator backup',
          snapshot,
        }
      }
      case 'profiles': {
        snapshot.calculator.profiles = structuredClone(bundle.data.profiles)
        snapshot.calculator.suggestionsByResonatorId = structuredClone(bundle.data.suggestionsByResonatorId)
        snapshot.calculator.optimizerContext = structuredClone(bundle.data.optimizerContext)
        snapshot.calculator.session.activeResonatorId = resolveActiveResonatorId(
          bundle.data.activeResonatorId,
          snapshot.calculator.profiles,
          snapshot.calculator.session.activeResonatorId,
        )

        if (
          snapshot.calculator.optimizerContext
          && !snapshot.calculator.profiles[snapshot.calculator.optimizerContext.resonatorId]
        ) {
          snapshot.calculator.optimizerContext = null
        }

        return {
          label: 'resonator backup',
          snapshot,
        }
      }
      case 'inventory': {
        snapshot.calculator.inventoryEchoes = structuredClone(bundle.data.inventoryEchoes)
        snapshot.calculator.inventoryBuilds = structuredClone(bundle.data.inventoryBuilds)
        snapshot.calculator.inventoryRotations = structuredClone(bundle.data.inventoryRotations)
        return {
          label: 'inventory backup',
          snapshot,
        }
      }
      case 'settings': {
        snapshot.ui = structuredClone(bundle.data.ui)
        return {
          label: 'settings backup',
          snapshot,
        }
      }
      case 'session': {
        snapshot.calculator.session = structuredClone(bundle.data.session)
        snapshot.calculator.session.activeResonatorId = resolveActiveResonatorId(
          bundle.data.session.activeResonatorId,
          snapshot.calculator.profiles,
          currentState.calculator.session.activeResonatorId,
        )
        return {
          label: 'session backup',
          snapshot,
        }
      }
    }
  }
}
