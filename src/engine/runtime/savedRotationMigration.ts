/*
  Author: Runor Ewhro
  Description: Upgrades legacy personal saved rotations into the mode-less
               saved-program contract without replacing their saved record.
*/

import type { TeamSlots } from '@/domain/entities/runtime.ts'

type StoredRecord = Record<string, unknown>

function isRecord(value: unknown): value is StoredRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function readTeamSlots(value: unknown): TeamSlots | null {
  if (
    !Array.isArray(value)
    || value.length !== 3
    || value.some((member) => member !== null && typeof member !== 'string')
  ) {
    return null
  }

  return [...value] as TeamSlots
}

function readSnapshotTeam(entry: StoredRecord): TeamSlots | null {
  if (!isRecord(entry.snapshot) || !isRecord(entry.snapshot.runtime)) {
    return null
  }

  return readTeamSlots(entry.snapshot.runtime.team)
}

/**
 * `mode` is an input-only discriminator from the split personal/team era.
 * Personal entries did not duplicate their team beside the profile snapshot,
 * so materialize it before dropping the discriminator.
 */
export function migrateLegacySavedRotationRecord(value: unknown): unknown {
  if (!isRecord(value)) {
    return value
  }

  const entry: StoredRecord = { ...value }
  if (entry.mode === 'personal' && !readTeamSlots(entry.team)) {
    const resonatorId = typeof entry.resonatorId === 'string'
      ? entry.resonatorId
      : null
    const team = readSnapshotTeam(entry)
      ?? (resonatorId ? [resonatorId, null, null] satisfies TeamSlots : null)

    if (team) {
      entry.team = team
    }
  }

  // Damage summaries are derived from the current simulation environment.
  // Drop legacy snapshots at every persistence/import boundary instead of
  // allowing stale Simulation output back into the saved-rotation entity.
  delete entry.summary
  delete entry.mode
  return entry
}
