/*
  Author: Runor Ewhro
  Description: Defines the zod schema used to validate and hydrate persisted
               application state from local storage.
*/

import { z } from 'zod'
import { DEF_UI_PREFS } from '@/domain/entities/preferences'
import { DEFAULT_BODY_FONT, getPresetFontUrl } from '@/domain/entities/appearance'
import { DEF_SET_COND } from '@/domain/entities/sonataSetConditionals'
import { makeOptInventorySelection } from '@/domain/entities/profile'
import {
  DEFAULT_ROTATION_EDITOR_STAT_KEYS,
  ROTATION_EDITOR_DAMAGE_DECIMALS,
  ROTATION_EDITOR_REGISTER_GROUPS,
  ROTATION_EDITOR_STAT_KEYS,
  makeDefaultRotationEditorPreferences,
} from '@/domain/entities/rotationEditorPreferences'
import {
  BG_THEMES,
  DARK_THEMES,
  LIGHT_THEMES,
} from '@/domain/entities/themes'
import { mnlBffsSchm } from '@/domain/state/manualBuffsSchema'
import { migrateLegacySavedRotationRecord } from '@/domain/state/savedRotationMigration.ts'
import { migrateLegacyRotationItems } from '@/domain/gameData/loopPasses.ts'
import type { RotationNode } from '@/domain/gameData/contracts.ts'
import {
  mkDefPckrFre,
  mkEmptyPckrFreqBkt,
  normalizePckrFreqState,
} from '@/domain/state/pickerFrequency'

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
const wpnMkSchm = z.preprocess((value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return value
  }
  const weapon = { ...value } as Record<string, unknown>
  delete weapon.baseAtk
  return weapon
}, z.object({
  id: z.string().nullable(),
  level: z.number(),
  rank: z.number(),
}).strict())

// teammate weapon storage omits fixed level and resolves it at runtime
const teamMemWpnMk = z.object({
  id: z.string().nullable(),
  rank: z.number(),
})

// saved build entry
const svdMkSchm = z.preprocess((value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return value
  }
  const build = { ...value } as Record<string, unknown>
  delete build.resonatorName
  return build
}, z.object({
  id: z.string(),
  name: z.string(),
  resonatorId: z.string(),
  build: z.object({
    weapon: wpnMkSchm,
    echoes: z.array(echoNstnSchm.nullable()),
  }).strict(),
  createdAt: z.number(),
  updatedAt: z.number(),
}).strict())

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

// Input-only compatibility shape. rotItemsSchm migrates and removes it.
const legacyRotWhenRuleS = z.object({
  loops: z.array(z.object({
    loopId: z.string(),
    runs: z.array(z.number().int().positive()),
  }).strict()).optional(),
  overrides: z.array(z.object({
    runs: z.record(z.string(), z.number().int().positive()),
    multiplier: z.number().optional(),
    times: z.number().optional(),
    ratio: z.number().optional(),
    changes: z.array(rtChngSchm).optional(),
  }).strict()).optional(),
}).strict()

// recursive rotation node schema
const rotEditorSectionS = z.enum(['preamble', 'main'])
const rotNoteNodeS = z.object({
  id: z.string(),
  type: z.literal('note'),
  label: z.string().optional(),
  color: z.string().optional(),
  text: z.string(),
  editorSection: rotEditorSectionS.optional(),
}).strict()
const rotNoteFieldS = { note: rotNoteNodeS.optional() }

const rotNodeSchm: z.ZodTypeAny = z.lazy(() =>
    z.discriminatedUnion('type', [
      rotNoteNodeS,
      z.object({
        id: z.string(),
        type: z.literal('feature'),
        resonatorId: z.string().optional(),
        enabled: z.boolean().optional(),
        when: legacyRotWhenRuleS.optional(),
        editorSection: rotEditorSectionS.optional(),
        featureId: z.string(),
        multiplier: z.number().optional(),
        negativeEffectStacks: z.number().optional(),
        negativeEffectInstances: z.number().optional(),
        negativeEffectStableWidth: z.number().optional(),
        // legacy pre-attach write list; loaders fold this into attached.conditions
        changes: z.array(rtChngSchm).optional(),
        attached: z.object({
          conditions: z.array(rotNodeSchm),
          features: z.array(rotNodeSchm),
        }).strict().optional(),
        ...rotNoteFieldS,
      }).strict(),
      z.object({
        id: z.string(),
        type: z.literal('condition'),
        resonatorId: z.string().optional(),
        enabled: z.boolean().optional(),
        when: legacyRotWhenRuleS.optional(),
        editorSection: rotEditorSectionS.optional(),
        label: z.string().optional(),
        changes: z.array(rtChngSchm),
        ...rotNoteFieldS,
      }).strict(),
      z.object({
        id: z.string(),
        type: z.literal('repeat'),
        resonatorId: z.string().optional(),
        enabled: z.boolean().optional(),
        when: legacyRotWhenRuleS.optional(),
        editorSection: rotEditorSectionS.optional(),
        label: z.string().optional(),
        color: z.string().optional(),
        times: z.union([z.number(), formExprSchm]),
        ratio: z.union([z.number(), formExprSchm]).optional(),
        setup: z.array(rotNodeSchm).optional(),
        items: z.array(rotNodeSchm),
        ...rotNoteFieldS,
      }).strict(),
      z.object({
        id: z.string(),
        type: z.literal('uptime'),
        resonatorId: z.string().optional(),
        enabled: z.boolean().optional(),
        when: legacyRotWhenRuleS.optional(),
        editorSection: rotEditorSectionS.optional(),
        label: z.string().optional(),
        color: z.string().optional(),
        ratio: z.union([z.number(), formExprSchm]),
        setup: z.array(rotNodeSchm).optional(),
        items: z.array(rotNodeSchm),
        ...rotNoteFieldS,
      }).strict(),
      z.object({
        id: z.string(),
        type: z.literal('loop'),
        resonatorId: z.string().optional(),
        enabled: z.boolean().optional(),
        when: legacyRotWhenRuleS.optional(),
        editorSection: rotEditorSectionS.optional(),
        kind: z.enum(['start', 'end']),
        loopId: z.string(),
        label: z.string().optional(),
        color: z.string().optional(),
        runs: z.number().int().positive().optional(),
        // lazy per-run bodies; keys are 1-based run numbers as strings
        passForks: z.record(z.string(), z.array(rotNodeSchm)).optional(),
        ...rotNoteFieldS,
      }).strict(),
    ]).superRefine((node, ctx) => {
      if (node.type === 'loop' && node.kind === 'end' && node.note) {
        ctx.addIssue({
          code: 'custom',
          path: ['note'],
          message: 'Loop end markers cannot own notes',
        })
      }
      if (node.type === 'feature' && node.attached) {
        node.attached.conditions.forEach((condition, index) => {
          if ((condition as { type?: unknown }).type !== 'condition') {
            ctx.addIssue({
              code: 'custom',
              path: ['attached', 'conditions', index],
              message: 'Feature condition attachments must be condition nodes',
            })
          }
        })
        node.attached.features.forEach((feature, index) => {
          if ((feature as { type?: unknown }).type !== 'feature') {
            ctx.addIssue({
              code: 'custom',
              path: ['attached', 'features', index],
              message: 'Feature attachments must be feature nodes',
            })
          }
        })
      }
    }),
)

const rotItemsSchm = z.array(rotNodeSchm).transform((items) =>
  migrateLegacyRotationItems(items as RotationNode[]),
)

// saved rotation state
const rotSttSchm = z.preprocess((value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return value
  }

  const stored = value as Record<string, unknown>
  return {
    sequence: stored.sequence ?? stored.items ?? stored.personalItems ?? [],
    program: stored.program ?? stored.runItems ?? stored.teamItems ?? [],
    lastRanAt: stored.lastRanAt ?? null,
  }
}, z.object({
  sequence: rotItemsSchm,
  program: rotItemsSchm,
  lastRanAt: z.number().nullable().default(null),
}).strict())

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

// saved inventory rotation entry
const invRotSchm = z.preprocess((value) => {
  const migrated = migrateLegacySavedRotationRecord(value)
  if (!migrated || typeof migrated !== 'object' || Array.isArray(migrated)) {
    return migrated
  }
  const entry = { ...migrated } as Record<string, unknown>
  delete entry.resonatorName
  if (entry.scenario) {
    delete entry.resonatorId
    delete entry.team
    delete entry.items
    delete entry.snapshot
  }
  const migration = entry.migration
  return migration && typeof migration === 'object' && !Array.isArray(migration)
    ? {
      ...entry,
      migration: {
        ...migration,
        source: (migration as Record<string, unknown>).source === 'advanced-personal'
          ? 'advanced-sequence'
          : (migration as Record<string, unknown>).source,
      },
    }
    : entry
}, z.object({
  id: z.string(),
  name: z.string(),
  resonatorId: z.string().optional(),
  resonatorName: z.string().optional(),
  duration: z.number().default(0),
  note: z.string().default(''),
  team: z.tuple([z.string().nullable(), z.string().nullable(), z.string().nullable()]).optional(),
  items: rotItemsSchm.optional(),
  scenario: z.lazy(() => combatScenarioSchm).optional(),
  snapshot: resProfSchm.optional(),
  migration: z.object({
    source: z.literal('advanced-sequence'),
    acknowledged: z.boolean(),
  }).strict().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
}).strict().superRefine((entry, context) => {
  if (entry.scenario) return
  if (!entry.resonatorId || !entry.items) {
    context.addIssue({
      code: 'custom',
      path: ['scenario'],
      message: 'A saved rotation requires a scenario snapshot',
    })
  }
}))

const enemyProfSchm = z.object({
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
  }).strict()

// Legacy active/target projection accepted only while importing old snapshots.
const cmbtSssnSchm = z.object({
  activeResonatorId: z.string().nullable(),
  enemyProfile: enemyProfSchm,
}).strict()

const scenarioMemberSchm = z.object({
  id: z.string(),
  resonatorId: z.string(),
  progression: baseSttSchm,
  loadout: z.object({
    weapon: wpnMkSchm,
    echoes: z.array(echoNstnSchm.nullable()),
  }).strict(),
  local: z.object({
    controls: prssCntrSchm,
    setConditionals: sntSetConS.default(DEF_SET_COND),
    optimizerInventory: z.object({
      mode: z.enum(['include', 'exclude']).default('exclude'),
      echoUids: z.array(z.string()).default([]),
    }).strict().default(makeOptInventorySelection()),
  }).strict(),
}).strict()

const combatScenarioSchm = z.preprocess((value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const scenario = { ...value } as Record<string, unknown>
  const rawEnvironment = scenario.environment
  if (rawEnvironment && typeof rawEnvironment === 'object' && !Array.isArray(rawEnvironment)) {
    const legacy = rawEnvironment as Record<string, unknown>
    scenario.target ??= legacy.enemy
    scenario.combatState ??= legacy.combat
  }
  const team = scenario.team && typeof scenario.team === 'object' && !Array.isArray(scenario.team)
    ? scenario.team as Record<string, unknown>
    : null
  const members = Array.isArray(team?.members)
    ? team.members.map((value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return value
      const member = { ...value } as Record<string, unknown>
      const local = member.local && typeof member.local === 'object' && !Array.isArray(member.local)
        ? { ...(member.local as Record<string, unknown>) }
        : null
      if (local) {
        member.local = local
      }
      return member
    })
    : []
  const legacyManualEffects = members.flatMap((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return []
    const member = value as Record<string, unknown>
    const local = member.local as Record<string, unknown> | null
    const buffs = local?.manualBuffs
    if (!local || !buffs) return []
    delete local.manualBuffs
    return [{
      id: `member:${String(member.id)}:manual`,
      enabled: true,
      selector: { kind: 'members', memberIds: [member.id] },
      buffs,
    }]
  })
  if (team) scenario.team = { ...team, members }
  const environment = rawEnvironment && typeof rawEnvironment === 'object'
    && !Array.isArray(rawEnvironment)
    && 'combatState' in rawEnvironment
    ? { ...(rawEnvironment as Record<string, unknown>) }
    : {
      combatState: scenario.combatState,
      manualEffects: legacyManualEffects,
      targetModifiers: {
        defenseReduction: 0,
        resistanceReduction: {},
        damageTakenAmplification: 0,
      },
      routing: scenario.routing,
    }
  environment.manualEffects ??= legacyManualEffects
  environment.targetModifiers ??= {
    defenseReduction: 0,
    resistanceReduction: {},
    damageTakenAmplification: 0,
  }
  scenario.environment = environment
  scenario.contextMemberId ??= (members[0] as Record<string, unknown> | undefined)?.id
  delete scenario.combatState
  delete scenario.routing
  return scenario
}, z.object({
  id: z.string(),
  revision: z.number().int().nonnegative(),
  team: z.object({
    members: z.array(scenarioMemberSchm)
      .min(1)
      .max(3)
      .refine(
        (members) => new Set(members.map((member) => member.id)).size === members.length,
        'Scenario member ids must be unique',
      )
      .refine(
        (members) => new Set(members.map((member) => member.resonatorId)).size === members.length,
        'Scenario resonators must be unique',
      ),
  }).strict(),
  contextMemberId: z.string(),
  target: enemyProfSchm,
  environment: z.object({
    combatState: cmbtSttSchm,
    manualEffects: z.array(z.object({
      id: z.string(),
      enabled: z.boolean(),
      label: z.string().optional(),
      selector: z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('all') }).strict(),
        z.object({ kind: z.literal('members'), memberIds: z.array(z.string()) }).strict(),
        z.object({ kind: z.literal('attribute'), attributes: z.array(ttrbSchm) }).strict(),
        z.object({ kind: z.literal('weaponType'), weaponTypes: z.array(z.number()) }).strict(),
      ]),
      buffs: mnlBffsSchm,
    }).strict()).refine(
      (effects) => new Set(effects.map((effect) => effect.id)).size === effects.length,
      'Environment effect ids must be unique',
    ),
    targetModifiers: z.object({
      defenseReduction: z.number(),
      resistanceReduction: z.partialRecord(ttrbSchm, z.number()),
      damageTakenAmplification: z.number(),
    }).strict(),
    routing: z.object({
      bySourceMemberId: z.record(
        z.string(),
        z.record(z.string(), z.string().nullable()),
      ),
    }).strict(),
  }).strict(),
  program: rotSttSchm,
  initialOnFieldMemberId: z.string(),
}).strict().superRefine((scenario, context) => {
  const memberIds = new Set(scenario.team.members.map((member) => member.id))
  if (!memberIds.has(scenario.contextMemberId)) {
    context.addIssue({
      code: 'custom',
      path: ['contextMemberId'],
      message: 'Scenario context member must belong to the team',
    })
  }
  if (!memberIds.has(scenario.initialOnFieldMemberId)) {
    context.addIssue({
      code: 'custom',
      path: ['initialOnFieldMemberId'],
      message: 'Initial on-field member must belong to the team',
    })
  }
  for (const [sourceMemberId, routes] of Object.entries(
    scenario.environment.routing.bySourceMemberId,
  )) {
    if (!memberIds.has(sourceMemberId)) {
      context.addIssue({
        code: 'custom',
        path: ['environment', 'routing', 'bySourceMemberId', sourceMemberId],
        message: 'Routing source must belong to the scenario team',
      })
    }
    for (const [routeId, targetMemberId] of Object.entries(routes)) {
      if (targetMemberId !== null && !memberIds.has(targetMemberId)) {
        context.addIssue({
          code: 'custom',
          path: ['environment', 'routing', 'bySourceMemberId', sourceMemberId, routeId],
          message: 'Routing target must belong to the scenario team',
        })
      }
    }
  }
  scenario.environment.manualEffects.forEach((effect, effectIndex) => {
    if (effect.selector.kind !== 'members') return
    effect.selector.memberIds.forEach((memberId, memberIndex) => {
      if (!memberIds.has(memberId)) {
        context.addIssue({
          code: 'custom',
          path: ['environment', 'manualEffects', effectIndex, 'selector', 'memberIds', memberIndex],
          message: 'Environment effect member must belong to the scenario team',
        })
      }
    })
  })
}))

/** Validate and normalize a standalone scenario carried by an import artifact. */
export function parseCombatScenario(value: unknown) {
  return combatScenarioSchm.safeParse(value)
}

// saved rotation page ui preferences
const svdRotPrefsS = z.preprocess((value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return value
  }
  const preferences = { ...value } as Record<string, unknown>
  delete preferences.filterMode
  return preferences
}, z.object({
  sortBy: z.enum(['date', 'name', 'avg', 'dps']).default('date'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  contributionFilter: z.enum(['unset', 'solo', 'duo', 'trio']).default('unset'),
  autoSearchActiveResonator: z.boolean().default(false),
  showLiveRotation: z.boolean().default(false),
  scaleToSelected: z.boolean().default(true),
}).strict())

const rotEditorPrefsS = z.object({
  view: z.enum(['tree', 'flat']).default('tree'),
  ghostRepeats: z.boolean().default(true),
  showPriors: z.boolean().default(false),
  statKeys: z.array(z.enum(ROTATION_EDITOR_STAT_KEYS))
    .max(ROTATION_EDITOR_STAT_KEYS.length)
    .refine((keys) => new Set(keys).size === keys.length, 'Rotation editor columns must be unique')
    .default([...DEFAULT_ROTATION_EDITOR_STAT_KEYS]),
  groupOrder: z.array(z.enum(ROTATION_EDITOR_REGISTER_GROUPS))
    .length(ROTATION_EDITOR_REGISTER_GROUPS.length)
    .refine((groups) => new Set(groups).size === groups.length, 'Rotation editor groups must be unique')
    .default([...ROTATION_EDITOR_REGISTER_GROUPS]),
  dockPane: z.boolean().default(false),
  damageBasis: z.enum(['avg', 'full']).default('avg'),
  decimals: z.union(ROTATION_EDITOR_DAMAGE_DECIMALS.map((value) => (
    z.literal(value)
  )) as [
    z.ZodLiteral<0>,
    z.ZodLiteral<1>,
    z.ZodLiteral<2>,
    z.ZodLiteral<3>,
    z.ZodLiteral<4>,
  ]).default(2),
  percentDisplay: z.enum(['percent', 'factor']).default('percent'),
  savedView: z.enum(['off', 'list', 'groups']).default('off'),
}).strict()

const histMaxSchm = z.union([
  z.literal(5),
  z.literal(10),
  z.literal(25),
  z.literal(50),
  z.literal(75),
  z.literal(100),
]).default(10)

const pckrFreqItmS = z.object({
  id: z.string(),
  count: z.number().int().positive(),
  firstUsedAt: z.string().nullable().default(null),
  lastUsedAt: z.string().nullable().default(null),
  previousUsedAt: z.string().nullable().default(null),
  firstUseSeq: z.number().int().nonnegative().default(0),
  lastUseSeq: z.number().int().nonnegative().default(0),
  usesByDay: z.record(z.string(), z.number().int().positive()).default({}),
  firstActiveResonatorId: z.string().nullable().default(null),
  lastActiveResonatorId: z.string().nullable().default(null),
  previousActiveResonatorId: z.string().nullable().default(null),
  usesByActiveResonator: z.record(z.string(), z.number().int().positive()).default({}),
}).strict()

const pckrFreqBktS = z.object({
  version: z.literal(2).default(2),
  totalUses: z.number().int().nonnegative().default(0),
  firstUsedAt: z.string().nullable().default(null),
  lastUsedAt: z.string().nullable().default(null),
  order: z.array(z.string()).default([]),
  items: z.record(z.string(), pckrFreqItmS).default({}),
}).strict().default(mkEmptyPckrFreqBkt)

const pckrFreqSttS = z.preprocess(normalizePckrFreqState, z.object({
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
    broadblade: mkEmptyPckrFreqBkt(),
    sword: mkEmptyPckrFreqBkt(),
    pistols: mkEmptyPckrFreqBkt(),
    gauntlets: mkEmptyPckrFreqBkt(),
    rectifier: mkEmptyPckrFreqBkt(),
  }),
  resonatorByTeamSlot: z.object({
    active: pckrFreqBktS,
    teammate1: pckrFreqBktS,
    teammate2: pckrFreqBktS,
  }).strict().default({
    active: mkEmptyPckrFreqBkt(),
    teammate1: mkEmptyPckrFreqBkt(),
    teammate2: mkEmptyPckrFreqBkt(),
  }),
}).strict().default(mkDefPckrFre))

export const APP_STATE_VER = 28 as const

function normalizeSimulationPrefs(value: unknown): unknown {
  if (!value || typeof value !== 'object') {
    return value
  }

  const prefs = value as Record<string, unknown>
  const legacyCards = prefs.benchmarkCards
  const cards = prefs.showcaseCards ?? legacyCards
  const showcaseCards = cards && typeof cards === 'object' && !Array.isArray(cards)
    ? Object.fromEntries(Object.entries(cards as Record<string, unknown>).map(([id, config]) => {
        if (!config || typeof config !== 'object' || Array.isArray(config)) return [id, config]
        const card = config as Record<string, unknown>
        const style = card.style && typeof card.style === 'object' && !Array.isArray(card.style)
          ? card.style as Record<string, unknown>
          : null
        const customCss = typeof style?.customCss === 'string'
          ? style.customCss.replaceAll('.bench-', '.workspace-').replaceAll('--bench-', '--workspace-')
          : style?.customCss
        return [id, style ? { ...card, style: { ...style, customCss } } : card]
      }))
    : {}

  const normalized: Record<string, unknown> = {
    ...prefs,
    showEvaluationStates: typeof prefs.showEvaluationStates === 'boolean'
      ? prefs.showEvaluationStates
      : typeof prefs.showBenchStates === 'boolean' ? prefs.showBenchStates : DEF_UI_PREFS.showEvaluationStates,
    animatedRailPortraits: typeof prefs.animatedRailPortraits === 'boolean'
      ? prefs.animatedRailPortraits
      : typeof prefs.benchAnim2d === 'boolean' ? prefs.benchAnim2d : DEF_UI_PREFS.animatedRailPortraits,
    showcaseCards,
  }
  delete normalized.showBenchStates
  delete normalized.benchAnim2d
  delete normalized.benchmarkCards
  delete normalized.benchmarkViewMode
  return normalized
}

const uiPersistSchema = z.object({
  theme: z.enum(['light', 'dark', 'background']),
  themePreference: z.enum(['system', 'light', 'dark', 'background']).optional(),
  lightVariant: z.enum(LIGHT_THEMES),
  darkVariant: z.enum(DARK_THEMES),
  backgroundVariant: z.enum(BG_THEMES),
  backgroundImageKey: z.string().default('builtin:wallpaperflare1.jpg'),
  backgroundTextMode: z.enum(['light', 'dark']).default('dark'),
  bodyFontName: z.string().default(DEFAULT_BODY_FONT),
  bodyFontUrl: z.string().default(getPresetFontUrl(DEFAULT_BODY_FONT)),
  blurMode: uiBoolSchm(false),
  entranceAnimations: uiBoolSchm(true),
  preferences: z.preprocess(normalizeSimulationPrefs, z.object({
    ctxMenu: z.boolean().default(DEF_UI_PREFS.ctxMenu),
    updateToast: z.boolean().default(DEF_UI_PREFS.updateToast),
    gameBetaData: z.boolean().default(DEF_UI_PREFS.gameBetaData),
    recommendedMenuItems: z.boolean().default(DEF_UI_PREFS.recommendedMenuItems),
    showEvaluationStates: z.boolean().default(DEF_UI_PREFS.showEvaluationStates),
    maxResOnInit: z.boolean().default(DEF_UI_PREFS.maxResOnInit),
    animatedRailPortraits: z.boolean().default(DEF_UI_PREFS.animatedRailPortraits),
    showcaseCards: z.record(
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
    showcaseLayout: z.enum(['classic', 'seal']).default(DEF_UI_PREFS.showcaseLayout),
    uploadPersist: z.enum(['indexeddb', 'imgbb']).nullable().default(DEF_UI_PREFS.uploadPersist),
    imgbbApiKey: z.string().default(DEF_UI_PREFS.imgbbApiKey),
    playerId: z.string().default(DEF_UI_PREFS.playerId),
    playerUid: z.string().default(DEF_UI_PREFS.playerUid),
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
  groupInv: z.boolean().default(false),
  seeEquipped: z.boolean().default(true),
  haveHistory: z.boolean().default(true),
  historyMax: histMaxSchm,
  itemFreq: pckrFreqSttS,
  optimizerCpuHintSeen: z.boolean().default(false),
  // portrait-mode preference for the optimizer (sprite vs profile art). a
  // display preference, not resonator-scoped, so it persists globally with
  // other UI preferences.
  optimizerUseSprite: z.boolean().default(true),
  // export files default to the compact .wwcalc format; plain json is the
  // readable fallback.
  compressedExports: z.boolean().default(true),
  rotationEditorPreferences: rotEditorPrefsS.default(makeDefaultRotationEditorPreferences()),
  savedRotationPreferences: svdRotPrefsS.default({
    sortBy: 'date',
    sortOrder: 'desc',
    contributionFilter: 'unset',
    autoSearchActiveResonator: false,
    showLiveRotation: false,
    scaleToSelected: true,
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
  groupInv: uiPersistSchema.shape.groupInv,
  seeEquipped: uiPersistSchema.shape.seeEquipped,
  haveHistory: uiPersistSchema.shape.haveHistory,
  historyMax: uiPersistSchema.shape.historyMax,
  itemFreq: uiPersistSchema.shape.itemFreq,
  optimizerCpuHintSeen: uiPersistSchema.shape.optimizerCpuHintSeen,
  optimizerUseSprite: uiPersistSchema.shape.optimizerUseSprite,
  compressedExports: uiPersistSchema.shape.compressedExports,
  rotationEditorPreferences: uiPersistSchema.shape.rotationEditorPreferences,
}).strict()

export const prssUiSvdRot = z.object({
  savedRotationPreferences: uiPersistSchema.shape.savedRotationPreferences,
}).strict()

const prssSimulationTools = z.object({
  optimizerSettingsResonatorId: z.string().nullable().optional(),
  optimizerSettings: optSetsSchm.optional(),
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

const prssSimulationInvS = z.object({
  inventoryEchoes: z.array(invChsEntSch),
  inventoryBuilds: z.array(svdMkSchm),
  inventoryRotations: z.array(invRotSchm),
}).strict()

const savedScenarioSchm = z.object({
  id: z.string(),
  name: z.string(),
  note: z.string().default(''),
  createdAt: z.number(),
  updatedAt: z.number(),
  scenario: combatScenarioSchm,
}).strict()

const savedArtifactLibrarySchm = z.object({
  echoes: z.array(invChsEntSch),
  builds: z.array(svdMkSchm),
  rotations: z.array(invRotSchm),
  scenarios: z.array(savedScenarioSchm),
}).strict()

export const prssCombatWorkspace = z.preprocess((value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const workspace = { ...value } as Record<string, unknown>
  if (workspace.scenariosById) {
    delete workspace.scenario
    return workspace
  }
  if (workspace.documentsById && typeof workspace.documentsById === 'object') {
    const documents = workspace.documentsById as Record<string, { scenario?: unknown }>
    return {
      selectedScenarioId: workspace.selectedScenarioId,
      order: workspace.order,
      scenariosById: Object.fromEntries(Object.entries(documents).map(
        ([id, document]) => [id, document?.scenario],
      )),
    }
  }
  const scenario = workspace.scenario
  if (!scenario || typeof scenario !== 'object' || Array.isArray(scenario)) return value
  const id = String((scenario as Record<string, unknown>).id ?? 'workspace')
  return {
    selectedScenarioId: id,
    order: [id],
    scenariosById: { [id]: scenario },
  }
}, z.object({
  selectedScenarioId: z.string(),
  order: z.array(z.string()),
  scenariosById: z.record(z.string(), combatScenarioSchm),
}).strict().superRefine((workspace, context) => {
  const scenarioIds = Object.keys(workspace.scenariosById)
  const orderIds = new Set(workspace.order)
  if (scenarioIds.length === 0) {
    context.addIssue({ code: 'custom', path: ['scenariosById'], message: 'At least one scenario is required' })
  }
  if (!workspace.scenariosById[workspace.selectedScenarioId]) {
    context.addIssue({ code: 'custom', path: ['selectedScenarioId'], message: 'Selected scenario must exist' })
  }
  if (orderIds.size !== workspace.order.length
    || scenarioIds.some((id) => !orderIds.has(id))
    || workspace.order.some((id) => !workspace.scenariosById[id])) {
    context.addIssue({ code: 'custom', path: ['order'], message: 'Scenario order must contain every scenario once' })
  }
  const contextOwners = new Set<string>()
  for (const [id, scenario] of Object.entries(workspace.scenariosById)) {
    if (scenario.id !== id) {
      context.addIssue({
        code: 'custom',
        path: ['scenariosById', id],
        message: 'Scenario key and identity must match',
      })
    }
    const member = scenario.team.members.find((entry) => entry.id === scenario.contextMemberId)
    const resonatorId = member?.resonatorId
    if (resonatorId && contextOwners.has(resonatorId)) {
      context.addIssue({
        code: 'custom',
        path: ['scenariosById', id, 'contextMemberId'],
        message: 'Each context resonator can own only one working scenario',
      })
    }
    if (resonatorId) contextOwners.add(resonatorId)
  }
}))

export const prssSimulationOptS = z.object({
  // Optional only while reading v28 records written before settings gained an
  // owner key. initAppState backfills the selected context resonator.
  optimizerSettingsResonatorId: z.string().nullable().optional(),
  optimizerSettings: optSetsSchm,
}).strict()

export const prssSimulationSugg = z.object({
  weaponSuggests: prssSimulationTools.shape.weaponSuggests,
  suggestionsByResonatorId: prssSimulationTools.shape.suggestionsByResonatorId,
}).strict()

export const prssSimulationInvC = z.object({
  echoes: savedArtifactLibrarySchm.shape.echoes,
}).strict()

export const prssSimulationInvB = z.object({
  builds: savedArtifactLibrarySchm.shape.builds,
}).strict()

export const prssSimulationInvR = z.object({
  rotations: savedArtifactLibrarySchm.shape.rotations,
}).strict()

export const prssInvScenarios = z.object({
  scenarios: savedArtifactLibrarySchm.shape.scenarios,
}).strict()

function makePersistSchema(version: typeof APP_STATE_VER) {
  return z.object({
    version: z.literal(version),
    ui: z.preprocess(stripLegacyMainMode, uiPersistSchema),
    // Optional only at the schema boundary so v22 state can materialize its
    // first scenario from legacy profiles/session during initialization.
    combat: prssCombatWorkspace.optional(),
    library: savedArtifactLibrarySchm.optional(),
    simulation: z.object({
      ...prssSimulationTools.shape,
      runtimeRevision: z.number().int().nonnegative().optional(),
      profiles: z.record(z.string(), resProfSchm).optional(),
      inventoryEchoes: prssSimulationInvS.shape.inventoryEchoes.optional(),
      inventoryBuilds: prssSimulationInvS.shape.inventoryBuilds.optional(),
      inventoryRotations: prssSimulationInvS.shape.inventoryRotations.optional(),
      session: cmbtSssnSchm.optional(),
      workspace: z.object({ currentScenario: combatScenarioSchm.optional() }).passthrough().optional(),
    }).strict(),
  }).strict()
}

function collapseLegacyScenarioContexts(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const workspace = value as Record<string, unknown>
  const rawScenarios = workspace.scenariosById && typeof workspace.scenariosById === 'object'
    ? workspace.scenariosById as Record<string, unknown>
    : workspace.documentsById && typeof workspace.documentsById === 'object'
      ? Object.fromEntries(Object.entries(workspace.documentsById as Record<string, unknown>).map(
        ([id, document]) => [
          id,
          document && typeof document === 'object' && !Array.isArray(document)
            ? (document as Record<string, unknown>).scenario
            : undefined,
        ],
      ))
      : null
  if (!rawScenarios) return value

  const selectedId = typeof workspace.selectedScenarioId === 'string'
    ? workspace.selectedScenarioId
    : null
  const rawOrder = Array.isArray(workspace.order)
    ? workspace.order.filter((id): id is string => typeof id === 'string')
    : Object.keys(rawScenarios)
  const contextIdFor = (scenario: unknown): string | null => {
    if (!scenario || typeof scenario !== 'object' || Array.isArray(scenario)) return null
    const record = scenario as Record<string, unknown>
    if (!record.team || typeof record.team !== 'object' || Array.isArray(record.team)) return null
    const members = (record.team as Record<string, unknown>).members
    if (!Array.isArray(members)) return null
    const contextMemberId = record.contextMemberId
    const member = members.find((candidate) => (
      candidate && typeof candidate === 'object' && !Array.isArray(candidate)
      && (candidate as Record<string, unknown>).id === contextMemberId
    )) as Record<string, unknown> | undefined
    return typeof member?.resonatorId === 'string' ? member.resonatorId : null
  }

  const selectedContext = selectedId ? contextIdFor(rawScenarios[selectedId]) : null
  const seen = new Set<string>()
  const order = rawOrder.filter((id) => {
    const contextId = contextIdFor(rawScenarios[id])
    if (!contextId) return true
    if (contextId === selectedContext && id !== selectedId) return false
    if (seen.has(contextId)) return false
    seen.add(contextId)
    return true
  })
  if (selectedId && rawScenarios[selectedId] && !order.includes(selectedId)) order.unshift(selectedId)

  return {
    selectedScenarioId: selectedId ?? order[0],
    order,
    scenariosById: Object.fromEntries(order.map((id) => [id, rawScenarios[id]])),
  }
}

function migratePersistedVersion(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const record = value as Record<string, unknown>
  if (![22, 23, 24, 25, 26, 27].includes(Number(record.version))) return value

  const legacySimulation = record.simulation ?? record.calculator
  const simulation = legacySimulation && typeof legacySimulation === 'object'
    && !Array.isArray(legacySimulation)
    ? { ...(legacySimulation as Record<string, unknown>) }
    : {}
  const workspace = simulation.workspace
  delete simulation.workspace
  const optimizerContext = simulation.optimizerContext
  if (
    !simulation.optimizerSettings
    && optimizerContext
    && typeof optimizerContext === 'object'
    && !Array.isArray(optimizerContext)
  ) {
    simulation.optimizerSettings = (optimizerContext as Record<string, unknown>).settings
  }
  if (
    !simulation.optimizerSettingsResonatorId
    && optimizerContext
    && typeof optimizerContext === 'object'
    && !Array.isArray(optimizerContext)
  ) {
    simulation.optimizerSettingsResonatorId =
      (optimizerContext as Record<string, unknown>).resonatorId ?? null
  }
  delete simulation.optimizerContext
  const legacyScenario = workspace && typeof workspace === 'object'
    && !Array.isArray(workspace)
    ? (workspace as Record<string, unknown>).currentScenario
    : undefined
  const currentRecord = { ...record }
  delete currentRecord.calculator

  return {
    ...currentRecord,
    version: APP_STATE_VER,
    library: record.library ?? {
      echoes: simulation.inventoryEchoes ?? [],
      builds: simulation.inventoryBuilds ?? [],
      rotations: simulation.inventoryRotations ?? [],
      scenarios: [],
    },
    ...(record.combat
      ? { combat: Number(record.version) === 25
        ? collapseLegacyScenarioContexts(record.combat)
        : record.combat }
      : legacyScenario
        ? { combat: { scenario: legacyScenario } }
        : {}),
    simulation,
  }
}

// root persisted app state schema
export const persistedSchema = z.preprocess(
  migratePersistedVersion,
  makePersistSchema(APP_STATE_VER),
)

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

export const prssCmbtWrkspSlcS = z.object({
  version: z.literal(APP_STATE_VER),
  combat: prssCombatWorkspace,
}).strict()

export const prssOptSettingsSl = z.object({
  version: z.literal(APP_STATE_VER),
  simulation: prssSimulationOptS,
}).strict()

export const prssSuggsSlc = z.object({
  version: z.literal(APP_STATE_VER),
  simulation: prssSimulationSugg,
}).strict()

export const prssInvChsSl = z.object({
  version: z.literal(APP_STATE_VER),
  library: prssSimulationInvC,
}).strict()

export const prssInvBldsS = z.object({
  version: z.literal(APP_STATE_VER),
  library: prssSimulationInvB,
}).strict()

export const prssInvRttnS = z.object({
  version: z.literal(APP_STATE_VER),
  library: prssSimulationInvR,
}).strict()

export const prssInvScenariosSl = z.object({
  version: z.literal(APP_STATE_VER),
  library: prssInvScenarios,
}).strict()
