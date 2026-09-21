/*
  Author: Runor Ewhro
  Description: Contracts shared by rotation catalogs, authoring controls, and
               immutable node-tree operations.
*/

import type { FeatDef, SourceState } from '@/domain/gameData/contracts.ts'
import type { RotationInsertTarget } from '@/domain/gameData/rotationTree.ts'
import type { ResRuntime } from '@/domain/entities/runtime.ts'
import type { AttributeKey, SkillAggType, SkillDef } from '@/domain/entities/stats.ts'
import type { MenuEntry } from '@/shared/ui/CtxMenu.tsx'

export interface NodeTotals {
  normal: number
  crit: number
  avg: number
}

export interface FeatureMenuState {
  mode: 'add' | 'edit'
  actMemId: string
  target?: RotationInsertTarget
  nodeId?: string
}

export interface ConditionEditorState {
  mode: 'add' | 'edit'
  target?: RotationInsertTarget
  nodeId?: string
}

export interface FeatureAttachmentState {
  nodeId: string
}

export type CondAction = 'set' | 'add'

export interface FeatureConditionDraft {
  id: string
  action: CondAction
  choiceId: string
  value: string | number | boolean
}

export interface SkillMenuEntry {
  featureId: string
  resonatorId: string
  resName: string
  featureLabel: string
  feature: FeatDef
  skill: SkillDef
  variant: 'skill' | 'subHit'
  hitIndex?: number
}

export interface SkillMenuGroup {
  resonatorId: string
  resName: string
  skill: SkillDef
  totalEntry: SkillMenuEntry | null
  subHitNtrs: SkillMenuEntry[]
}

export interface CondChoice {
  id: string
  resonatorId: string
  resName: string
  sourceName: string
  /** semantic effect/passive identity; distinct from the authored control label */
  effectName?: string
  label: string
  description?: string
  dscrPrms?: Array<string | number>
  state: SourceState
  changeTarget?: 'runtime' | 'enemy' | 'rotation'
}

export interface FeatureMeta {
  label: string
  skillId?: string
  tab: string
  archetype?: SkillDef['archetype']
  section?: string
  skillTypeLabel: string
  element: AttributeKey
  ggrgType: SkillAggType
  resonatorId: string
  resName: string
  variant?: 'skill' | 'subHit'
  hitIndex?: number
  fixedStacks?: boolean
}

export interface RotationMember {
  id: string
  name: string
  profile: string
  attribute: AttributeKey
  runtime: ResRuntime
  skills: SkillDef[]
  features: FeatDef[]
  states: SourceState[]
}

export interface EditConfig {
  copy?: {
    disabled?: boolean
    onSelect?: () => void
  }
  cut?: {
    disabled?: boolean
    onSelect?: () => void
  }
  paste?: {
    hidden?: boolean
    disabled?: boolean
    onSelect?: () => void
    submenu?: MenuEntry[]
  }
  /* only offered where a surface asks for it, so menus that have no notion of
     duplicating a thing are left as they were */
  duplicate?: {
    disabled?: boolean
    onSelect?: () => void
  }
  select?: {
    disabled?: boolean
    onSelect?: () => void
  }
}

export interface RotationConditionOptions {
  id?: string
  enabled?: boolean
  fallbackResId?: string
}

export type RotationConditionValue = string | number | boolean
