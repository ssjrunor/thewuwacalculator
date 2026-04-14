/*
  author: runor ewhro
  description: shared skill-tab order and labels for calculator controls.
*/

export const SKILL_TAB_LABELS = {
  combo: 'Combo',
  normalAttack: 'Normal Attack',
  resonanceSkill: 'Resonance Skill',
  forteCircuit: 'Forte Circuit',
  resonanceLiberation: 'Resonance Liberation',
  introSkill: 'Intro Skill',
  outroSkill: 'Outro Skill',
  tuneBreak: 'Tune Break',
  echoAttacks: 'Echo Attacks',
  negativeEffect: 'Negative Effects',
} as const

export type SkillTabKey = keyof typeof SKILL_TAB_LABELS

export const ROTATION_SKILL_TAB_ORDER: SkillTabKey[] = [
  'combo',
  'normalAttack',
  'resonanceSkill',
  'forteCircuit',
  'resonanceLiberation',
  'introSkill',
  'outroSkill',
  'tuneBreak',
  'echoAttacks',
  'negativeEffect',
]

export const OPTIMIZER_SKILL_TAB_ORDER: SkillTabKey[] = [
  'normalAttack',
  'resonanceSkill',
  'forteCircuit',
  'resonanceLiberation',
  'introSkill',
  'outroSkill',
  'tuneBreak',
  'negativeEffect',
]

export const MANUAL_BUFF_SKILL_TAB_ORDER: SkillTabKey[] = [
  'normalAttack',
  'resonanceSkill',
  'forteCircuit',
  'resonanceLiberation',
  'introSkill',
  'outroSkill',
  'tuneBreak',
  'echoAttacks',
  'negativeEffect',
]

export function getSkillTabLabel(tab: string): string {
  return SKILL_TAB_LABELS[tab as SkillTabKey] ?? tab
}

export function makeSkillTabOptions(order: readonly SkillTabKey[]): Array<{ value: SkillTabKey; label: string }> {
  return order.map((value) => ({
    value,
    label: getSkillTabLabel(value),
  }))
}
