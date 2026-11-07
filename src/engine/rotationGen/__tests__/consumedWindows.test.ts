/*
  Author: Runor Ewhro
  description: checks control writes for effects consumed by a feature.
*/

import { describe, expect, it } from 'vitest'
import { settleConsumedWindows } from '../editor/consumedWindows'
import type { RuntimeValue } from '../types'

const path = 'runtime.state.controls.resonator:1:window:active'
const set = (id: string, value: RuntimeValue, control = path): RuntimeValue => ({ id, type: 'condition',
  resonatorId: '1', enabled: true, changes: [{ type: 'set', path: control, value, resonatorId: '1' }] })
const hit = (id: string, extra = {}): RuntimeValue => ({ id, type: 'feature', resonatorId: '1', enabled: true,
  featureId: 'damage', attached: { conditions: [set(`${id}:local`, true)], features: [] }, ...extra })
const ids = (nodes: RuntimeValue[]) => nodes.map(node => node.id)

describe('consumed control windows', () => {
  it('keeps an active window through all consuming hits and its immediate reactivation', () => {
    const input = [set('on', true), set('off', false), hit('first'), hit('last'),
      set('unrelated', 3, 'runtime.state.controls.other:stacks'), set('regrant', true), hit('next')]
    const snapshot = structuredClone(input), result = settleConsumedWindows(input)
    expect(ids(result)).toEqual(['on', 'first', 'last', 'unrelated', 'next'])
    expect(result.filter(node => node.type === 'feature').every(node => !node.attached)).toBe(true)
    expect(input).toEqual(snapshot)
  })

  it('ends a consumed window after its covered hits when the next action does not regrant it', () => {
    const input = [set('on', true), set('off', false), hit('first'), hit('last'),
      { id: 'uncovered', type: 'feature', resonatorId: '1' }, set('later', true)]
    const result = settleConsumedWindows(input)
    expect(ids(result)).toEqual(['on', 'first', 'last', 'off', 'uncovered', 'later'])
    expect(result[1].attached).toBeUndefined()
    expect(result[2].attached).toBeUndefined()
  })

  it('does not extend a window through unobserved, foreign, pinned or annotated actions', () => {
    const bases = [hit('foreign', { resonatorId: '2' }), hit('child', {
      attached: { conditions: [set('local', true)], features: [{ type: 'feature', featureId: 'child' }] },
    }), hit('annotated', { attached: { conditions: [{ ...set('local', true), note: 'Keep scope' }] } })]
    for (const feature of bases) {
      const input = [set('on', true), set('off', false), feature, set('regrant', true)]
      expect(settleConsumedWindows(input)).toEqual(input)
    }
    const input = [set('on', true), set('off', false), hit('hit'), set('regrant', true)]
    expect(settleConsumedWindows(input, new Set([`1|${path}`]))).toEqual(input)
    expect(settleConsumedWindows([set('off', false), hit('hit')])[1].attached).toBeDefined()
  })

  it('removes equal local values across owners, retaining different hit states and pinned recipients', () => {
    const count = 'runtime.state.controls.resonator:1:resource:stacks'
    const input = [set('count', 3, count), hit('same', { attached: { conditions: [set('local', 3, count)], features: [] } }),
      hit('different', { attached: { conditions: [set('local', 2, count)], features: [] } }),
      hit('foreign', { resonatorId: '2', attached: { conditions: [set('local', 3, count)], features: [] } })]
    const result = settleConsumedWindows(input)
    expect(result[1].attached).toBeUndefined()
    expect(result[2]).toEqual(input[2])
    expect(result[3].attached).toBeUndefined()
    expect(settleConsumedWindows(input, new Set([`1|${count}`]))).toEqual(input)
    expect(settleConsumedWindows(result)).toEqual(result)
  })

  it('preserves conflicting local writes with partially matching attachments', () => {
    const feature = hit('conflict', { attached: { conditions: [set('true', true), set('false', false)], features: [] } })
    const input = [set('on', true), set('off', false), feature, set('regrant', true)]
    expect(settleConsumedWindows(input)).toEqual(input)
  })
})
