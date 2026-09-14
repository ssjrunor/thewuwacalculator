/*
  Author: Runor Ewhro
  Description: Implements the rotationSummary logic for the entities module.
*/

import type { ResonatorId } from './runtime'

export interface RotationDamageTotals {
  normal: number
  avg: number
  crit: number
}

export interface RotationMemberContribution {
  id: ResonatorId
  name: string
  contribution: RotationDamageTotals
}

/** Calculated comparison data. This is never part of a saved rotation. */
export interface RotationComparisonSummary {
  total: RotationDamageTotals
  members?: RotationMemberContribution[]
}
