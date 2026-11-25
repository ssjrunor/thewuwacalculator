/*
  Author: Runor Ewhro
  description: prepares rotation inputs for optimizer, suggestions, and evaluation scoring.
*/
import type { EchoInstance } from '@/domain/entities/runtime'
import type { captureRotationDamagePlan } from '@/engine/rotation/damagePlan'
import { compilePortableRotation, type PortableRotationEnvironment, type RotationCandidateOptions } from './portable/compiler'

export interface RotationCandidatePlan {
  environment: PortableRotationEnvironment
  items: ReturnType<typeof captureRotationDamagePlan>['teamDamagePlan']['items']
  featureKeys: Set<string>
  damageEventKeys: Set<string>
  disabledSetParts: Readonly<Record<string, readonly string[]>>
  setControls?: RotationCandidateOptions['setControls']
  /** candidate echoes for searches with fixed catalog identities and Sonata sets. */
  candidates?: readonly EchoInstance[]
  /** also lower each participant's shown damage (PortableRotationProgram.shownOffset); the leaderboard's DPR reads it. */
  shown?: boolean
}

export function prepareRotationCandidatePlan(
  captured: ReturnType<typeof captureRotationDamagePlan>,
  options: Pick<RotationCandidatePlan, 'setControls' | 'candidates'> = {},
): RotationCandidatePlan {
  const { graph, enemy, prmrResId, catalogByResonator, stateDefsByResonator, enemyStateDefs } = captured.environment
  return {
    environment: { graph, enemy, prmrResId, catalogByResonator, stateDefsByResonator, enemyStateDefs },
    items: captured.teamDamagePlan.items,
    featureKeys: new Set(captured.teamDamagePlan.featureKeys),
    damageEventKeys: captured.damageEventKeys,
    disabledSetParts: captured.teamDamagePlan.setConds?.off ?? {},
    ...options,
  }
}

export function compileRotationCandidates(
  plan: RotationCandidatePlan,
  candidates: readonly EchoInstance[],
  options: RotationCandidateOptions = {},
  constraints?: Float32Array,
) {
  return compilePortableRotation(plan.environment, plan.items, candidates, plan.featureKeys,
    plan.disabledSetParts, constraints, plan.damageEventKeys,
    { ...options, setControls: plan.setControls, ...(plan.shown ? { shown: true } : {}) })
}
