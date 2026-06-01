/*
  Author: Runor Ewhro
  Description: Shared skill-tab order and labels for calculator controls and
               editor surfaces.
*/

export const SKILL_TAB_NAMES = {
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

export type SkillTabKey = keyof typeof SKILL_TAB_NAMES

export const ROT_SKILL_TABS: SkillTabKey[] = [
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

export const OPT_SKILL_TABS: SkillTabKey[] = [
  'normalAttack',
  'resonanceSkill',
  'forteCircuit',
  'resonanceLiberation',
  'introSkill',
  'outroSkill',
  'tuneBreak',
  'negativeEffect',
]

export const BUFF_SKILL_TABS: SkillTabKey[] = [
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
  return SKILL_TAB_NAMES[tab as SkillTabKey] ?? tab
}

export function makeSkillTabOptions(order: readonly SkillTabKey[]): Array<{ value: SkillTabKey; label: string }> {
  // keep select option building centralized so every consumer inherits the
  // same labels and ordering for a given tab order list.
  return order.map((value) => ({
    value,
    label: getSkillTabLabel(value),
  }))
}
