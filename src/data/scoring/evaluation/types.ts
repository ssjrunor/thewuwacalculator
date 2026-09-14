/*
  Author: Runor Ewhro
  Description: Public evaluation scoring contracts shared by workers and UI.
*/
import type { ResRuntime } from '@/domain/entities/runtime';
import type { SkillTypeKey } from '@/domain/entities/stats';
import type { EnemyProfile } from '@/domain/entities/appState';
import type { CombatScenarioId, TeamMemberId } from '@/domain/entities/combatScenario';
import type { RotationNode } from '@/domain/gameData/contracts';
import type { SimResult } from '@/engine/pipeline/types';



export interface EvaluationSubstatEntry {
  key: string
  count: number
  effectiveCount: number
  rollValue: number
  total: number
}

export interface EvaluationSetSummary {
  setId: number
  name: string
  pieces: number
}

export interface EvaluationStatValue {
  key: string
  value: number
}

export interface EvaluationEchoSlot {
  echoId: string
  echoName: string
  cost: number
  mainEcho: boolean
  setId: number
  setName: string
  primary: { key: string; value: number }
  secondary: { key: string; value: number }
  equippedSubstats: EvaluationStatValue[]
}

export type EvaluationSubstatMode = 'none' | 'equipped' | 'generated'
export type EvaluationBuildKey = 'baselineBuild' | 'active' | 'referenceBuild' | 'maximumBuild'

export interface EvaluationBuildSnapshot {
  label: string
  score: number
  damage: number
  sets: EvaluationSetSummary[]
  echoes: EvaluationEchoSlot[]
  substatMode: EvaluationSubstatMode
  statRows: EvaluationStatContribution[]
  overviewStats: EvaluationOverviewStats
  features: EvaluationFeature[]
  featureGroups: EvaluationFeatureGroups
}

export interface EvaluationStatContribution {
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

export type EvaluationAltKind = 'mainStatSwap' | 'mainStatAdd' | 'sonataSet'
export type EvaluationAltOp = 'swap' | 'add' | 'set'

export interface EvaluationAlternative {
  kind: EvaluationAltKind
  operation: EvaluationAltOp
  cost: number
  from: string | null
  to: string | null
  fromPrimary: EvaluationStatValue | null
  toPrimary: EvaluationStatValue | null
  fromSecondaryKey: string | null
  toSecondaryKey: string | null
  fromSets?: EvaluationSetSummary[]
  toSets?: EvaluationSetSummary[]
  damage: number
  damageDelta: number
  damageDeltaPct: number
  score: number
  scoreDelta: number
}

export interface EvaluationFeature {
  skillId: string
  label: string
  tab: string
  skillType: SkillTypeKey[]
  damage: number
  weightedDamage: number
  sharePct: number
}

export interface EvaluationFeatureGroup {
  key: string
  label: string
  sharePct: number
  skillType?: SkillTypeKey
}

export interface EvaluationFeatureGroups {
  skillTypes: EvaluationFeatureGroup[]
  tabs: EvaluationFeatureGroup[]
}

export interface EvaluationOverviewStatRow {
  key: string
  label: string
  base: number
  bonus: number
  total: number
  color?: string
}

export interface EvaluationOverviewStats {
  mainStats: EvaluationOverviewStatRow[]
  secondaryStats: EvaluationOverviewStatRow[]
  dmgMdfrStts: EvaluationOverviewStatRow[]
}

export interface EvaluationStatTreeLeaf {
  kind: 'leaf'
  key: string
  label: string
  value: number
  displayValue: string
  color?: string
}

export interface EvaluationStatTreeBranch {
  kind: 'branch'
  key: string
  label: string
  color?: string
  flow?: 'grid'
  children: EvaluationStatTreeNode[]
}

export type EvaluationStatTreeNode = EvaluationStatTreeLeaf | EvaluationStatTreeBranch

export interface BuildEvaluation {
  userDamage: number
  baselineDamage: number      // no Echo stats, Sonata rows, or main Echo effect (0%)
  referenceDamage: number     // best legal generated Echo frame + evaluation-quality substats (100%)
  maximumDamage: number       // best legal generated Echo frame + max-roll substats (200%)
  percent: number             // 0 = baseline, 1 = evaluation, 2 = perfection
  grade: string
  invariantStats: EvaluationStatTreeNode[]
  builds: Record<EvaluationBuildKey, EvaluationBuildSnapshot>
}

export interface EvaluationRotationSummary {
  id: string
  name: string
  resonatorId: string
  items: RotationNode[]
}

export interface BuildEvaluationReport {
  evaluation: BuildEvaluation
  alternatives: EvaluationAlternative[]
  rotation: EvaluationRotationSummary | null
}

export interface EvaluationReportSections {
  rotationFeatures: boolean
  upgradePaths: boolean
  echoStatsTable: boolean
  evaluationTargets: boolean
}

export interface EvaluationReportOpts {
  alternativesLimit?: number
  sections?: Partial<EvaluationReportSections>
}

export interface DefRotEvaluationIn {
  scenarioId: CombatScenarioId
  memberId: TeamMemberId
  runtime: ResRuntime
  simulation: SimResult | null
  enemy: EnemyProfile
  runtimesById: Record<string, ResRuntime>
}
