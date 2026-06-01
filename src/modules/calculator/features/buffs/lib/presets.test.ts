import { describe, expect, it } from 'vitest'
import type { ResRuntime } from '@/domain/entities/runtime'
import type { BuffPresetEntry } from './presets'
import {
  buffTypeForScope,
  buildBuffPresetCatalog,
  formatManualModifierPreview,
  presetToManualModifiers,
} from './presets'

function makeRuntime(): ResRuntime {
  return {
    id: '1506',
    base: {
      level: 90,
      sequence: 0,
      skillLevels: {
        normalAttack: 1,
        resonanceSkill: 1,
        forteCircuit: 1,
        resonanceLiberation: 1,
        introSkill: 1,
        tuneBreak: 1,
      },
      traceNodes: {
        atk: { flat: 0, percent: 0 },
        hp: { flat: 0, percent: 0 },
        def: { flat: 0, percent: 0 },
        attribute: {
          aero: { resShred: 0, dmgBonus: 0, amplify: 0, defIgnore: 0, defShred: 0, dmgVuln: 0, critRate: 0, critDmg: 0 },
          glacio: { resShred: 0, dmgBonus: 0, amplify: 0, defIgnore: 0, defShred: 0, dmgVuln: 0, critRate: 0, critDmg: 0 },
          spectro: { resShred: 0, dmgBonus: 0, amplify: 0, defIgnore: 0, defShred: 0, dmgVuln: 0, critRate: 0, critDmg: 0 },
          fusion: { resShred: 0, dmgBonus: 0, amplify: 0, defIgnore: 0, defShred: 0, dmgVuln: 0, critRate: 0, critDmg: 0 },
          electro: { resShred: 0, dmgBonus: 0, amplify: 0, defIgnore: 0, defShred: 0, dmgVuln: 0, critRate: 0, critDmg: 0 },
          havoc: { resShred: 0, dmgBonus: 0, amplify: 0, defIgnore: 0, defShred: 0, dmgVuln: 0, critRate: 0, critDmg: 0 },
          physical: { resShred: 0, dmgBonus: 0, amplify: 0, defIgnore: 0, defShred: 0, dmgVuln: 0, critRate: 0, critDmg: 0 },
        },
        critRate: 0,
        critDmg: 0,
        healingBonus: 0,
        activeNodes: {},
      },
    },
    build: {
      weapon: { id: '0', level: 1, rank: 1, baseAtk: 0 },
      echoes: [null, null, null, null, null],
      team: [null, null, null],
    },
    state: {
      controls: {},
      manualBuffs: {
        quick: {
          atk: { flat: 0, percent: 0 },
          hp: { flat: 0, percent: 0 },
          def: { flat: 0, percent: 0 },
          critRate: 0,
          critDmg: 0,
          energyRegen: 0,
          healingBonus: 0,
        },
        modifiers: [],
      },
      combat: {
        spectroFrazzle: 0,
        aeroErosion: 0,
        fusionBurst: 0,
        havocBane: 0,
        glacioChafe: 0,
        electroFlare: 0,
        electroRage: 0,
      },
    },
    rotation: { view: 'personal', personalItems: [], teamItems: [] },
    teamRuntimes: [null, null],
  }
}

describe('manual buff presets', () => {
  it('converts a set effect into static manual modifiers', () => {
    const entry: BuffPresetEntry = {
      id: 'set:test',
      source: { type: 'echoSet', id: '99' },
      sourceName: 'Test Set',
      sourceIcon: null,
      label: 'Test 5pc',
      effectName: 'Test 5pc',
      buffType: 'self',
      targetScope: 'self',
      controls: [],
      effect: {
        id: 'set:test',
        label: 'Test 5pc',
        source: { type: 'echoSet', id: '99' },
        trigger: 'runtime',
        operations: [
          { type: 'add_attribute_mod', attribute: 'spectro', mod: 'dmgBonus', value: { type: 'const', value: 30 } },
        ],
      },
    }

    expect(presetToManualModifiers(entry, makeRuntime(), {}, 1)).toMatchObject([
      { scope: 'attribute', attribute: 'spectro', mod: 'dmgBonus', value: 30 },
    ])
  })

  it('evaluates rank and stack inputs at add time', () => {
    const entry: BuffPresetEntry = {
      id: 'weapon:test',
      source: { type: 'weapon', id: '21010001' },
      sourceName: 'Test Weapon',
      sourceIcon: null,
      label: 'Stacked ATK',
      effectName: 'Stacked ATK',
      buffType: 'self',
      targetScope: 'self',
      controls: [],
      effect: {
        id: 'weapon:test',
        label: 'Stacked ATK',
        source: { type: 'weapon', id: '21010001' },
        trigger: 'runtime',
        operations: [
          {
            type: 'add_base_stat',
            stat: 'atk',
            field: 'percent',
            value: {
              type: 'mul',
              values: [
                { type: 'read', from: 'sourceRuntime', path: 'state.controls.weapon:test:stacks', default: 0 },
                { type: 'table', from: 'sourceRuntime', path: 'build.weapon.rank', minIndex: 1, values: [4, 5, 6, 7, 8] },
              ],
            },
          },
        ],
      },
    }

    expect(presetToManualModifiers(entry, makeRuntime(), { 'weapon:test:stacks': 3 }, 5)).toMatchObject([
      { scope: 'baseStat', stat: 'atk', field: 'percent', value: 24 },
    ])
  })

  it('collapses complete element and skill-type preset targets into all modifiers', () => {
    const entry: BuffPresetEntry = {
      id: 'echo:test:all-targets',
      source: { type: 'echo', id: '6000189' },
      sourceName: 'Hyvatia',
      sourceIcon: null,
      label: 'All Targets',
      effectName: 'All Targets',
      buffType: 'team',
      targetScope: 'activeOther',
      controls: [],
      effect: {
        id: 'echo:test:all-targets',
        label: 'All Targets',
        source: { type: 'echo', id: '6000189' },
        trigger: 'runtime',
        operations: [
          {
            type: 'add_attribute_mod',
            attribute: ['aero', 'glacio', 'spectro', 'fusion', 'electro', 'havoc', 'physical'],
            mod: 'dmgBonus',
            value: { type: 'const', value: 10 },
          },
          {
            type: 'add_skilltype_mod',
            skillType: [
              'basicAtk',
              'heavyAtk',
              'resonanceSkill',
              'resonanceLiberation',
              'introSkill',
              'outroSkill',
              'echoSkill',
              'coord',
              'spectroFrazzle',
              'aeroErosion',
              'fusionBurst',
              'havocBane',
              'glacioChafe',
              'electroFlare',
              'healing',
              'shield',
              'tuneRupture',
              'hack',
            ],
            mod: 'amplify',
            value: { type: 'const', value: 12 },
          },
        ],
      },
    }

    expect(presetToManualModifiers(entry, makeRuntime(), {}, 1)).toMatchObject([
      { scope: 'attribute', attribute: 'all', mod: 'dmgBonus', value: 10 },
      { scope: 'skillType', skillType: 'all', mod: 'amplify', value: 12 },
    ])
  })

  it('hides internal toggle wording from preset labels', () => {
    const hyvatia = buildBuffPresetCatalog().find((entry) => entry.id === 'echo:6000189:effect:toggle:activeOther')

    expect(hyvatia).toMatchObject({
      sourceName: 'Hyvatia',
      label: 'Hyvatia',
      effectName: 'Hyvatia',
    })
  })

  it('keeps split-scope set presets from colliding by id', () => {
    const entries = buildBuffPresetCatalog().filter((entry) => entry.sourceName === 'Flaming Clawprint')
    const ids = entries.map((entry) => entry.id)
    const teamEntry = entries.find((entry) => entry.targetScope === 'teamWide')
    const selfEntry = entries.find((entry) => entry.targetScope === 'self' && entry.id.includes('clawprint5'))
    const valuesFor = (entry: BuffPresetEntry) =>
      Object.fromEntries(entry.controls.map((control) => [control.key, control.defaultValue]))

    expect(new Set(ids).size).toBe(ids.length)
    expect(teamEntry?.id).toBe('echoSet:18:clawprint5:teamWide')
    expect(teamEntry?.label).toBe('5pc Fusion/Liberation Buff')
    expect(teamEntry?.description).toBe('Casting Resonance Liberation grants 15% Fusion DMG Bonus and 20% Resonance Liberation DMG Bonus for 35s.')
    expect(selfEntry?.id).toBe('echoSet:18:clawprint5:self')
    expect(selfEntry?.label).toBe('5pc Fusion/Liberation Buff')
    expect(selfEntry?.description).toBe('Casting Resonance Liberation grants 15% Fusion DMG Bonus and 20% Resonance Liberation DMG Bonus for 35s.')
    expect(teamEntry ? presetToManualModifiers(teamEntry, makeRuntime(), valuesFor(teamEntry), 1) : []).toMatchObject([
      { scope: 'attribute', attribute: 'fusion', mod: 'dmgBonus', value: 15 },
    ])
    expect(selfEntry ? presetToManualModifiers(selfEntry, makeRuntime(), valuesFor(selfEntry), 1) : []).toMatchObject([
      { scope: 'skillType', skillType: 'resonanceLiberation', mod: 'dmgBonus', value: 20 },
    ])
  })

  it('groups game-data scopes into ux buff types', () => {
    expect(buffTypeForScope('self')).toBe('self')
    expect(buffTypeForScope('active')).toBe('active')
    expect(buffTypeForScope('teamWide')).toBe('team')
    expect(buffTypeForScope('activeOther')).toBe('team')
    expect(buffTypeForScope('otherTeammates')).toBe('team')
  })

  it('formats modifier previews with readable labels', () => {
    expect(formatManualModifierPreview({
      id: 'preview:attribute',
      enabled: true,
      scope: 'attribute',
      attribute: 'aero',
      mod: 'dmgBonus',
      value: 15,
    })).toBe('Aero DMG Bonus +15%')

    expect(formatManualModifierPreview({
      id: 'preview:base',
      enabled: true,
      scope: 'baseStat',
      stat: 'atk',
      field: 'percent',
      value: 24,
    })).toBe('Attack Percent +24%')
  })
})
