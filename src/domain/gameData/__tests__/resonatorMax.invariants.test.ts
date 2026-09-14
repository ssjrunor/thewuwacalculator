/*
  Author: Runor Ewhro
  Description: Protects resonator Max behavior across sequence-gated state
               controls and dependency chains.
*/

import { describe, expect, it } from 'vitest'
import { getResDtlsBy } from '@/data/gameData/resonators/resonatorDataStore'
import { getResCntrMax, mkResCntrScp, normResRtCnt } from '@/domain/gameData/controlOptions'
import { getResModeGroups, getResStateControls, getResStateGroups } from '@/domain/gameData/resonatorStateGraph'
import { maxResRt, setResRtSequence } from '@/domain/gameData/resonatorMax'
import { listFfctForO } from '@/domain/services/gameDataService'
import { listResSds } from '@/domain/services/resonatorSeedService'
import { makeResRuntime } from '@/domain/state/defaults'
import { evalCond } from '@/engine/effects/evaluator'

describe('resonator Max invariants', () => {
  it('maxes simple sequence-unlocked toggles and values at the current sequence', () => {
    const cases = [
      ['1102', 1, 'sequence:1102:s1:active', true],
      ['1105', 3, 'sequence:1105:s3:value', '3'],
      ['1209', 2, 'team:1209:entropic_morning:active', true],
      ['1507', 3, 'sequence:1507:s3:blaze_consumed', 150],
      ['1508', 6, 'team:1508:rising_dawn:active', true],
    ] as const

    for (const [resonatorId, sequence, controlKey, expected] of cases) {
      const seed = listResSds().find((entry) => entry.id === resonatorId)
      const details = getResDtlsBy()[resonatorId]
      expect(seed, `missing seed ${resonatorId}`).toBeDefined()
      expect(details, `missing details ${resonatorId}`).toBeDefined()

      const runtime = maxResRt(makeResRuntime(seed!), details, {
        targetSequence: sequence,
      })

      expect(runtime.state.controls[controlKey]).toBe(expected)
    }
  })

  it('maxes every directly available sequence control in generated data', () => {
    for (const seed of listResSds()) {
      const details = getResDtlsBy()[seed.id]
      for (let sequence = 0; sequence <= 6; sequence += 1) {
        const runtime = maxResRt(makeResRuntime(seed), details, {
          targetSequence: sequence,
        })
        const sequenceKeys = new Set(
          (details?.resonanceChains ?? [])
            .filter((chain) => chain.index <= sequence)
            .flatMap((chain) => chain.stateKeys ?? []),
        )
        const scope = mkResCntrScp(runtime)

        for (const control of getResStateControls(details)) {
          if (!sequenceKeys.has(control.key)) continue
          if (!evalCond(control.visibleWhen, scope)) continue
          if (!evalCond(control.enabledWhen, scope)) continue
          if (control.controlDependencies?.some((key) => !runtime.state.controls[key])) continue

          const value = runtime.state.controls[control.key]
          if (control.kind === 'toggle') {
            expect.soft(value, `${seed.id} S${sequence} ${control.key}`).toBe(control.maxValue ?? true)
          } else if (control.maxValue !== undefined) {
            expect.soft(String(value), `${seed.id} S${sequence} ${control.key}`).toBe(String(control.maxValue))
          }
        }
      }
    }
  })

  it('maxes controls gated by non-sequence conditions', () => {
    const cases = [
      ['1210', 'resonator:1210:stardust_resonance:active', true],
      ['1210', 'resonator:1210:fusion_trail:value', 60],
      ['1506', 'resonator:1506:attentive_heart:active', true],
      ['1506', 'sequence:1506:s2:boat_adrift', true],
    ] as const

    for (const [resonatorId, controlKey, expected] of cases) {
      const seed = listResSds().find((entry) => entry.id === resonatorId)
      const details = getResDtlsBy()[resonatorId]
      expect(seed, `missing seed ${resonatorId}`).toBeDefined()

      const runtime = maxResRt(makeResRuntime(seed!), details, { targetSequence: 6 })
      expect(runtime.state.controls[controlKey]).toBe(expected)
    }
  })

  it('writes every generated non-exclusive control to its authored maximum', () => {
    for (const seed of listResSds()) {
      const details = getResDtlsBy()[seed.id]
      const excludedKeys = new Set(
        getResStateGroups(details).flatMap((group) =>
          (group.members ?? []).filter((key) => key !== group.maxKey),
        ),
      )
      const modeKeys = new Set(getResModeGroups(details).map((group) => group.controlKey))

      for (const sequence of [0, 6]) {
        const runtime = maxResRt(makeResRuntime(seed), details, { targetSequence: sequence })

        for (const control of getResStateControls(details)) {
          if (modeKeys.has(control.key) || excludedKeys.has(control.key)) continue
          const expected = getResCntrMax(runtime, control)
          expect.soft(
            String(runtime.state.controls[control.key]),
            `${seed.id} S${sequence} ${control.key}`,
          ).toBe(String(expected))
        }
      }
    }
  })

  it('pre-arms maxed sequence controls while the effect remains sequence-gated', () => {
    const seed = listResSds().find((entry) => entry.id === '1102')
    const details = getResDtlsBy()['1102']
    expect(seed).toBeDefined()

    const s0Runtime = maxResRt(makeResRuntime(seed!), details, { targetSequence: 0 })
    const s1Runtime = setResRtSequence(s0Runtime, details, 1)
    const s2Runtime = setResRtSequence(s1Runtime, details, 2)
    const effect = listFfctForO('sequence:1102:s1')
      .find((entry) => entry.id === '1102:s1:crit-rate')
    expect(effect).toBeDefined()

    expect(s0Runtime.state.controls['sequence:1102:s1:active']).toBe(true)
    expect(normResRtCnt(s0Runtime)['sequence:1102:s1:active']).toBe(true)
    expect(s2Runtime.state.controls['sequence:1102:s3:active']).toBe(true)
    expect(evalCond(effect?.condition, mkResCntrScp(s0Runtime))).toBe(false)
    expect(evalCond(effect?.condition, mkResCntrScp(s1Runtime))).toBe(true)
  })

  it('advances conditional caps when a maxed runtime changes sequence', () => {
    const seed = listResSds().find((entry) => entry.id === '1210')
    const details = getResDtlsBy()['1210']
    expect(seed).toBeDefined()

    const s0Runtime = maxResRt(makeResRuntime(seed!), details, { targetSequence: 0 })
    const s6Runtime = setResRtSequence(s0Runtime, details, 6)

    expect(s0Runtime.state.controls['resonator:1210:fusion_trail:value']).toBe(30)
    expect(s6Runtime.state.controls['resonator:1210:fusion_trail:value']).toBe(60)
  })
})
