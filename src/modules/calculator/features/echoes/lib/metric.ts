/*
  Author: Runor Ewhro
  Description: provides shared metric helpers for the echoes surface.
*/

import type { EchoInstance } from '@/domain/entities/runtime'

type MetricTier = {
  min: number
  max: number
  stage: 1 | 2 | 3 | 4 | 5 | 6
  tone: 'grey' | 'lime' | 'blue' | 'gold' | 'red' | 'cyan'
}

export type ScoreTone = MetricTier['tone']

export const SCORE_TONE_COLORS: Record<ScoreTone, string> = {
  grey: '#8c939f',
  lime: 'limegreen',
  blue: '#1f8fff',
  gold: 'gold',
  cyan: '#00f5ff',
  red: '#ff0033',
}

const SCORE_TIERS: MetricTier[] = [
  { min: 0, max: 29, stage: 1, tone: 'grey' },
  { min: 30, max: 59, stage: 2, tone: 'lime' },
  { min: 60, max: 69, stage: 3, tone: 'blue' },
  { min: 70, max: 79, stage: 4, tone: 'gold' },
  { min: 80, max: 93, stage: 5, tone: 'cyan' },
  { min: 94, max: 100, stage: 6, tone: 'red' },
]

const MAX_CV = 42

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function getTier(value: number, tiers: MetricTier[]): MetricTier {
  const safeValue = Number.isFinite(value) ? Math.floor(value) : 0
  return (
    tiers.find((tier) => safeValue >= tier.min && safeValue <= tier.max) ??
    tiers[0]
  )
}

function getPrcnFromC(cv: number, maxCv = MAX_CV): number {
  if (maxCv <= 0) return 0
  return clamp((cv / maxCv) * 100, 0, 100)
}

export function cmptEchoCrit(substats: Record<string, number>): number {
  return (substats.critRate ?? 0) * 2 + (substats.critDmg ?? 0)
}

// Crit value across an echo's full crit contribution: substats plus any crit
// rolled on the primary/secondary main stats.
export function cmptEchoCritAll(echo: EchoInstance): number {
  let critRate = echo.substats.critRate ?? 0
  let critDmg = echo.substats.critDmg ?? 0
  for (const stat of [echo.mainStats.primary, echo.mainStats.secondary]) {
    if (stat.key === 'critRate') critRate += stat.value
    else if (stat.key === 'critDmg') critDmg += stat.value
  }
  return critRate * 2 + critDmg
}

export function getScrBdgCls(score: number): string {
  const tier = getTier(score, SCORE_TIERS)
  return `echo-score-badge echo-score-badge--stage-${tier.stage} echo-score-badge--${tier.tone}`
}

export function getScrTone(score: number): ScoreTone {
  return getTier(score, SCORE_TIERS).tone
}

export function getScrToneColor(score: number): string {
  return SCORE_TONE_COLORS[getScrTone(score)]
}

export function getCvTone(cv: number, maxCv = MAX_CV): ScoreTone {
  const percent = getPrcnFromC(cv, maxCv)
  return getTier(percent, SCORE_TIERS).tone
}

export function getCvToneColor(cv: number, maxCv = MAX_CV): string {
  return SCORE_TONE_COLORS[getCvTone(cv, maxCv)]
}

export function getCvBdgClss(cv: number, maxCv = MAX_CV): string {
  const tier = getTier(getPrcnFromC(cv, maxCv), SCORE_TIERS)
  return `echo-cv-badge echo-cv-badge--stage-${tier.stage} echo-cv-badge--${tier.tone}`
}
