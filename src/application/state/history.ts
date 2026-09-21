/*
  Author: Runor Ewhro
  Description: Provides small immutable helpers for app-history snapshots,
               stack trimming, and user-facing history labels derived from
               changed runtime or persisted domains.
*/

import type { HistoryMax, LeftPaneView, PersistedState } from '@/domain/entities/appState'
import type { ResRuntime, TeamMemRtVie } from '@/domain/entities/runtime'
import type { PersistKey } from '@/application/persistence/storage'

/**
 * Global persisted-state history is temporarily suspended while the
 * Simulation memory model is being tightened.  The stored preference remains
 * readable/editable so it can be honoured again without a migration.  Route
 * owned histories (notably the rotation editor) do not use this capability.
 */
export const RUNTIME_APP_HISTORY_ENABLED = false

export interface PrssHistEnt {
  snapshot: PersistedState
  label: string
}

export interface PrssHistStt {
  past: PrssHistEnt[]
  future: PrssHistEnt[]
  isRestoring: boolean
}

export function mkMptyHistSt(): PrssHistStt {
  return {
    past: [],
    future: [],
    isRestoring: false,
  }
}

export function clonePrssSna(snapshot: PersistedState): PersistedState {
  return structuredClone(snapshot)
}

export function mkHistEnt(snapshot: PersistedState, label: string): PrssHistEnt {
  return {
    snapshot: clonePrssSna(snapshot),
    label,
  }
}

export function trimHistEnts<TEntry>(entries: TEntry[], max: HistoryMax, keep: 'recent' | 'earliest'): TEntry[] {
  if (entries.length <= max) {
    return entries
  }

  return keep === 'recent'
    ? entries.slice(-max)
    : entries.slice(0, max)
}

function areVlsQl(left: unknown, right: unknown): boolean {
  // deep equality only matters for desc selection, so json comparison keeps
  // the helper tiny and predictable across plain persisted runtime data.
  return JSON.stringify(left) === JSON.stringify(right)
}

export function resFllbHistL(dirtyDomains: PersistKey[]): string {
  // prefer the most user-meaningful domain bucket instead of echoing raw keys.
  const domainSet = new Set(dirtyDomains)

  if (domainSet.has('library.echoes')) {
    return 'Updated Inventory Echoes'
  }

  if (domainSet.has('library.builds')) {
    return 'Updated Inventory Builds'
  }

  if (domainSet.has('library.rotations')) {
    return 'Updated Inventory Rotations'
  }

  if (domainSet.has('library.scenarios')) {
    return 'Updated Saved Scenarios'
  }

  if (domainSet.has('simulation.optimizerSettings')) {
    return 'Updated Optimizer Settings'
  }

  if (domainSet.has('combat.workspace')) {
    return 'Updated Combat Scenario'
  }

  if (domainSet.has('simulation.suggestions')) {
    return 'Updated Suggestions'
  }

  if (domainSet.has('ui.savedRotationPreferences')) {
    return 'Updated Saved Rotation Preferences'
  }

  if (domainSet.has('ui.appearance')) {
    return 'Updated Appearance'
  }

  if (domainSet.has('ui.layout')) {
    return 'Updated Layout'
  }

  return 'Updated State'
}

export function mkRtUpdHistL(
  previous: ResRuntime,
  next: ResRuntime,
): string {
  // check the most visible setup areas first so history labels stay specific.
  if (!areVlsQl(previous.build.echoes, next.build.echoes)) {
    return 'Updated Equipped Echoes'
  }

  if (!areVlsQl(previous.build.weapon, next.build.weapon)) {
    return 'Updated Weapon'
  }

  if (!areVlsQl(previous.build.team, next.build.team)
    || !areVlsQl(previous.teamRuntimes, next.teamRuntimes)) {
    return 'Updated Team Setup'
  }

  if (!areVlsQl(previous.base, next.base)) {
    return 'Updated Resonator Progression'
  }

  if (!areVlsQl(previous.rotation, next.rotation)) {
    return 'Updated Rotation'
  }

  if (!areVlsQl(previous.state, next.state)) {
    return 'Updated Combat State'
  }

  return 'Updated Resonator Setup'
}

export function mkTeamMemRtU(
  previous: TeamMemRtVie,
  next: TeamMemRtVie,
): string {
  // teammate labels mirror the primary runtime labels, but keep the wording
  // explicit so undo/redo stays readable when team edits are mixed in.
  if (!areVlsQl(previous.build.echoes, next.build.echoes)) {
    return 'Updated Teammate Echoes'
  }

  if (!areVlsQl(previous.build.weapon, next.build.weapon)) {
    return 'Updated Teammate Weapon'
  }

  if (!areVlsQl(previous.base, next.base)) {
    return 'Updated Teammate Progression'
  }

  if (!areVlsQl(previous.state, next.state)) {
    return 'Updated Teammate State'
  }

  return 'Updated Teammate Setup'
}

export function mkLeftPaneVi(view: LeftPaneView): string {
  switch (view) {
    case 'resonators':
      return 'Opened Resonators Pane'
    case 'weapon':
      return 'Opened Weapon Pane'
    case 'echoes':
      return 'Opened Echoes Pane'
    case 'suggestions':
      return 'Opened Suggestions Pane'
    case 'teams':
      return 'Opened Team Buffs Pane'
    case 'enemy':
      return 'Opened Enemy Pane'
    case 'buffs':
      return 'Opened Custom Bonuses Pane'
    case 'rotations':
      return 'Opened Rotation Pane'
    default:
      return 'Changed Left Pane View'
  }
}
