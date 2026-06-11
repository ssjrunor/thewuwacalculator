import {
  addValues,
  and,
  buildControlPaths,
  clampValue,
  constValue,
  createResonatorOverrideContext,
  defineResonatorOverride,
  gte,
  lt,
  makeModeGroup,
  makeNumberControl,
  makeNumberState,
  makeSelectControl,
  makeSelectState,
  makeToggleControl,
  makeToggleState,
  multiplyValues,
  or,
  sequenceDescription,
  truthy, eq, targetHasNegativeEffect
} from './schema.mjs'

const { ID, SOURCE, ownerKey, controlKey } = createResonatorOverrideContext('1210')

const OWNER_KEYS = {
  mode: ownerKey('resonator', 'mode'),
  tuneRuptureMode: ownerKey('resonator', 'tune_rupture_mode'),
  fusionBurstMode: ownerKey('resonator', 'fusion_burst_mode'),
  stardustResonance: ownerKey('resonator', 'stardust_resonance'),
  fusionTrail: ownerKey('resonator', 'fusion_trail'),
  rupturousTrail: ownerKey('resonator', 'rupturous_trail'),
  outroActive: ownerKey('team', 'silent_protection'),
  outroTrigger: ownerKey('team', 'silent_protection_trigger'),
  s4Team: ownerKey('team', 'ethereal_waltz'),
  lvl70: ownerKey('inherent', 'lvl70'),
  lvl50: ownerKey('inherent', 'lvl50'),
  s2: ownerKey('sequence', 's2'),
  s4: ownerKey('sequence', 's4'),
}

const CONTROL_KEYS = {
  mode: controlKey(OWNER_KEYS.mode, 'value'),
  stardustResonance: controlKey(OWNER_KEYS.stardustResonance, 'active'),
  fusionTrail: controlKey(OWNER_KEYS.fusionTrail, 'value'),
  rupturousTrail: controlKey(OWNER_KEYS.rupturousTrail, 'value'),
  inherent2Stacks: controlKey(OWNER_KEYS.lvl70, 'stacks'),
  lvl50: controlKey(OWNER_KEYS.lvl50, 'active'),
  s2Hits: controlKey(OWNER_KEYS.s2, 'hits'),
  outroActive: controlKey(OWNER_KEYS.outroActive, 'active'),
  outroTrigger: controlKey(OWNER_KEYS.outroTrigger, 'active'),
  s4Self: controlKey(OWNER_KEYS.s4, 'active'),
  s4Buff: controlKey(OWNER_KEYS.s4Team, 'active'),
}

const CONTROL_PATHS = buildControlPaths(CONTROL_KEYS)

const PATHS = {
  level: 'runtime.base.level',
  sequence: 'runtime.base.sequence',
}

const HEAVY_IDS = ['1210005', '1210006', '1210107', '1210108']
const SERAPHIC_DUET_IDS = ['1210601', '1210602']
const FINALE_ID = '1210202'
const OVERDRIVE_ID = '1210201'
const SERAPHIC_DUET_MODE_ID = '1210604'

const MODE_VALUES = {
  tuneRupture: 'tune_rupture',
  fusionBurst: 'fusion_burst',
}

const MODE_OPTIONS = [
  {
    id: MODE_VALUES.tuneRupture,
    label: 'Tune Rupture',
    icon: '/assets/resonators/skills/1210/modes/tune-rupture.webp',
    body: 'Aemeath enters <span class="highlight">Resonance Mode - Tune Rupture</span>. <span class="highlight">Resonance Skill - Duet of Seraphic Plumes</span> deals extra <span class="highlight">Tune Rupture DMG</span> and consumes <span class="highlight">Rupturous Trail</span> to increase its DMG Multiplier.',
    keywords: ['Tune Rupture', 'Resonance Mode - Tune Rupture', 'Rupturous Trail'],
  },
  {
    id: MODE_VALUES.fusionBurst,
    label: 'Fusion Burst',
    icon: '/assets/resonators/skills/1210/modes/fusion-burst.webp',
    body: 'Aemeath enters <span class="highlight">Resonance Mode - Fusion Burst</span>. <span class="highlight">Resonance Skill - Duet of Seraphic Plumes</span> consumes <span class="highlight">Fusion Trail</span> to strengthen the triggered <span class="highlight">Fusion Burst</span>.',
    keywords: ['Fusion Burst', 'Resonance Mode - Fusion Burst', 'Fusion Trail'],
  },
]

function inTuneRuptureMode() {
  return eq(CONTROL_PATHS.mode, MODE_VALUES.tuneRupture)
}

function inFusionBurstMode() {
  return eq(CONTROL_PATHS.mode, MODE_VALUES.fusionBurst)
}

function ruptureTrailBonus() {
  return multiplyValues(
    clampValue(readValue(CONTROL_PATHS.rupturousTrail, 0), { min: 0, max: 60 }),
    constValue(0.04),
  )
}

function s2RuptureScale() {
  return addValues(
    constValue(1),
    multiplyValues(
      clampValue(readValue(CONTROL_PATHS.s2Hits, 0), { min: 0, max: 5 }),
      constValue(0.2),
    ),
  )
}

function ruptureStackCritDmg() {
  return multiplyValues(
    clampValue(readValue(CONTROL_PATHS.inherent2Stacks, 0), { min: 0, max: 3 }),
    constValue(20),
  )
}

function burstStackCritDmg() {
  return multiplyValues(
    clampValue(readValue(CONTROL_PATHS.inherent2Stacks, 0), { min: 0, max: 2 }),
    constValue(30),
  )
}

function fusionTrailBurstMultiplier() {
  return multiplyValues(
    clampValue(readValue(CONTROL_PATHS.fusionTrail, 0), { min: 0, max: 60 }),
    constValue(0.1),
  )
}

function fusionTrailS2BurstMultiplier() {
  return addValues(
      multiplyValues(
          clampValue(readValue(CONTROL_PATHS.fusionTrail, 0), { min: 0, max: 60 }),
          constValue(0.05),
      ),
      constValue(2)
  )
}

function ruptureFinaleCondition() {
  return and(
    inTuneRuptureMode(),
    or(
      gte(PATHS.sequence, 3),
      and(gte(PATHS.level, 70), gte(CONTROL_PATHS.inherent2Stacks, 3)),
    ),
  )
}

function burstFinaleCondition() {
  return and(
    inFusionBurstMode(),
    or(
      gte(PATHS.sequence, 3),
      and(gte(PATHS.level, 70), gte(CONTROL_PATHS.inherent2Stacks, 2)),
    ),
  )
}

function readValue(path, defaultValue) {
  return {
    type: 'read',
    path,
    ...(defaultValue === undefined ? {} : { default: defaultValue }),
  }
}

export default defineResonatorOverride({
  negativeEffectSources: [{ key: 'fusionBurst' }],
  descriptionKeywords: [
    'Instant Response',
    'Resonance Mode - Tune Rupture',
    'Resonance Mode - Fusion Burst',
    'Stardust Resonance',
    'Fusion Trail',
    'Rupturous Trail',
    'Between the Stars',
    'Silent Protection',
    'Ethereal Waltz',
    'Seraphic Duet',
  ],
  skillPatches: {
    '1210005': { skillType: ['resonanceLiberation'] },
    '1210006': { skillType: ['resonanceLiberation'] },
    '1210107': { skillType: ['resonanceLiberation'] },
    '1210108': { skillType: ['resonanceLiberation'] },
    '1210601': { skillType: ['resonanceLiberation'] },
    '1210602': { skillType: ['resonanceLiberation'] },
    '1210603': {
      skillType: ['tuneRupture'],
      archetype: 'tuneRupture',
      aggregationType: 'damage',
      element: 'fusion',
    },
    '1210604': {
      label: 'Seraphic Duet: Tune Rupture',
      skillType: ['tuneRupture'],
      archetype: 'tuneRupture',
      aggregationType: 'damage',
      element: 'fusion',
      visibleWhen: inTuneRuptureMode(),
      skillVariantWhen: [
        {
          when: inFusionBurstMode(),
          patch: {
            label: 'Seraphic Duet: Fusion Burst',
            skillType: ['fusionBurst'],
            archetype: 'fusionBurst',
            aggregationType: 'damage',
            element: 'fusion',
            stackMode: 'fixedMax',
            multiplier: 1,
            flat: 0,
            fixedDmg: 0,
            levelSource: null,
            visibleWhen: inFusionBurstMode(),
            hits: [{ count: 1, multiplier: 1 }],
            hitTable: [{ count: 1, values: [1] }],
          },
        },
      ],
    },
  },
  modeGroups: [
    makeModeGroup({
      id: 'mode',
      label: 'Resonance Mode',
      controlKey: CONTROL_KEYS.mode,
      defaultValue: MODE_VALUES.tuneRupture,
      modes: MODE_OPTIONS,
    }),
  ],
  statePanels: [
    {
      id: 'stardust-resonance',
      title: 'Stardust Resonance',
      body: 'In Stardust Resonance, Fusion Burst triggered by Resonance Skill <span class="highlight">Seraphic Duet</span> on the main target gains an additional <span class="highlight">200%</span> DMG Multiplier.',
      keywords: ['Fusion Burst', 'Resonance Mode - Fusion Burst', 'Fusion Trail'],
      controls: [
        makeToggleControl({
          key: CONTROL_KEYS.stardustResonance,
          label: 'Stardust Resonance?',
          visibleWhen: inFusionBurstMode(),
          enabledWhen: inFusionBurstMode(),
        }),
      ],
    },
    {
      id: 'fusion-trail',
      title: 'Fusion Trail',
      body: 'Each stack of Fusion Trail removed from the target increases the DMG Multiplier of Fusion Burst on the main target by 10%.',
      keywords: ['Fusion Trail'],
      controls: [
        makeNumberControl({
          key: CONTROL_KEYS.fusionTrail,
          label: 'Fusion Trail',
          min: 0,
          max: 30,
          maxWhen: [{ when: gte(PATHS.sequence, 6), max: 60 }],
          visibleWhen: inFusionBurstMode(),
          enabledWhen: inFusionBurstMode(),
          disabledReason: 'Available while in Fusion Burst',
        }),
      ],
    },
    {
      id: 'rupturous-trail',
      title: 'Rupturous Trail',
      body: 'In <span class="highlight">Resonance Mode - Tune Rupture</span>, every <span class="highlight">10</span> <span class="highlight">Rupturous Trail</span> adds <span class="highlight">40%</span> DMG Multiplier to <span class="highlight">Seraphic Duet: Tune Rupture</span>.',
      keywords: ['Rupturous Trail'],
      controls: [
        makeSelectControl({
          key: CONTROL_KEYS.rupturousTrail,
          label: 'Rupturous Trail',
          optionsWhen: [
            { when: lt(PATHS.sequence, 6), options: [0, 10, 20, 30] },
            { when: gte(PATHS.sequence, 6), options: [0, 10, 20, 30, 40, 50, 60] },
          ],
          visibleWhen: inTuneRuptureMode(),
          enabledWhen: inTuneRuptureMode(),
          disabledReason: 'Available while in Tune Rupture',
        }),
      ],
    },
  ],
  inherentSkillControls: {
    lvl50: makeToggleControl({
      key: CONTROL_KEYS.lvl50,
      label: 'Enable',
    }),
    lvl70: makeSelectControl({
      key: CONTROL_KEYS.inherent2Stacks,
      label: 'Stacks',
      optionsWhen: [
        { when: inTuneRuptureMode(), options: [0, 1, 2, 3] },
        { when: inFusionBurstMode(), options: [0, 1, 2] },
      ],
    }),
  },
  resonanceChainControls: {
    s2: makeSelectControl({
      key: CONTROL_KEYS.s2Hits,
      label: 'Tune Rupture hits',
      options: [0, 1, 2, 3, 4, 5],
      visibleWhen: inTuneRuptureMode(),
    }),
    s4: makeToggleControl({
      key: CONTROL_KEYS.s4Self,
      label: 'Enable',
    }),
  },
  owners: [
    {
      id: 'mode',
      label: 'Mode',
      source: SOURCE,
      scope: 'resonator',
      kind: 'stateGroup',
      ownerKey: OWNER_KEYS.mode,
      description: 'Aemeath resonance mode selection.',
    },
    {
      id: 'tune_rupture_mode',
      label: 'Tune Rupture',
      source: SOURCE,
      scope: 'resonator',
      kind: 'stateGroup',
      ownerKey: OWNER_KEYS.tuneRuptureMode,
      description: 'Aemeath enters Resonance Mode - Tune Rupture.',
    },
    {
      id: 'fusion_burst_mode',
      label: 'Fusion Burst',
      source: SOURCE,
      scope: 'resonator',
      kind: 'stateGroup',
      ownerKey: OWNER_KEYS.fusionBurstMode,
      description: 'Aemeath enters Resonance Mode - Fusion Burst.',
    },
    {
      id: 'stardust_resonance',
      label: 'Stardust Resonance',
      source: SOURCE,
      scope: 'resonator',
      kind: 'stateGroup',
      ownerKey: OWNER_KEYS.stardustResonance,
      description: 'In Stardust Resonance, Seraphic Duet-triggered Fusion Burst on the main target gains an additional 200% DMG Multiplier.',
    },
    {
      id: 'fusion_trail',
      label: 'Fusion Trail',
      source: SOURCE,
      scope: 'resonator',
      kind: 'stateGroup',
      ownerKey: OWNER_KEYS.fusionTrail,
      description: 'Current Fusion Trail stack count.',
    },
    {
      id: 'rupturous_trail',
      label: 'Rupturous Trail',
      source: SOURCE,
      scope: 'resonator',
      kind: 'stateGroup',
      ownerKey: OWNER_KEYS.rupturousTrail,
      description: 'Current Rupturous Trail stack count.',
    },
    {
      id: 'silent_protection',
      label: 'Outro Skill: Silent Protection',
      source: SOURCE,
      scope: 'team',
      kind: 'teamBuff',
      ownerKey: OWNER_KEYS.outroActive,
      description: 'Aemeath grants All DMG Amplification to other teammates.',
    },
    {
      id: 'silent_protection_trigger',
      label: 'Silent Protection Trigger',
      source: SOURCE,
      scope: 'team',
      kind: 'teamBuff',
      ownerKey: OWNER_KEYS.outroTrigger,
      description: 'Aemeath upgrades her Outro buff for teammates who inflict the relevant reaction.',
    },
    {
      id: 'ethereal_waltz',
      label: 'Sequence 4: Ethereal Waltz on Binary Tides',
      source: SOURCE,
      scope: 'team',
      kind: 'teamBuff',
      ownerKey: OWNER_KEYS.s4Team,
      description: 'Aemeath grants teamwide All-Attribute DMG Bonus.',
    },
  ],
  states: [
    makeSelectState({
      id: 'mode',
      source: SOURCE,
      ownerKey: OWNER_KEYS.mode,
      controlKey: CONTROL_KEYS.mode,
      label: 'Mode',
      description: 'Set Aemeath to Resonance Mode - Tune Rupture or Resonance Mode - Fusion Burst.',
      defaultValue: MODE_VALUES.tuneRupture,
      options: MODE_OPTIONS,
    }),
    makeToggleState({
      source: SOURCE,
      ownerKey: OWNER_KEYS.stardustResonance,
      controlKey: CONTROL_KEYS.stardustResonance,
      label: 'Stardust Resonance',
      description: 'In Stardust Resonance, Fusion Burst triggered by Resonance Skill <span class="highlight">Seraphic Duet</span> on the main target gains an additional <span class="highlight">200%</span> DMG Multiplier.',
      controlDependencies: [CONTROL_KEYS.mode],
      visibleWhen: inFusionBurstMode(),
      enabledWhen: inFusionBurstMode(),
    }),
    makeNumberState({
      source: SOURCE,
      ownerKey: OWNER_KEYS.fusionTrail,
      controlKey: CONTROL_KEYS.fusionTrail,
      label: 'Fusion Trail',
      description: 'Each stack of Fusion Trail removed from the target increases the DMG Multiplier of Fusion Burst on the main target by 10%.',
      min: 0,
      max: 30,
      maxWhen: [{ when: gte(PATHS.sequence, 6), max: 60 }],
      controlDependencies: [CONTROL_KEYS.mode],
      visibleWhen: inFusionBurstMode(),
      enabledWhen: inFusionBurstMode(),
    }),
    makeSelectState({
      source: SOURCE,
      ownerKey: OWNER_KEYS.rupturousTrail,
      controlKey: CONTROL_KEYS.rupturousTrail,
      label: 'Rupturous Trail',
      description: 'Current Rupturous Trail. In <span class="highlight">Resonance Mode - Tune Rupture</span>, every <span class="highlight">10</span> Rupturous Trail adds <span class="highlight">40%</span> DMG Multiplier to <span class="highlight">Seraphic Duet: Tune Rupture</span>.',
      optionsWhen: [
        { when: lt(PATHS.sequence, 6), options: [0, 10, 20, 30] },
        { when: gte(PATHS.sequence, 6), options: [0, 10, 20, 30, 40, 50, 60] },
      ],
      controlDependencies: [CONTROL_KEYS.mode],
      visibleWhen: inTuneRuptureMode(),
      enabledWhen: inTuneRuptureMode(),
    }),
    makeSelectState({
      source: SOURCE,
      ownerKey: OWNER_KEYS.lvl70,
      controlKey: CONTROL_KEYS.inherent2Stacks,
      label: 'Between the Stars Stacks',
      description: 'Current stacks for <span class="highlight">Between the Stars</span>. In Tune Rupture mode each stack gives <span class="highlight">20%</span> Crit. DMG up to 3 stacks; in Fusion Burst mode each stack gives <span class="highlight">30%</span> Crit. DMG up to 2 stacks.',
      controlDependencies: [CONTROL_KEYS.mode],
      optionsWhen: [
        { when: inTuneRuptureMode(), options: [0, 1, 2, 3] },
        { when: inFusionBurstMode(), options: [0, 1, 2] },
      ],
      visibleWhen: gte(PATHS.level, 70),
      enabledWhen: lt(PATHS.sequence, 3),
    }),
    makeToggleState({
      source: SOURCE,
      ownerKey: OWNER_KEYS.lvl50,
      controlKey: CONTROL_KEYS.lvl50,
      label: 'Instant Response',
      description: 'In Instant Response, Heavy Attack - Aemeath and Heavy Attack - Mech gain 200% DMG Amplification.',
      visibleWhen: gte(PATHS.level, 50),
    }),
    makeSelectState({
      source: SOURCE,
      ownerKey: OWNER_KEYS.s2,
      controlKey: CONTROL_KEYS.s2Hits,
      label: 'Tune Rupture hits',
      description: 'Additional Tune Rupture hits granted by Sequence 2. Each hit increases <span class="highlight">Seraphic Duet Bonus</span> DMG by <span class="highlight">20%</span>.',
      options: [0, 1, 2, 3, 4, 5],
      visibleWhen: and(gte(PATHS.sequence, 2), inTuneRuptureMode()),
    }),
    makeToggleState({
      source: SOURCE,
      ownerKey: OWNER_KEYS.outroActive,
      controlKey: CONTROL_KEYS.outroActive,
      label: 'Outro Skill: Silent Protection',
      description: 'All Resonators in the team except <span class="highlight">Aemeath</span> gain <span class="highlight">10%</span> All DMG Amplification for 20s.',
      displayScope: 'team',
    }),
    makeToggleState({
      source: SOURCE,
      ownerKey: OWNER_KEYS.outroTrigger,
      controlKey: CONTROL_KEYS.outroTrigger,
      label: 'Silent Protection Trigger',
      description: '- In Resonance Mode - Tune Rupture: all Resonators in the team except Aemeath gain an additional 20% All-DMG Amplification for Resonators who inflict Tune Rupture - Shifting.\n' +
          '- In Resonance Mode - Fusion Burst: all Resonators in the team except Aemeath gain an additional 20% All-DMG Amplification for Resonators who inflict Fusion Burst.',
      displayScope: 'team',
      controlDependencies: [CONTROL_KEYS.outroActive],
      enabledWhen: truthy(CONTROL_PATHS.outroActive),
    }),
    makeToggleState({
      source: SOURCE,
      ownerKey: OWNER_KEYS.s4,
      controlKey: CONTROL_KEYS.s4Self,
      label: 'S4 Active',
      descriptionRef: sequenceDescription(4),
      visibleWhen: gte(PATHS.sequence, 4),
    }),
    makeToggleState({
      source: SOURCE,
      ownerKey: OWNER_KEYS.s4Team,
      controlKey: CONTROL_KEYS.s4Buff,
      label: 'Sequence 4: Ethereal Waltz on Binary Tides',
      descriptionRef: sequenceDescription(4),
      displayScope: 'team',
      visibleWhen: gte(PATHS.sequence, 4),
    }),
  ],
  effects: [
    {
      id: `${ID}:instant-response:amplify`,
      label: 'Instant Response Heavy Amplify',
      source: SOURCE,
      ownerKey: OWNER_KEYS.lvl50,
      trigger: 'skill',
      targetScope: 'self',
      condition: and(gte(PATHS.level, 50), truthy(CONTROL_PATHS.lvl50)),
      operations: [
        {
          type: 'add_skill_mod',
          mod: 'amplify',
          match: { skillIds: HEAVY_IDS },
          value: constValue(200),
        },
      ],
    },
    {
      id: `${ID}:s1:instant-response-crit-dmg`,
      label: 'S1 Instant Response Crit DMG',
      source: SOURCE,
      ownerKey: ownerKey('sequence', 's1'),
      trigger: 'skill',
      targetScope: 'self',
      condition: and(gte(PATHS.sequence, 1), truthy(CONTROL_PATHS.lvl50)),
      operations: [
        {
          type: 'add_skill_mod',
          mod: 'critDmg',
          match: { skillIds: HEAVY_IDS },
          value: constValue(300),
        },
      ],
    },
    {
      id: `${ID}:rupture-mode:crit-dmg:auto`,
      label: 'Tune Rupture Mode Crit DMG Auto Max',
      source: SOURCE,
      trigger: 'runtime',
      targetScope: 'self',
      condition: and(gte(PATHS.sequence, 3), inTuneRuptureMode()),
      operations: [
        {
          type: 'add_negative_effect_mod',
          negativeEffect: 'fusionBurst',
          mod: 'critDmg',
          value: constValue(60),
        },
      ],
    },
    {
      id: `${ID}:rupture-mode:crit-dmg`,
      label: 'Tune Rupture Mode Crit DMG',
      source: SOURCE,
      ownerKey: OWNER_KEYS.lvl70,
      trigger: 'runtime',
      targetScope: 'self',
      condition: and(lt(PATHS.sequence, 3), gte(PATHS.level, 70), inTuneRuptureMode()),
      operations: [
        {
          type: 'add_top_stat',
          stat: 'critDmg',
          value: ruptureStackCritDmg(),
        },
      ],
    },
    {
      id: `${ID}:fusion-burst-mode:crit-dmg:auto`,
      label: 'Fusion Burst Mode Crit DMG Auto Max',
      source: SOURCE,
      trigger: 'runtime',
      targetScope: 'self',
      condition: and(gte(PATHS.sequence, 3), inFusionBurstMode()),
      operations: [
        {
          type: 'add_top_stat',
          stat: 'critDmg',
          value: constValue(60),
        },
      ],
    },
    {
      id: `${ID}:fusion-burst-mode:multiplier`,
      label: 'Stardust Resonance Fusion Burst Multiplier',
      source: SOURCE,
      ownerKey: OWNER_KEYS.stardustResonance,
      trigger: 'skill',
      targetScope: 'self',
      condition: and(truthy(CONTROL_PATHS.stardustResonance), inFusionBurstMode()),
      operations: [
        {
          type: 'add_skill_multiplier',
          match: { skillIds: [SERAPHIC_DUET_MODE_ID] },
          value: constValue(2),
        },
      ],
    },
    {
      id: `${ID}:fusion-trail:multiplier`,
      label: 'Fusion Trail Multiplier',
      source: SOURCE,
      ownerKey: OWNER_KEYS.fusionTrail,
      trigger: 'skill',
      targetScope: 'self',
      condition: inFusionBurstMode(),
      operations: [
        {
          type: 'add_skill_multiplier',
          match: { skillIds: [SERAPHIC_DUET_MODE_ID] },
          value: fusionTrailBurstMultiplier(),
        },
      ],
    },
    {
      id: `${ID}:s2:fusion-trail:multiplier`,
      label: 'S2 Fusion Trail Multiplier',
      source: SOURCE,
      ownerKey: OWNER_KEYS.s2,
      trigger: 'skill',
      targetScope: 'self',
      condition: and(gte(PATHS.sequence, 2), inFusionBurstMode()),
      operations: [
        {
          type: 'add_skill_multiplier',
          match: { skillIds: [SERAPHIC_DUET_MODE_ID] },
          value: fusionTrailS2BurstMultiplier(),
        },
      ],
    },
    {
      id: `${ID}:fusion-burst-mode:crit-dmg`,
      label: 'Fusion Burst Mode Crit DMG',
      source: SOURCE,
      ownerKey: OWNER_KEYS.lvl70,
      trigger: 'runtime',
      targetScope: 'self',
      condition: and(lt(PATHS.sequence, 3), gte(PATHS.level, 70), inFusionBurstMode()),
      operations: [
        {
          type: 'add_top_stat',
          stat: 'critDmg',
          value: burstStackCritDmg(),
        },
      ],
    },
    {
      id: `${ID}:rupture-mode:seraphic-duet-bonus`,
      label: 'Rupturous Trail Seraphic Duet Tune Rupture',
      source: SOURCE,
      ownerKey: OWNER_KEYS.rupturousTrail,
      trigger: 'skill',
      targetScope: 'self',
      condition: inTuneRuptureMode(),
      operations: [
        {
          type: 'add_skill_hit_multiplier',
          hitIndex: 0,
          match: { skillIds: [SERAPHIC_DUET_MODE_ID] },
          value: ruptureTrailBonus(),
        },
      ],
    },
    {
      id: `${ID}:rupture-mode:finale`,
      label: 'Tune Rupture Finale Amplify',
      source: SOURCE,
      ownerKey: OWNER_KEYS.lvl70,
      trigger: 'skill',
      targetScope: 'self',
      condition: ruptureFinaleCondition(),
      operations: [
        {
          type: 'add_skill_mod',
          mod: 'amplify',
          match: { skillIds: [FINALE_ID] },
          value: constValue(25),
        },
      ],
    },
    {
      id: `${ID}:fusion-burst-mode:finale`,
      label: 'Fusion Burst Finale Amplify',
      source: SOURCE,
      ownerKey: OWNER_KEYS.lvl70,
      trigger: 'skill',
      targetScope: 'self',
      condition: burstFinaleCondition(),
      operations: [
        {
          type: 'add_skill_mod',
          mod: 'amplify',
          match: { skillIds: [FINALE_ID] },
          value: constValue(25),
        },
      ],
    },
    {
      id: `${ID}:s2:seraphic-duet`,
      label: 'S2 Seraphic Duet Multiplier',
      source: SOURCE,
      ownerKey: OWNER_KEYS.s2,
      trigger: 'skill',
      targetScope: 'self',
      condition: gte(PATHS.sequence, 2),
      operations: [
        {
          type: 'scale_skill_multiplier',
          match: { skillIds: SERAPHIC_DUET_IDS },
          value: constValue(2),
        },
      ],
    },
    {
      id: `${ID}:s2:seraphic-duet-bonus`,
      label: 'S2 Tune Rupture Hit Bonus',
      source: SOURCE,
      ownerKey: OWNER_KEYS.s2,
      trigger: 'skill',
      targetScope: 'self',
      condition: and(gte(PATHS.sequence, 2), inTuneRuptureMode()),
      operations: [
        {
          type: 'scale_skill_multiplier',
          match: { skillIds: [SERAPHIC_DUET_MODE_ID] },
          value: s2RuptureScale(),
        },
      ],
    },
    {
      id: `${ID}:s3:finale`,
      label: 'S3 Finale Multiplier',
      source: SOURCE,
      ownerKey: ownerKey('sequence', 's3'),
      trigger: 'skill',
      targetScope: 'self',
      condition: gte(PATHS.sequence, 3),
      operations: [
        {
          type: 'scale_skill_multiplier',
          match: { skillIds: [FINALE_ID] },
          value: constValue(2),
        },
      ],
    },
    {
      id: `${ID}:s3:overdrive`,
      label: 'S3 Overdrive Multiplier',
      source: SOURCE,
      ownerKey: ownerKey('sequence', 's3'),
      trigger: 'skill',
      targetScope: 'self',
      condition: gte(PATHS.sequence, 3),
      operations: [
        {
          type: 'scale_skill_multiplier',
          match: { skillIds: [OVERDRIVE_ID] },
          value: constValue(1.4),
        },
      ],
    },
    {
      id: `${ID}:s4:self`,
      label: 'S4 Self All-Attribute Bonus',
      source: SOURCE,
      ownerKey: OWNER_KEYS.s4,
      trigger: 'runtime',
      targetScope: 'self',
      condition: and(gte(PATHS.sequence, 4), truthy(CONTROL_PATHS.s4Self)),
      operations: [
        {
          type: 'add_attribute_mod',
          attribute: 'all',
          mod: 'dmgBonus',
          value: constValue(20),
        },
      ],
    },
    {
      id: `${ID}:s4:team`,
      label: 'S4 Team All-Attribute Bonus',
      source: SOURCE,
      ownerKey: OWNER_KEYS.s4Team,
      trigger: 'runtime',
      targetScope: 'teamWide',
      condition: and(gte(PATHS.sequence, 4), truthy(CONTROL_PATHS.s4Buff)),
      operations: [
        {
          type: 'add_attribute_mod',
          attribute: 'all',
          mod: 'dmgBonus',
          value: constValue(20),
        },
      ],
    },
    {
      id: `${ID}:outro:base`,
      label: 'Silent Protection Amplify',
      source: SOURCE,
      ownerKey: OWNER_KEYS.outroActive,
      trigger: 'runtime',
      targetScope: 'otherTeammates',
      condition: truthy(CONTROL_PATHS.outroActive),
      operations: [
        {
          type: 'add_attribute_mod',
          attribute: 'all',
          mod: 'amplify',
          value: constValue(10),
        },
      ],
    },
    {
      id: `${ID}:outro:trigger`,
      label: 'Silent Protection Reaction Trigger',
      source: SOURCE,
      ownerKey: OWNER_KEYS.outroTrigger,
      trigger: 'runtime',
      targetScope: 'otherTeammates',
      condition:  and(
        truthy(CONTROL_PATHS.outroActive),
        truthy(CONTROL_PATHS.outroTrigger),
        or(targetHasNegativeEffect('fusionBurst'),
          eq('context.targetRuntimeId', '1509'),
          eq('context.targetRuntimeId', '1510'),
          eq('context.targetRuntimeId', '1210'),
          eq('context.targetRuntimeId', '1211'),
        ),
      ),
      operations: [
        {
          type: 'add_attribute_mod',
          attribute: 'all',
          mod: 'amplify',
          value: constValue(20),
        },
      ],
    },
    {
      id: `${ID}:s6:liberation-vulnerability`,
      label: 'S6 Resonance Liberation Vulnerability',
      source: SOURCE,
      ownerKey: ownerKey('sequence', 's6'),
      trigger: 'runtime',
      targetScope: 'self',
      condition: gte(PATHS.sequence, 6),
      operations: [
        {
          type: 'add_skilltype_mod',
          skillType: 'resonanceLiberation',
          mod: 'dmgVuln',
          value: constValue(40),
        },
      ],
    },
    {
      id: `${ID}:s6:tune-rupture-crit-rate`,
      label: 'S6 Tune Rupture Crit Rate',
      source: SOURCE,
      ownerKey: ownerKey('sequence', 's6'),
      trigger: 'skill',
      targetScope: 'self',
      condition: and(gte(PATHS.sequence, 6), inTuneRuptureMode()),
      operations: [
        {
          type: 'add_skill_scalar',
          field: 'tuneRuptureCritRate',
          match: { skillTypes: ['tuneRupture'] },
          value: constValue(0.8),
        },
      ],
    },
    {
      id: `${ID}:s6:tune-rupture-crit-dmg`,
      label: 'S6 Tune Rupture Crit DMG',
      source: SOURCE,
      ownerKey: ownerKey('sequence', 's6'),
      trigger: 'skill',
      targetScope: 'self',
      condition: and(gte(PATHS.sequence, 6), inTuneRuptureMode()),
      operations: [
        {
          type: 'add_skill_scalar',
          field: 'tuneRuptureCritDmg',
          match: { skillTypes: ['tuneRupture'] },
          value: constValue(2.75),
        },
      ],
    },
    {
      id: `${ID}:s6:fusion-burst-crit-rate`,
      label: 'S6 Fusion Burst Crit Rate',
      source: SOURCE,
      ownerKey: ownerKey('sequence', 's6'),
      trigger: 'runtime',
      targetScope: 'active',
      condition: and(gte(PATHS.sequence, 6), inFusionBurstMode()),
      operations: [
        {
          type: 'add_negative_effect_mod',
          negativeEffect: 'fusionBurst',
          mod: 'critRate',
          value: constValue(80),
        },
      ],
    },
    {
      id: `${ID}:s6:fusion-burst-crit-dmg`,
      label: 'S6 Fusion Burst Crit DMG',
      source: SOURCE,
      ownerKey: ownerKey('sequence', 's6'),
      trigger: 'runtime',
      targetScope: 'active',
      condition: and(gte(PATHS.sequence, 6), inFusionBurstMode()),
      operations: [
        {
          type: 'add_negative_effect_mod',
          negativeEffect: 'fusionBurst',
          mod: 'critDmg',
          value: constValue(175),
        },
      ],
    },
  ],
})
