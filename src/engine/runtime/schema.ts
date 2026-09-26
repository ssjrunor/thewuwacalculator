/*
  Author: Runor Ewhro
  Description: Defines the zod schema used to validate and hydrate persisted
               application state from local storage.
*/

import * as z from 'zod/mini'
import { APP_STATE_VER } from '@/domain/entities/appStateVersion'
export { APP_STATE_VER } from '@/domain/entities/appStateVersion'
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
import { mnlBffsSchm } from '@/engine/runtime/manualBuffsSchema'
import { migrateLegacySavedRotationRecord } from '@/engine/runtime/savedRotationMigration.ts'
import { migrateLegacyRotationItems } from '@/domain/gameData/loopPasses.ts'
import type { CondExpr, FormExpr, RotationNode } from '@/domain/gameData/contracts.ts'
import {
  mkDefPckrFre,
  mkEmptyPckrFreqBkt,
  normalizePckrFreqState,
} from '@/engine/runtime/pickerFrequency'

function stripLegacyMainMode(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return value
  }

  const rest = { ...value as Record<string, unknown> }
  delete rest.mainMode
  return rest
}

// shared base stat buff shape
const baseStatBuff = z.lazy(() => z.strictObject({
  percent: z.number(),
  flat: z.number(),
}))

// shared modifier buff shape
const modBuffSchm = z.lazy(() => z.strictObject({
  resShred: z.number(),
  dmgBonus: z.number(),
  amplify: z.number(),
  defIgnore: z.number(),
  defShred: z.number(),
  dmgVuln: z.number(),
  critRate: z.number(),
  critDmg: z.number(),
}))

// supported elemental attributes
const ttrbSchm = z.lazy(() => z.enum([
  'aero',
  'glacio',
  'spectro',
  'fusion',
  'electro',
  'havoc',
  'physical',
]))

// trace node buff storage
const trcNodeBffsS = z.lazy(() => z.strictObject({
  atk: baseStatBuff,
  hp: baseStatBuff,
  def: baseStatBuff,
  attribute: z.record(ttrbSchm, modBuffSchm),
  critRate: z.number(),
  critDmg: z.number(),
  healingBonus: z.number(),
  activeNodes: z.record(z.string(), z.boolean()),
}))

// per-tab skill level storage
const skllLvlsSchm = z.lazy(() => z.strictObject({
  normalAttack: z.number(),
  resonanceSkill: z.number(),
  forteCircuit: z.number(),
  resonanceLiberation: z.number(),
  introSkill: z.number(),
  tuneBreak: z.number(),
}))

// combat status effect state
const cmbtSttSchm = z.lazy(() => z.strictObject({
  spectroFrazzle: z.number(),
  aeroErosion: z.number(),
  fusionBurst: z.number(),
  havocBane: z.number(),
  glacioChafe: z.number(),
  electroFlare: z.number(),
  electroRage: z.number(),
}))

const cntrVlSchm = z.lazy(() => z.union([z.string(), z.number(), z.boolean()]))

const prssCntrSchm = z.lazy(() => z.record(z.string(), cntrVlSchm))

const uiBoolSchm = (defaultValue: boolean) => z.pipe(z.transform((value) => {
  if (typeof value === 'string') {
    if (value === 'on') {
      return true
    }
    if (value === 'off') {
      return false
    }
  }

  return value
}), z._default(z.boolean(), defaultValue))

// equipped echo instance
const echoNstnSchm = z.lazy(() => z.strictObject({
  uid: z.string(),
  id: z.string(),
  set: z.number(),
  mainEcho: z.boolean(),
  mainStats: z.strictObject({
    primary: z.strictObject({ key: z.string(), value: z.number() }),
    secondary: z.strictObject({ key: z.string(), value: z.number() }),
  }),
  substats: z.record(z.string(), z.number()),
}))

// inventory echo entry
const invChsEntSch = z.lazy(() => z.strictObject({
  id: z.string(),
  echo: echoNstnSchm,
  createdAt: z.number(),
  updatedAt: z.number(),
}))

// shared weapon build snapshot
const wpnMkSchm = z.lazy(() => z.pipe(z.transform((value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return value
  }
  const weapon = { ...value } as Record<string, unknown>
  delete weapon.baseAtk
  return weapon
}), z.strictObject({
  id: z.nullable(z.string()),
  level: z.number(),
  rank: z.number(),
})))

// teammate weapon storage omits fixed level and resolves it at runtime
const teamMemWpnMk = z.lazy(() => z.object({
  id: z.nullable(z.string()),
  rank: z.number(),
}))

// saved build entry
const svdMkSchm = z.lazy(() => z.pipe(z.transform((value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return value
  }
  const build = { ...value } as Record<string, unknown>
  delete build.resonatorName
  return build
}), z.strictObject({
  id: z.string(),
  name: z.string(),
  resonatorId: z.string(),
  build: z.strictObject({
    weapon: wpnMkSchm,
    echoes: z.array(z.nullable(echoNstnSchm)),
  }),
  createdAt: z.number(),
  updatedAt: z.number(),
})))

// shared base progression state
const baseSttSchm = z.lazy(() => z.strictObject({
  level: z.number(),
  sequence: z.number(),
  skillLevels: skllLvlsSchm,
  traceNodes: trcNodeBffsS,
}))

// teammate progression persists only the player-editable sequence
const teamMemBaseS = z.lazy(() => z.strictObject({
  sequence: z.number(),
}))

// runtime mutation step used in rotations
const rtChngSchm = z.lazy(() => z.strictObject({
  type: z.enum(['set', 'add', 'toggle']),
  path: z.string(),
  value: z.optional(z.union([z.string(), z.number(), z.boolean()])),
  resonatorId: z.optional(z.string()),
}))

// recursive formula expression tree
const formExprSchm: z.ZodMiniType<FormExpr> = z.lazy(() =>
    z.union([
      z.strictObject({
        type: z.literal('const'),
        value: z.number(),
      }),
      z.strictObject({
        type: z.literal('read'),
        from: z.optional(z.enum([
          'sourceRuntime',
          'sourceFinalStats',
          'targetRuntime',
          'activeRuntime',
          'pool',
          'baseStats',
          'finalStats',
          'context',
        ])),
        path: z.string(),
        default: z.optional(z.number()),
      }),
      z.strictObject({
        type: z.literal('table'),
        from: z.optional(z.enum([
          'sourceRuntime',
          'sourceFinalStats',
          'targetRuntime',
          'activeRuntime',
          'pool',
          'baseStats',
          'finalStats',
          'context',
        ])),
        path: z.string(),
        values: z.array(z.number()),
        minIndex: z.optional(z.number()),
        maxIndex: z.optional(z.number()),
        defaultIndex: z.optional(z.number()),
      }),
      z.strictObject({
        type: z.literal('add'),
        values: z.array(formExprSchm),
      }),
      z.strictObject({
        type: z.literal('mul'),
        values: z.array(formExprSchm),
      }),
      z.strictObject({
        type: z.literal('clamp'),
        value: formExprSchm,
        min: z.optional(z.number()),
        max: z.optional(z.number()),
      }),
    ]),
)

// recursive condition expression tree
const condExprSchm: z.ZodMiniType<CondExpr> = z.lazy(() =>
    z.union([
      z.strictObject({ type: z.literal('always') }),
      z.strictObject({
        type: z.literal('not'),
        value: condExprSchm,
      }),
      z.strictObject({
        type: z.literal('truthy'),
        from: z.optional(z.enum([
          'sourceRuntime',
          'sourceFinalStats',
          'targetRuntime',
          'activeRuntime',
          'pool',
          'baseStats',
          'finalStats',
          'context',
        ])),
        path: z.string(),
      }),
      z.strictObject({
        type: z.literal('eq'),
        from: z.optional(z.enum([
          'sourceRuntime',
          'sourceFinalStats',
          'targetRuntime',
          'activeRuntime',
          'pool',
          'baseStats',
          'finalStats',
          'context',
        ])),
        path: z.string(),
        value: z.union([z.string(), z.number(), z.boolean()]),
      }),
      z.strictObject({
        type: z.literal('neq'),
        from: z.optional(z.enum([
          'sourceRuntime',
          'sourceFinalStats',
          'targetRuntime',
          'activeRuntime',
          'pool',
          'baseStats',
          'finalStats',
          'context',
        ])),
        path: z.string(),
        value: z.union([z.string(), z.number(), z.boolean()]),
      }),
      z.strictObject({
        type: z.literal('gt'),
        from: z.optional(z.enum([
          'sourceRuntime',
          'sourceFinalStats',
          'targetRuntime',
          'activeRuntime',
          'pool',
          'baseStats',
          'finalStats',
          'context',
        ])),
        path: z.string(),
        value: z.number(),
      }),
      z.strictObject({
        type: z.literal('gte'),
        from: z.optional(z.enum([
          'sourceRuntime',
          'sourceFinalStats',
          'targetRuntime',
          'activeRuntime',
          'pool',
          'baseStats',
          'finalStats',
          'context',
        ])),
        path: z.string(),
        value: z.number(),
      }),
      z.strictObject({
        type: z.literal('lt'),
        from: z.optional(z.enum([
          'sourceRuntime',
          'sourceFinalStats',
          'targetRuntime',
          'activeRuntime',
          'pool',
          'baseStats',
          'finalStats',
          'context',
        ])),
        path: z.string(),
        value: z.number(),
      }),
      z.strictObject({
        type: z.literal('lte'),
        from: z.optional(z.enum([
          'sourceRuntime',
          'sourceFinalStats',
          'targetRuntime',
          'activeRuntime',
          'pool',
          'baseStats',
          'finalStats',
          'context',
        ])),
        path: z.string(),
        value: z.number(),
      }),
      z.strictObject({
        type: z.literal('includes'),
        from: z.optional(z.enum([
          'sourceRuntime',
          'sourceFinalStats',
          'targetRuntime',
          'activeRuntime',
          'pool',
          'baseStats',
          'finalStats',
          'context',
        ])),
        path: z.string(),
        value: z.union([z.string(), z.number(), z.boolean()]),
        itemPath: z.optional(z.string()),
      }),
      z.strictObject({
        type: z.literal('and'),
        values: z.array(condExprSchm),
      }),
      z.strictObject({
        type: z.literal('or'),
        values: z.array(condExprSchm),
      }),
    ]),
)

// Input-only compatibility shape. rotItemsSchm migrates and removes it.
const legacyRotWhenRuleS = z.lazy(() => z.strictObject({
  loops: z.optional(z.array(z.strictObject({
    loopId: z.string(),
    runs: z.array(z.number().check(z.int()).check(z.positive())),
  }))),
  overrides: z.optional(z.array(z.strictObject({
    runs: z.record(z.string(), z.number().check(z.int()).check(z.positive())),
    multiplier: z.optional(z.number()),
    times: z.optional(z.number()),
    ratio: z.optional(z.number()),
    changes: z.optional(z.array(rtChngSchm)),
  }))),
}))

// recursive rotation node schema
const rotEditorSectionS = z.lazy(() => z.enum(['preamble', 'main']))
const rotNoteNodeS = z.lazy(() => z.strictObject({
  id: z.string(),
  type: z.literal('note'),
  label: z.optional(z.string()),
  color: z.optional(z.string()),
  text: z.string(),
  editorSection: z.optional(rotEditorSectionS),
}))
const rotNoteFieldS = { note: z.optional(rotNoteNodeS) }

// Persisted nodes include legacy changes normalized by the rotation migration.
const rotNodeSchm: z.ZodMiniType<unknown> = z.lazy(() =>
    z.discriminatedUnion('type', [
      rotNoteNodeS,
      z.strictObject({
        id: z.string(),
        type: z.literal('feature'),
        resonatorId: z.optional(z.string()),
        enabled: z.optional(z.boolean()),
        when: z.optional(legacyRotWhenRuleS),
        editorSection: z.optional(rotEditorSectionS),
        featureId: z.string(),
        multiplier: z.optional(z.number()),
        offTuneResume: z.optional(z.boolean()),
        negativeEffectStacks: z.optional(z.number()),
        negativeEffectInstances: z.optional(z.number()),
        negativeEffectStableWidth: z.optional(z.number()),
        // legacy pre-attach write list; loaders fold this into attached.conditions
        changes: z.optional(z.array(rtChngSchm)),
        attached: z.optional(z.strictObject({
          conditions: z.array(rotNodeSchm),
          features: z.array(rotNodeSchm),
        })),
        ...rotNoteFieldS,
      }),
      z.strictObject({
        id: z.string(),
        type: z.literal('condition'),
        resonatorId: z.optional(z.string()),
        enabled: z.optional(z.boolean()),
        when: z.optional(legacyRotWhenRuleS),
        editorSection: z.optional(rotEditorSectionS),
        label: z.optional(z.string()),
        changes: z.array(rtChngSchm),
        ...rotNoteFieldS,
      }),
      z.strictObject({
        id: z.string(),
        type: z.literal('repeat'),
        resonatorId: z.optional(z.string()),
        enabled: z.optional(z.boolean()),
        when: z.optional(legacyRotWhenRuleS),
        editorSection: z.optional(rotEditorSectionS),
        label: z.optional(z.string()),
        color: z.optional(z.string()),
        times: z.union([z.number(), formExprSchm]),
        ratio: z.optional(z.union([z.number(), formExprSchm])),
        setup: z.optional(z.array(rotNodeSchm)),
        items: z.array(rotNodeSchm),
        ...rotNoteFieldS,
      }),
      z.strictObject({
        id: z.string(),
        type: z.literal('uptime'),
        resonatorId: z.optional(z.string()),
        enabled: z.optional(z.boolean()),
        when: z.optional(legacyRotWhenRuleS),
        editorSection: z.optional(rotEditorSectionS),
        label: z.optional(z.string()),
        color: z.optional(z.string()),
        ratio: z.union([z.number(), formExprSchm]),
        setup: z.optional(z.array(rotNodeSchm)),
        items: z.array(rotNodeSchm),
        ...rotNoteFieldS,
      }),
      z.strictObject({
        id: z.string(),
        type: z.literal('loop'),
        resonatorId: z.optional(z.string()),
        enabled: z.optional(z.boolean()),
        when: z.optional(legacyRotWhenRuleS),
        editorSection: z.optional(rotEditorSectionS),
        kind: z.enum(['start', 'end']),
        loopId: z.string(),
        label: z.optional(z.string()),
        color: z.optional(z.string()),
        runs: z.optional(z.number().check(z.int()).check(z.positive())),
        // lazy per-run bodies; keys are 1-based run numbers as strings
        passForks: z.optional(z.record(z.string(), z.array(rotNodeSchm))),
        ...rotNoteFieldS,
      }),
    ]).check(z.superRefine((node, ctx) => {
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
    })),
)

const rotItemsSchm = z.lazy(() => z.pipe(z.array(rotNodeSchm), z.transform((items) =>
  migrateLegacyRotationItems(items as RotationNode[]))))

// saved rotation state
const rotSttSchm = z.lazy(() => z.pipe(z.transform((value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return value
  }

  const stored = value as Record<string, unknown>
  return {
    sequence: stored.sequence ?? stored.items ?? stored.personalItems ?? [],
    program: stored.program ?? stored.runItems ?? stored.teamItems ?? [],
    lastRanAt: stored.lastRanAt ?? null,
  }
}), z.strictObject({
  sequence: rotItemsSchm,
  program: rotItemsSchm,
  lastRanAt: z._default(z.nullable(z.number()), null),
})))

// optimizer settings payload
const optSetsSchm = z.lazy(() => z.strictObject({
  targetSkillId: z.nullable(z.string()),
  targetMode: z.enum(['skill', 'combo']),
  targetComboSourceId: z.nullable(z.string()),
  rotationMode: z.boolean(),
  searchMode: z._default(z.enum(['inventory', 'theory']), 'inventory'),
  resultsLimit: z.number(),
  keepPercent: z.number(),
  lowMemoryMode: z.boolean(),
  enableGpu: z.boolean(),
  lockedMainEchoId: z.nullable(z.string()),
  // keys are optional so snapshots exported before a cost tier existed still validate;
  // cloneOptSets() backfills any missing tier from defaults during hydration.
  allowedSets: z.strictObject({
    1: z.optional(z.array(z.number())),
    3: z.optional(z.array(z.number())),
    5: z.optional(z.array(z.number())),
  }),
  mainStatFilter: z.array(z.string()),
  selectedBonus: z.nullable(z.string()),
  // inventory-mode toggle. optional + default so older snapshots backfill.
  excludeEquipped: z._default(z.optional(z.boolean()), false),
  // theory-mode weapon search toggle. optional + default so snapshots exported
  // before it existed still validate; cloneOptSets backfills the default.
  includeWeapons: z._default(z.optional(z.boolean()), false),
  statConstraints: z.record(z.string(), z.strictObject({
    minTotal: z.optional(z.string()),
    maxTotal: z.optional(z.string()),
  })),
}))

const ovrSntSetCo = z.lazy(() => z.strictObject({
  version: z.literal(1),
  encoding: z.literal('off-v1'),
  off: z.record(z.string(), z.array(z.string())),
}))

const sntSetConS = z.lazy(() => z.catch(ovrSntSetCo, DEF_SET_COND))

// simplified teammate runtime used inside team state
const teamMemRtSch = z.lazy(() => z.strictObject({
  id: z.string(),
  base: teamMemBaseS,
  build: z.strictObject({
    weapon: teamMemWpnMk,
    echoes: z.array(z.nullable(echoNstnSchm)),
  }),
  manualBuffs: mnlBffsSchm,
}))

// resonator suggestion settings
const suggSetsSchm = z.lazy(() => z.strictObject({
  targetFeatureId: z._default(z.nullable(z.string()), null),
  rotationMode: z._default(z.boolean(), false),
}))

// random suggestion set preference
const randGnrtSetP = z.lazy(() => z.strictObject({
  setId: z.number(),
  count: z.number(),
}))

// random suggestion generation settings
const randGnrtSets = z.lazy(() => z.strictObject({
  bias: z._default(z.number(), 0.5),
  rollQuality: z._default(z.number(), 0.3),
  targetEnergyRegen: z._default(z.number(), 0),
  setPreferences: z._default(z.array(randGnrtSetP), []),
  mainEchoId: z._default(z.nullable(z.string()), null),
}))

// weapon suggestion settings
const wpnStValS = z.lazy(() => z.union([z.boolean(), z.number(), z.string()]))
const wpnStCfgS = z.lazy(() => z.strictObject({
  off: z.optional(z.literal(true)),
  max: z.optional(wpnStValS),
}))

const wpnSuggSetS = z.lazy(() => z.strictObject({
  mode: z._default(z.enum(['default', 'max', 'both']), 'both'),
  target: z._default(z.enum(['default', 'max']), 'max'),
  ranks: z._default(z.record(z.string(), z.number()), {
    '5': 1,
    '4': 5,
    '3': 5,
    '2': 5,
    '1': 5,
  }),
  stdRank: z._default(z.number(), 1),
  visible: z._default(z.record(z.string(), z.boolean()), {
    '5': true,
    '4': true,
    '3': false,
    '2': false,
    '1': false,
  }),
  states: z._default(z.record(z.string(), z.record(z.string(), wpnStCfgS)), {}),
}))

// stored suggestion state per resonator
const resSuggsSttS = z.lazy(() => z.object({
  settings: z._default(suggSetsSchm, {
    targetFeatureId: null,
    rotationMode: false,
  }),
  random: z._default(randGnrtSets, {
    bias: 0.5,
    rollQuality: 0.3,
    targetEnergyRegen: 0,
    setPreferences: [],
    mainEchoId: null,
  }),
}))

// persisted resonator profile schema
const resProfSchm = z.lazy(() => z.strictObject({
  resonatorId: z.string(),
  runtime: z.strictObject({
    progression: baseSttSchm,
    build: z.strictObject({
      weapon: wpnMkSchm,
      echoes: z.array(z.nullable(echoNstnSchm)),
    }),
    local: z.strictObject({
      controls: prssCntrSchm,
      manualBuffs: mnlBffsSchm,
      combat: cmbtSttSchm,
      setConditionals: z._default(sntSetConS, DEF_SET_COND),
      optimizerInventory: z._default(z.strictObject({
        mode: z._default(z.enum(['include', 'exclude']), 'exclude'),
        echoUids: z._default(z.array(z.string()), []),
      }), makeOptInventorySelection()),
    }),
    routing: z.strictObject({
      selectedTargetsByOwnerKey: z.record(z.string(), z.nullable(z.string())),
    }),
    team: z.tuple([z.nullable(z.string()), z.nullable(z.string()), z.nullable(z.string())]),
    rotation: rotSttSchm,
    teamRuntimes: z.tuple([z.nullable(teamMemRtSch), z.nullable(teamMemRtSch)]),
  }),
}))

// saved inventory rotation entry
const invRotSchm = z.lazy(() => z.pipe(z.transform((value) => {
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
}), z.strictObject({
  id: z.string(),
  name: z.string(),
  resonatorId: z.optional(z.string()),
  resonatorName: z.optional(z.string()),
  duration: z._default(z.number(), 0),
  note: z._default(z.string(), ''),
  team: z.optional(z.tuple([z.nullable(z.string()), z.nullable(z.string()), z.nullable(z.string())])),
  items: z.optional(rotItemsSchm),
  scenario: z.optional(z.lazy(() => combatScenarioSchm)),
  snapshot: z.optional(resProfSchm),
  migration: z.optional(z.strictObject({
    source: z.literal('advanced-sequence'),
    acknowledged: z.boolean(),
  })),
  createdAt: z.number(),
  updatedAt: z.number(),
}).check(z.superRefine((entry, context) => {
  if (entry.scenario) return
  if (!entry.resonatorId || !entry.items) {
    context.addIssue({
      code: 'custom',
      path: ['scenario'],
      message: 'A saved rotation requires a scenario snapshot',
    })
  }
}))))

const enemyProfSchm = z.lazy(() => z.strictObject({
    id: z.string(),
    level: z.number(),
    class: z.number(),
    toa: z.boolean(),
    source: z.optional(z.enum(['catalog', 'custom'])),
    status: z.optional(z.catchall(z.object({
      tuneStrain: z.number(),
    }), z.union([z.number(), z.boolean(), z.string()]))),
    res: z.strictObject({
      0: z.number(),
      1: z.number(),
      2: z.number(),
      3: z.number(),
      4: z.number(),
      5: z.number(),
      6: z.number(),
    }),
  }))

// Legacy active/target projection accepted only while importing old snapshots.
const cmbtSssnSchm = z.lazy(() => z.strictObject({
  activeResonatorId: z.nullable(z.string()),
  enemyProfile: enemyProfSchm,
}))

const scenarioMemberSchm = z.lazy(() => z.strictObject({
  id: z.string(),
  resonatorId: z.string(),
  progression: baseSttSchm,
  loadout: z.strictObject({
    weapon: wpnMkSchm,
    echoes: z.array(z.nullable(echoNstnSchm)),
  }),
  local: z.strictObject({
    controls: prssCntrSchm,
    setConditionals: z._default(sntSetConS, DEF_SET_COND),
    optimizerInventory: z._default(z.strictObject({
      mode: z._default(z.enum(['include', 'exclude']), 'exclude'),
      echoUids: z._default(z.array(z.string()), []),
    }), makeOptInventorySelection()),
  }),
}))

const combatScenarioSchm = z.lazy(() => z.pipe(z.transform((value) => {
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
}), z.strictObject({
  id: z.string(),
  revision: z.number().check(z.int()).check(z.nonnegative()),
  team: z.strictObject({
    members: z.array(scenarioMemberSchm).check(z.minLength(1)).check(z.maxLength(3)).check(z.refine((members) => new Set(members.map((member) => member.id)).size === members.length, 'Scenario member ids must be unique')).check(z.refine((members) => new Set(members.map((member) => member.resonatorId)).size === members.length, 'Scenario resonators must be unique')),
  }),
  contextMemberId: z.string(),
  target: enemyProfSchm,
  environment: z.strictObject({
    combatState: cmbtSttSchm,
    manualEffects: z.array(z.strictObject({
      id: z.string(),
      enabled: z.boolean(),
      label: z.optional(z.string()),
      selector: z.discriminatedUnion('kind', [
        z.strictObject({ kind: z.literal('all') }),
        z.strictObject({ kind: z.literal('members'), memberIds: z.array(z.string()) }),
        z.strictObject({ kind: z.literal('attribute'), attributes: z.array(ttrbSchm) }),
        z.strictObject({ kind: z.literal('weaponType'), weaponTypes: z.array(z.number()) }),
      ]),
      buffs: mnlBffsSchm,
    })).check(z.refine((effects) => new Set(effects.map((effect) => effect.id)).size === effects.length, 'Environment effect ids must be unique')),
    targetModifiers: z.strictObject({
      defenseReduction: z.number(),
      resistanceReduction: z.partialRecord(ttrbSchm, z.number()),
      damageTakenAmplification: z.number(),
    }),
    routing: z.strictObject({
      bySourceMemberId: z.record(
        z.string(),
        z.record(z.string(), z.nullable(z.string())),
      ),
    }),
  }),
  program: rotSttSchm,
  initialOnFieldMemberId: z.string(),
}).check(z.superRefine((scenario, context) => {
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
}))))

/** Validate and normalize a standalone scenario carried by an import artifact. */
export function parseCombatScenario(value: unknown) {
  return combatScenarioSchm.safeParse(value)
}

// saved rotation page ui preferences
const svdRotPrefsS = z.lazy(() => z.pipe(z.transform((value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return value
  }
  const preferences = { ...value } as Record<string, unknown>
  delete preferences.filterMode
  return preferences
}), z.strictObject({
  sortBy: z._default(z.enum(['date', 'name', 'avg', 'dps']), 'date'),
  sortOrder: z._default(z.enum(['asc', 'desc']), 'desc'),
  contributionFilter: z._default(z.enum(['unset', 'solo', 'duo', 'trio']), 'unset'),
  autoSearchActiveResonator: z._default(z.boolean(), false),
  showLiveRotation: z._default(z.boolean(), false),
  scaleToSelected: z._default(z.boolean(), true),
})))

const rotEditorPrefsS = z.lazy(() => z.strictObject({
  view: z._default(z.enum(['tree', 'flat']), 'tree'),
  ghostRepeats: z._default(z.boolean(), true),
  showPriors: z._default(z.boolean(), false),
  statKeys: z._default(z.array(z.enum(ROTATION_EDITOR_STAT_KEYS)).check(z.maxLength(ROTATION_EDITOR_STAT_KEYS.length)).check(z.refine((keys) => new Set(keys).size === keys.length, 'Rotation editor columns must be unique')), [...DEFAULT_ROTATION_EDITOR_STAT_KEYS]),
  groupOrder: z._default(z.array(z.enum(ROTATION_EDITOR_REGISTER_GROUPS)).check(z.length(ROTATION_EDITOR_REGISTER_GROUPS.length)).check(z.refine((groups) => new Set(groups).size === groups.length, 'Rotation editor groups must be unique')), [...ROTATION_EDITOR_REGISTER_GROUPS]),
  dockPane: z._default(z.boolean(), false),
  damageBasis: z._default(z.enum(['avg', 'full']), 'avg'),
  decimals: z._default(z.union(ROTATION_EDITOR_DAMAGE_DECIMALS.map((value) => (
    z.literal(value)
  )) as [
    z.ZodMiniLiteral<0>,
    z.ZodMiniLiteral<1>,
    z.ZodMiniLiteral<2>,
    z.ZodMiniLiteral<3>,
    z.ZodMiniLiteral<4>,
  ]), 2),
  percentDisplay: z._default(z.enum(['percent', 'factor']), 'percent'),
  savedView: z._default(z.enum(['off', 'list', 'groups']), 'off'),
}))

const histMaxSchm = z.lazy(() => z._default(z.union([
  z.literal(5),
  z.literal(10),
  z.literal(25),
  z.literal(50),
  z.literal(75),
  z.literal(100),
]), 10))

const pckrFreqItmS = z.lazy(() => z.strictObject({
  id: z.string(),
  count: z.number().check(z.int()).check(z.positive()),
  firstUsedAt: z._default(z.nullable(z.string()), null),
  lastUsedAt: z._default(z.nullable(z.string()), null),
  previousUsedAt: z._default(z.nullable(z.string()), null),
  firstUseSeq: z._default(z.number().check(z.int()).check(z.nonnegative()), 0),
  lastUseSeq: z._default(z.number().check(z.int()).check(z.nonnegative()), 0),
  usesByDay: z._default(z.record(z.string(), z.number().check(z.int()).check(z.positive())), {}),
  firstActiveResonatorId: z._default(z.nullable(z.string()), null),
  lastActiveResonatorId: z._default(z.nullable(z.string()), null),
  previousActiveResonatorId: z._default(z.nullable(z.string()), null),
  usesByActiveResonator: z._default(z.record(z.string(), z.number().check(z.int()).check(z.positive())), {}),
}))

const pckrFreqBktS = z.lazy(() => z._default(z.strictObject({
  version: z._default(z.literal(2), 2),
  totalUses: z._default(z.number().check(z.int()).check(z.nonnegative()), 0),
  firstUsedAt: z._default(z.nullable(z.string()), null),
  lastUsedAt: z._default(z.nullable(z.string()), null),
  order: z._default(z.array(z.string()), []),
  items: z._default(z.record(z.string(), pckrFreqItmS), {}),
}), mkEmptyPckrFreqBkt))

const pckrFreqSttS = z.lazy(() => z.pipe(z.transform((value: unknown): unknown => normalizePckrFreqState(value)), z._default(z.strictObject({
  resonator: pckrFreqBktS,
  echo: pckrFreqBktS,
  enemy: pckrFreqBktS,
  weaponByType: z._default(z.strictObject({
    broadblade: pckrFreqBktS,
    sword: pckrFreqBktS,
    pistols: pckrFreqBktS,
    gauntlets: pckrFreqBktS,
    rectifier: pckrFreqBktS,
  }), {
    broadblade: mkEmptyPckrFreqBkt(),
    sword: mkEmptyPckrFreqBkt(),
    pistols: mkEmptyPckrFreqBkt(),
    gauntlets: mkEmptyPckrFreqBkt(),
    rectifier: mkEmptyPckrFreqBkt(),
  }),
  resonatorByTeamSlot: z._default(z.strictObject({
    active: pckrFreqBktS,
    teammate1: pckrFreqBktS,
    teammate2: pckrFreqBktS,
  }), {
    active: mkEmptyPckrFreqBkt(),
    teammate1: mkEmptyPckrFreqBkt(),
    teammate2: mkEmptyPckrFreqBkt(),
  }),
}), mkDefPckrFre)))


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

const uiPersistSchema = z.strictObject({
  theme: z.enum(['light', 'dark', 'background']),
  themePreference: z.optional(z.enum(['system', 'light', 'dark', 'background'])),
  lightVariant: z.enum(LIGHT_THEMES),
  darkVariant: z.enum(DARK_THEMES),
  backgroundVariant: z.enum(BG_THEMES),
  backgroundImageKey: z._default(z.string(), 'builtin:wallpaperflare1.jpg'),
  backgroundTextMode: z._default(z.enum(['light', 'dark']), 'dark'),
  bodyFontName: z._default(z.string(), DEFAULT_BODY_FONT),
  bodyFontUrl: z._default(z.string(), getPresetFontUrl(DEFAULT_BODY_FONT)),
  blurMode: uiBoolSchm(false),
  entranceAnimations: uiBoolSchm(true),
  preferences: z.pipe(z.transform(normalizeSimulationPrefs), z._default(z.object({
    ctxMenu: z._default(z.boolean(), DEF_UI_PREFS.ctxMenu),
    updateToast: z._default(z.boolean(), DEF_UI_PREFS.updateToast),
    gameBetaData: z._default(z.boolean(), DEF_UI_PREFS.gameBetaData),
    recommendedMenuItems: z._default(z.boolean(), DEF_UI_PREFS.recommendedMenuItems),
    showEvaluationStates: z._default(z.boolean(), DEF_UI_PREFS.showEvaluationStates),
    maxResOnInit: z._default(z.boolean(), DEF_UI_PREFS.maxResOnInit),
    animatedRailPortraits: z._default(z.boolean(), DEF_UI_PREFS.animatedRailPortraits),
    showcaseCards: z._default(z.record(
      z.string(),
      z.object({
        style: z.object({
          accent: z._default(z.nullable(z.string()), null),
          surface: z._default(z.nullable(z.string()), null),
          text: z._default(z.nullable(z.string()), null),
          opacity: z._default(z.nullable(z.number()), null),
          displayFont: z._default(z.nullable(z.string()), null),
          monoFont: z._default(z.nullable(z.string()), null),
          portraitX: z._default(z.nullable(z.number()), null),
          portraitY: z._default(z.nullable(z.number()), null),
          portraitScale: z._default(z.nullable(z.number()), null),
          maskTop: z._default(z.nullable(z.number()), null),
          maskRight: z._default(z.nullable(z.number()), null),
          maskBottom: z._default(z.nullable(z.number()), null),
          maskLeft: z._default(z.nullable(z.number()), null),
          maskTopSharp: z._default(z.nullable(z.number()), null),
          maskRightSharp: z._default(z.nullable(z.number()), null),
          maskBottomSharp: z._default(z.nullable(z.number()), null),
          maskLeftSharp: z._default(z.nullable(z.number()), null),
          backdropBlur: z._default(z.nullable(z.number()), null),
          backdropOpacity: z._default(z.nullable(z.number()), null),
          backdropX: z._default(z.nullable(z.number()), null),
          backdropY: z._default(z.nullable(z.number()), null),
          backdropScale: z._default(z.nullable(z.number()), null),
          portraitImage: z._default(z.nullable(z.string()), null),
          backdropImage: z._default(z.nullable(z.string()), null),
          portraitCredit: z._default(z.nullable(z.string()), null),
          backdropCredit: z._default(z.nullable(z.string()), null),
          statsColumn: z._default(z.nullable(z.enum(['build', 'combat', 'both'])), null),
          textSlots: z._default(z.record(
            z.string(),
            z.object({
              color: z._default(z.nullable(z.string()), null),
              font: z._default(z.nullable(z.string()), null),
              size: z._default(z.nullable(z.number()), null),
              weight: z._default(z.nullable(z.number()), null),
              spacing: z._default(z.nullable(z.number()), null),
              transform: z._default(z.nullable(z.enum(['none', 'uppercase', 'lowercase', 'capitalize'])), null),
            }),
          ), {}),
          customCss: z._default(z.nullable(z.string()), null),
        }),
        hidden: z.object({
          score: z._default(z.boolean(), false),
          damage: z._default(z.boolean(), false),
          cv: z._default(z.boolean(), false),
          team: z._default(z.boolean(), false),
          brand: z._default(z.boolean(), false),
          portraitCredit: z._default(z.boolean(), false),
          backdropCredit: z._default(z.boolean(), false),
          seqRail: z._default(z.boolean(), false),
          subVal: z._default(z.boolean(), false),
          subColor: z._default(z.boolean(), false),
          relStats: z._default(z.boolean(), true),
        }),
      }),
    ), {}),
    showcaseLayout: z._default(z.enum(['classic', 'seal']), DEF_UI_PREFS.showcaseLayout),
    uploadPersist: z._default(z.nullable(z.enum(['indexeddb', 'imgbb'])), DEF_UI_PREFS.uploadPersist),
    imgbbApiKey: z._default(z.string(), DEF_UI_PREFS.imgbbApiKey),
    playerId: z._default(z.string(), DEF_UI_PREFS.playerId),
    playerUid: z._default(z.string(), DEF_UI_PREFS.playerUid),
    echoImportBands: z._default(z.object({
      resonator: z._default(z.boolean(), DEF_UI_PREFS.echoImportBands.resonator),
      weapon: z._default(z.boolean(), DEF_UI_PREFS.echoImportBands.weapon),
      echoes: z._default(z.boolean(), DEF_UI_PREFS.echoImportBands.echoes),
    }), DEF_UI_PREFS.echoImportBands),
  }), DEF_UI_PREFS)),
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
  suggsViewMode: z._default(z.enum(['mainStats', 'setPlans', 'weapons', 'random', 'substats']), 'mainStats'),
  showSubHits: z.boolean(),
  compactInv: z._default(z.boolean(), false),
  groupInv: z._default(z.boolean(), false),
  seeEquipped: z._default(z.boolean(), true),
  haveHistory: z._default(z.boolean(), true),
  historyMax: histMaxSchm,
  itemFreq: pckrFreqSttS,
  optimizerCpuHintSeen: z._default(z.boolean(), false),
  // portrait-mode preference for the optimizer (sprite vs profile art). a
  // display preference, not resonator-scoped, so it persists globally with
  // other UI preferences.
  optimizerUseSprite: z._default(z.boolean(), true),
  // export files default to the compact .wwcalc format; plain json is the
  // readable fallback.
  compressedExports: z._default(z.boolean(), true),
  rotationEditorPreferences: z._default(rotEditorPrefsS, makeDefaultRotationEditorPreferences()),
  savedRotationPreferences: z._default(svdRotPrefsS, {
    sortBy: 'date',
    sortOrder: 'desc',
    contributionFilter: 'unset',
    autoSearchActiveResonator: false,
    showLiveRotation: false,
    scaleToSelected: true,
  }),
})

export const prssUiPprnSc = z.lazy(() => z.strictObject({
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
}))

export const prssUiLytSch = z.lazy(() => z.strictObject({
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
}))

export const prssUiSvdRot = z.lazy(() => z.strictObject({
  savedRotationPreferences: uiPersistSchema.shape.savedRotationPreferences,
}))

const prssSimulationTools = z.lazy(() => z.strictObject({
  optimizerSettingsResonatorId: z.optional(z.nullable(z.string())),
  optimizerSettings: z.optional(optSetsSchm),
  weaponSuggests: z._default(wpnSuggSetS, {
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
  suggestionsByResonatorId: z._default(z.record(z.string(), resSuggsSttS), {}),
}))

const prssSimulationInvS = z.lazy(() => z.strictObject({
  inventoryEchoes: z.array(invChsEntSch),
  inventoryBuilds: z.array(svdMkSchm),
  inventoryRotations: z.array(invRotSchm),
}))

const savedScenarioSchm = z.lazy(() => z.strictObject({
  id: z.string(),
  name: z.string(),
  note: z._default(z.string(), ''),
  createdAt: z.number(),
  updatedAt: z.number(),
  scenario: combatScenarioSchm,
}))

const savedArtifactLibrarySchm = z.strictObject({
  echoes: z.array(invChsEntSch),
  builds: z.array(svdMkSchm),
  rotations: z.array(invRotSchm),
  scenarios: z.array(savedScenarioSchm),
})

export const prssCombatWorkspace = z.lazy(() => z.pipe(z.transform((value) => {
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
}), z.strictObject({
  selectedScenarioId: z.string(),
  order: z.array(z.string()),
  scenariosById: z.record(z.string(), combatScenarioSchm),
}).check(z.superRefine((workspace, context) => {
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
}))))

export const prssSimulationOptS = z.lazy(() => z.strictObject({
  // Optional only while reading v28 records written before settings gained an
  // owner key. initAppState backfills the selected context resonator.
  optimizerSettingsResonatorId: z.optional(z.nullable(z.string())),
  optimizerSettings: optSetsSchm,
}))

export const prssSimulationSugg = z.lazy(() => z.strictObject({
  weaponSuggests: prssSimulationTools.def.getter().shape.weaponSuggests,
  suggestionsByResonatorId: prssSimulationTools.def.getter().shape.suggestionsByResonatorId,
}))

export const prssSimulationInvC = z.lazy(() => z.strictObject({
  echoes: savedArtifactLibrarySchm.shape.echoes,
}))

export const prssSimulationInvB = z.lazy(() => z.strictObject({
  builds: savedArtifactLibrarySchm.shape.builds,
}))

export const prssSimulationInvR = z.lazy(() => z.strictObject({
  rotations: savedArtifactLibrarySchm.shape.rotations,
}))

export const prssInvScenarios = z.lazy(() => z.strictObject({
  scenarios: savedArtifactLibrarySchm.shape.scenarios,
}))

function makePersistSchema(version: typeof APP_STATE_VER) {
  return z.strictObject({
    version: z.literal(version),
    ui: z.pipe(z.transform(stripLegacyMainMode), uiPersistSchema),
    // Optional only at the schema boundary so v22 state can materialize its
    // first scenario from legacy profiles/session during initialization.
    combat: z.optional(prssCombatWorkspace),
    library: z.optional(savedArtifactLibrarySchm),
    simulation: z.strictObject({
      ...prssSimulationTools.def.getter().shape,
      runtimeRevision: z.optional(z.number().check(z.int()).check(z.nonnegative())),
      profiles: z.optional(z.record(z.string(), resProfSchm)),
      inventoryEchoes: z.optional(prssSimulationInvS.def.getter().shape.inventoryEchoes),
      inventoryBuilds: z.optional(prssSimulationInvS.def.getter().shape.inventoryBuilds),
      inventoryRotations: z.optional(prssSimulationInvS.def.getter().shape.inventoryRotations),
      session: z.optional(cmbtSssnSchm),
      workspace: z.optional(z.looseObject({ currentScenario: z.optional(combatScenarioSchm) })),
    }),
  })
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
export const persistedSchema = z.lazy(() => z.pipe(z.transform(migratePersistedVersion), makePersistSchema(APP_STATE_VER)))

export const prssUiPprnSl = z.lazy(() => z.strictObject({
  version: z.literal(APP_STATE_VER),
  ui: prssUiPprnSc,
}))

export const prssUiLytSlc = z.lazy(() => z.strictObject({
  version: z.literal(APP_STATE_VER),
  ui: z.pipe(z.transform(stripLegacyMainMode), prssUiLytSch),
}))

export const prssUiSvdRoh = z.lazy(() => z.strictObject({
  version: z.literal(APP_STATE_VER),
  ui: prssUiSvdRot,
}))

export const prssCmbtWrkspSlcS = z.lazy(() => z.strictObject({
  version: z.literal(APP_STATE_VER),
  combat: prssCombatWorkspace,
}))

export const prssOptSettingsSl = z.lazy(() => z.strictObject({
  version: z.literal(APP_STATE_VER),
  simulation: prssSimulationOptS,
}))

export const prssSuggsSlc = z.lazy(() => z.strictObject({
  version: z.literal(APP_STATE_VER),
  simulation: prssSimulationSugg,
}))

export const prssInvChsSl = z.lazy(() => z.strictObject({
  version: z.literal(APP_STATE_VER),
  library: prssSimulationInvC,
}))

export const prssInvBldsS = z.lazy(() => z.strictObject({
  version: z.literal(APP_STATE_VER),
  library: prssSimulationInvB,
}))

export const prssInvRttnS = z.lazy(() => z.strictObject({
  version: z.literal(APP_STATE_VER),
  library: prssSimulationInvR,
}))

export const prssInvScenariosSl = z.lazy(() => z.strictObject({
  version: z.literal(APP_STATE_VER),
  library: prssInvScenarios,
}))
