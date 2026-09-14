/*
  Author: Runor Ewhro
  Description: What the editor's search has to find, and in what order.
*/

import { describe, expect, it } from 'vitest'
import {
  buildNodeIndex,
  searchNodes,
} from '@/modules/simulation/features/rotation/program-editor/interaction/nodeSearch.ts'
import type {
  EditorNode,
  EditorSection,
} from '@/modules/simulation/features/rotation/program-editor/model/program.ts'

const owner = { kind: 'member', memberId: 'qingxiao' } as const

const step = (id: string, label: string, extra: Partial<EditorNode> = {}) => ({
  type: 'step',
  id,
  owner,
  label,
  index: 0,
  damageByRun: {},
  statsByRun: {},
  normalDamageByRun: {},
  critDamageByRun: {},
  skillTypeLabel: 'Heavy Atk',
  talentNodeLabel: 'Forte Circuit',
  kindLabel: 'forteCircuit',
  buffCount: 0,
  ...extra,
}) as unknown as EditorNode

const sections = (): EditorSection[] => [
  {
    id: 'main',
    title: 'Main',
    children: [
      step('a', 'Basic Attack Stage 1 DMG', {
        skillTypeLabel: 'Basic Atk',
        talentNodeLabel: 'Normal Atk',
      }),
      {
        type: 'loop',
        id: 'loop-1',
        owner,
        label: 'Loop 1',
        runs: 4,
        children: [
          step('b', 'Heavy Attack - Inversion DMG'),
          {
            type: 'condition',
            id: 'c',
            owner,
            label: 'Tune Strain',
            sourceName: 'Sonata',
          } as unknown as EditorNode,
          // a handoff has no `label` and no `owner`: it is only from and to
          { type: 'swap', id: 's', from: 'qingxiao', to: 'denia' } as unknown as EditorNode,
        ],
      } as unknown as EditorNode,
    ],
  } as unknown as EditorSection,
]

const MEMBERS: Record<string, string> = { qingxiao: 'Qingxiao', denia: 'Denia' }
const names = {
  owner: () => 'Qingxiao',
  member: (id: string) => MEMBERS[id] ?? '',
}

describe('editor node search', () => {
  it('indexes every node in the order it runs, with where it sits', () => {
    const index = buildNodeIndex(sections(), names)
    expect(index.map((entry) => entry.id)).toEqual(['a', 'loop-1', 'b', 'c', 's'])
    expect(index.find((entry) => entry.id === 'b')?.crumb).toBe('Main / Loop 1')
  })

  it('finds a step by name and marks the span that matched', () => {
    const hits = searchNodes(buildNodeIndex(sections(), names), 'inversion')
    expect(hits).toHaveLength(1)
    expect(hits[0].id).toBe('b')
    expect(hits[0].title.slice(hits[0].from, hits[0].to)).toBe('Inversion')
    expect(hits[0].via).toBeNull()
  })

  it('ranks a match at the start of a name above one further in', () => {
    const hits = searchNodes(buildNodeIndex(sections(), names), 'attack')
    expect(hits.map((hit) => hit.id)).toEqual(['a', 'b'])
  })

  it('finds a node by what it is when the name does not say so', () => {
    const hits = searchNodes(buildNodeIndex(sections(), names), 'forte')
    expect(hits.map((hit) => hit.id)).toEqual(['b'])
    // reported as found some other way, so the hit can say why it is there
    expect(hits[0].via).toContain('Forte Circuit')
  })

  it('finds states and blocks, not only steps', () => {
    const index = buildNodeIndex(sections(), names)
    expect(searchNodes(index, 'tune')[0]).toMatchObject({ id: 'c', kind: 'state' })
    expect(searchNodes(index, 'loop')[0]).toMatchObject({ id: 'loop-1', kind: 'block' })
  })

  it('normalizes underscores in loop labels and exposes every run variant', () => {
    const hit = searchNodes(buildNodeIndex(sections(), names), 'loop_1')[0]

    expect(hit).toMatchObject({
      id: 'loop-1',
      target: { nodeId: 'loop-1' },
      loop: { id: 'loop-1', runs: 4 },
    })
    expect(hit.target.loopRuns).toBeUndefined()
  })

  it('parses a trailing loop run into an exact navigation target', () => {
    expect(searchNodes(buildNodeIndex(sections(), names), 'loop_1 3')[0]).toMatchObject({
      id: 'loop-1',
      target: { nodeId: 'loop-1', loopRuns: { 'loop-1': 3 } },
      loop: { id: 'loop-1', runs: 4, requestedRun: 3 },
    })
    expect(searchNodes(buildNodeIndex(sections(), names), 'loop_1 5')).toEqual([])
  })

  it('keeps an ordinary spaced search for a numbered loop on its general view', () => {
    expect(searchNodes(buildNodeIndex(sections(), names), 'loop 1')[0].target)
      .toEqual({ nodeId: 'loop-1' })
  })

  it('finds an attached note, and hangs it off its host', () => {
    const withNote = sections()
    const host = withNote[0].children[0] as EditorNode & {
      attachedNote?: { type: 'note'; id: string; text: string }
    }
    host.attachedNote = { type: 'note', id: 'n1', text: 'swap out before the burst' }

    const hits = searchNodes(buildNodeIndex(withNote, names), 'burst')
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({ id: 'n1', kind: 'note' })
    expect(hits[0].crumb).toBe('Main / Basic Attack Stage 1 DMG')
  })

  it('names a handoff by who takes the field, since it carries no label', () => {
    const index = buildNodeIndex(sections(), names)
    // the whole index has to survive a query, not just the labelled half
    expect(() => searchNodes(index, 'x')).not.toThrow()
    expect(searchNodes(index, 'denia')[0]).toMatchObject({ id: 's', kind: 'swap' })
  })

  it('answers an empty query with nothing rather than everything', () => {
    expect(searchNodes(buildNodeIndex(sections(), names), '   ')).toEqual([])
  })
})
