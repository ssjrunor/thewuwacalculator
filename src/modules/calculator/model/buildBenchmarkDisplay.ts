/*
  Author: Runor Ewhro
  Description: shared display helpers for default-rotation build benchmark scores.
*/

import type { CSSProperties } from 'react'
import { GRADE_LADDER } from '@/data/scoring/buildBenchmark.ts'

const BUILD_BENCHMARK_GRADE_TONES = {
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

const GLOWING_BUILD_BENCHMARK_GRADES = new Set(['SOLON?!', 'SON?!', 'SSS+', 'SSS', 'SS'])

export type BuildBenchmarkTone = typeof BUILD_BENCHMARK_GRADE_TONES[keyof typeof BUILD_BENCHMARK_GRADE_TONES]
export type BuildBenchmarkEmoji = typeof GRADE_EMOJI[keyof typeof GRADE_EMOJI]
export type BuildBenchmarkStyle = CSSProperties & Record<string, string | number>

function getBuildBenchmarkGradeBand(score: number): string {
  return GRADE_LADDER.find(([threshold]) => score >= threshold)?.[1] ?? '🥀'
}

export function getBuildBenchmarkTone(score: number): BuildBenchmarkTone {
  const grade = getBuildBenchmarkGradeBand(score)
  return BUILD_BENCHMARK_GRADE_TONES[grade as keyof typeof BUILD_BENCHMARK_GRADE_TONES] ?? BUILD_BENCHMARK_GRADE_TONES['🥀']
}

export function getBuildBenchmarkEmoji(grade: string): BuildBenchmarkEmoji {
  return GRADE_EMOJI[grade as keyof typeof GRADE_EMOJI] ?? grade
}

export function getBuildBenchmarkGrade(score: number | null): string | null {
  return score == null ? null : getBuildBenchmarkGradeBand(score)
}

export function isBuildBenchmarkGlowing(score: number | null): boolean {
  return score == null ? false : GLOWING_BUILD_BENCHMARK_GRADES.has(getBuildBenchmarkGradeBand(score))
}

export function isBuildBenchmarkUnreal(score: number | null): boolean {
  return score == null ? false : getBuildBenchmarkGradeBand(score) === 'SOLON?!'
}

export function getBuildBenchmarkTrackPct(score: number | null): number {
  return score == null ? 0 : Math.max(0, Math.min(100, Math.round(score / 2)))
}

export function formatBuildBenchmarkScore(score: number | null): string {
  return score == null ? '-' : `${Math.max(0, Math.round(score))}%`
}

export function getBuildBenchmarkBadgeStyle(score: number): BuildBenchmarkStyle {
  const tone = getBuildBenchmarkTone(score)
  return {
    '--metric-bg': `color-mix(in srgb, ${tone.color} ${tone.bg}%, transparent)`,
    '--metric-border': `color-mix(in srgb, ${tone.color} ${tone.border}%, var(--item-border, var(--border)))`,
    '--metric-text': `color-mix(in srgb, ${tone.color} ${tone.text}%, var(--text))`,
    '--build-score-glow': tone.color,
  }
}

export function getBuildBenchmarkResScoreStyle(score: number | null): BuildBenchmarkStyle | undefined {
  if (score == null) {
    return undefined
  }

  const tone = getBuildBenchmarkTone(score)
  return {
    '--score-color': `color-mix(in srgb, ${tone.color} ${tone.score}%, var(--text))`,
    '--build-score-glow': tone.color,
  }
}

function getBuildBenchmarkClass(baseClass: string, score: number | null, glowClass: string, unrealClass: string): string {
  const classes = [
    baseClass,
    isBuildBenchmarkGlowing(score) ? glowClass : '',
    isBuildBenchmarkUnreal(score) ? unrealClass : '',
  ].filter(Boolean)
  return classes.join(' ')
}

export function getBuildBenchmarkBadgeClass(score: number): string {
  return getBuildBenchmarkClass(
    'echo-score-badge echo-score-badge--build',
    score,
    'echo-score-badge--glow',
    'echo-score-badge--unreal',
  )
}

export function getBuildBenchmarkResScoreClass(baseClass: string, score: number | null): string {
  return getBuildBenchmarkClass(baseClass, score, 'res-score--glow', 'res-score--unreal')
}
