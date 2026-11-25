/*
  Author: Runor Ewhro
  description: tests generated rotation cleanup: the shared planner, exact pass
               boundaries, and preserved attached features.
*/

import { describe, expect, it } from 'vitest'
import type { RotationNode } from '@/domain/gameData/contracts.ts'
import { cleanupGeneratedRotation } from '../editor/cleanup.ts'
import { packSections } from '../editorProgram.ts'
import { planRotationCleanup } from '@/engine/rotation/cleanup.ts'
import { planRotationCleanup as editorCleanup } from '@/modules/simulation/surfaces/rotation/program-editor/model/cleanup.ts'

const path = 'runtime.state.controls.test:clarity'
const setter = (id: string, value: boolean, owner = '1506'): Extract<RotationNode, { type: 'condition' }> => ({
  id, type: 'condition', resonatorId: owner, changes: [{ type: 'set', path, value, resonatorId: owner }],
})
const hit = (id: string, value?: boolean): Extract<RotationNode, { type: 'feature' }> => ({
  id, type: 'feature', resonatorId: '1506', featureId: 'damage:1506001', multiplier: 1,
  ...(value == null ? {} : { attached: { conditions: [setter(`${id}:local`, value)], features: [] } }),
})
const section = (pass: number): RotationNode => ({ id: `section:${pass}`, type: 'note', text: `__plan_section_${pass}__` })

describe('generated rotation cleanup', () => {
  it('shares one cleanup planner with the editor', () => {
    expect(editorCleanup).toBe(planRotationCleanup)
  })

  it('moves a trailing setter ahead of a whole hit run and preserves attached feature identities', () => {
    const attached = hit('extra')
    const first = hit('one', true)
    first.attached!.features = [attached]
    const input = [setter('opening', false), section(0), first, hit('two', true), setter('on', true), hit('three')]
    const before = structuredClone(input)
    const cleaned = cleanupGeneratedRotation(input)
    expect(input).toEqual(before)
    expect(cleaned.items.map(node => node.id)).toEqual(['opening', 'section:0', 'on', 'one', 'two', 'three'])
    expect(cleaned.items[3]).toEqual({ ...first, attached: { conditions: [], features: [attached] } })
    expect(cleaned.items[4]).toEqual(hit('two'))
    expect(cleaned.counts).toMatchObject({ reordered: 1, detached: 2 })
    expect(cleanupGeneratedRotation(cleaned.items)).toEqual({ items: cleaned.items,
      counts: { inert: 0, dead: 0, redundant: 0, reordered: 0, detached: 0, total: 0 } })
  })

  it('keeps the preamble and four distinct pass bodies, including a necessary later attachment', () => {
    const opening = { ...setter('opening', true), editorSection: 'preamble' as const }
    const input = [opening, section(0), setter('on', true), hit('opener', true), section(1),
      hit('loop2', true), section(2), hit('loop3', false), setter('off', false), section(3), hit('loop4', true)]
    const cleaned = cleanupGeneratedRotation(input)
    expect(cleaned.items[0]).toBe(opening)
    expect(cleaned.items.find(node => node.id === 'opener')).toEqual(hit('opener'))
    // known values reset at each pass boundary
    expect(cleaned.items.find(node => node.id === 'loop2')).toEqual(hit('loop2', true))
    expect(cleaned.items.find(node => node.id === 'loop4')).toEqual(hit('loop4', true))
    const packed = packSections(cleaned.items) as RotationNode[]
    const loop = packed.find(node => node.type === 'loop' && node.kind === 'start')!
    expect(loop).toMatchObject({ runs: 4, passForks: {
      2: [hit('loop2', true)], 3: [setter('off', false), hit('loop3')], 4: [hit('loop4', true)],
    } })
  })

  it('keeps attachments from another source, named attachments, and stack-specific hits', () => {
    const other = hit('other', true)
    other.attached!.conditions = [setter('other:local', true, '1509')]
    const named = hit('named', true)
    named.attached!.conditions![0].label = 'Keep this annotation'
    const stacks = { ...hit('stacks', true), negativeEffectStacks: 13 }
    const input = [section(0), setter('on', true), other, named, stacks]
    expect(cleanupGeneratedRotation(input).items).toEqual(input)
  })

  it('moves a setter forward when the neighbouring prior is known and keeps its final value', () => {
    const input = [section(0), setter('before', true), setter('early', false), hit('one', true), hit('two', true), hit('later')]
    const cleaned = cleanupGeneratedRotation(input)
    expect(cleaned.items.map(node => node.id)).toEqual(['section:0', 'before', 'one', 'two', 'early', 'later'])
    expect(cleaned.items.filter(node => node.type === 'feature')).toEqual([hit('one'), hit('two'), hit('later')])
  })

  it('leaves setters on recipient-sensitive controls in place', () => {
    const input = [section(0), setter('before', true), setter('early', false), hit('one', true)]
    expect(cleanupGeneratedRotation(input, new Set([`1506|${path}`])).items).toEqual(input)
  })

  it('keeps a cap-enabling control before the status write that reads its cap', () => {
    const status: RotationNode = { id: 'bane', type: 'condition', changes: [
      { type: 'set', path: 'enemy.combat.havocBane', value: 6 },
    ] }
    const input = [section(0), setter('before', false), setter('cap-on', true), status, hit('tail', false)]
    expect(cleanupGeneratedRotation(input).items).toEqual(input)
  })

  it('treats a stack write with authored dynamic bounds as dependent', () => {
    const counterPath = 'runtime.state.controls.counter'
    const counter: RotationNode = { id: 'counter', type: 'condition', resonatorId: '1506', changes: [
      { type: 'set', path: counterPath, value: 6, resonatorId: '1506' },
    ] }
    const input = [section(0), setter('before', false), setter('cap-on', true), counter, hit('tail', false)]
    const cleaned = cleanupGeneratedRotation(input, new Set(), [{ resonatorId: '1506', state: {
      id: 'counter', label: 'Counter', source: { type: 'resonator', id: '1506' }, ownerKey: 'counter',
      controlKey: 'counter', path: counterPath, kind: 'stack', max: 3,
      maxWhen: [{ when: { type: 'eq', from: 'sourceRuntime', path: 'state.controls.test:clarity', value: true }, max: 6 }],
    } }])
    expect(cleaned.items).toEqual(input)
  })
})
