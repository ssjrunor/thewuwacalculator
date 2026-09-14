/*
  Author: Runor Ewhro
  Description: Projects the last-run live advanced rotation into the saved
               rotation contract without adding it to persisted inventory.
*/

import type { SavedRotation } from '@/domain/entities/inventoryStorage.ts'
import { contextScenarioMember } from '@/domain/entities/combatScenario.ts'
import type { CombatScenario } from '@/domain/entities/combatScenario.ts'
import type { RotationNode } from '@/domain/gameData/contracts.ts'

export const LIVE_ROTATION_ENTRY_PREFIX = 'live-rotation:'

/** Whether an id names the live projection rather than a banked rotation. */
export function isLiveRotEntId(id: string | null | undefined): boolean {
  return typeof id === 'string' && id.startsWith(LIVE_ROTATION_ENTRY_PREFIX)
}

/**
 * Build an immutable, saved-rotation-compatible view of a live program.
 * A program that has never been committed through Run has no truthful saved
 * date, so it deliberately has no projection yet.
 */
export function makeLiveRotationEntry(
  scenario: CombatScenario | null | undefined,
  resonatorName: string,
  options: {
    items?: RotationNode[]
    lastRanAt?: number | null
    name?: string
  } = {},
): SavedRotation | null {
  const lastRanAt = options.lastRanAt === undefined
    ? scenario?.program.lastRanAt
    : options.lastRanAt
  if (!scenario || typeof lastRanAt !== 'number' || !Number.isFinite(lastRanAt)) {
    return null
  }

  const snapshot = structuredClone(scenario)
  snapshot.program = {
    ...snapshot.program,
    ...(options.items === undefined ? {} : { program: structuredClone(options.items) }),
    lastRanAt,
  }
  const context = contextScenarioMember(snapshot)
  return {
    id: `${LIVE_ROTATION_ENTRY_PREFIX}${scenario.id}:${context.id}`,
    name: options.name ?? `${resonatorName} Live Rotation`,
    duration: 0,
    note: '',
    scenario: snapshot,
    createdAt: lastRanAt,
    updatedAt: lastRanAt,
  }
}
