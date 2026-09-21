/*
  Author: Runor Ewhro
  Description: Builds searchable palette specifications from live feature, condition, and owner metadata.
*/

import type { SkillAggType } from '@/domain/entities/stats.ts'

export type PaletteSpec =
  | {
    kind: 'step'
    label: string
    featureId: string
    resonatorId: string
    tab: string
    color?: string
    aggregationType?: SkillAggType
    echoId?: string
  }
  | {
    kind: 'condition'
    label: string
    choiceId: string
  }
