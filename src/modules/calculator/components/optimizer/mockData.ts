export interface MockEchoStats {
  atk: number
  hp: number
  def: number
  er: number
  cr: number
  cd: number
  bonus: number
  amp: number
}

export interface MockResult {
  damage: number
  stats: MockEchoStats
  cost: number
  sets: { id: number; icon: string; count: number }[]
  mainEchoIcon: string | null
}

export interface MockEcho {
  name: string
  icon: string
  cost: number
  selectedSet: number
  mainStats: Record<string, number>
  subStats: Record<string, number>
}

export const MOCK_BASE_STATS: MockEchoStats = {
  atk: 3248,
  hp: 18432,
  def: 1102,
  er: 110.0,
  cr: 62.4,
  cd: 198.2,
  bonus: 45.6,
  amp: 0.0,
}

export const MOCK_BASE_DAMAGE = 48210

export const MOCK_RESULTS: MockResult[] = [
  {
    damage: 52340,
    stats: { atk: 3451, hp: 17820, def: 1050, er: 115.2, cr: 68.1, cd: 212.5, bonus: 52.3, amp: 0.0 },
    cost: 12,
    sets: [{ id: 1, icon: '', count: 5 }],
    mainEchoIcon: null,
  },
  {
    damage: 51890,
    stats: { atk: 3390, hp: 18100, def: 1080, er: 112.4, cr: 66.8, cd: 208.9, bonus: 49.1, amp: 0.0 },
    cost: 12,
    sets: [{ id: 1, icon: '', count: 3 }, { id: 2, icon: '', count: 2 }],
    mainEchoIcon: null,
  },
  {
    damage: 51420,
    stats: { atk: 3320, hp: 18340, def: 1095, er: 118.6, cr: 65.2, cd: 206.4, bonus: 47.8, amp: 0.0 },
    cost: 12,
    sets: [{ id: 1, icon: '', count: 5 }],
    mainEchoIcon: null,
  },
  {
    damage: 50980,
    stats: { atk: 3280, hp: 17950, def: 1110, er: 110.8, cr: 64.5, cd: 210.1, bonus: 46.2, amp: 0.0 },
    cost: 12,
    sets: [{ id: 2, icon: '', count: 5 }],
    mainEchoIcon: null,
  },
  {
    damage: 50540,
    stats: { atk: 3310, hp: 18200, def: 1068, er: 114.0, cr: 63.9, cd: 205.8, bonus: 50.5, amp: 0.0 },
    cost: 12,
    sets: [{ id: 1, icon: '', count: 3 }, { id: 3, icon: '', count: 2 }],
    mainEchoIcon: null,
  },
  {
    damage: 50540,
    stats: { atk: 3310, hp: 18200, def: 1068, er: 114.0, cr: 63.9, cd: 205.8, bonus: 50.5, amp: 0.0 },
    cost: 12,
    sets: [{ id: 1, icon: '', count: 3 }, { id: 3, icon: '', count: 2 }],
    mainEchoIcon: null,
  },
  {
    damage: 50540,
    stats: { atk: 3310, hp: 18200, def: 1068, er: 114.0, cr: 63.9, cd: 205.8, bonus: 50.5, amp: 0.0 },
    cost: 12,
    sets: [{ id: 1, icon: '', count: 3 }, { id: 3, icon: '', count: 2 }],
    mainEchoIcon: null,
  },
  {
    damage: 50540,
    stats: { atk: 3310, hp: 18200, def: 1068, er: 114.0, cr: 63.9, cd: 205.8, bonus: 50.5, amp: 0.0 },
    cost: 12,
    sets: [{ id: 1, icon: '', count: 3 }, { id: 3, icon: '', count: 2 }],
    mainEchoIcon: null,
  },
  {
    damage: 50540,
    stats: { atk: 3310, hp: 18200, def: 1068, er: 114.0, cr: 63.9, cd: 205.8, bonus: 50.5, amp: 0.0 },
    cost: 12,
    sets: [{ id: 1, icon: '', count: 3 }, { id: 3, icon: '', count: 2 }],
    mainEchoIcon: null,
  },
  {
    damage: 50540,
    stats: { atk: 3310, hp: 18200, def: 1068, er: 114.0, cr: 63.9, cd: 205.8, bonus: 50.5, amp: 0.0 },
    cost: 12,
    sets: [{ id: 1, icon: '', count: 3 }, { id: 3, icon: '', count: 2 }],
    mainEchoIcon: null,
  },
  {
    damage: 52340,
    stats: { atk: 3451, hp: 17820, def: 1050, er: 115.2, cr: 68.1, cd: 212.5, bonus: 52.3, amp: 0.0 },
    cost: 12,
    sets: [{ id: 1, icon: '', count: 5 }],
    mainEchoIcon: null,
  },
  {
    damage: 51890,
    stats: { atk: 3390, hp: 18100, def: 1080, er: 112.4, cr: 66.8, cd: 208.9, bonus: 49.1, amp: 0.0 },
    cost: 12,
    sets: [{ id: 1, icon: '', count: 3 }, { id: 2, icon: '', count: 2 }],
    mainEchoIcon: null,
  },
  {
    damage: 51420,
    stats: { atk: 3320, hp: 18340, def: 1095, er: 118.6, cr: 65.2, cd: 206.4, bonus: 47.8, amp: 0.0 },
    cost: 12,
    sets: [{ id: 1, icon: '', count: 5 }],
    mainEchoIcon: null,
  },
  {
    damage: 50980,
    stats: { atk: 3280, hp: 17950, def: 1110, er: 110.8, cr: 64.5, cd: 210.1, bonus: 46.2, amp: 0.0 },
    cost: 12,
    sets: [{ id: 2, icon: '', count: 5 }],
    mainEchoIcon: null,
  },
  {
    damage: 50540,
    stats: { atk: 3310, hp: 18200, def: 1068, er: 114.0, cr: 63.9, cd: 205.8, bonus: 50.5, amp: 0.0 },
    cost: 12,
    sets: [{ id: 1, icon: '', count: 3 }, { id: 3, icon: '', count: 2 }],
    mainEchoIcon: null,
  },
  {
    damage: 50540,
    stats: { atk: 3310, hp: 18200, def: 1068, er: 114.0, cr: 63.9, cd: 205.8, bonus: 50.5, amp: 0.0 },
    cost: 12,
    sets: [{ id: 1, icon: '', count: 3 }, { id: 3, icon: '', count: 2 }],
    mainEchoIcon: null,
  },
  {
    damage: 50540,
    stats: { atk: 3310, hp: 18200, def: 1068, er: 114.0, cr: 63.9, cd: 205.8, bonus: 50.5, amp: 0.0 },
    cost: 12,
    sets: [{ id: 1, icon: '', count: 3 }, { id: 3, icon: '', count: 2 }],
    mainEchoIcon: null,
  },
  {
    damage: 50540,
    stats: { atk: 3310, hp: 18200, def: 1068, er: 114.0, cr: 63.9, cd: 205.8, bonus: 50.5, amp: 0.0 },
    cost: 12,
    sets: [{ id: 1, icon: '', count: 3 }, { id: 3, icon: '', count: 2 }],
    mainEchoIcon: null,
  },
  {
    damage: 50540,
    stats: { atk: 3310, hp: 18200, def: 1068, er: 114.0, cr: 63.9, cd: 205.8, bonus: 50.5, amp: 0.0 },
    cost: 12,
    sets: [{ id: 1, icon: '', count: 3 }, { id: 3, icon: '', count: 2 }],
    mainEchoIcon: null,
  },
  {
    damage: 50540,
    stats: { atk: 3310, hp: 18200, def: 1068, er: 114.0, cr: 63.9, cd: 205.8, bonus: 50.5, amp: 0.0 },
    cost: 12,
    sets: [{ id: 1, icon: '', count: 3 }, { id: 3, icon: '', count: 2 }],
    mainEchoIcon: null,
  },
  {
    damage: 52340,
    stats: { atk: 3451, hp: 17820, def: 1050, er: 115.2, cr: 68.1, cd: 212.5, bonus: 52.3, amp: 0.0 },
    cost: 12,
    sets: [{ id: 1, icon: '', count: 5 }],
    mainEchoIcon: null,
  },
  {
    damage: 51890,
    stats: { atk: 3390, hp: 18100, def: 1080, er: 112.4, cr: 66.8, cd: 208.9, bonus: 49.1, amp: 0.0 },
    cost: 12,
    sets: [{ id: 1, icon: '', count: 3 }, { id: 2, icon: '', count: 2 }],
    mainEchoIcon: null,
  },
  {
    damage: 51420,
    stats: { atk: 3320, hp: 18340, def: 1095, er: 118.6, cr: 65.2, cd: 206.4, bonus: 47.8, amp: 0.0 },
    cost: 12,
    sets: [{ id: 1, icon: '', count: 5 }],
    mainEchoIcon: null,
  },
  {
    damage: 50980,
    stats: { atk: 3280, hp: 17950, def: 1110, er: 110.8, cr: 64.5, cd: 210.1, bonus: 46.2, amp: 0.0 },
    cost: 12,
    sets: [{ id: 2, icon: '', count: 5 }],
    mainEchoIcon: null,
  },
  {
    damage: 50540,
    stats: { atk: 3310, hp: 18200, def: 1068, er: 114.0, cr: 63.9, cd: 205.8, bonus: 50.5, amp: 0.0 },
    cost: 12,
    sets: [{ id: 1, icon: '', count: 3 }, { id: 3, icon: '', count: 2 }],
    mainEchoIcon: null,
  },
  {
    damage: 50540,
    stats: { atk: 3310, hp: 18200, def: 1068, er: 114.0, cr: 63.9, cd: 205.8, bonus: 50.5, amp: 0.0 },
    cost: 12,
    sets: [{ id: 1, icon: '', count: 3 }, { id: 3, icon: '', count: 2 }],
    mainEchoIcon: null,
  },
  {
    damage: 50540,
    stats: { atk: 3310, hp: 18200, def: 1068, er: 114.0, cr: 63.9, cd: 205.8, bonus: 50.5, amp: 0.0 },
    cost: 12,
    sets: [{ id: 1, icon: '', count: 3 }, { id: 3, icon: '', count: 2 }],
    mainEchoIcon: null,
  },
  {
    damage: 50540,
    stats: { atk: 3310, hp: 18200, def: 1068, er: 114.0, cr: 63.9, cd: 205.8, bonus: 50.5, amp: 0.0 },
    cost: 12,
    sets: [{ id: 1, icon: '', count: 3 }, { id: 3, icon: '', count: 2 }],
    mainEchoIcon: null,
  },
  {
    damage: 50540,
    stats: { atk: 3310, hp: 18200, def: 1068, er: 114.0, cr: 63.9, cd: 205.8, bonus: 50.5, amp: 0.0 },
    cost: 12,
    sets: [{ id: 1, icon: '', count: 3 }, { id: 3, icon: '', count: 2 }],
    mainEchoIcon: null,
  },
  {
    damage: 50540,
    stats: { atk: 3310, hp: 18200, def: 1068, er: 114.0, cr: 63.9, cd: 205.8, bonus: 50.5, amp: 0.0 },
    cost: 12,
    sets: [{ id: 1, icon: '', count: 3 }, { id: 3, icon: '', count: 2 }],
    mainEchoIcon: null,
  },
]

export const MOCK_ECHOES: (MockEcho | null)[] = [
  null,
  null,
  null,
  null,
  null,
]

export const MOCK_RADAR_DATA = [
  { stat: 'ATK', current: 3200, candidate: 3450 },
  { stat: 'HP', current: 18000, candidate: 17500 },
  { stat: 'DEF', current: 1100, candidate: 1050 },
  { stat: 'ER%', current: 110, candidate: 115 },
  { stat: 'CR%', current: 62.4, candidate: 68.1 },
  { stat: 'CD%', current: 198.2, candidate: 212.5 },
  { stat: 'BNS%', current: 45.6, candidate: 52.3 },
]

export const MOCK_COMBINATIONS = 156432
export const MOCK_FILTERED = 84

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
  '\u01A9 Cost',
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
