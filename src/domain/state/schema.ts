/*
  Author: Runor Ewhro
  Description: Defines the zod schema used to validate and hydrate persisted
               application state from local storage.
*/

import { z } from 'zod'
import {
  BACKGROUND_THEME_VARIANTS,
  DARK_THEME_VARIANTS,
  LIGHT_THEME_VARIANTS,
} from '@/domain/entities/themes'
import { manualBuffsSchema } from '@/domain/state/manualBuffsSchema'

// shared base stat buff shape
const baseStatBuffSchema = z.object({
  percent: z.number(),
  flat: z.number(),
}).strict()

// shared modifier buff shape
const modBuffSchema = z.object({
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
const attributeSchema = z.enum([
  'aero',
  'glacio',
  'spectro',
  'fusion',
  'electro',
  'havoc',
  'physical',
])

// trace node buff storage
const traceNodeBuffsSchema = z.object({
  atk: baseStatBuffSchema,
  hp: baseStatBuffSchema,
  def: baseStatBuffSchema,
  attribute: z.record(attributeSchema, modBuffSchema),
  critRate: z.number(),
  critDmg: z.number(),
  healingBonus: z.number(),
  activeNodes: z.record(z.string(), z.boolean()),
}).strict()

// per-tab skill level storage
const skillLevelsSchema = z.object({
  normalAttack: z.number(),
  resonanceSkill: z.number(),
  forteCircuit: z.number(),
  resonanceLiberation: z.number(),
  introSkill: z.number(),
  tuneBreak: z.number(),
}).strict()

// combat status effect state
const combatStateSchema = z.object({
  spectroFrazzle: z.number(),
  aeroErosion: z.number(),
  fusionBurst: z.number(),
  havocBane: z.number(),
  electroFlare: z.number(),
}).strict()

// equipped echo instance
const echoInstanceSchema = z.object({
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
const inventoryEchoesEntrySchema = z.object({
  id: z.string(),
  echo: echoInstanceSchema,
  createdAt: z.number(),
  updatedAt: z.number(),
}).strict()

// shared weapon build snapshot
const weaponBuildSchema = z.object({
  id: z.string().nullable(),
  level: z.number(),
  rank: z.number(),
  baseAtk: z.number(),
}).strict()

// saved build entry
const savedBuildSchema = z.object({
  id: z.string(),
  name: z.string(),
  resonatorId: z.string(),
  resonatorName: z.string(),
  build: z.object({
    weapon: weaponBuildSchema,
    echoes: z.array(echoInstanceSchema.nullable()),
  }).strict(),
  createdAt: z.number(),
  updatedAt: z.number(),
}).strict()

// shared base progression state
const baseStateSchema = z.object({
  level: z.number(),
  sequence: z.number(),
  skillLevels: skillLevelsSchema,
  traceNodes: traceNodeBuffsSchema,
}).strict()

// runtime mutation step used in rotations
const runtimeChangeSchema = z.object({
  type: z.enum(['set', 'add', 'toggle']),
  path: z.string(),
  value: z.union([z.string(), z.number(), z.boolean()]).optional(),
  resonatorId: z.string().optional(),
}).strict()

// recursive formula expression tree
const formulaExpressionSchema: z.ZodTypeAny = z.lazy(() =>
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
        values: z.array(formulaExpressionSchema),
      }).strict(),
      z.object({
        type: z.literal('mul'),
        values: z.array(formulaExpressionSchema),
      }).strict(),
      z.object({
        type: z.literal('clamp'),
        value: formulaExpressionSchema,
        min: z.number().optional(),
        max: z.number().optional(),
      }).strict(),
    ]),
)

// recursive condition expression tree
const conditionExpressionSchema: z.ZodTypeAny = z.lazy(() =>
    z.union([
      z.object({ type: z.literal('always') }).strict(),
      z.object({
        type: z.literal('not'),
        value: conditionExpressionSchema,
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
        type: z.literal('and'),
        values: z.array(conditionExpressionSchema),
      }).strict(),
      z.object({
        type: z.literal('or'),
        values: z.array(conditionExpressionSchema),
      }).strict(),
    ]),
)

// recursive rotation node schema
const rotationNodeSchema: z.ZodTypeAny = z.lazy(() =>
    z.discriminatedUnion('type', [
      z.object({
        id: z.string(),
        type: z.literal('feature'),
        resonatorId: z.string().optional(),
        enabled: z.boolean().optional(),
        featureId: z.string(),
        multiplier: z.number().optional(),
        negativeEffectStacks: z.number().optional(),
        negativeEffectInstances: z.number().optional(),
        negativeEffectStableWidth: z.number().optional(),
        condition: conditionExpressionSchema.optional(),
      }).strict(),
      z.object({
        id: z.string(),
        type: z.literal('condition'),
        resonatorId: z.string().optional(),
        enabled: z.boolean().optional(),
        label: z.string().optional(),
        condition: conditionExpressionSchema.optional(),
        changes: z.array(runtimeChangeSchema),
      }).strict(),
      z.object({
        id: z.string(),
        type: z.literal('repeat'),
        resonatorId: z.string().optional(),
        enabled: z.boolean().optional(),
        condition: conditionExpressionSchema.optional(),
        times: z.union([z.number(), formulaExpressionSchema]),
        items: z.array(rotationNodeSchema),
      }).strict(),
      z.object({
        id: z.string(),
        type: z.literal('uptime'),
        resonatorId: z.string().optional(),
        enabled: z.boolean().optional(),
        condition: conditionExpressionSchema.optional(),
        ratio: z.union([z.number(), formulaExpressionSchema]),
        setup: z.array(rotationNodeSchema).optional(),
        items: z.array(rotationNodeSchema),
      }).strict(),
    ]),
)

// saved rotation state
const rotationStateSchema = z.object({
  view: z.enum(['personal', 'team', 'saved']),
  personalItems: z.array(rotationNodeSchema),
  teamItems: z.array(rotationNodeSchema),
}).strict()

// optimizer settings payload
const optimizerSettingsSchema = z.object({
  targetSkillId: z.string().nullable(),
  targetMode: z.enum(['skill', 'combo']).default('skill'),
  targetComboSourceId: z.string().nullable().default(null),
  rotationMode: z.boolean(),
  resultsLimit: z.number(),
  keepPercent: z.number(),
  lowMemoryMode: z.boolean().default(false),
  enableGpu: z.boolean(),
  lockedMainEchoId: z.string().nullable(),
  allowedSets: z.object({
    3: z.array(z.number()),
    5: z.array(z.number()),
  }).strict(),
  mainStatFilter: z.array(z.string()),
  selectedBonus: z.string().nullable(),
  statConstraints: z.record(z.string(), z.object({
    minTotal: z.string().optional(),
    maxTotal: z.string().optional(),
  }).strict()),
}).strict()

// simplified teammate runtime used inside team state
const teamMemberRuntimeSchema = z.object({
  id: z.string(),
  base: baseStateSchema,
  build: z.object({
    weapon: weaponBuildSchema,
    echoes: z.array(echoInstanceSchema.nullable()),
  }).strict(),
  manualBuffs: manualBuffsSchema,
}).strict()

// live resonator runtime state
const resonatorRuntimeStateSchema = z.object({
  id: z.string(),
  base: baseStateSchema,
  build: z.object({
    weapon: weaponBuildSchema,
    echoes: z.array(echoInstanceSchema.nullable()),
    team: z.tuple([z.string().nullable(), z.string().nullable(), z.string().nullable()]),
  }).strict(),
  state: z.object({
    controls: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
    manualBuffs: manualBuffsSchema,
    combat: combatStateSchema,
  }).strict(),
  rotation: rotationStateSchema,
  teamRuntimes: z.tuple([teamMemberRuntimeSchema.nullable(), teamMemberRuntimeSchema.nullable()]),
}).strict()

// optimizer context stored in persistence
const optimizerContextSchema = z.object({
  resonatorId: z.string(),
  runtime: resonatorRuntimeStateSchema,
  settings: optimizerSettingsSchema,
}).strict()

// resonator suggestion settings
const suggestionSettingsSchema = z.object({
  targetFeatureId: z.string().nullable().default(null),
  rotationMode: z.boolean().default(false),
}).strict()

// random suggestion set preference
const randomGeneratorSetPreferenceSchema = z.object({
  setId: z.number(),
  count: z.number(),
}).strict()

// random suggestion generation settings
const randomGeneratorSettingsSchema = z.object({
  bias: z.number().default(0.5),
  rollQuality: z.number().default(0.3),
  targetEnergyRegen: z.number().default(0),
  setPreferences: z.array(randomGeneratorSetPreferenceSchema).default([]),
  mainEchoId: z.string().nullable().default(null),
}).strict()

// stored suggestion state per resonator
const resonatorSuggestionsStateSchema = z.object({
  settings: suggestionSettingsSchema.default({
    targetFeatureId: null,
    rotationMode: false,
  }),
  random: randomGeneratorSettingsSchema.default({
    bias: 0.5,
    rollQuality: 0.3,
    targetEnergyRegen: 0,
    setPreferences: [],
    mainEchoId: null,
  }),
}).strict()

// persisted resonator profile schema
const resonatorProfileSchema = z.object({
  resonatorId: z.string(),
  runtime: z.object({
    progression: baseStateSchema,
    build: z.object({
      weapon: weaponBuildSchema,
      echoes: z.array(echoInstanceSchema.nullable()),
    }).strict(),
    local: z.object({
      controls: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
      manualBuffs: manualBuffsSchema,
      combat: combatStateSchema,
    }).strict(),
    routing: z.object({
      selectedTargetsByOwnerKey: z.record(z.string(), z.string().nullable()),
    }).strict(),
    team: z.tuple([z.string().nullable(), z.string().nullable(), z.string().nullable()]),
    rotation: rotationStateSchema,
    teamRuntimes: z.tuple([teamMemberRuntimeSchema.nullable(), teamMemberRuntimeSchema.nullable()]),
  }).strict(),
}).strict()

// compact damage total snapshot
const damageTotalsSnapshotSchema = z.object({
  normal: z.number(),
  avg: z.number(),
  crit: z.number(),
}).strict()

// teammate contribution snapshot
const teamMemberContributionSchema = z.object({
  id: z.string(),
  name: z.string(),
  contribution: damageTotalsSnapshotSchema,
}).strict()

// saved rotation summary snapshot
const rotationEntrySummarySchema = z.object({
  total: damageTotalsSnapshotSchema,
  members: z.array(teamMemberContributionSchema).optional(),
}).strict()

// saved inventory rotation entry
const inventoryRotationSchema = z.object({
  id: z.string(),
  name: z.string(),
  mode: z.enum(['personal', 'team']),
  resonatorId: z.string(),
  resonatorName: z.string(),
  team: z.tuple([z.string().nullable(), z.string().nullable(), z.string().nullable()]).optional(),
  items: z.array(rotationNodeSchema),
  snapshot: resonatorProfileSchema.optional(),
  summary: rotationEntrySummarySchema.optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
}).strict()

// combat session persistence
const combatSessionSchema = z.object({
  activeResonatorId: z.string().nullable(),
  enemyProfile: z.object({
    id: z.string(),
    level: z.number(),
    class: z.number(),
    toa: z.boolean(),
    source: z.enum(['catalog', 'custom']).optional(),
    status: z.object({
      tuneStrain: z.number(),
    }).strict().optional(),
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
const savedRotationPreferencesSchema = z.object({
  sortBy: z.enum(['date', 'name', 'avg']).default('date'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  filterMode: z.enum(['all', 'personal', 'team']).default('all'),
  autoSearchActiveResonator: z.boolean().default(false),
}).strict()

export const LEGACY_PERSISTED_APP_STATE_VERSION = 21 as const
export const PERSISTED_APP_STATE_VERSION = 22 as const

const persistedUiSchema = z.object({
  theme: z.enum(['light', 'dark', 'background']),
  themePreference: z.enum(['system', 'light', 'dark', 'background']).optional(),
  lightVariant: z.enum(LIGHT_THEME_VARIANTS),
  darkVariant: z.enum(DARK_THEME_VARIANTS),
  backgroundVariant: z.enum(BACKGROUND_THEME_VARIANTS),
  backgroundImageKey: z.string().default('builtin:wallpaperflare1.jpg'),
  backgroundTextMode: z.enum(['light', 'dark']).default('light'),
  bodyFontName: z.string().default('Sen'),
  bodyFontUrl: z.string().default('https://fonts.googleapis.com/css2?family=Sen:wght@400..800&display=swap'),
  blurMode: z.enum(['on', 'off']),
  entranceAnimations: z.enum(['on', 'off']).default('on'),
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
  mainMode: z.enum(['default', 'optimizer', 'overview']),
  showSubHits: z.boolean(),
  optimizerCpuHintSeen: z.boolean().default(false),
  savedRotationPreferences: savedRotationPreferencesSchema.default({
    sortBy: 'date',
    sortOrder: 'desc',
    filterMode: 'all',
    autoSearchActiveResonator: false,
  }),
}).strict()

const persistedCalculatorProfilesSchema = z.object({
  runtimeRevision: z.number().int().nonnegative().default(0),
  profiles: z.record(z.string(), resonatorProfileSchema),
  optimizerContext: optimizerContextSchema.nullable().default(null),
  suggestionsByResonatorId: z.record(z.string(), resonatorSuggestionsStateSchema).default({}),
}).strict()

const persistedCalculatorInventorySchema = z.object({
  inventoryEchoes: z.array(inventoryEchoesEntrySchema),
  inventoryBuilds: z.array(savedBuildSchema),
  inventoryRotations: z.array(inventoryRotationSchema),
}).strict()

function createPersistedAppStateSchema(version: typeof LEGACY_PERSISTED_APP_STATE_VERSION | typeof PERSISTED_APP_STATE_VERSION) {
  return z.object({
    version: z.literal(version),
    ui: persistedUiSchema,
    calculator: z.object({
      ...persistedCalculatorProfilesSchema.shape,
      ...persistedCalculatorInventorySchema.shape,
      session: combatSessionSchema,
    }).strict(),
  }).strict()
}

// root persisted app state schema
export const persistedAppStateSchema = createPersistedAppStateSchema(PERSISTED_APP_STATE_VERSION)
export const legacyPersistedAppStateSchema = createPersistedAppStateSchema(LEGACY_PERSISTED_APP_STATE_VERSION)

export const persistedSessionSliceSchema = z.object({
  version: z.literal(PERSISTED_APP_STATE_VERSION),
  ui: z.object({
    ...persistedUiSchema.shape,
  }).strict(),
  calculator: z.object({
    session: combatSessionSchema,
  }).strict(),
}).strict()

export const persistedProfilesSliceSchema = z.object({
  version: z.literal(PERSISTED_APP_STATE_VERSION),
  calculator: z.object({
    ...persistedCalculatorProfilesSchema.shape,
  }).strict(),
}).strict()

export const persistedInventorySliceSchema = z.object({
  version: z.literal(PERSISTED_APP_STATE_VERSION),
  calculator: z.object({
    ...persistedCalculatorInventorySchema.shape,
  }).strict(),
}).strict()
