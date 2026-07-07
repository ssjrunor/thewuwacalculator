/*
  Author: Runor Ewhro
  Description: provides settings-page data management helpers and derived values.
*/

import type { PersistedState } from '@/domain/entities/appState'
import type { ResProf } from '@/domain/entities/profile'
import type { SuggestState } from '@/domain/entities/suggestions'
import { makeSuggest } from '@/domain/state/defaults'
import type { AppStore } from '@/domain/state/store'
import { selectPersisted } from '@/domain/state/serialization'
import { parsePersisted } from '@/infra/persistence/storage'

export type DataXprtKind =
  | 'current-resonator'
  | 'profiles'
  | 'inventory'
  | 'settings'
  | 'session'

export interface DataXprtCtn {
  kind: DataXprtKind
  label: string
}

interface DataXprtBndl<TKind extends DataXprtKind, TData> {
  exportFormat: 'wwcalc-data'
  version: 1
  kind: TKind
  exportedAt: string
  data: TData
}

type CurResBndl = DataXprtBndl<'current-resonator', {
  profile: ResProf
  suggestions: SuggestState | null
}>

type PrflBndl = DataXprtBndl<'profiles', {
  activeResonatorId: string | null
  profiles: PersistedState['calculator']['profiles']
  suggestionsByResonatorId: PersistedState['calculator']['suggestionsByResonatorId']
  optimizerContext: PersistedState['calculator']['optimizerContext']
}>

type InvBndl = DataXprtBndl<'inventory', {
  inventoryEchoes: PersistedState['calculator']['inventoryEchoes']
  inventoryBuilds: PersistedState['calculator']['inventoryBuilds']
  inventoryRotations: PersistedState['calculator']['inventoryRotations']
}>

type SetsBndl = DataXprtBndl<'settings', {
  ui: PersistedState['ui']
}>

type SssnBndl = DataXprtBndl<'session', {
  session: PersistedState['calculator']['session']
}>

type DataXprtBnrc =
  | CurResBndl
  | PrflBndl
  | InvBndl
  | SetsBndl
  | SssnBndl

type LegacyPrflData = {
  actResId?: string | null
  suggsByResId?: PersistedState['calculator']['suggestionsByResonatorId']
  optimizer?: PersistedState['calculator']['optimizerContext']
}

type LegacyInvData = {
  invChs?: PersistedState['calculator']['inventoryEchoes']
  invBlds?: PersistedState['calculator']['inventoryBuilds']
  invRttn?: PersistedState['calculator']['inventoryRotations']
}

export interface XprtDataFile {
  fileName: string
  raw: string
  label: string
}

export interface RslvMprtData {
  label: string
  snapshot: PersistedState
}

export const DATAXPRTCTNS: DataXprtCtn[] = [
  { kind: 'current-resonator', label: 'Current Resonator' },
  { kind: 'profiles', label: 'Resonators' },
  { kind: 'inventory', label: 'Inventory' },
  { kind: 'settings', label: 'Settings' },
  { kind: 'session', label: 'Session' },
]

function mkTmst(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function buildBundle<TKind extends DataXprtKind, TData>(
  kind: TKind,
  data: TData,
): DataXprtBndl<TKind, TData> {
  // every partial export uses the same envelope so import can distinguish a
  // bundle from a full persisted snapshot before merging into current state.
  return {
    exportFormat: 'wwcalc-data',
    version: 1,
    kind,
    exportedAt: new Date().toISOString(),
    data,
  }
}

function isDataXprtBn(value: unknown): value is DataXprtBnrc {
  return (
    isRecord(value)
    && value.exportFormat === 'wwcalc-data'
    && value.version === 1
    && typeof value.kind === 'string'
    && 'data' in value
  )
}

function resActResId(
  preferredId: string | null | undefined,
  profiles: PersistedState['calculator']['profiles'],
  fallbackId: string | null,
): string | null {
  // restored session ids can point at profiles that are not present in the
  // imported subset, so choose the first surviving valid profile deterministically.
  if (preferredId && profiles[preferredId]) {
    return preferredId
  }

  if (fallbackId && profiles[fallbackId]) {
    return fallbackId
  }

  return Object.keys(profiles)[0] ?? null
}

function prsBndlJson(raw: string): DataXprtBnrc {
  let parsed: unknown

  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('Import is not valid JSON.')
  }

  if (!isDataXprtBn(parsed)) {
    throw new Error('Import did not match a supported export format.')
  }

  return parsed
}

export function mkDataXprtFi(state: AppStore, kind: DataXprtKind): XprtDataFile {
  const persistedState = selectPersisted(state)
  const stamp = mkTmst()

  switch (kind) {
    case 'current-resonator': {
      const actResId = state.calculator.session.activeResonatorId
      const profile = actResId ? state.calculator.profiles[actResId] : null
      if (!actResId || !profile) {
        throw new Error('No active resonator is available to export.')
      }

      const raw = JSON.stringify(
        buildBundle('current-resonator', {
          profile: structuredClone(profile),
          suggestions: structuredClone(state.calculator.suggestionsByResonatorId[actResId] ?? null),
        }),
        null,
        2,
      )

      return {
        fileName: `wwcalc-current-resonator-${actResId}-${stamp}.json`,
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

export function resMprtData(raw: string, currentState: AppStore): RslvMprtData {
  try {
    // full snapshots already include all persistence domains and can be handed
    // directly to the persistence parser.
    return {
      label: 'full snapshot',
      snapshot: parsePersisted(raw),
    }
  } catch {
    const bundle = prsBndlJson(raw)
    // partial imports patch a cloned current snapshot so unrelated domains are
    // preserved instead of being reset to defaults.
    const snapshot = structuredClone(selectPersisted(currentState))

    switch (bundle.kind) {
      case 'current-resonator': {
        const profile = bundle.data.profile
        if (!profile?.resonatorId) {
          throw new Error('Current resonator backup is missing a resonator profile.')
        }

        snapshot.calculator.profiles[profile.resonatorId] = structuredClone(profile)
        snapshot.calculator.suggestionsByResonatorId[profile.resonatorId] = structuredClone(
          bundle.data.suggestions ?? makeSuggest(),
        )
        snapshot.calculator.session.activeResonatorId = profile.resonatorId
        return {
          label: 'current resonator backup',
          snapshot,
        }
      }
      case 'profiles': {
        const data = bundle.data as PrflBndl['data'] & LegacyPrflData
        snapshot.calculator.profiles = structuredClone(data.profiles)
        snapshot.calculator.suggestionsByResonatorId = structuredClone(
          data.suggestionsByResonatorId ?? data.suggsByResId ?? {},
        )
        snapshot.calculator.optimizerContext = structuredClone(
          data.optimizerContext ?? data.optimizer ?? null,
        )
        snapshot.calculator.session.activeResonatorId = resActResId(
          data.activeResonatorId ?? data.actResId,
          snapshot.calculator.profiles,
          snapshot.calculator.session.activeResonatorId,
        )

        if (
          snapshot.calculator.optimizerContext
          && !snapshot.calculator.profiles[snapshot.calculator.optimizerContext.resonatorId]
        ) {
          // optimizer context is only valid while its owning profile exists.
          snapshot.calculator.optimizerContext = null
        }

        return {
          label: 'resonator backup',
          snapshot,
        }
      }
      case 'inventory': {
        const data = bundle.data as InvBndl['data'] & LegacyInvData
        snapshot.calculator.inventoryEchoes = structuredClone(data.inventoryEchoes ?? data.invChs ?? [])
        snapshot.calculator.inventoryBuilds = structuredClone(data.inventoryBuilds ?? data.invBlds ?? [])
        snapshot.calculator.inventoryRotations = structuredClone(data.inventoryRotations ?? data.invRttn ?? [])
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
        snapshot.calculator.session.activeResonatorId = resActResId(
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
