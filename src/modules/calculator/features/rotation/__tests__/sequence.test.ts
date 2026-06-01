import { describe, expect, it } from 'vitest'
import { mkSqnc } from '@/modules/calculator/features/rotation/lib/sequence.ts'

describe('rotationSequence', () => {
  it('annotates negative-effect actions with the stack count at that feature', () => {
    const result = mkSqnc({
      resonatorId: '1105',
      initialCombat: {
        spectroFrazzle: 1,
      },
      items: [
        {
          id: 'set-frazzle',
          type: 'condition',
          label: 'Set Frazzle',
          changes: [
            {
              type: 'set',
              path: 'enemy.combat.spectroFrazzle',
              value: 2,
            },
          ],
        },
        {
          id: 'frazzle-tick',
          type: 'feature',
          featureId: 'damage:1105:negative-effect:spectro-frazzle',
          negativeEffectStacks: 99,
          changes: [
            {
              type: 'add',
              path: 'runtime.state.combat.spectroFrazzle',
              value: 2,
            },
          ],
          enabled: true,
        },
      ],
    })

    expect(result.actions[0]?.label).toBe('Spectro Frazzle')
    expect(result.actions[0]?.negEfxStck).toBe(4)
  })

  it('uses legacy negative-effect stack overrides when no stack condition is attached', () => {
    const result = mkSqnc({
      resonatorId: '1105',
      initialCombat: {
        spectroFrazzle: 1,
      },
      items: [
        {
          id: 'frazzle-tick',
          type: 'feature',
          featureId: 'damage:1105:negative-effect:spectro-frazzle',
          negativeEffectStacks: 7,
          enabled: true,
        },
      ],
    })

    expect(result.actions[0]?.negEfxStck).toBe(7)
  })

  it('does not annotate normal action labels with negative-effect stacks', () => {
    const result = mkSqnc({
      resonatorId: '1105',
      initialCombat: {
        spectroFrazzle: 9,
      },
      items: [
        {
          id: 'stage-one',
          type: 'feature',
          featureId: 'damage:1105001',
          enabled: true,
        },
      ],
    })

    expect(result.actions[0]?.label).toBe('Stage 1 DMG')
    expect(result.actions[0]?.negEfxStck).toBeUndefined()
  })

  it('emits paired loop markers without emitting a span', () => {
    const result = mkSqnc({
      resonatorId: '1105',
      items: [
        {
          id: 'loop-a-start',
          type: 'loop',
          kind: 'start',
          loopId: 'loop-a',
          label: 'Burst Window',
          color: '#22c55e',
          runs: 3,
        },
        {
          id: 'tick',
          type: 'feature',
          featureId: 'damage:1105001',
          enabled: true,
        },
        {
          id: 'loop-a-end',
          type: 'loop',
          kind: 'end',
          loopId: 'loop-a',
        },
      ],
    })

    expect(result.entries).toHaveLength(3)
    expect(result.entries[0]).toMatchObject({ type: 'loopMarker', kind: 'start', color: '#22c55e', runs: 3, label: 'Burst Window' })
    expect(result.entries[1]?.type).toBe('action')
    expect(result.entries[2]).toMatchObject({ type: 'loopMarker', kind: 'end', label: 'Burst Window' })
    expect(result.spans).toHaveLength(0)
  })

  it("flags an unmatched loop start as 'self' and emits no span", () => {
    const result = mkSqnc({
      resonatorId: '1105',
      items: [
        {
          id: 'lone-start',
          type: 'loop',
          kind: 'start',
          loopId: 'loop-x',
          label: 'Self Loop',
          runs: 2,
        },
        {
          id: 'tick',
          type: 'feature',
          featureId: 'damage:1105001',
          enabled: true,
        },
      ],
    })

    expect(result.entries[0]).toMatchObject({ type: 'loopMarker', kind: 'self', label: 'Self Loop' })
    expect(result.spans).toHaveLength(0)
  })

  it('propagates meaningful when rules onto entries and drops empty ones', () => {
    const result = mkSqnc({
      resonatorId: '1105',
      items: [
        {
          id: 'gated-feature',
          type: 'feature',
          featureId: 'damage:1105001',
          enabled: true,
          when: { loops: [{ loopId: 'loop-a', runs: [1, 3] }] },
        },
        {
          id: 'plain-feature',
          type: 'feature',
          featureId: 'damage:1105001',
          enabled: true,
          when: {},
        },
      ],
    })

    expect(result.entries[0]).toMatchObject({
      type: 'action',
      when: { loops: [{ loopId: 'loop-a', runs: [1, 3] }] },
    })
    expect((result.entries[1] as { when?: unknown }).when).toBeUndefined()
  })
})
