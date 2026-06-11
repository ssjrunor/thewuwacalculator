import { describe, expect, it } from 'vitest'
import { getResDtlsBy } from '@/data/gameData/resonators/resonatorDataStore'
import { maxResRt } from '@/domain/gameData/resonatorMax'
import { normResCntrOpt, normResRtCnt, resResCntrPt } from '@/domain/gameData/controlOptions'
import {
  getResChainControls,
  getLooseResCtrls,
  getResModeGroups,
  getResStateControls,
} from '@/domain/gameData/resonatorStateGraph'
import { getResonatorById } from '@/domain/services/catalogService'
import { makeAppState, makeResProfile, makeResRuntime } from '@/domain/state/defaults'
import type { ResStateNode } from '@/domain/entities/resonator'

function runtimeFor(resonatorId: string) {
  const seed = getResonatorById(resonatorId)
  if (!seed) {
    throw new Error(`missing resonator ${resonatorId}`)
  }

  return makeResRuntime(seed)
}

function optionValue(option: NonNullable<ResStateNode['options']>[number]): string {
  return String(typeof option === 'object' ? option.id : option)
}

function nodeOptionValues(node: ResStateNode): string[] {
  return [
    ...(node.options ?? []),
    ...(node.optionsWhen ?? []).flatMap((optionSet) => optionSet.options),
    ...(node.sequenceAwareOptions ? [
      ...node.sequenceAwareOptions.below,
      ...node.sequenceAwareOptions.atOrAbove,
    ] : []),
  ].map((option) => optionValue(option))
}

function hasLtCond(value: unknown): boolean {
  if (!value || typeof value !== 'object') {
    return false
  }

  const condition = value as { type?: string; values?: unknown[]; value?: unknown }
  if (condition.type === 'lt' || condition.type === 'lte') {
    return true
  }

  return Boolean(
    condition.values?.some((entry) => hasLtCond(entry))
    || hasLtCond(condition.value),
  )
}

describe('resonator state graph runtime behavior', () => {
  it('emits valid default and max values for every generated resonator state', () => {
    for (const [resonatorId, details] of Object.entries(getResDtlsBy())) {
      for (const node of details.stateGraph?.nodes ?? []) {
        const label = `${resonatorId} ${node.key}`

        expect(node.defaultValue, `${label} defaultValue`).not.toBeUndefined()
        expect(node.maxValue, `${label} maxValue`).not.toBeUndefined()

        if (node.kind === 'toggle') {
          expect(typeof node.defaultValue, `${label} toggle defaultValue`).toBe('boolean')
          expect(typeof node.maxValue, `${label} toggle maxValue`).toBe('boolean')
          continue
        }

        if (node.kind === 'select') {
          const values = nodeOptionValues(node)

          expect(values.length, `${label} select options`).toBeGreaterThan(0)
          expect(values, `${label} select defaultValue`).toContain(String(node.defaultValue))
          expect(values, `${label} select maxValue`).toContain(String(node.maxValue))
          continue
        }

        const min = node.min ?? 0
        const maxWhenCap = node.maxWhen
          ?.map((entry) => entry.max)
          .reduce((highest, value) => Math.max(highest, value), -Infinity)
        const max = maxWhenCap === undefined || maxWhenCap === -Infinity ? node.max : maxWhenCap
        const defaultValue = Number(node.defaultValue)
        const maxValue = Number(node.maxValue)

        expect(Number.isFinite(defaultValue), `${label} number defaultValue`).toBe(true)
        expect(Number.isFinite(maxValue), `${label} number maxValue`).toBe(true)
        expect(defaultValue, `${label} number defaultValue min`).toBeGreaterThanOrEqual(min)
        expect(maxValue, `${label} number maxValue min`).toBeGreaterThanOrEqual(min)
        if (max !== undefined) {
          expect(maxValue, `${label} number maxValue cap`).toBeLessThanOrEqual(max)
        }
      }

      for (const group of details.stateGraph?.groups ?? []) {
        const label = `${resonatorId} ${group.id}`

        if (group.controlKey) {
          const values = (group.modes ?? []).map((mode) => mode.id)

          expect(group.defaultValue, `${label} mode defaultValue`).not.toBeUndefined()
          expect(group.maxValue, `${label} mode maxValue`).not.toBeUndefined()
          expect(values, `${label} mode defaultValue`).toContain(String(group.defaultValue))
          expect(values, `${label} mode maxValue`).toContain(String(group.maxValue))
        }

        if (group.members?.length) {
          expect(group.defaultKey, `${label} exclusive defaultKey`).not.toBeUndefined()
          expect(group.maxKey, `${label} exclusive maxKey`).not.toBeUndefined()
          expect(group.members, `${label} exclusive defaultKey`).toContain(group.defaultKey)
          expect(group.members, `${label} exclusive maxKey`).toContain(group.maxKey)
        }
      }
    }
  })

  it('links every inherent skill state key to a generated graph control', () => {
    for (const [resonatorId, details] of Object.entries(getResDtlsBy())) {
      const controlsByKey = new Map(getResStateControls(details).map((control) => [control.key, control]))
      const nodesByKey = new Map((details.stateGraph?.nodes ?? []).map((node) => [node.key, node]))

      for (const inherent of details.inherentSkills) {
        for (const key of inherent.stateKeys ?? []) {
          const label = `${resonatorId} ${inherent.name} ${key}`

          expect(nodesByKey.has(key), `${label} node`).toBe(true)
          expect(controlsByKey.has(key), `${label} control`).toBe(true)
          expect(hasLtCond(nodesByKey.get(key)?.unlockWhen), `${label} unlockWhen should not carry disabling conditions`).toBe(false)
        }
      }
    }
  })

  it('defaults new app state to max resonators on init and can build a maxed profile', () => {
    const appState = makeAppState()
    const seed = getResonatorById('1308')
    if (!seed) {
      throw new Error('missing Rebecca seed')
    }

    const profile = makeResProfile(seed, { maxed: appState.ui.preferences.maxResOnInit })

    expect(appState.ui.preferences.maxResOnInit).toBe(true)
    expect(profile.runtime.progression.level).toBe(90)
    expect(profile.runtime.progression.sequence).toBe(0)
    expect(profile.runtime.build.weapon.level).toBe(90)
    expect(profile.runtime.build.weapon.rank).toBe(1)
    expect(profile.runtime.local.controls['resonator:1308:huntress:active']).toBe(false)
    expect(profile.runtime.local.controls['resonator:1308:guts:active']).toBe(false)
    expect(profile.runtime.local.controls['resonator:1308:a_girl_gets_what_she_wants:active']).toBe(true)
  })

  it('maxes Rebecca through A Girl Gets What She Wants', () => {
    const details = getResDtlsBy()['1308']
    const maxed = maxResRt(runtimeFor('1308'), details, { targetSequence: 6 })
    const group = details.stateGraph?.groups?.find((entry) =>
      entry.members?.includes('resonator:1308:huntress:active'),
    )

    expect(group).toMatchObject({
      type: 'exclusive',
      maxKey: 'resonator:1308:a_girl_gets_what_she_wants:active',
    })
    expect(maxed.state.controls['resonator:1308:huntress:active']).toBe(false)
    expect(maxed.state.controls['resonator:1308:guts:active']).toBe(false)
    expect(maxed.state.controls['resonator:1308:a_girl_gets_what_she_wants:active']).toBe(true)
    expect(maxed.state.controls['sequence:1308:s2:intro_liberation']).toBe(true)
    expect(maxed.state.controls['sequence:1308:s2:hack_shifting']).toBe(true)
    expect(maxed.state.controls['sequence:1308:s5:hack_shifting']).toBe(true)
  })

  it('initializes missing runtime controls from generated defaults', () => {
    const runtime = runtimeFor('1308')
    const controls = { ...runtime.state.controls }

    delete controls['resonator:1308:huntress:active']
    delete controls['resonator:1308:guts:active']
    delete controls['resonator:1308:a_girl_gets_what_she_wants:active']
    delete controls['inherent:1308:lvl50:stacks']

    const normalized = normResRtCnt({
      ...runtime,
      state: {
        ...runtime.state,
        controls,
      },
    }, controls)

    expect(normalized['resonator:1308:huntress:active']).toBe(true)
    expect(normalized['resonator:1308:guts:active']).toBe(false)
    expect(normalized['resonator:1308:a_girl_gets_what_she_wants:active']).toBe(false)
    expect(normalized['inherent:1308:lvl50:stacks']).toBe('0')
  })

  it('can redirect Rebecca max path by sequence priority', () => {
    const details = structuredClone(getResDtlsBy()['1308'])
    const group = details.stateGraph?.groups?.find((entry) =>
      entry.members?.includes('resonator:1308:huntress:active'),
    )
    if (!group) {
      throw new Error('missing Rebecca gear group')
    }

    group.maxPriority = [
      {
        sequenceMin: 4,
        key: 'resonator:1308:huntress:active',
      },
    ]

    const s3Maxed = maxResRt(runtimeFor('1308'), details, { targetSequence: 3 })
    expect(s3Maxed.state.controls['resonator:1308:huntress:active']).toBe(false)
    expect(s3Maxed.state.controls['resonator:1308:guts:active']).toBe(false)
    expect(s3Maxed.state.controls['resonator:1308:a_girl_gets_what_she_wants:active']).toBe(true)

    const s4Maxed = maxResRt(runtimeFor('1308'), details, { targetSequence: 4 })
    expect(s4Maxed.state.controls['resonator:1308:huntress:active']).toBe(true)
    expect(s4Maxed.state.controls['resonator:1308:guts:active']).toBe(false)
    expect(s4Maxed.state.controls['resonator:1308:a_girl_gets_what_she_wants:active']).toBe(false)
  })

  it('does not attach every graph state to sequence entries without state keys', () => {
    const details = getResDtlsBy()['1210']
    const s4 = details.resonanceChains.find((entry) => entry.index === 4)
    const s5 = details.resonanceChains.find((entry) => entry.index === 5)
    if (!s4 || !s5) {
      throw new Error('missing Aemeath sequence fixture')
    }

    expect(getResChainControls(details, s4).map((control) => control.key)).toEqual([
      'sequence:1210:s4:active',
    ])
    expect(getResChainControls(details, s5)).toEqual([])
  })

  it('keeps Aemeath Between the Stars max branch-aware', () => {
    const details = getResDtlsBy()['1210']
    const controlKey = 'inherent:1210:lvl70:stacks'
    const control = getResStateControls(details).find((entry) => entry.key === controlKey)
    const node = details.stateGraph?.nodes.find((entry) => entry.key === controlKey)
    if (!control || !node) {
      throw new Error('missing Aemeath Between the Stars control')
    }

    expect(node.maxValue).toBe('3')
    expect(node.unlockWhen).toEqual({ type: 'gte', from: 'sourceRuntime', path: 'base.level', value: 70 })
    expect(node.enabledWhen).toEqual({ type: 'lt', from: 'sourceRuntime', path: 'base.sequence', value: 3 })
    expect(control.visibleWhen).toEqual(node.unlockWhen)
    expect(control.enabledWhen).toEqual(node.enabledWhen)
    expect(resResCntrPt(runtimeFor('1210'), control).map((option) => String(normResCntrOpt(option).value))).toEqual([
      '0',
      '1',
      '2',
      '3',
    ])

    const ruptureMaxed = maxResRt(runtimeFor('1210'), details, { targetSequence: 0 })
    expect(ruptureMaxed.state.controls['resonator:1210:mode:value']).toBe('tune_rupture')
    expect(ruptureMaxed.state.controls[controlKey]).toBe('3')

    const fusionDetails = structuredClone(details)
    const fusionModeGroup = fusionDetails.stateGraph?.groups?.find((entry) => entry.controlKey === 'resonator:1210:mode:value')
    if (!fusionModeGroup) {
      throw new Error('missing Aemeath mode group')
    }
    fusionModeGroup.maxValue = 'fusion_burst'

    const fusionMaxed = maxResRt(runtimeFor('1210'), fusionDetails, { targetSequence: 0 })
    expect(fusionMaxed.state.controls['resonator:1210:mode:value']).toBe('fusion_burst')
    expect(fusionMaxed.state.controls[controlKey]).toBe('2')
  })

  it('keeps Aemeath Fusion Trail number cap sequence-aware', () => {
    const details = structuredClone(getResDtlsBy()['1210'])
    const controlKey = 'resonator:1210:fusion_trail:value'
    const control = getResStateControls(details).find((entry) => entry.key === controlKey)
    const node = details.stateGraph?.nodes.find((entry) => entry.key === controlKey)
    const fusionModeGroup = details.stateGraph?.groups?.find((entry) => entry.controlKey === 'resonator:1210:mode:value')
    if (!control || !node || !fusionModeGroup) {
      throw new Error('missing Aemeath Fusion Trail fixture')
    }

    fusionModeGroup.maxValue = 'fusion_burst'

    expect(control.kind).toBe('number')
    expect(control.max).toBe(30)
    expect(control.maxWhen).toEqual([{ when: { type: 'gte', from: 'sourceRuntime', path: 'base.sequence', value: 6 }, max: 60 }])
    expect(node.kind).toBe('number')
    expect(node.maxValue).toBe(60)
    expect(node.max).toBe(30)
    expect(node.maxWhen).toEqual([{ when: { type: 'gte', from: 'sourceRuntime', path: 'base.sequence', value: 6 }, max: 60 }])

    const s0Runtime = runtimeFor('1210')
    s0Runtime.state.controls['resonator:1210:mode:value'] = 'fusion_burst'
    s0Runtime.state.controls[controlKey] = 60
    expect(normResRtCnt(s0Runtime)[controlKey]).toBe(30)

    const s6Runtime = {
      ...runtimeFor('1210'),
      base: {
        ...s0Runtime.base,
        sequence: 6,
      },
      state: {
        ...s0Runtime.state,
        controls: {
          ...s0Runtime.state.controls,
          'resonator:1210:mode:value': 'fusion_burst',
          [controlKey]: 60,
        },
      },
    }
    expect(normResRtCnt(s6Runtime)[controlKey]).toBe(60)

    const s0Maxed = maxResRt(runtimeFor('1210'), details, { targetSequence: 0 })
    expect(s0Maxed.state.controls['resonator:1210:mode:value']).toBe('fusion_burst')
    expect(s0Maxed.state.controls[controlKey]).toBe(30)

    const s6Maxed = maxResRt(runtimeFor('1210'), details, { targetSequence: 6 })
    expect(s6Maxed.state.controls['resonator:1210:mode:value']).toBe('fusion_burst')
    expect(s6Maxed.state.controls[controlKey]).toBe(60)
  })

  it('keeps Aemeath Rupturous Trail select cap sequence-aware', () => {
    const details = getResDtlsBy()['1210']
    const controlKey = 'resonator:1210:rupturous_trail:value'
    const control = getResStateControls(details).find((entry) => entry.key === controlKey)
    const node = details.stateGraph?.nodes.find((entry) => entry.key === controlKey)
    if (!control || !node) {
      throw new Error('missing Aemeath Rupturous Trail fixture')
    }

    expect(control.kind).toBe('select')
    expect(node.maxValue).toBe('60')
    expect(resResCntrPt(runtimeFor('1210'), control).map((option) => String(normResCntrOpt(option).value))).toEqual([
      '0',
      '10',
      '20',
      '30',
    ])

    const baseRuntime = runtimeFor('1210')
    const s6Runtime = {
      ...baseRuntime,
      base: {
        ...baseRuntime.base,
        sequence: 6,
      },
    }
    expect(resResCntrPt(s6Runtime, control).map((option) => String(normResCntrOpt(option).value))).toEqual([
      '0',
      '10',
      '20',
      '30',
      '40',
      '50',
      '60',
    ])

    const s0Maxed = maxResRt(runtimeFor('1210'), details, { targetSequence: 0 })
    expect(s0Maxed.state.controls['resonator:1210:mode:value']).toBe('tune_rupture')
    expect(s0Maxed.state.controls[controlKey]).toBe('30')

    const s6Maxed = maxResRt(runtimeFor('1210'), details, { targetSequence: 6 })
    expect(s6Maxed.state.controls['resonator:1210:mode:value']).toBe('tune_rupture')
    expect(s6Maxed.state.controls[controlKey]).toBe('60')
  })

  it('keeps Phoebe defaulted to none and hides confession-only states outside confession', () => {
    const details = getResDtlsBy()['1506']
    const runtime = runtimeFor('1506')
    const modeGroup = getResModeGroups(details)[0]

    expect(modeGroup).toMatchObject({
      controlKey: 'resonator:1506:mode:value',
      defaultValue: 'none',
    })
    expect(runtime.state.controls['resonator:1506:mode:value']).toBe('none')

    const confessionRuntime = {
      ...runtime,
      base: {
        ...runtime.base,
        level: 90,
        sequence: 2,
      },
      state: {
        ...runtime.state,
        controls: {
          ...runtime.state.controls,
          'resonator:1506:mode:value': 'confession',
          'resonator:1506:attentive_heart:active': true,
          'sequence:1506:s2:boat_adrift': true,
        },
      },
    }
    const normalizedConfession = normResRtCnt(confessionRuntime)

    expect(normalizedConfession['resonator:1506:attentive_heart:active']).toBe(true)
    expect(normalizedConfession['sequence:1506:s2:boat_adrift']).toBe(true)

    const noneRuntime = {
      ...confessionRuntime,
      state: {
        ...confessionRuntime.state,
        controls: {
          ...confessionRuntime.state.controls,
          'resonator:1506:mode:value': 'none',
        },
      },
    }
    const normalizedNone = normResRtCnt(noneRuntime)

    expect(normalizedNone['resonator:1506:attentive_heart:active']).toBe(false)
    expect(normalizedNone['sequence:1506:s2:boat_adrift']).toBe(false)

    const maxed = maxResRt(runtime, details, { targetSequence: 6 })

    expect(maxed.state.controls['resonator:1506:mode:value']).toBe('absolution')
    expect(maxed.state.controls['resonator:1506:attentive_heart:active']).toBe(false)
    expect(maxed.state.controls['sequence:1506:s2:boat_adrift']).toBe(false)
    expect(maxed.state.controls['sequence:1506:s4:active']).toBe(true)
    expect(maxed.state.controls['sequence:1506:s5:active']).toBe(true)
    expect(maxed.state.controls['sequence:1506:s6:active']).toBe(true)
  })

  it('can redirect Phoebe max mode by sequence priority', () => {
    const details = structuredClone(getResDtlsBy()['1506'])
    const group = details.stateGraph?.groups?.find((entry) => entry.controlKey === 'resonator:1506:mode:value')
    if (!group) {
      throw new Error('missing Phoebe mode group')
    }

    group.maxPriority = [
      {
        sequenceMin: 2,
        value: 'confession',
      },
    ]

    const s1Maxed = maxResRt(runtimeFor('1506'), details, { targetSequence: 1 })
    expect(s1Maxed.state.controls['resonator:1506:mode:value']).toBe('absolution')
    expect(s1Maxed.state.controls['resonator:1506:attentive_heart:active']).toBe(false)

    const s2Maxed = maxResRt(runtimeFor('1506'), details, { targetSequence: 2 })
    expect(s2Maxed.state.controls['resonator:1506:mode:value']).toBe('confession')
    expect(s2Maxed.state.controls['resonator:1506:attentive_heart:active']).toBe(true)
    expect(s2Maxed.state.controls['sequence:1506:s2:boat_adrift']).toBe(true)
  })

  it('keeps Denia in her default mode and maxes dependencies up to the requested sequence', () => {
    const details = getResDtlsBy()['1211']
    const runtime = runtimeFor('1211')
    const modeGroup = getResModeGroups(details)[0]

    expect(modeGroup).toMatchObject({
      controlKey: 'resonator:1211:mode:value',
      defaultValue: 'fusion_burst',
    })
    expect(runtime.state.controls['resonator:1211:mode:value']).toBe('fusion_burst')

    const s0Maxed = maxResRt(runtime, details, { targetSequence: 0 })
    expect(s0Maxed.base.sequence).toBe(0)
    expect(s0Maxed.state.controls['resonator:1211:mode:value']).toBe('fusion_burst')
    expect(s0Maxed.state.controls['resonator:1211:entropy_shift:active']).toBe(true)
    expect(s0Maxed.state.controls['resonator:1211:entropy_shift_breakdown:active']).toBe(true)
    expect(s0Maxed.state.controls['resonator:1211:dark_cores:value']).toBe('3')
    expect(s0Maxed.state.controls['sequence:1211:s2:active']).toBe(false)
    expect(s0Maxed.state.controls['sequence:1211:s6:active']).toBe(false)
    expect(s0Maxed.state.controls['resonator:1211:shattered_hours:active']).toBe(false)
    expect(s0Maxed.state.controls['inherent:1211:lvl70:off_tune_overcap']).toBe(0)

    const s2Maxed = maxResRt(runtime, details, { targetSequence: 2 })
    expect(s2Maxed.base.sequence).toBe(2)
    expect(s2Maxed.state.controls['sequence:1211:s2:active']).toBe(true)
    expect(s2Maxed.state.controls['sequence:1211:s2:stacks']).toBe('10')

    const s3Maxed = maxResRt(runtime, details, { targetSequence: 3 })
    expect(s3Maxed.base.sequence).toBe(3)
    expect(s3Maxed.state.controls['resonator:1211:dark_cores:value']).toBe('5')

    const tuneStrainControls = getResStateControls(details)
      .filter((control) =>
        String(control.visibleWhen ? JSON.stringify(control.visibleWhen) : '').includes('tune_strain'),
      )
      .map((control) => control.key)

    expect(tuneStrainControls).toContain('resonator:1211:shattered_hours:active')
    expect(tuneStrainControls).toContain('inherent:1211:lvl70:off_tune_overcap')
  })

  it('surfaces loose non-team graph controls for the active resonator pane', () => {
    const deniaLoose = getLooseResCtrls(getResDtlsBy()['1211']).map((control) => control.key)
    const aemeathLoose = getLooseResCtrls(getResDtlsBy()['1210']).map((control) => control.key)

    expect(deniaLoose).toContain('resonator:1211:shattered_hours:active')
    expect(aemeathLoose).not.toContain('team:1210:silent_protection:active')
    expect(aemeathLoose).not.toContain('team:1210:silent_protection_trigger:active')
  })
})
