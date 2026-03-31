import type { SkillDefinition, SkillSubHitResult } from '@/domain/entities/stats'
import type { SimulationResult } from '@/engine/pipeline/types'
import type { TeamMemberContribution } from '@/domain/entities/inventoryStorage'

// utility builders that keep the right pane damage and summary tables aligned with the latest simulation.
export interface ContributionBreakdownItem {
  label: string
  percent: number
  normal: number
  crit: number
  avg: number
}

export function buildSubHitFormula(
  subHits: SkillSubHitResult[],
  valueKey: 'normal' | 'crit' | 'avg',
): string {
  return subHits
    .map((hit) => {
      const value = String(Math.floor(hit[valueKey]))
      return hit.count > 1 ? `${value} x ${hit.count}` : value
    })
    .join(' + ')
}

export function shouldRenderSubHitRows(subHits: SkillSubHitResult[]): boolean {
  return !(subHits.length === 1 && (subHits[0]?.count ?? 1) === 1)
}

export function formatContributionPercent(value: number): string {
  if (value >= 99.95) {
    return '100%'
  }

  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)}%`
}

export function buildContributionBreakdown(
  entries: SimulationResult['perSkill'],
  getKey: (entry: SimulationResult['perSkill'][number]) => string,
  getLabel: (entry: SimulationResult['perSkill'][number]) => string,
): ContributionBreakdownItem[] {
  const totalAvg = entries.reduce((sum, entry) => sum + entry.avg, 0)
  if (totalAvg <= 0) {
    return []
  }

  const grouped = new Map<string, { label: string; normal: number; crit: number; avg: number }>()

  for (const entry of entries) {
    const key = getKey(entry)
    const current = grouped.get(key)
    if (current) {
      current.normal += entry.normal
      current.crit += entry.crit
      current.avg += entry.avg
      continue
    }

    grouped.set(key, {
      label: getLabel(entry),
      normal: entry.normal,
      crit: entry.crit,
      avg: entry.avg,
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

export function buildMemberContributions(
  entries: SimulationResult['perSkill'],
): TeamMemberContribution[] {
  const grouped = new Map<string, { name: string; normal: number; crit: number; avg: number }>()

  for (const entry of entries) {
    const current = grouped.get(entry.resonatorId)
    if (current) {
      current.normal += entry.normal
      current.crit += entry.crit
      current.avg += entry.avg
    } else {
      grouped.set(entry.resonatorId, {
        name: entry.resonatorName,
        normal: entry.normal,
        crit: entry.crit,
        avg: entry.avg,
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

export function groupSkillsByTab(allSkills: SimulationResult['allSkills']) {
  const groups = allSkills.reduce(
    (acc, entry) => {
      const key = entry.skill.tab || 'misc'
      const current = acc.get(key) ?? []
      current.push(entry)
      acc.set(key, current)
      return acc
    },
    new Map<string, SimulationResult['allSkills']>(),
  )

  return Array.from(groups.entries())
}

export function getTabTitle(skill: SkillDefinition): string {
  if (skill.sectionTitle) {
    return skill.sectionTitle
  }

  const tabLabel = skill.tab
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (value) => value.toUpperCase())

  const normalizedLabel = skill.label.toLowerCase()
  const normalizedTab = tabLabel.toLowerCase()

  if (normalizedLabel.includes(normalizedTab)) {
    return skill.label
  }

  return `${tabLabel}: ${skill.label}`
}
