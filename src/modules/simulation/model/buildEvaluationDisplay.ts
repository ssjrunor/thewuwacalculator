/*
  Author: Runor Ewhro
  Description: shared display helpers for default-rotation build evaluation scores.
*/

import { GRADE_LADDER } from '@/engine/evaluation/buildEvaluation.ts'

const BUILD_EVALUATION_GRADE_TONES = {
  'SOLON?!': { color: '#ff0033', bg: 14, border: 38, text: 92, score: 96},
  'SON?!': { color: '#3dffd2', bg: 14, border: 38, text: 86, score: 86 },
  'SSS+': { color: '#53efef', bg: 13, border: 36, text: 88, score: 92 },
  SSS: { color: '#2ff8ff', bg: 12, border: 34, text: 86, score: 88 },
  SS: { color: '#ffd617', bg: 12, border: 34, text: 86, score: 90 },
  S: { color: '#f4d124', bg: 12, border: 34, text: 86, score: 90 },
  'A+': { color: '#b9cd2f', bg: 11, border: 28, text: 78, score: 78 },
  A: { color: '#778f2e', bg: 10, border: 26, text: 76, score: 76 },
  'A-': { color: '#64af69', bg: 10, border: 26, text: 76, score: 76 },
  'B+': { color: '#1c8cb5', bg: 10, border: 26, text: 76, score: 76 },
  B: { color: '#7babcd', bg: 10, border: 26, text: 76, score: 76 },
  'C+': { color: '#6b8bbc', bg: 10, border: 24, text: 74, score: 74 },
  C: { color: '#6f8799', bg: 10, border: 24, text: 74, score: 74 },
  'C-': { color: '#758595', bg: 10, border: 24, text: 72, score: 72 },
  D: { color: '#68737e', bg: 10, border: 24, text: 72, score: 72 },
  E: { color: '#82889a', bg: 10, border: 24, text: 72, score: 72 },
  F: { color: '#777f88', bg: 10, border: 24, text: 72, score: 72 },
  cute: { color: '#777f88', bg: 10, border: 24, text: 72, score: 72 },
  'son..': { color: '#939393', bg: 10, border: 24, text: 72, score: 72 },
  '🥀': { color: '#939393', bg: 10, border: 24, text: 72, score: 72 },
} as const

const GRADE_EMOJI = {
  'SOLON?!': '( ⚆ _ ⚆ )',
  'SON?!': '(⊙ _ ⊙ )',
  'SSS+': '(∩˃o˂∩)✧',
  SSS: 'ദ്ദി ˉ꒳ˉ )✧',
  SS: 'ദ്ദി(ᵔᗜᵔ)',
  S: '(ദ്ദി ˙ᗜ˙ )',
  'A+': '(👍🏻ᴗ _ᴗ)👍🏻',
  'A-': 'ദ്ദി ˉᴗ ˉ )',
  'A': '( •⌄• )✧',
  'B+': '(„• ֊ •„)',
  'B': '(｡･･｡)',
  'C+': '(っ\'ヮ\'c)',
  C: '(゜。゜)',
  'C-': '(゜-゜)',
  D: '(≖_≖ )',
  'son..': '( ༎ຶŎ༎ຶ )',
  E: '(ー_ーゞ',
  F: '(👁ˋ _ ˊ 👁)',
  cute: '🫶🏻🥹❤️‍🩹',
  '🥀': '😭🙏💔'
}

export type BuildEvaluationTone = typeof BUILD_EVALUATION_GRADE_TONES[keyof typeof BUILD_EVALUATION_GRADE_TONES]
export type BuildEvaluationEmoji = typeof GRADE_EMOJI[keyof typeof GRADE_EMOJI]
function getBuildEvaluationGradeBand(score: number): string {
  return GRADE_LADDER.find(([threshold]) => score >= threshold)?.[1] ?? '🥀'
}

export function getBuildEvaluationTone(score: number): BuildEvaluationTone {
  const grade = getBuildEvaluationGradeBand(score)
  return BUILD_EVALUATION_GRADE_TONES[grade as keyof typeof BUILD_EVALUATION_GRADE_TONES] ?? BUILD_EVALUATION_GRADE_TONES['🥀']
}

export function getBuildEvaluationEmoji(grade: string): BuildEvaluationEmoji {
  return GRADE_EMOJI[grade as keyof typeof GRADE_EMOJI] ?? grade
}

export function getBuildEvaluationGrade(score: number | null): string | null {
  return score == null ? null : getBuildEvaluationGradeBand(score)
}

export function getBuildEvaluationTrackPct(score: number | null): number {
  return score == null ? 0 : Math.max(0, Math.min(100, Math.round(score / 2)))
}

export function formatBuildEvaluationScore(score: number | null): string {
  return score == null ? '-' : `${Math.max(0, Math.trunc(score))}%`
}
