import { describe, expect, it } from 'vitest'
import { buildRotationActionSequence } from '@/modules/calculator/model/rotationSequence'

describe('rotationSequence', () => {
  it('annotates negative-effect actions with the stack count at that feature', () => {
    const result = buildRotationActionSequence({
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
    expect(result.actions[0]?.negativeEffectStacks).toBe(4)
  })

  it('uses legacy negative-effect stack overrides when no stack condition is attached', () => {
    const result = buildRotationActionSequence({
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

    expect(result.actions[0]?.negativeEffectStacks).toBe(7)
  })

  it('does not annotate normal action labels with negative-effect stacks', () => {
    const result = buildRotationActionSequence({
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
    expect(result.actions[0]?.negativeEffectStacks).toBeUndefined()
  })
})
