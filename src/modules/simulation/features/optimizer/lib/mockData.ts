/*
  Author: Runor Ewhro
  Description: Provides optimizer stat labels and result-table headers shared
               by the optimizer controls and result grid.
*/

export const STAT_LIST = [
  { key: 'atk', label: 'ATK' },
  { key: 'hp', label: 'HP' },
  { key: 'def', label: 'DEF' },
  { key: 'er', label: 'ER%' },
  { key: 'cr', label: 'CR%' },
  { key: 'cd', label: 'CD%' },
] as const

export const HEADER_TITLES = [
  'Set',
  'Main',
  'Cost',
  '\u01A9 ATK',
  '\u01A9 HP',
  '\u01A9 DEF',
  '\u01A9 ER%',
  '\u01A9 CR%',
  '\u01A9 CD%',
  '\u01A9 BNS%',
  '\u01A9 AMP%',
  'DMG',
  'EFF',
]
