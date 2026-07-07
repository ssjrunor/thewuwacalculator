/*
  Author: Runor Ewhro
  Description: Public benchmark scoring contracts shared by workers and UI.
*/
import type { ResRuntime } from '@/domain/entities/runtime';
import type { SkillTypeKey } from '@/domain/entities/stats';
import type { EnemyProfile } from '@/domain/entities/appState';
import type { RotationNode } from '@/domain/gameData/contracts';
import type { SimResult } from '@/engine/pipeline/types';



export interface BenchmarkSubstatEntry {
  key: string
  count: number
  effectiveCount: number
  rollValue: number
  total: number
}

export interface BenchmarkSetSummary {
  setId: number
  name: string
  pieces: number
}

export interface BenchmarkStatValue {
  key: string
  value: number
}

export interface BenchmarkEchoSlot {
  echoId: string
  echoName: string
  cost: number
  mainEcho: boolean
  setId: number
  setName: string
  primary: { key: string; value: number }
  secondary: { key: string; value: number }
  equippedSubstats: BenchmarkStatValue[]
}

export type BenchmarkSubstatMode = 'none' | 'equipped' | 'generated'
export type BenchmarkBuildKey = 'baseline0' | 'active' | 'benchmark100' | 'benchmark200'

export interface BenchmarkBuildSnapshot {
  label: string
  score: number
  damage: number
  sets: BenchmarkSetSummary[]
  echoes: BenchmarkEchoSlot[]
  substatMode: BenchmarkSubstatMode
  statRows: BenchmarkStatContribution[]
  overviewStats: BenchmarkOverviewStats
  features: BenchmarkFeature[]
  featureGroups: BenchmarkFeatureGroups
}

export interface BenchmarkStatContribution {
  key: string
  mainTotal: number
  mainCount: number
  substatTotal: number
  total: number
  substatCount: number
  qualityPct: number
  damage: number
  sharePct: number
}

export type BenchmarkAltKind = 'mainStatSwap' | 'mainStatAdd' | 'sonataSet'
export type BenchmarkAltOp = 'swap' | 'add' | 'set'

export interface BenchmarkAlternative {
  kind: BenchmarkAltKind
  operation: BenchmarkAltOp
  cost: number
  from: string | null
  to: string | null
  fromPrimary: BenchmarkStatValue | null
  toPrimary: BenchmarkStatValue | null
  fromSecondaryKey: string | null
  toSecondaryKey: string | null
  fromSets?: BenchmarkSetSummary[]
  toSets?: BenchmarkSetSummary[]
  damage: number
  damageDelta: number
  damageDeltaPct: number
  score: number
  scoreDelta: number
}

export interface BenchmarkFeature {
  skillId: string
  label: string
  tab: string
  skillType: SkillTypeKey[]
  damage: number
  weightedDamage: number
  sharePct: number
}

export interface BenchmarkFeatureGroup {
  key: string
  label: string
  sharePct: number
  skillType?: SkillTypeKey
}

export interface BenchmarkFeatureGroups {
  skillTypes: BenchmarkFeatureGroup[]
  tabs: BenchmarkFeatureGroup[]
}

export interface BenchmarkOverviewStatRow {
  key: string
  label: string
  base: number
  bonus: number
  total: number
  color?: string
}

export interface BenchmarkOverviewStats {
  mainStats: BenchmarkOverviewStatRow[]
  secondaryStats: BenchmarkOverviewStatRow[]
  dmgMdfrStts: BenchmarkOverviewStatRow[]
}

export interface BenchmarkStatTreeLeaf {
  kind: 'leaf'
  key: string
  label: string
  value: number
  displayValue: string
  color?: string
}

export interface BenchmarkStatTreeBranch {
  kind: 'branch'
  key: string
  label: string
  color?: string
  flow?: 'grid'
  children: BenchmarkStatTreeNode[]
}

export type BenchmarkStatTreeNode = BenchmarkStatTreeLeaf | BenchmarkStatTreeBranch

export interface BuildBenchmark {
  userDamage: number
  baselineDamage: number      // optimal mains, no substats (0%)
  benchmarkDamage: number     // optimal mains + optimal substats at benchmark quality (100%)
  perfectionDamage: number    // optimal mains + optimal substats at max rolls (200%)
  percent: number             // 0 = baseline, 1 = benchmark, 2 = perfection
  grade: string
  invariantStats: BenchmarkStatTreeNode[]
  builds: Record<BenchmarkBuildKey, BenchmarkBuildSnapshot>
}

export interface BenchmarkRotationSummary {
  id: string
  name: string
  resonatorId: string
  items: RotationNode[]
}

export interface BuildBenchmarkReport {
  benchmark: BuildBenchmark
  alternatives: BenchmarkAlternative[]
  rotation: BenchmarkRotationSummary | null
}

export interface BenchmarkReportSections {
  rotationFeatures: boolean
  upgradePaths: boolean
  echoStatsTable: boolean
  benchmarkTargets: boolean
}

export interface BenchmarkReportOpts {
  alternativesLimit?: number
  sections?: Partial<BenchmarkReportSections>
}

export interface DefRotBenchIn {
  runtime: ResRuntime
  simulation: SimResult | null
  enemy: EnemyProfile
  runtimesById: Record<string, ResRuntime>
}
