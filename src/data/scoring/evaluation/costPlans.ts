/*
  Author: Runor Ewhro
  Description: Defines the canonical Echo cost layouts used by evaluation and
               filters them when an objective requires a particular main cost.
*/

const EVALUATION_COST_PLANS = [
  [4, 4, 1, 1, 1],
  [4, 3, 3, 1, 1],
  [4, 3, 1, 1, 1],
  [4, 1, 1, 1, 1],
  [3, 3, 3, 1, 1],
  [3, 3, 1, 1, 1],
  [3, 1, 1, 1, 1],
  [1, 1, 1, 1, 1],
] as const

export function makeEvaluationCostPlans(requiredCost?: number | null): number[][] {
  const plans = requiredCost
      ? EVALUATION_COST_PLANS.filter((plan) => plan.some((cost) => cost === requiredCost))
      : EVALUATION_COST_PLANS

  const selected = plans.length > 0 ? plans : EVALUATION_COST_PLANS
  return selected.map((plan) => [...plan])
}
