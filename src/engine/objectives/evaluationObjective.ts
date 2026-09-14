/*
  Author: Runor Ewhro
  Description: Defines one evaluation objective language shared by direct
               features, rotations, weighted plans, and composite searches.
*/

import type { TeamMemberId } from '@/domain/entities/combatScenario'

export type EvaluationMetric = 'normal' | 'crit' | 'avg'

export type EvaluationObjective =
  | {
    kind: 'feature'
    memberId: TeamMemberId
    featureId: string
    metric: EvaluationMetric
  }
  | {
    kind: 'rotation'
    memberIds?: readonly TeamMemberId[]
    program: 'sequence' | 'program'
    metric: EvaluationMetric
  }
  | {
    kind: 'weighted'
    terms: readonly {
      objective: EvaluationObjective
      weight: number
    }[]
  }
  | {
    kind: 'combo'
    combine: 'sum' | 'product' | 'minimum' | 'maximum'
    objectives: readonly EvaluationObjective[]
  }

export interface EvaluationObjectiveSource {
  members: Readonly<Record<TeamMemberId, {
    allFeatures: readonly {
      id: string
      feature: { id: string }
      normal: number
      crit: number
      avg: number
    }[]
    rotation: {
      sequence: { total: Record<EvaluationMetric, number> }
      program: { total: Record<EvaluationMetric, number> }
    }
  }>>
}

export function evaluateObjective(
  source: EvaluationObjectiveSource,
  objective: EvaluationObjective,
): number {
  switch (objective.kind) {
    case 'feature': {
      const member = source.members[objective.memberId]
      const feature = member?.allFeatures.find((entry) =>
        entry.id === objective.featureId || entry.feature.id === objective.featureId)
      return feature?.[objective.metric] ?? 0
    }
    case 'rotation': {
      const memberIds = objective.memberIds ?? Object.keys(source.members) as TeamMemberId[]
      return memberIds.reduce((total, memberId) => (
        total + (source.members[memberId]?.rotation[objective.program].total[objective.metric] ?? 0)
      ), 0)
    }
    case 'weighted':
      return objective.terms.reduce((total, term) => (
        total + evaluateObjective(source, term.objective) * term.weight
      ), 0)
    case 'combo': {
      const values = objective.objectives.map((entry) => evaluateObjective(source, entry))
      if (values.length === 0) return 0
      switch (objective.combine) {
        case 'sum': return values.reduce((total, value) => total + value, 0)
        case 'product': return values.reduce((total, value) => total * value, 1)
        case 'minimum': return Math.min(...values)
        case 'maximum': return Math.max(...values)
      }
    }
  }
}
