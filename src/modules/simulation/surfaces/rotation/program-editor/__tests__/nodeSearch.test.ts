/*
  Author: Runor Ewhro
  description: what the editor's search has to find, and in what order.
*/

import { describe, expect, it } from 'vitest'
import {
  buildNodeIndex,
  searchNodes,
} from '@/modules/simulation/surfaces/rotation/program-editor/interaction/nodeSearch.ts'
import type {
  EditorNode,
  EditorSection,
} from '@/modules/simulation/surfaces/rotation/program-editor/model/program.ts'

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

  it('names an unlabelled handoff by the incoming member', () => {
    const index = buildNodeIndex(sections(), names)
    // the whole index has to survive a query, not just the labelled half
    expect(() => searchNodes(index, 'x')).not.toThrow()
    expect(searchNodes(index, 'denia')[0]).toMatchObject({ id: 's', kind: 'swap' })
  })
})
