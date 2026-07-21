/*
  Author: Runor Ewhro
  Description: Defines the zod schema used to validate and hydrate persisted
               application state from local storage.
*/

import { z } from 'zod'
import { DEF_BENCH_RPT, DEF_UI_PREFS } from '@/domain/entities/preferences'
import { DEF_BODY_FONT, getPrstBodyF } from '@/modules/settings/model/typography'
import { DEF_SET_COND } from '@/domain/entities/sonataSetConditionals'
import { makeOptInventorySelection } from '@/domain/entities/profile'
import {
  BG_THEMES,
  DARK_THEMES,
  LIGHT_THEMES,
} from '@/domain/entities/themes'
import { mnlBffsSchm } from '@/domain/state/manualBuffsSchema'

function stripLegacyMainMode(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return value
  }

  const rest = { ...value as Record<string, unknown> }
  delete rest.mainMode
  return rest
}

// shared base stat buff shape
const baseStatBuff = z.object({
  percent: z.number(),
  flat: z.number(),
}).strict()

// shared modifier buff shape
const modBuffSchm = z.object({
  resShred: z.number(),
  dmgBonus: z.number(),
  amplify: z.number(),
  defIgnore: z.number(),
  defShred: z.number(),
  dmgVuln: z.number(),
  critRate: z.number(),
  critDmg: z.number(),
}).strict()

// supported elemental attributes
const ttrbSchm = z.enum([
  'aero',
  'glacio',
  'spectro',
  'fusion',
  'electro',
  'havoc',
  'physical',
])

// trace node buff storage
const trcNodeBffsS = z.object({
  atk: baseStatBuff,
  hp: baseStatBuff,
  def: baseStatBuff,
  attribute: z.record(ttrbSchm, modBuffSchm),
  critRate: z.number(),
  critDmg: z.number(),
  healingBonus: z.number(),
  activeNodes: z.record(z.string(), z.boolean()),
}).strict()

// per-tab skill level storage
const skllLvlsSchm = z.object({
  normalAttack: z.number(),
  resonanceSkill: z.number(),
  forteCircuit: z.number(),
  resonanceLiberation: z.number(),
  introSkill: z.number(),
  tuneBreak: z.number(),
}).strict()

// combat status effect state
const cmbtSttSchm = z.object({
  spectroFrazzle: z.number(),
  aeroErosion: z.number(),
  fusionBurst: z.number(),
  havocBane: z.number(),
  glacioChafe: z.number(),
  electroFlare: z.number(),
  electroRage: z.number(),
}).strict()

const cntrVlSchm = z.union([z.string(), z.number(), z.boolean()])

const prssCntrSchm = z.record(z.string(), cntrVlSchm)

const uiBoolSchm = (defaultValue: boolean) => z.preprocess((value) => {
  if (typeof value === 'string') {
    if (value === 'on') {
      return true
    }
    if (value === 'off') {
      return false
    }
  }

  return value
}, z.boolean().default(defaultValue))

// equipped echo instance
const echoNstnSchm = z.object({
  uid: z.string(),
  id: z.string(),
  set: z.number(),
  mainEcho: z.boolean(),
  mainStats: z.object({
    primary: z.object({ key: z.string(), value: z.number() }).strict(),
    secondary: z.object({ key: z.string(), value: z.number() }).strict(),
  }).strict(),
  substats: z.record(z.string(), z.number()),
}).strict()

// inventory echo entry
const invChsEntSch = z.object({
  id: z.string(),
  echo: echoNstnSchm,
  createdAt: z.number(),
  updatedAt: z.number(),
}).strict()

// shared weapon build snapshot
const wpnMkSchm = z.object({
  id: z.string().nullable(),
  level: z.number(),
  rank: z.number(),
})

// teammate weapon storage omits fixed level and resolves it at runtime
const teamMemWpnMk = z.object({
  id: z.string().nullable(),
  rank: z.number(),
})

// saved build entry
const svdMkSchm = z.object({
  id: z.string(),
  name: z.string(),
  resonatorId: z.string(),
  build: z.object({
    weapon: wpnMkSchm,
    echoes: z.array(echoNstnSchm.nullable()),
  }).strict(),
  createdAt: z.number(),
  updatedAt: z.number(),
})

// shared base progression state
const baseSttSchm = z.object({
  level: z.number(),
  sequence: z.number(),
  skillLevels: skllLvlsSchm,
  traceNodes: trcNodeBffsS,
}).strict()

// teammate progression persists only the player-editable sequence
const teamMemBaseS = z.object({
  sequence: z.number(),
}).strict()

// runtime mutation step used in rotations
const rtChngSchm = z.object({
  type: z.enum(['set', 'add', 'toggle']),
  path: z.string(),
  value: z.union([z.string(), z.number(), z.boolean()]).optional(),
  resonatorId: z.string().optional(),
}).strict()

// recursive formula expression tree
const formExprSchm: z.ZodTypeAny = z.lazy(() =>
    z.union([
      z.object({
        type: z.literal('const'),
        value: z.number(),
      }).strict(),
      z.object({
        type: z.literal('read'),
        from: z.enum([
          'sourceRuntime',
          'sourceFinalStats',
          'targetRuntime',
          'activeRuntime',
          'pool',
          'baseStats',
          'finalStats',
          'context',
        ]).optional(),
        path: z.string(),
        default: z.number().optional(),
      }).strict(),
      z.object({
        type: z.literal('table'),
        from: z.enum([
          'sourceRuntime',
          'sourceFinalStats',
          'targetRuntime',
          'activeRuntime',
          'pool',
          'baseStats',
          'finalStats',
          'context',
        ]).optional(),
        path: z.string(),
        values: z.array(z.number()),
        minIndex: z.number().optional(),
        maxIndex: z.number().optional(),
        defaultIndex: z.number().optional(),
      }).strict(),
      z.object({
        type: z.literal('add'),
        values: z.array(formExprSchm),
      }).strict(),
      z.object({
        type: z.literal('mul'),
        values: z.array(formExprSchm),
      }).strict(),
      z.object({
        type: z.literal('clamp'),
        value: formExprSchm,
        min: z.number().optional(),
        max: z.number().optional(),
      }).strict(),
    ]),
)

// recursive condition expression tree
const condExprSchm: z.ZodTypeAny = z.lazy(() =>
    z.union([
      z.object({ type: z.literal('always') }).strict(),
      z.object({
        type: z.literal('not'),
        value: condExprSchm,
      }).strict(),
      z.object({
        type: z.literal('truthy'),
        from: z.enum([
          'sourceRuntime',
          'sourceFinalStats',
          'targetRuntime',
          'activeRuntime',
          'pool',
          'baseStats',
          'finalStats',
          'context',
        ]).optional(),
        path: z.string(),
      }).strict(),
      z.object({
        type: z.literal('eq'),
        from: z.enum([
          'sourceRuntime',
          'sourceFinalStats',
          'targetRuntime',
          'activeRuntime',
          'pool',
          'baseStats',
          'finalStats',
          'context',
        ]).optional(),
        path: z.string(),
        value: z.union([z.string(), z.number(), z.boolean()]),
      }).strict(),
      z.object({
        type: z.literal('neq'),
        from: z.enum([
          'sourceRuntime',
          'sourceFinalStats',
          'targetRuntime',
          'activeRuntime',
          'pool',
          'baseStats',
          'finalStats',
          'context',
        ]).optional(),
        path: z.string(),
        value: z.union([z.string(), z.number(), z.boolean()]),
      }).strict(),
      z.object({
        type: z.literal('gt'),
        from: z.enum([
          'sourceRuntime',
          'sourceFinalStats',
          'targetRuntime',
          'activeRuntime',
          'pool',
          'baseStats',
          'finalStats',
          'context',
        ]).optional(),
        path: z.string(),
        value: z.number(),
      }).strict(),
      z.object({
        type: z.literal('gte'),
        from: z.enum([
          'sourceRuntime',
          'sourceFinalStats',
          'targetRuntime',
          'activeRuntime',
          'pool',
          'baseStats',
          'finalStats',
          'context',
        ]).optional(),
        path: z.string(),
        value: z.number(),
      }).strict(),
      z.object({
        type: z.literal('lt'),
        from: z.enum([
          'sourceRuntime',
          'sourceFinalStats',
          'targetRuntime',
          'activeRuntime',
          'pool',
          'baseStats',
          'finalStats',
          'context',
        ]).optional(),
        path: z.string(),
        value: z.number(),
      }).strict(),
      z.object({
        type: z.literal('lte'),
        from: z.enum([
          'sourceRuntime',
          'sourceFinalStats',
          'targetRuntime',
          'activeRuntime',
          'pool',
          'baseStats',
          'finalStats',
          'context',
        ]).optional(),
        path: z.string(),
        value: z.number(),
      }).strict(),
      z.object({
        type: z.literal('includes'),
        from: z.enum([
          'sourceRuntime',
          'sourceFinalStats',
          'targetRuntime',
          'activeRuntime',
          'pool',
          'baseStats',
          'finalStats',
          'context',
        ]).optional(),
        path: z.string(),
        value: z.union([z.string(), z.number(), z.boolean()]),
        itemPath: z.string().optional(),
      }).strict(),
      z.object({
        type: z.literal('and'),
        values: z.array(condExprSchm),
      }).strict(),
      z.object({
        type: z.literal('or'),
        values: z.array(condExprSchm),
      }).strict(),
    ]),
)

const rotWhenRuleS = z.object({
  condition: condExprSchm.optional(),
  loops: z.array(z.object({
    loopId: z.string(),
    runs: z.array(z.number().int().positive()),
  }).strict()).optional(),
}).strict()

// recursive rotation node schema
const rotNodeSchm: z.ZodTypeAny = z.lazy(() =>
    z.discriminatedUnion('type', [
      z.object({
        id: z.string(),
        type: z.literal('feature'),
        resonatorId: z.string().optional(),
        enabled: z.boolean().optional(),
        when: rotWhenRuleS.optional(),
        featureId: z.string(),
        multiplier: z.number().optional(),
        negativeEffectStacks: z.number().optional(),
        negativeEffectInstances: z.number().optional(),
        negativeEffectStableWidth: z.number().optional(),
        changes: z.array(rtChngSchm).optional(),
        condition: condExprSchm.optional(),
      }).strict(),
      z.object({
        id: z.string(),
        type: z.literal('condition'),
        resonatorId: z.string().optional(),
        enabled: z.boolean().optional(),
        when: rotWhenRuleS.optional(),
        label: z.string().optional(),
        condition: condExprSchm.optional(),
        changes: z.array(rtChngSchm),
      }).strict(),
      z.object({
        id: z.string(),
        type: z.literal('repeat'),
        resonatorId: z.string().optional(),
        enabled: z.boolean().optional(),
        when: rotWhenRuleS.optional(),
        condition: condExprSchm.optional(),
        times: z.union([z.number(), formExprSchm]),
        items: z.array(rotNodeSchm),
      }).strict(),
      z.object({
        id: z.string(),
        type: z.literal('uptime'),
        resonatorId: z.string().optional(),
        enabled: z.boolean().optional(),
        when: rotWhenRuleS.optional(),
        condition: condExprSchm.optional(),
        ratio: z.union([z.number(), formExprSchm]),
        setup: z.array(rotNodeSchm).optional(),
        items: z.array(rotNodeSchm),
      }).strict(),
      z.object({
        id: z.string(),
        type: z.literal('loop'),
        resonatorId: z.string().optional(),
        enabled: z.boolean().optional(),
        when: rotWhenRuleS.optional(),
        kind: z.enum(['start', 'end']),
        loopId: z.string(),
        label: z.string().optional(),
        color: z.string().optional(),
        runs: z.number().int().positive().optional(),
      }).strict(),
    ]),
)

// saved rotation state
const rotSttSchm = z.object({
  view: z.enum(['personal', 'team', 'saved']),
  personalItems: z.array(rotNodeSchm),
  teamItems: z.array(rotNodeSchm),
}).strict()

// optimizer settings payload
const optSetsSchm = z.object({
  targetSkillId: z.string().nullable(),
  targetMode: z.enum(['skill', 'combo']),
  targetComboSourceId: z.string().nullable(),
  rotationMode: z.boolean(),
  searchMode: z.enum(['inventory', 'theory']).default('inventory'),
  resultsLimit: z.number(),
  keepPercent: z.number(),
  lowMemoryMode: z.boolean(),
  enableGpu: z.boolean(),
  lockedMainEchoId: z.string().nullable(),
  // keys are optional so snapshots exported before a cost tier existed still validate;
  // cloneOptSets() backfills any missing tier from defaults during hydration.
  allowedSets: z.object({
    1: z.array(z.number()).optional(),
    3: z.array(z.number()).optional(),
    5: z.array(z.number()).optional(),
  }).strict(),
  mainStatFilter: z.array(z.string()),
  selectedBonus: z.string().nullable(),
  // inventory-mode toggle. optional + default so older snapshots backfill.
  excludeEquipped: z.boolean().optional().default(false),
  // theory-mode weapon search toggle. optional + default so snapshots exported
  // before it existed still validate; cloneOptSets backfills the default.
  includeWeapons: z.boolean().optional().default(false),
  statConstraints: z.record(z.string(), z.object({
    minTotal: z.string().optional(),
    maxTotal: z.string().optional(),
  }).strict()),
}).strict()

const ovrSntSetCo = z.object({
  version: z.literal(1),
  encoding: z.literal('off-v1'),
  off: z.record(z.string(), z.array(z.string())),
}).strict()

const sntSetConS = ovrSntSetCo.catch(DEF_SET_COND)

// simplified teammate runtime used inside team state
const teamMemRtSch = z.object({
  id: z.string(),
  base: teamMemBaseS,
  build: z.object({
    weapon: teamMemWpnMk,
    echoes: z.array(echoNstnSchm.nullable()),
  }).strict(),
  manualBuffs: mnlBffsSchm,
}).strict()

// live resonator runtime state
const resRtSttSchm = z.object({
  id: z.string(),
  base: baseSttSchm,
  build: z.object({
    weapon: wpnMkSchm,
    echoes: z.array(echoNstnSchm.nullable()),
    team: z.tuple([z.string().nullable(), z.string().nullable(), z.string().nullable()]),
  }).strict(),
  state: z.object({
    controls: prssCntrSchm,
    manualBuffs: mnlBffsSchm,
    combat: cmbtSttSchm,
  }).strict(),
  rotation: rotSttSchm,
  teamRuntimes: z.tuple([teamMemRtSch.nullable(), teamMemRtSch.nullable()]),
}).strict()

// optimizer context stored in persistence
const optCtxSchm = z.object({
  resonatorId: z.string(),
  runtime: resRtSttSchm,
  sourceRuntimeSig: z.string().default(''),
  settings: optSetsSchm,
}).strict()

// resonator suggestion settings
const suggSetsSchm = z.object({
  targetFeatureId: z.string().nullable().default(null),
  rotationMode: z.boolean().default(false),
}).strict()

// random suggestion set preference
const randGnrtSetP = z.object({
  setId: z.number(),
  count: z.number(),
}).strict()

// random suggestion generation settings
const randGnrtSets = z.object({
  bias: z.number().default(0.5),
  rollQuality: z.number().default(0.3),
  targetEnergyRegen: z.number().default(0),
  setPreferences: z.array(randGnrtSetP).default([]),
  mainEchoId: z.string().nullable().default(null),
}).strict()

// weapon suggestion settings
const wpnStValS = z.union([z.boolean(), z.number(), z.string()])
const wpnStCfgS = z.object({
  off: z.literal(true).optional(),
  max: wpnStValS.optional(),
}).strict()

const wpnSuggSetS = z.object({
  mode: z.enum(['default', 'max', 'both']).default('both'),
  target: z.enum(['default', 'max']).default('max'),
  ranks: z.record(z.string(), z.number()).default({
    '5': 1,
    '4': 5,
    '3': 5,
    '2': 5,
    '1': 5,
  }),
  stdRank: z.number().default(1),
  visible: z.record(z.string(), z.boolean()).default({
    '5': true,
    '4': true,
    '3': false,
    '2': false,
    '1': false,
  }),
  states: z.record(z.string(), z.record(z.string(), wpnStCfgS)).default({}),
}).strict()

// stored suggestion state per resonator
const resSuggsSttS = z.object({
  settings: suggSetsSchm.default({
    targetFeatureId: null,
    rotationMode: false,
  }),
  random: randGnrtSets.default({
    bias: 0.5,
    rollQuality: 0.3,
    targetEnergyRegen: 0,
    setPreferences: [],
    mainEchoId: null,
  }),
}).strip()

// persisted resonator profile schema
const resProfSchm = z.object({
  resonatorId: z.string(),
  runtime: z.object({
    progression: baseSttSchm,
    build: z.object({
      weapon: wpnMkSchm,
      echoes: z.array(echoNstnSchm.nullable()),
    }).strict(),
    local: z.object({
      controls: prssCntrSchm,
      manualBuffs: mnlBffsSchm,
      combat: cmbtSttSchm,
      setConditionals: sntSetConS.default(DEF_SET_COND),
      optimizerInventory: z.object({
        mode: z.enum(['include', 'exclude']).default('exclude'),
        echoUids: z.array(z.string()).default([]),
      }).strict().default(makeOptInventorySelection()),
    }).strict(),
    routing: z.object({
      selectedTargetsByOwnerKey: z.record(z.string(), z.string().nullable()),
    }).strict(),
    team: z.tuple([z.string().nullable(), z.string().nullable(), z.string().nullable()]),
    rotation: rotSttSchm,
    teamRuntimes: z.tuple([teamMemRtSch.nullable(), teamMemRtSch.nullable()]),
  }).strict(),
}).strict()

// compact damage total snapshot
const dmgTtlsSnapS = z.object({
  normal: z.number(),
  avg: z.number(),
  crit: z.number(),
}).strict()

// teammate contribution snapshot
const teamMemCntrS = z.object({
  id: z.string(),
  contribution: dmgTtlsSnapS,
})

// saved rotation summary snapshot
const rotEntSmmrSc = z.object({
  total: dmgTtlsSnapS,
  members: z.array(teamMemCntrS).optional(),
}).strict()

// saved inventory rotation entry
const invRotSchm = z.object({
  id: z.string(),
  name: z.string(),
  mode: z.enum(['personal', 'team']),
  resonatorId: z.string(),
  duration: z.number().default(0),
  note: z.string().default(''),
  team: z.tuple([z.string().nullable(), z.string().nullable(), z.string().nullable()]).optional(),
  items: z.array(rotNodeSchm),
  snapshot: resProfSchm.optional(),
  summary: rotEntSmmrSc.optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
})

// combat session persistence
const cmbtSssnSchm = z.object({
  activeResonatorId: z.string().nullable(),
  enemyProfile: z.object({
    id: z.string(),
    level: z.number(),
    class: z.number(),
    toa: z.boolean(),
    source: z.enum(['catalog', 'custom']).optional(),
    status: z.object({
      tuneStrain: z.number(),
    }).catchall(z.union([z.number(), z.boolean(), z.string()])).optional(),
    res: z.object({
      0: z.number(),
      1: z.number(),
      2: z.number(),
      3: z.number(),
      4: z.number(),
      5: z.number(),
      6: z.number(),
    }).strict(),
  }).strict(),
}).strict()

// saved rotation page ui preferences
const svdRotPrefsS = z.object({
  sortBy: z.enum(['date', 'name', 'avg', 'dps']).default('date'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  filterMode: z.enum(['all', 'personal', 'team']).default('all'),
  autoSearchActiveResonator: z.boolean().default(false),
}).strict()

const histMaxSchm = z.union([
  z.literal(5),
  z.literal(10),
  z.literal(25),
  z.literal(50),
  z.literal(75),
  z.literal(100),
]).default(10)

const pckrFreqIdsS = z.array(z.string()).max(3).default([])
const pckrFreqCnts = z.record(
  z.string(),
  z.number().int().positive(),
).default({})
const pckrFreqBktS = z.object({
  ids: pckrFreqIdsS,
  counts: pckrFreqCnts,
}).strict().default({
  ids: [],
  counts: {},
})

const pckrFreqSttS = z.object({
  resonator: pckrFreqBktS,
  echo: pckrFreqBktS,
  enemy: pckrFreqBktS,
  weaponByType: z.object({
    broadblade: pckrFreqBktS,
    sword: pckrFreqBktS,
    pistols: pckrFreqBktS,
    gauntlets: pckrFreqBktS,
    rectifier: pckrFreqBktS,
  }).strict().default({
    broadblade: { ids: [], counts: {} },
    sword: { ids: [], counts: {} },
    pistols: { ids: [], counts: {} },
    gauntlets: { ids: [], counts: {} },
    rectifier: { ids: [], counts: {} },
  }),
  resonatorByTeamSlot: z.object({
    active: pckrFreqBktS,
    teammate1: pckrFreqBktS,
    teammate2: pckrFreqBktS,
  }).strict().default({
    active: { ids: [], counts: {} },
    teammate1: { ids: [], counts: {} },
    teammate2: { ids: [], counts: {} },
  }),
}).strict().default({
  resonator: { ids: [], counts: {} },
  echo: { ids: [], counts: {} },
  enemy: { ids: [], counts: {} },
  weaponByType: {
    broadblade: { ids: [], counts: {} },
    sword: { ids: [], counts: {} },
    pistols: { ids: [], counts: {} },
    gauntlets: { ids: [], counts: {} },
    rectifier: { ids: [], counts: {} },
  },
  resonatorByTeamSlot: {
    active: { ids: [], counts: {} },
    teammate1: { ids: [], counts: {} },
    teammate2: { ids: [], counts: {} },
  },
})

export const APP_STATE_VER = 22 as const

function normalizeBenchPrefs(value: unknown): unknown {
  if (!value || typeof value !== 'object') {
    return value
  }

  const prefs = value as Record<string, unknown>
  if ('showBenchStates' in prefs) {
    return prefs
  }

  return {
    ...prefs,
    showBenchStates: typeof prefs.showBenchStates === 'boolean'
      ? prefs.showBenchStates
      : DEF_UI_PREFS.showBenchStates,
  }
}

const uiPersistSchema = z.object({
  theme: z.enum(['light', 'dark', 'background']),
  themePreference: z.enum(['system', 'light', 'dark', 'background']).optional(),
  lightVariant: z.enum(LIGHT_THEMES),
  darkVariant: z.enum(DARK_THEMES),
  backgroundVariant: z.enum(BG_THEMES),
  backgroundImageKey: z.string().default('builtin:wallpaperflare1.jpg'),
  backgroundTextMode: z.enum(['light', 'dark']).default('light'),
  bodyFontName: z.string().default(DEF_BODY_FONT),
  bodyFontUrl: z.string().default(getPrstBodyF(DEF_BODY_FONT)),
  blurMode: uiBoolSchm(false),
  entranceAnimations: uiBoolSchm(true),
  preferences: z.preprocess(normalizeBenchPrefs, z.object({
    ctxMenu: z.boolean().default(DEF_UI_PREFS.ctxMenu),
    updateToast: z.boolean().default(DEF_UI_PREFS.updateToast),
    recommendedMenuItems: z.boolean().default(DEF_UI_PREFS.recommendedMenuItems),
    showBenchStates: z.boolean().default(DEF_UI_PREFS.showBenchStates),
    maxResOnInit: z.boolean().default(DEF_UI_PREFS.maxResOnInit),
    benchmarkViewMode: z.enum(['benchmark', 'showcase']).default(DEF_UI_PREFS.benchmarkViewMode),
    benchAnim2d: z.boolean().default(DEF_UI_PREFS.benchAnim2d),
    benchmarkCards: z.record(
      z.string(),
      z.object({
        style: z.object({
          accent: z.string().nullable().default(null),
          surface: z.string().nullable().default(null),
          text: z.string().nullable().default(null),
          opacity: z.number().nullable().default(null),
          displayFont: z.string().nullable().default(null),
          monoFont: z.string().nullable().default(null),
          portraitX: z.number().nullable().default(null),
          portraitY: z.number().nullable().default(null),
          portraitScale: z.number().nullable().default(null),
          maskTop: z.number().nullable().default(null),
          maskRight: z.number().nullable().default(null),
          maskBottom: z.number().nullable().default(null),
          maskLeft: z.number().nullable().default(null),
          maskTopSharp: z.number().nullable().default(null),
          maskRightSharp: z.number().nullable().default(null),
          maskBottomSharp: z.number().nullable().default(null),
          maskLeftSharp: z.number().nullable().default(null),
          backdropBlur: z.number().nullable().default(null),
          backdropOpacity: z.number().nullable().default(null),
          backdropX: z.number().nullable().default(null),
          backdropY: z.number().nullable().default(null),
          backdropScale: z.number().nullable().default(null),
          portraitImage: z.string().nullable().default(null),
          backdropImage: z.string().nullable().default(null),
          portraitCredit: z.string().nullable().default(null),
          backdropCredit: z.string().nullable().default(null),
          statsColumn: z.enum(['build', 'combat', 'both']).nullable().default(null),
          textSlots: z.record(
            z.string(),
            z.object({
              color: z.string().nullable().default(null),
              font: z.string().nullable().default(null),
              size: z.number().nullable().default(null),
              weight: z.number().nullable().default(null),
              spacing: z.number().nullable().default(null),
              transform: z.enum(['none', 'uppercase', 'lowercase', 'capitalize']).nullable().default(null),
            }),
          ).default({}),
          customCss: z.string().nullable().default(null),
        }),
        hidden: z.object({
          score: z.boolean().default(false),
          damage: z.boolean().default(false),
          cv: z.boolean().default(false),
          team: z.boolean().default(false),
          brand: z.boolean().default(false),
          portraitCredit: z.boolean().default(false),
          backdropCredit: z.boolean().default(false),
          seqRail: z.boolean().default(false),
          subVal: z.boolean().default(false),
          subColor: z.boolean().default(false),
          relStats: z.boolean().default(true),
        }),
      }),
    ).default({}),
    benchRptSettings: z.object({
      rotationFeatures: z.boolean().default(DEF_BENCH_RPT.rotationFeatures),
      activeStateSources: z.boolean().default(DEF_BENCH_RPT.activeStateSources),
      upgradePaths: z.boolean().default(DEF_BENCH_RPT.upgradePaths),
      buildDetails: z.boolean().default(DEF_BENCH_RPT.buildDetails),
      echoStatsTable: z.boolean().default(DEF_BENCH_RPT.echoStatsTable),
      benchmarkTargets: z.boolean().default(DEF_BENCH_RPT.benchmarkTargets),
    }).default(DEF_BENCH_RPT),
    uploadPersist: z.enum(['indexeddb', 'imgbb']).nullable().default(DEF_UI_PREFS.uploadPersist),
    imgbbApiKey: z.string().default(DEF_UI_PREFS.imgbbApiKey),
  }).default(DEF_UI_PREFS)),
  leftPaneView: z.enum([
    'resonators',
    'buffs',
    'echoes',
    'enemy',
    'weapon',
    'teams',
    'rotations',
    'suggestions',
  ]),
  suggsViewMode: z.enum(['mainStats', 'setPlans', 'weapons', 'random', 'substats']).default('mainStats'),
  showSubHits: z.boolean(),
  compactInv: z.boolean().default(false),
  seeEquipped: z.boolean().default(true),
  haveHistory: z.boolean().default(true),
  historyMax: histMaxSchm,
  itemFreq: pckrFreqSttS,
  optimizerCpuHintSeen: z.boolean().default(false),
  // portrait-mode preference for the optimizer (sprite vs profile art). a
  // display preference, not resonator-scoped, so it persists globally rather
  // than living in the per-resonator optimizer context.
  optimizerUseSprite: z.boolean().default(true),
  savedRotationPreferences: svdRotPrefsS.default({
    sortBy: 'date',
    sortOrder: 'desc',
    filterMode: 'all',
    autoSearchActiveResonator: false,
  }),
}).strict()

export const prssUiPprnSc = z.object({
  theme: uiPersistSchema.shape.theme,
  themePreference: uiPersistSchema.shape.themePreference,
  lightVariant: uiPersistSchema.shape.lightVariant,
  darkVariant: uiPersistSchema.shape.darkVariant,
  backgroundVariant: uiPersistSchema.shape.backgroundVariant,
  backgroundImageKey: uiPersistSchema.shape.backgroundImageKey,
  backgroundTextMode: uiPersistSchema.shape.backgroundTextMode,
  bodyFontName: uiPersistSchema.shape.bodyFontName,
  bodyFontUrl: uiPersistSchema.shape.bodyFontUrl,
  blurMode: uiPersistSchema.shape.blurMode,
  entranceAnimations: uiPersistSchema.shape.entranceAnimations,
}).strict()

export const prssUiLytSch = z.object({
  preferences: uiPersistSchema.shape.preferences,
  leftPaneView: uiPersistSchema.shape.leftPaneView,
  suggsViewMode: uiPersistSchema.shape.suggsViewMode,
  showSubHits: uiPersistSchema.shape.showSubHits,
  compactInv: uiPersistSchema.shape.compactInv,
  seeEquipped: uiPersistSchema.shape.seeEquipped,
  haveHistory: uiPersistSchema.shape.haveHistory,
  historyMax: uiPersistSchema.shape.historyMax,
  itemFreq: uiPersistSchema.shape.itemFreq,
  optimizerCpuHintSeen: uiPersistSchema.shape.optimizerCpuHintSeen,
  optimizerUseSprite: uiPersistSchema.shape.optimizerUseSprite,
}).strict()

export const prssUiSvdRot = z.object({
  savedRotationPreferences: uiPersistSchema.shape.savedRotationPreferences,
}).strict()

const prssCalcPrfl = z.object({
  runtimeRevision: z.number().int().nonnegative().default(0),
  profiles: z.record(z.string(), resProfSchm),
  optimizerContext: optCtxSchm.nullable().default(null),
  weaponSuggests: wpnSuggSetS.default({
    mode: 'both',
    target: 'max',
    ranks: {
      '5': 1,
      '4': 5,
      '3': 5,
      '2': 5,
      '1': 5,
    },
    stdRank: 1,
    visible: {
      '5': true,
      '4': true,
      '3': false,
      '2': false,
      '1': false,
    },
    states: {},
  }),
  suggestionsByResonatorId: z.record(z.string(), resSuggsSttS).default({}),
}).strict()

const prssCalcInvS = z.object({
  inventoryEchoes: z.array(invChsEntSch),
  inventoryBuilds: z.array(svdMkSchm),
  inventoryRotations: z.array(invRotSchm),
}).strict()

export const prssCalcPrgd = z.object({
  runtimeRevision: prssCalcPrfl.shape.runtimeRevision,
  profiles: prssCalcPrfl.shape.profiles,
}).strict()

export const prssCalcOptC = z.object({
  optimizerContext: prssCalcPrfl.shape.optimizerContext,
}).strict()

export const prssCalcSugg = z.object({
  weaponSuggests: prssCalcPrfl.shape.weaponSuggests,
  suggestionsByResonatorId: prssCalcPrfl.shape.suggestionsByResonatorId,
}).strict()

export const prssCalcInvC = z.object({
  inventoryEchoes: prssCalcInvS.shape.inventoryEchoes,
}).strict()

export const prssCalcInvB = z.object({
  inventoryBuilds: prssCalcInvS.shape.inventoryBuilds,
}).strict()

export const prssCalcInvR = z.object({
  inventoryRotations: prssCalcInvS.shape.inventoryRotations,
}).strict()

function makePersistSchema(version: typeof APP_STATE_VER) {
  return z.object({
    version: z.literal(version),
    ui: z.preprocess(stripLegacyMainMode, uiPersistSchema),
    calculator: z.object({
      ...prssCalcPrfl.shape,
      ...prssCalcInvS.shape,
      session: cmbtSssnSchm,
    }).strict(),
  }).strict()
}

// root persisted app state schema
export const persistedSchema = makePersistSchema(APP_STATE_VER)

export const prssUiPprnSl = z.object({
  version: z.literal(APP_STATE_VER),
  ui: prssUiPprnSc,
}).strict()

export const prssUiLytSlc = z.object({
  version: z.literal(APP_STATE_VER),
  ui: z.preprocess(stripLegacyMainMode, prssUiLytSch),
}).strict()

export const prssUiSvdRoh = z.object({
  version: z.literal(APP_STATE_VER),
  ui: prssUiSvdRot,
}).strict()

export const prssSssnSlcS = z.object({
  version: z.literal(APP_STATE_VER),
  calculator: z.object({
    session: cmbtSssnSchm,
  }).strict(),
}).strict()

export const prssPrflSlcS = z.object({
  version: z.literal(APP_STATE_VER),
  calculator: prssCalcPrgd,
}).strict()

export const prssOptCtxSl = z.object({
  version: z.literal(APP_STATE_VER),
  calculator: prssCalcOptC,
}).strict()

export const prssSuggsSlc = z.object({
  version: z.literal(APP_STATE_VER),
  calculator: prssCalcSugg,
}).strict()

export const prssInvChsSl = z.object({
  version: z.literal(APP_STATE_VER),
  calculator: prssCalcInvC,
}).strict()

export const prssInvBldsS = z.object({
  version: z.literal(APP_STATE_VER),
  calculator: prssCalcInvB,
}).strict()

export const prssInvRttnS = z.object({
  version: z.literal(APP_STATE_VER),
  calculator: prssCalcInvR,
}).strict()
