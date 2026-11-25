/*
  Author: Runor Ewhro
  description: one colour per skill type, the same on every build, so
               Liberation reads as Liberation wherever a rotation is split.
*/

import type { SkillTypeKey } from '@/domain/entities/stats'
import { ROTATION_CHART_COLORS as C } from '@/modules/simulation/surfaces/modulation/evaluationFeatureDisplay'

const BY_TYPE: Partial<Record<SkillTypeKey | 'feature', string>> = {
  basicAtk: C[0], resonanceLiberation: C[1], resonanceSkill: C[2], introSkill: C[3], outroSkill: C[4],
  echoSkill: C[5], heavyAtk: C[6], coord: C[7], tuneRupture: C[8],
}

export const skillTypeColor = (key: string): string => BY_TYPE[key as SkillTypeKey] ?? C[9]
