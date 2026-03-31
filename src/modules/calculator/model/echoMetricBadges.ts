type MetricTier = {
  min: number
  max: number
  stage: 1 | 2 | 3 | 4 | 5 | 6
  tone: 'grey' | 'lime' | 'blue' | 'gold' | 'red' | 'cyan'
}

const SCORE_TIERS: MetricTier[] = [
  { min: 0, max: 29, stage: 1, tone: 'grey' },
  { min: 30, max: 59, stage: 2, tone: 'lime' },
  { min: 60, max: 69, stage: 3, tone: 'blue' },
  { min: 70, max: 79, stage: 4, tone: 'gold' },
  { min: 80, max: 94, stage: 5, tone: 'red' },
  { min: 95, max: 100, stage: 6, tone: 'cyan' },
]

const MAX_CV = 42

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function getTier(value: number, tiers: MetricTier[]): MetricTier {
  const safeValue = Number.isFinite(value) ? value : 0
  return (
    tiers.find((tier) => safeValue >= tier.min && safeValue <= tier.max) ??
    tiers[0]
  )
}

function getPercentFromCV(cv: number, maxCv = MAX_CV): number {
  if (maxCv <= 0) return 0
  return clamp((cv / maxCv) * 100, 0, 100)
}

export function computeEchoCritValue(substats: Record<string, number>): number {
  return (substats.critRate ?? 0) * 2 + (substats.critDmg ?? 0)
}

export function getScoreBadgeClass(score: number): string {
  const tier = getTier(score, SCORE_TIERS)
  return `echo-score-badge echo-score-badge--stage-${tier.stage} echo-score-badge--${tier.tone}`
}

export function getCvBadgeClass(cv: number, maxCv = MAX_CV): string {
  const percent = getPercentFromCV(cv, maxCv)
  const tier = getTier(percent, SCORE_TIERS)
  return `echo-cv-badge echo-cv-badge--stage-${tier.stage} echo-cv-badge--${tier.tone}`
}
