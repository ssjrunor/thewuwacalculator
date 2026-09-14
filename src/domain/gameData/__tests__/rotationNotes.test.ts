/*
  Author: Runor Ewhro
  Description: Verifies the rotationNotes.test behavior and its compatibility invariants.
*/

import { describe, expect, it } from 'vitest'
import type { RotationNode } from '@/domain/gameData/contracts.ts'
import {
  attachRotationNote,
  detachRotationNote,
  stripRotationNotes,
} from '@/domain/gameData/rotationNotes.ts'

describe('stripRotationNotes', () => {
  it('attaches only once and detaches without changing the host identity', () => {
    const host: Extract<RotationNode, { type: 'feature' }> = {
      id: 'hit',
      type: 'feature',
      featureId: 'skill-a',
    }
    const first = { id: 'first', type: 'note' as const, text: 'First' }
    const second = { id: 'second', type: 'note' as const, text: 'Second' }

    const attached = attachRotationNote(host, first)

    expect(attachRotationNote(attached, second)).toBe(attached)
    expect(detachRotationNote(attached)).toEqual(host)
    expect(detachRotationNote(host)).toBe(host)
  })

  it('removes standalone and owned notes from every execution branch', () => {
    const items: RotationNode[] = [
      { id: 'root-note', type: 'note', label: 'Opening', text: 'Display only' },
      {
        id: 'loop-start',
        type: 'loop',
        kind: 'start',
        loopId: 'loop-a',
        runs: 2,
        note: { id: 'loop-note', type: 'note', text: 'Loop note' },
        passForks: {
          '2': [{ id: 'fork-note', type: 'note', text: 'Fork only' }],
        },
      },
      {
        id: 'repeat',
        type: 'repeat',
        times: 2,
        note: { id: 'repeat-note', type: 'note', text: 'Repeat note' },
        items: [
          { id: 'body-note', type: 'note', text: 'Body note' },
          {
            id: 'uptime',
            type: 'uptime',
            ratio: 0.5,
            note: { id: 'uptime-note', type: 'note', text: 'Uptime note' },
            setup: [{ id: 'setup-note', type: 'note', text: 'Setup note' }],
            items: [{
            id: 'hit',
            type: 'feature',
            featureId: 'skill-a',
            note: { id: 'hit-note', type: 'note', text: 'Hit note' },
            attached: {
              conditions: [{
                id: 'attached-condition',
                type: 'condition',
                changes: [],
                note: { id: 'condition-note', type: 'note', text: 'Condition note' },
              }],
              features: [{
                id: 'attached-feature',
                type: 'feature',
                featureId: 'skill-b',
                note: { id: 'feature-note', type: 'note', text: 'Feature note' },
              }],
            },
          }],
          },
        ],
      },
      { id: 'loop-end', type: 'loop', kind: 'end', loopId: 'loop-a' },
    ]

    const stripped = stripRotationNotes(items)

    expect(stripped.map((node) => node.id)).toEqual(['loop-start', 'repeat', 'loop-end'])
    const start = stripped[0]
    const repeat = stripped[1]
    expect(start?.type === 'loop' && start.kind === 'start' ? start.note : null).toBeUndefined()
    expect(start?.type === 'loop' && start.kind === 'start' ? start.passForks?.['2'] : null)
      .toEqual([])
    expect(repeat?.type === 'repeat' ? repeat.note : null).toBeUndefined()
    expect(repeat?.type === 'repeat' ? repeat.items.map((node) => node.id) : null)
      .toEqual(['uptime'])
    const uptime = repeat?.type === 'repeat' ? repeat.items[0] : undefined
    expect(uptime?.type === 'uptime' ? uptime.setup : null).toEqual([])
    expect(uptime?.type === 'uptime' ? uptime.items[0] : null)
      .not.toHaveProperty('note')
    const hit = uptime?.type === 'uptime' ? uptime.items[0] : undefined
    expect(hit?.type === 'feature' ? hit.attached?.conditions[0] : null)
      .not.toHaveProperty('note')
    expect(hit?.type === 'feature' ? hit.attached?.features[0] : null)
      .not.toHaveProperty('note')

    expect(items[0]).toHaveProperty('type', 'note')
    expect(items[1]).toHaveProperty('note.id', 'loop-note')
  })
})
