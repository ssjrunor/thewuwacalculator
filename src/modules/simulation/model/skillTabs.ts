/*
  Author: Runor Ewhro
  Description: Shared skill-tab order and labels for Simulation controls and
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

/*
  the same tabs cut to fit a register track. a node column states which talent
  a step came off, next to a type column that already says what kind of hit it
  is, so the tab only has to be told apart from the other nine.
*/
export const SKILL_TAB_SHORT = {
  combo: 'Combo',
  normalAttack: 'Normal Atk',
  resonanceSkill: 'Res. Skill',
  forteCircuit: 'Forte Circuit',
  resonanceLiberation: 'Res. Liberation',
  introSkill: 'Intro',
  outroSkill: 'Outro',
  tuneBreak: 'Tune Break',
  echoAttacks: 'Echo',
  negativeEffect: 'Neg. Effects',
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

export function getSkillTabShort(tab: string): string {
  return SKILL_TAB_SHORT[tab as SkillTabKey] ?? getSkillTabLabel(tab)
}

/** the short form of a tab already spelled out, for a label read back long */
export function shortenSkillTabLabel(label: string): string {
  const tab = (Object.keys(SKILL_TAB_NAMES) as SkillTabKey[])
    .find((key) => SKILL_TAB_NAMES[key] === label)
  return tab ? SKILL_TAB_SHORT[tab] : label
}

export function makeSkillTabOptions(order: readonly SkillTabKey[]): Array<{ value: SkillTabKey; label: string }> {
  // keep select option building centralized so every consumer inherits the
  // same labels and ordering for a given tab order list.
  return order.map((value) => ({
    value,
    label: getSkillTabLabel(value),
  }))
}
