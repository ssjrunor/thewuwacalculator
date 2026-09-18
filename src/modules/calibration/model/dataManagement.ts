/*
  Author: Runor Ewhro
  Description: Serializes full and partial app-data exports, validates imported
               envelopes, and merges selected domains into persisted snapshots.
*/

import type { HydratedAppState, LegacyProfileMap, PersistedState } from '@/domain/entities/appState'
import type { ResProf } from '@/domain/entities/profile'
import type { CombatSession } from '@/domain/entities/session'
import type { SuggestState } from '@/domain/entities/suggestions'
import { initAppState, makeScenarioFromProfiles, makeSuggest } from '@/domain/state/defaults'
import {
  addScenario,
  replaceScenario,
  scenarioIdForContextResonator,
  selectScenario,
  selectedCombatScenario,
} from '@/domain/entities/scenarioLibrary'
import { combatScenarioId, contextScenarioMember } from '@/domain/entities/combatScenario'
import type { AppStore } from '@/domain/state/store'
import { selectPersisted } from '@/domain/state/serialization'
import { parsePersisted } from '@/infra/persistence/storage'
import { projectScenarioWorkspaceProfiles } from '@/domain/state/scenarioRuntime'

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
  profiles: LegacyProfileMap
  suggestionsByResonatorId: PersistedState['simulation']['suggestionsByResonatorId']
  optimizerSettings: PersistedState['simulation']['optimizerSettings']
}>

type InvBndl = DataXprtBndl<'inventory', {
  inventoryEchoes: PersistedState['library']['echoes']
  inventoryBuilds: PersistedState['library']['builds']
  inventoryRotations: PersistedState['library']['rotations']
  savedScenarios: PersistedState['library']['scenarios']
}>

type SetsBndl = DataXprtBndl<'settings', {
  ui: PersistedState['ui']
}>

type SssnBndl = DataXprtBndl<'session', {
  /** Legacy bundle payload converted to a combat scenario during import. */
  session: CombatSession
}>

type DataXprtBnrc =
  | CurResBndl
  | PrflBndl
  | InvBndl
  | SetsBndl
  | SssnBndl

type LegacyPrflData = {
  actResId?: string | null
  suggsByResId?: PersistedState['simulation']['suggestionsByResonatorId']
  optimizerContext?: { settings?: PersistedState['simulation']['optimizerSettings'] } | null
  optimizer?: { settings?: PersistedState['simulation']['optimizerSettings'] } | null
}

type LegacyInvData = {
  invChs?: PersistedState['library']['echoes']
  invBlds?: PersistedState['library']['builds']
  invRttn?: PersistedState['library']['rotations']
  invScenarios?: PersistedState['library']['scenarios']
}

export interface XprtDataFile {
  fileName: string
  raw: string
  label: string
}

export interface RslvMprtData {
  label: string
  snapshot: HydratedAppState
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
  profiles: LegacyProfileMap,
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

function vldtPtchSnap(
  snapshot: PersistedState | HydratedAppState,
  label: string,
): HydratedAppState {
  // bundle payloads are only structurally guarded on the way in, so the
  // patched snapshot is revalidated through the same persisted-schema pipeline
  // as full snapshots before it can reach the live store.
  try {
    return parsePersisted(JSON.stringify(snapshot))
  } catch {
    throw new Error(`The ${label} contains data the app does not recognize, so nothing was imported.`)
  }
}

function makeImportWorkingState(currentState: PersistedState): HydratedAppState {
  return structuredClone(currentState)
}

function replaceImportedScenario(
  snapshot: HydratedAppState,
  scenario: ReturnType<typeof makeScenarioFromProfiles>,
): void {
  const contextResonatorId = contextScenarioMember(scenario).resonatorId
  const existingId = scenarioIdForContextResonator(snapshot.combat, contextResonatorId)
  let scenarioId = existingId ?? combatScenarioId(`scenario:${contextResonatorId}`)
  let suffix = 2
  while (!existingId && snapshot.combat.scenariosById[scenarioId]) {
    scenarioId = combatScenarioId(`scenario:${contextResonatorId}:${suffix}`)
    suffix += 1
  }
  const workingScenario = {
    ...scenario,
    id: scenarioId,
  }
  snapshot.combat = existingId
    ? selectScenario(replaceScenario(snapshot.combat, workingScenario), scenarioId)
    : addScenario(snapshot.combat, workingScenario, true)
}

export function mkDataXprtFi(state: AppStore, kind: DataXprtKind): XprtDataFile {
  const persistedState = selectPersisted(state)
  const profiles = projectScenarioWorkspaceProfiles(state.combat)
  const selectedScenario = selectedCombatScenario(state.combat)
  const stamp = mkTmst()

  switch (kind) {
    case 'current-resonator': {
      const actResId = selectedScenario.team.members[0]?.resonatorId ?? null
      const profile = actResId ? profiles[actResId] : null
      if (!actResId || !profile) {
        throw new Error('No active resonator is available to export.')
      }

      const raw = JSON.stringify(
        buildBundle('current-resonator', {
          profile: structuredClone(profile),
          suggestions: structuredClone(state.simulation.suggestionsByResonatorId[actResId] ?? null),
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
          activeResonatorId:
            selectedScenario.team.members[0]?.resonatorId ?? null,
          profiles: structuredClone(profiles),
          suggestionsByResonatorId: structuredClone(persistedState.simulation.suggestionsByResonatorId),
          optimizerSettings: structuredClone(persistedState.simulation.optimizerSettings),
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
          inventoryEchoes: structuredClone(persistedState.library.echoes),
          inventoryBuilds: structuredClone(persistedState.library.builds),
          inventoryRotations: structuredClone(persistedState.library.rotations),
          savedScenarios: structuredClone(persistedState.library.scenarios),
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
      const scenario = selectedScenario
      const raw = JSON.stringify(
        buildBundle('session', {
          session: {
            activeResonatorId: scenario.team.members[0].resonatorId,
            enemyProfile: structuredClone(scenario.target),
          },
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

export function resMprtData(raw: string, currentState: PersistedState): RslvMprtData {
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
    const snapshot = makeImportWorkingState(currentState)
    const selectedScenario = selectedCombatScenario(snapshot.combat)

    switch (bundle.kind) {
      case 'current-resonator': {
        const profile = bundle.data.profile
        if (!profile?.resonatorId) {
          throw new Error('Current resonator backup is missing a resonator profile.')
        }

        snapshot.simulation.suggestionsByResonatorId[profile.resonatorId] = structuredClone(
          bundle.data.suggestions ?? makeSuggest(),
        )
        replaceImportedScenario(snapshot, makeScenarioFromProfiles(
          { [profile.resonatorId]: profile },
          {
            activeResonatorId: profile.resonatorId,
            enemyProfile: selectedScenario.target,
          },
          selectedScenario.revision + 1,
          profile.resonatorId,
        ))
        return {
          label: 'current resonator backup',
          snapshot: vldtPtchSnap(snapshot, 'current resonator backup'),
        }
      }
      case 'profiles': {
        const data = bundle.data as PrflBndl['data'] & LegacyPrflData
        const profiles = structuredClone(data.profiles)
        const suggestionsByResonatorId = structuredClone(
          data.suggestionsByResonatorId ?? data.suggsByResId ?? {},
        )
        const optimizerSettings = structuredClone(
          data.optimizerSettings
          ?? data.optimizerContext?.settings
          ?? data.optimizer?.settings
          ?? snapshot.simulation.optimizerSettings,
        )
        const activeResonatorId = resActResId(
          data.activeResonatorId ?? data.actResId,
          profiles,
          selectedScenario.team.members[0].resonatorId,
        )
        const migrated = initAppState({
          ...currentState,
          combat: undefined,
          simulation: {
            ...currentState.simulation,
            profiles,
            suggestionsByResonatorId,
            optimizerSettings,
            session: {
            activeResonatorId,
            enemyProfile: selectedScenario.target,
            },
          },
        })

        return {
          label: 'resonator backup',
          snapshot: vldtPtchSnap(migrated, 'resonator backup'),
        }
      }
      case 'inventory': {
        const data = bundle.data as InvBndl['data'] & LegacyInvData
        snapshot.library.echoes = structuredClone(data.inventoryEchoes ?? data.invChs ?? [])
        snapshot.library.builds = structuredClone(data.inventoryBuilds ?? data.invBlds ?? [])
        snapshot.library.rotations = structuredClone(data.inventoryRotations ?? data.invRttn ?? [])
        snapshot.library.scenarios = structuredClone(
          data.savedScenarios ?? data.invScenarios ?? snapshot.library.scenarios,
        )
        return {
          label: 'inventory backup',
          snapshot: vldtPtchSnap(snapshot, 'inventory backup'),
        }
      }
      case 'settings': {
        snapshot.ui = structuredClone(bundle.data.ui)
        return {
          label: 'settings backup',
          snapshot: vldtPtchSnap(snapshot, 'settings backup'),
        }
      }
      case 'session': {
        const session = structuredClone(bundle.data.session)
        const profiles = projectScenarioWorkspaceProfiles(snapshot.combat)
        session.activeResonatorId = resActResId(
          bundle.data.session.activeResonatorId,
          profiles,
          selectedCombatScenario(currentState.combat).team.members[0].resonatorId,
        )
        replaceImportedScenario(snapshot, makeScenarioFromProfiles(
          profiles,
          session,
          selectedScenario.revision + 1,
          session.activeResonatorId,
        ))
        return {
          label: 'session backup',
          snapshot: vldtPtchSnap(snapshot, 'session backup'),
        }
      }
    }
  }
}
