/*
  Author: Runor Ewhro
  Description: provides shared utils helpers for the results surface.
*/

import type { SkillDef, SkillSubHit } from '@/domain/entities/stats.ts'
import type { SimResult } from '@/engine/pipeline/types.ts'
import type { TeamMemCntr } from '@/domain/entities/inventoryStorage.ts'
import { formatTruncCompact } from '@/shared/lib/number.ts'

// utility builders that keep the results pane damage and summary tables aligned with the latest simulation.
const SUBHITNMBRFR = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 0,
})

export interface CntrBrkdItem {
  label: string
  percent: number
  normal: number
  crit: number
  avg: number
}

export function mkSubHitForm(
  subHits: SkillSubHit[],
  valueKey: 'normal' | 'crit' | 'avg',
): string {
  return subHits
    .map((hit) => {
      const value = SUBHITNMBRFR.format(Math.floor(hit[valueKey]))
      return hit.count > 1 ? `${value} x ${hit.count}` : value
    })
    .join(' + ')
}

export function shldViewSubH(subHits: SkillSubHit[]): boolean {
  return subHits.length > 0 && !(subHits.length === 1 && (subHits[0]?.count ?? 1) === 1)
}

export function fmtCntrPrcn(value: number): string {
  if (value >= 100) {
    return '100%'
  }

  return `${value >= 10 ? formatTruncCompact(value, 0) : formatTruncCompact(value, 1)}%`
}

function getLoopVrgDv(entry: SimResult['perSkill'][number]): number {
  if (!entry.loopRunCounts) {
    return 1
  }

  return Object.values(entry.loopRunCounts).reduce(
    (divisor, runs) => divisor * Math.max(1, Math.floor(runs)),
    1,
  )
}

function getNrmlEntTt(entry: SimResult['perSkill'][number]) {
  const divisor = getLoopVrgDv(entry)
  return {
    normal: entry.normal / divisor,
    crit: entry.crit / divisor,
    avg: entry.avg / divisor,
  }
}

export function breakdown(
  entries: SimResult['perSkill'],
  getKey: (entry: SimResult['perSkill'][number]) => string,
  getLabel: (entry: SimResult['perSkill'][number]) => string,
): CntrBrkdItem[] {
  const totalAvg = entries.reduce((sum, entry) => sum + getNrmlEntTt(entry).avg, 0)
  if (totalAvg <= 0) {
    return []
  }

  const grouped = new Map<string, { label: string; normal: number; crit: number; avg: number }>()

  for (const entry of entries) {
    const key = getKey(entry)
    const normalized = getNrmlEntTt(entry)
    const current = grouped.get(key)
    if (current) {
      current.normal += normalized.normal
      current.crit += normalized.crit
      current.avg += normalized.avg
      continue
    }

    grouped.set(key, {
      label: getLabel(entry),
      normal: normalized.normal,
      crit: normalized.crit,
      avg: normalized.avg,
    })
  }

  return Array.from(grouped.values())
    .sort((left, right) => right.avg - left.avg)
    .map((entry) => ({
      label: entry.label,
      percent: (entry.avg / totalAvg) * 100,
      normal: entry.normal,
      crit: entry.crit,
      avg: entry.avg,
    }))
}

export function mkMemCntr(
  entries: SimResult['perSkill'],
): TeamMemCntr[] {
  const grouped = new Map<string, { name: string; normal: number; crit: number; avg: number }>()

  for (const entry of entries) {
    const normalized = getNrmlEntTt(entry)
    const current = grouped.get(entry.resonatorId)
    if (current) {
      current.normal += normalized.normal
      current.crit += normalized.crit
      current.avg += normalized.avg
    } else {
      grouped.set(entry.resonatorId, {
        name: entry.resonatorName,
        normal: normalized.normal,
        crit: normalized.crit,
        avg: normalized.avg,
      })
    }
  }

  return Array.from(grouped.entries())
    .sort(([, a], [, b]) => b.avg - a.avg)
    .map(([id, data]) => ({
      id,
      name: data.name,
      contribution: { normal: data.normal, avg: data.avg, crit: data.crit },
    }))
}

export function grpSkllByTab(allSkills: SimResult['allSkills']) {
  const groups = allSkills.reduce(
    (acc, entry) => {
      const key = entry.skill.tab || 'misc'
      const current = acc.get(key) ?? []
      current.push(entry)
      acc.set(key, current)
      return acc
    },
    new Map<string, SimResult['allSkills']>(),
  )

  return Array.from(groups.entries())
}

export function getTabTitle(skill: SkillDef): string {
  if (skill.sectionTitle) {
    return skill.sectionTitle
  }

  const tabLabel = skill.tab
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (value) => value.toUpperCase())

  const nrmlLbl = skill.label.toLowerCase()
  const nrmlTab = tabLabel.toLowerCase()

  if (nrmlLbl.includes(nrmlTab)) {
    return skill.label
  }

  return `${tabLabel}: ${skill.label}`
}
