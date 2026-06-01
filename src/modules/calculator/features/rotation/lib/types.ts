/*
  Author: Runor Ewhro
  Description: Defines shared rotation-editor view types used across tree,
               setup, inspector, and modal helpers.
*/

import type { FeatDef, RotationNode, RtChng, SourceState } from '@/domain/gameData/contracts.ts'
import type { InvRotEnt } from '@/domain/entities/inventoryStorage.ts'
import type { ResRuntime, ResonatorId } from '@/domain/entities/runtime.ts'
import type { AttributeKey, SkillAggType, SkillDef } from '@/domain/entities/stats.ts'
import type { MenuEntry } from '@/shared/ui/CtxMenu.tsx'
import type {SimResult} from "@/engine/pipeline/types.ts";

export type RotBrnc = 'root' | 'items' | 'setup'
export type RotDragArea = 'root' | 'block-items' | 'block-setup'

export interface RotPanePrps {
  runtime: ResRuntime
  runtimesById: Record<string, ResRuntime>
  simulation: SimResult | null
  onRtPdt: (updater: (runtime: ResRuntime) => ResRuntime) => void
}

export interface NodeTotals {
  normal: number
  crit: number
  avg: number
}

export interface RotNsrtTgt {
  parentId: string | null
  branch: RotBrnc
  index?: number
}

export interface RotDropTgt extends RotNsrtTgt {
  index: number
  key: string
}

export interface SvdRotDtrDrf {
  name: string
  duration: string
  note: string
}

export interface PndnRotSave {
  name: string
  mode: 'personal' | 'team'
  resonatorId: ResonatorId
  resName: string
  duration?: number
  note?: string
  team?: ResRuntime['build']['team']
  items: ResRuntime['rotation']['personalItems']
  snapshot?: InvRotEnt['snapshot']
  summary?: InvRotEnt['summary']
}

export type SvdRotDtrTgt =
  | { kind: 'create'; rotation: PndnRotSave }
  | { kind: 'edit'; rotation: InvRotEnt }

export interface FeatMenuStt {
  mode: 'add' | 'edit'
  actMemId: string
  target?: RotNsrtTgt
  nodeId?: string
}

export interface CondDtrStt {
  mode: 'add' | 'edit'
  target?: RotNsrtTgt
  nodeId?: string
}

export interface FeatCondStt {
  nodeId: string
}

export type CondAction = 'set' | 'add'

export interface FeatCondDrft {
  id: string
  action: CondAction
  choiceId: string
  value: string | number | boolean
}

export interface NegFfctCnfgS {
  nodeId: string
}

export interface BlckPckrStt {
  target: RotNsrtTgt
}

export interface LoopDtrStt {
  target: RotNsrtTgt
}

export interface WhenDtrStt {
  nodeId: string
}

export interface RotLoadPay {
  mode: 'personal' | 'team'
  resonatorId: ResonatorId
  resName: string
  team?: ResRuntime['build']['team']
  items: RotationNode[]
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

export interface SkllMenuGrp {
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
  label: string
  description?: string
  dscrPrms?: Array<string | number>
  state: SourceState
  changeTarget?: 'runtime' | 'enemy'
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

export interface RotMemEnt {
  id: string
  name: string
  profile: string
  attribute: AttributeKey
  runtime: ResRuntime
  skills: SkillDef[]
  features: FeatDef[]
  states: SourceState[]
}

export interface NodeMemIcon {
  name: string
  profile: string
}

export interface TrnsRslt {
  items: RotationNode[]
  skippedCount: number
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
  select?: {
    disabled?: boolean
    onSelect?: () => void
  }
}

export interface RotNodeLctn {
  parentId: string | null
  branch: RotBrnc
  index: number
  node: RotationNode
}

export interface RotCondMdlNp {
  visible: boolean
  open: boolean
  closing?: boolean
  portalTarget: HTMLElement | null
}

export interface RotCondBldrP {
  id?: string
  enabled?: boolean
  fallbackResId?: string
}

export interface SvdRotDrftNp {
  target: SvdRotDtrTgt | null | undefined
}

export type RotCondVl = string | number | boolean
export type RotCondChng = RtChng
