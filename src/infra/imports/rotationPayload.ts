/*
  Author: Runor Ewhro
  Description: Implements the rotationPayload logic for the imports module.
*/

import {
  cloneRotationNodes,
  normalizeDuration,
  normalizeRotNote,
} from '@/domain/entities/inventoryStorage.ts'
import { combatScenarioId, contextScenarioMember } from '@/domain/entities/combatScenario.ts'
import type { CombatScenario } from '@/domain/entities/combatScenario.ts'
import type { ResProf } from '@/domain/entities/profile.ts'
import type { RotationNode } from '@/domain/gameData/contracts.ts'
import { migrateLegacyRotationItems } from '@/domain/gameData/loopPasses.ts'
import { getResSeedBy } from '@/domain/services/resonatorSeedService.ts'
import { makeResProfile, makeScenarioFromProfiles } from '@/domain/state/defaults.ts'
import { migrateLegacySavedRotationRecord } from '@/domain/state/savedRotationMigration.ts'
import { parseCombatScenario } from '@/domain/state/schema.ts'

function normalizeImportedRotation(raw: unknown): {
  name: string
  resName: string
  duration?: number
  note?: string
  scenario: CombatScenario
} | null {
  const migrated = migrateLegacySavedRotationRecord(raw)
  if (!migrated || typeof migrated !== 'object' || Array.isArray(migrated)) {
    return null
  }

  const value = migrated as Record<string, unknown>
  const name = typeof value.name === 'string' ? value.name : null
  const parsedScenario = parseCombatScenario(value.scenario)
  if (name && parsedScenario.success) {
    const scenario = parsedScenario.data as unknown as CombatScenario
    const context = contextScenarioMember(scenario)
    return {
      name,
      resName: getResSeedBy(context.resonatorId)?.name ?? context.resonatorId,
      duration: normalizeDuration(value.duration),
      note: normalizeRotNote(value.note),
      scenario: structuredClone(scenario),
    }
  }

  const resonatorId = typeof value.resonatorId === 'string' ? value.resonatorId : null
  const seed = getResSeedBy(resonatorId ?? '')
  const items = Array.isArray(value.items)
    ? cloneRotationNodes(
      migrateLegacyRotationItems(value.items as RotationNode[]),
      { freshIds: true },
    )
    : null

  if (!resonatorId || !seed || !name || !items) {
    return null
  }

  const snapshot = value.snapshot && typeof value.snapshot === 'object'
    ? value.snapshot as ResProf
    : makeResProfile(seed)
  const scenario = makeScenarioFromProfiles(
    { [resonatorId]: snapshot },
    null,
    0,
    resonatorId,
  )
  scenario.id = combatScenarioId(`imported-rotation:${String(value.id ?? name)}`)
  scenario.program = { ...scenario.program, program: items }

  return {
    name,
    resName: seed.name,
    duration: normalizeDuration(value.duration),
    note: normalizeRotNote(value.note),
    scenario,
  }
}

export type NormalizedImportedRotation = NonNullable<ReturnType<typeof normalizeImportedRotation>>

export function normalizeImportedRotationEntries(parsed: unknown): NormalizedImportedRotation[] {
  let candidates: unknown[]

  if (
    parsed
    && typeof parsed === 'object'
    && 'kind' in parsed
    && (parsed as Record<string, unknown>).kind === 'rotation-export'
  ) {
    const wrapped = parsed as Record<string, unknown>
    candidates = Array.isArray(wrapped.rotations)
      ? wrapped.rotations
      : 'rotation' in wrapped
        ? [wrapped.rotation]
        : []
  } else {
    candidates = Array.isArray(parsed) ? parsed : [parsed]
  }

  return candidates
    .map(normalizeImportedRotation)
    .filter((entry): entry is NormalizedImportedRotation => Boolean(entry))
}
