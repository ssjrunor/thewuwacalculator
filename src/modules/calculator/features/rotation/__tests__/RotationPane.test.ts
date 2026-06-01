import { describe, expect, it } from 'vitest'
import type { DamageFeature, RotationNode } from '@/domain/gameData/contracts.ts'
import type { RotNspcEnt } from '@/engine/rotation/system'
import { makeInvRot } from '@/domain/entities/inventoryStorage.ts'
import {
  rmRotNode,
  trnsGrps,
  updRotNode,
} from '../lib/tree.ts'
import {
  applyLoopDrf,
  mkRotLoopInf,
  mkLoopLblGnr,
  getRotLpsCvr,
  type RotLoopInfo,
} from '../lib/loops.ts'
import {
  blckRotTms,
  lpfyRotTms,
} from '../lib/transforms.ts'
import {
  cllcSelRotNd,
  cllcVsblRotN,
  prsRotClpbPa,
  rmRotNds,
  serRotClpbPa,
  type RotClpbPay,
} from '../lib/helpers.ts'
import { mkWhenNspcRo } from '../lib/inspection.ts'
import { getNodeTotals, dsblByWhen } from '../lib/utils.ts'

function makeFeature(id: string, resonatorId = '1501'): Extract<RotationNode, { type: 'feature' }> {
  return {
    id,
    type: 'feature',
    featureId: `damage:${id}`,
    resonatorId,
    multiplier: 1,
    enabled: true,
  }
}

function makeCondition(id: string, resonatorId = '1501'): Extract<RotationNode, { type: 'condition' }> {
  return {
    id,
    type: 'condition',
    resonatorId,
    changes: [
      {
        type: 'set',
        path: `runtime.state.${id}`,
        value: true,
        resonatorId,
      },
    ],
    enabled: true,
  }
}

function makeResult(nodeId: string, avg: number, loopRuns?: Record<string, number>): DamageFeature {
  return {
    id: `${nodeId}:result:${avg}`,
    nodeId,
    normal: avg,
    crit: avg,
    avg,
    loopRuns,
  } as DamageFeature
}

function makeLoopInfo(loopId: string, label = loopId): RotLoopInfo {
  return {
    loopId,
    startNode: {
      id: `${loopId}:start`,
      type: 'loop',
      kind: 'start',
      loopId,
    },
    label,
    color: '#f59e0b',
    runs: 1,
    totals: { normal: 0, crit: 0, avg: 0 },
    complete: false,
    mode: 'wrap-start',
  }
}

describe('rotation pane helpers', () => {
  const rotationItems: RotationNode[] = [
    makeFeature('feature:root'),
    {
      id: 'repeat:block',
      type: 'repeat',
      times: 2,
      enabled: true,
      items: [
        makeFeature('feature:repeat'),
      ],
    },
    {
      id: 'uptime:block',
      type: 'uptime',
      ratio: 0.5,
      enabled: true,
      setup: [
        makeCondition('condition:setup'),
      ],
      items: [
        makeFeature('feature:uptime'),
      ],
    },
  ]

  it('collects only visible node ids when blocks are collapsed', () => {
    expect(
      cllcVsblRotN(rotationItems, {
        'repeat:block': true,
        'uptime:block': false,
      }),
    ).toEqual([
      'feature:root',
      'repeat:block',
      'uptime:block',
      'condition:setup',
      'feature:uptime',
    ])
  })

  it('collects only explicitly selected nodes without auto-including block children', () => {
    const onlyBlock = cllcSelRotNd(rotationItems, new Set(['uptime:block']))
    expect(onlyBlock.map((node) => node.id)).toEqual(['uptime:block'])

    const blockAndChild = cllcSelRotNd(rotationItems, new Set(['uptime:block', 'feature:uptime']))
    expect(blockAndChild.map((node) => node.id)).toEqual(['uptime:block', 'feature:uptime'])
  })

  it('removes only the selected live nodes from nested trees', () => {
    const nextItems = rmRotNds(rotationItems, new Set(['feature:root', 'feature:uptime']))

    expect(nextItems.map((node) => node.id)).toEqual(['repeat:block', 'uptime:block'])
    expect((nextItems[1] as Extract<RotationNode, { type: 'uptime' }>).setup?.map((node) => node.id)).toEqual(['condition:setup'])
    expect((nextItems[1] as Extract<RotationNode, { type: 'uptime' }>).items).toHaveLength(0)
  })

  it('updates loop marker enabled state as a pair', () => {
    const loopItems: RotationNode[] = [
      {
        id: 'loop:start',
        type: 'loop',
        kind: 'start',
        loopId: 'loop-a',
        enabled: true,
      },
      makeFeature('feature:inside'),
      {
        id: 'loop:end',
        type: 'loop',
        kind: 'end',
        loopId: 'loop-a',
        enabled: true,
      },
    ]

    const nextItems = updRotNode(loopItems, 'loop:end', (node) => (
      node.type === 'loop' ? { ...node, enabled: false } : node
    ))

    expect(nextItems[0]?.type === 'loop' ? nextItems[0].enabled : null).toBe(false)
    expect(nextItems[2]?.type === 'loop' ? nextItems[2].enabled : null).toBe(false)
  })

  it('deletes both loop markers only when removing the start marker', () => {
    const loopItems: RotationNode[] = [
      {
        id: 'loop:start',
        type: 'loop',
        kind: 'start',
        loopId: 'loop-a',
      },
      makeFeature('feature:inside'),
      {
        id: 'loop:end',
        type: 'loop',
        kind: 'end',
        loopId: 'loop-a',
      },
    ]

    expect(rmRotNode(loopItems, 'loop:start').map((node) => node.id)).toEqual(['feature:inside'])
    expect(rmRotNds(loopItems, new Set(['loop:start'])).map((node) => node.id)).toEqual(['feature:inside'])
  })

  it('deletes only the end marker when removing the end marker', () => {
    const loopItems: RotationNode[] = [
      {
        id: 'loop:start',
        type: 'loop',
        kind: 'start',
        loopId: 'loop-a',
      },
      makeFeature('feature:inside'),
      {
        id: 'loop:end',
        type: 'loop',
        kind: 'end',
        loopId: 'loop-a',
      },
    ]

    expect(rmRotNode(loopItems, 'loop:end').map((node) => node.id)).toEqual(['loop:start', 'feature:inside'])
    expect(rmRotNds(loopItems, new Set(['loop:end'])).map((node) => node.id)).toEqual(['loop:start', 'feature:inside'])
  })

  it('clears removed loop rules from node when config when deleting markers', () => {
    const loopItems: RotationNode[] = [
      {
        id: 'loop-a:start',
        type: 'loop',
        kind: 'start',
        loopId: 'loop-a',
      },
      {
        ...makeFeature('feature:inside'),
        when: {
          condition: { type: 'truthy', path: 'runtime.state.enabled' },
          loops: [
            { loopId: 'loop-a', runs: [1] },
            { loopId: 'loop-b', runs: [2] },
          ],
        },
      },
      {
        id: 'loop-a:end',
        type: 'loop',
        kind: 'end',
        loopId: 'loop-a',
      },
    ]

    const nextItems = rmRotNode(loopItems, 'loop-a:start')
    const feature = nextItems[0]

    expect(feature?.type === 'feature' ? feature.when?.condition?.type : null).toBe('truthy')
    expect(feature?.type === 'feature' ? feature.when?.loops : null).toEqual([{ loopId: 'loop-b', runs: [2] }])
  })

  it('clears loop-only when config when loop modal rows remove the loop', () => {
    const loopItems: RotationNode[] = [
      {
        id: 'loop-a:start',
        type: 'loop',
        kind: 'start',
        loopId: 'loop-a',
      },
      {
        ...makeFeature('feature:inside'),
        when: {
          loops: [{ loopId: 'loop-a', runs: [1] }],
        },
      },
      {
        id: 'loop-a:end',
        type: 'loop',
        kind: 'end',
        loopId: 'loop-a',
      },
    ]

    const nextItems = applyLoopDrf(loopItems, { parentId: null, branch: 'root' }, [])
    const feature = nextItems[0]

    expect(nextItems.map((node) => node.id)).toEqual(['feature:inside'])
    expect(feature?.type === 'feature' ? feature.when : null).toBeUndefined()
  })

  it('loopifies sibling groups with numbered loop labels', () => {
    const existingLoopStart: RotationNode = {
      id: 'loop:start',
      type: 'loop',
      kind: 'start',
      loopId: 'loop-a',
      label: 'Loop',
    }
    const items: RotationNode[] = [
      existingLoopStart,
      makeFeature('feature:first'),
      makeFeature('feature:second'),
    ]
    const nextLoopLabel = mkLoopLblGnr(items)

    const nextItems = trnsGrps(
      items,
      new Set(['feature:first', 'feature:second']),
      (nodes) => lpfyRotTms(nodes, { label: nextLoopLabel() }),
    )

    expect(nextItems.map((node) => node.type === 'loop' ? `${node.kind}:${node.kind === 'start' ? node.label : node.loopId}` : node.id)).toEqual([
      'start:Loop',
      'start:Loop 2',
      'feature:first',
      'feature:second',
      nextItems[1]?.type === 'loop' ? `end:${nextItems[1].loopId}` : 'end:missing',
    ])
  })

  it('blockifies selected sibling groups without moving unselected nodes', () => {
    const items: RotationNode[] = [
      makeFeature('feature:first'),
      makeFeature('feature:middle'),
      makeFeature('feature:last'),
    ]

    const nextItems = trnsGrps(
      items,
      new Set(['feature:first', 'feature:last']),
      (nodes) => blckRotTms(nodes, 'repeat'),
    )

    expect(nextItems).toHaveLength(3)
    expect(nextItems[0]?.type).toBe('repeat')
    expect(nextItems[1]?.id).toBe('feature:middle')
    expect(nextItems[2]?.type).toBe('repeat')
    expect(nextItems[0]?.type === 'repeat' ? nextItems[0].items.map((node) => node.id) : []).toEqual(['feature:first'])
    expect(nextItems[2]?.type === 'repeat' ? nextItems[2].items.map((node) => node.id) : []).toEqual(['feature:last'])
  })

  it('filters when-loop options to loops that cover the edited node', () => {
    const loopItems: RotationNode[] = [
      {
        id: 'loop-a:start',
        type: 'loop',
        kind: 'start',
        loopId: 'loop-a',
      },
      {
        id: 'repeat:inside',
        type: 'repeat',
        times: 1,
        enabled: true,
        items: [makeFeature('feature:inside')],
      },
      {
        id: 'loop-a:end',
        type: 'loop',
        kind: 'end',
        loopId: 'loop-a',
      },
      {
        id: 'loop-b:start',
        type: 'loop',
        kind: 'start',
        loopId: 'loop-b',
      },
      makeFeature('feature:outside'),
      {
        id: 'loop-b:end',
        type: 'loop',
        kind: 'end',
        loopId: 'loop-b',
      },
    ]

    expect(getRotLpsCvr(
      loopItems,
      'feature:inside',
      [makeLoopInfo('loop-a'), makeLoopInfo('loop-b')],
    ).map((loop) => loop.loopId)).toEqual(['loop-a'])
  })

  it('shows loop-covered feature totals from the first iteration context', () => {
    const feature = makeFeature('feature:looped')
    const resultMap = new Map<string, DamageFeature[]>([
      [
        feature.id,
        [
          makeResult(feature.id, 100, { 'loop-a': 1 }),
          makeResult(feature.id, 200, { 'loop-a': 2 }),
          makeResult(feature.id, 300, { 'loop-a': 3 }),
        ],
      ],
    ])

    expect(getNodeTotals(feature, resultMap)).toEqual({
      normal: 100,
      crit: 100,
      avg: 100,
    })
  })

  it('shows nested loop feature totals only when every active loop is on its first iteration', () => {
    const feature = makeFeature('feature:nested-looped')
    const resultMap = new Map<string, DamageFeature[]>([
      [
        feature.id,
        [
          makeResult(feature.id, 100, { 'loop-a': 1, 'loop-b': 1 }),
          makeResult(feature.id, 200, { 'loop-a': 1, 'loop-b': 2 }),
          makeResult(feature.id, 300, { 'loop-a': 2, 'loop-b': 1 }),
        ],
      ],
    ])

    expect(getNodeTotals(feature, resultMap)).toEqual({
      normal: 100,
      crit: 100,
      avg: 100,
    })
  })

  it('treats a when-skipped feature as visually disabled for the displayed iteration', () => {
    const feature: Extract<RotationNode, { type: 'feature' }> = {
      ...makeFeature('feature:when-looped'),
      when: {
        loops: [{ loopId: 'loop-a', runs: [2] }],
      },
    }
    const resultMap = new Map<string, DamageFeature[]>([
      [
        feature.id,
        [
          makeResult(feature.id, 200, { 'loop-a': 2 }),
        ],
      ],
    ])

    expect(getNodeTotals(feature, resultMap)).toEqual({
      normal: 0,
      crit: 0,
      avg: 0,
    })
    expect(dsblByWhen(feature, resultMap)).toBe(true)
  })

  it('reports loop marker totals as average damage per iteration', () => {
    const loopItems: RotationNode[] = [
      {
        id: 'loop-a:start',
        type: 'loop',
        kind: 'start',
        loopId: 'loop-a',
        runs: 3,
      },
      makeFeature('feature:looped'),
      {
        id: 'loop-a:end',
        type: 'loop',
        kind: 'end',
        loopId: 'loop-a',
      },
    ]

    const loopInfo = mkRotLoopInf(loopItems, [
      makeResult('feature:looped', 100, { 'loop-a': 1 }),
      makeResult('feature:looped', 200, { 'loop-a': 2 }),
      makeResult('feature:looped', 300, { 'loop-a': 3 }),
    ]).loops[0]

    expect(loopInfo?.totals).toEqual({
      normal: 200,
      crit: 200,
      avg: 200,
    })
  })

  it('builds disabled inspector rows for missing loop contexts', () => {
    const loopStart: Extract<RotationNode, { type: 'loop'; kind: 'start' }> = {
      id: 'loop-a:start',
      type: 'loop',
      kind: 'start',
      loopId: 'loop-a',
      label: 'Loop A',
      runs: 3,
    }
    const loopItems: RotationNode[] = [
      loopStart,
      {
        ...makeCondition('condition:looped'),
        when: {
          loops: [{ loopId: 'loop-a', runs: [2] }],
        },
      },
      {
        id: 'loop-a:end',
        type: 'loop',
        kind: 'end',
        loopId: 'loop-a',
      },
    ]

    const rows = mkWhenNspcRo({
      items: loopItems,
      node: loopItems[1]!,
      allLoops: [{
        ...makeLoopInfo('loop-a', 'Loop A'),
        startNode: loopStart,
        runs: 3,
        complete: true,
      }],
      traces: [{
        nodeId: 'condition:looped',
        nodeType: 'condition',
        executed: true,
        loopRuns: { 'loop-a': 2 },
        loopRunCnts: { 'loop-a': 3 },
        value: {
          kind: 'condition',
          path: 'runtime.state.condition:looped',
          value: true,
        },
      } satisfies RotNspcEnt],
      choices: [{
        id: 'choice:looped',
        resonatorId: '1501',
        resName: 'Test',
        sourceName: 'Test',
        label: 'Looped State',
        state: {
          id: 'state:looped',
          source: { type: 'resonator', id: '1501' },
          ownerKey: 'resonator:1501',
          controlKey: 'condition:looped',
          path: 'runtime.state.condition:looped',
          label: 'Looped State',
          kind: 'toggle',
        },
      }],
    })

    expect(rows.map((row) => ({
      label: row.label,
      disabled: row.disabled,
      valueText: row.valueText ?? null,
    }))).toEqual([
      { label: 'Loop A #1/3', disabled: true, valueText: null },
      { label: 'Loop A #2/3', disabled: false, valueText: 'True' },
      { label: 'Loop A #3/3', disabled: true, valueText: null },
    ])
  })

  it('mirrors loop end inspector rows from the linked start marker', () => {
    const loopStart: Extract<RotationNode, { type: 'loop'; kind: 'start' }> = {
      id: 'loop-a:start',
      type: 'loop',
      kind: 'start',
      loopId: 'loop-a',
      label: 'Loop A',
      runs: 2,
    }
    const loopEnd: Extract<RotationNode, { type: 'loop'; kind: 'end' }> = {
      id: 'loop-a:end',
      type: 'loop',
      kind: 'end',
      loopId: 'loop-a',
    }

    const rows = mkWhenNspcRo({
      items: [loopStart, makeFeature('feature:inside'), loopEnd],
      node: loopEnd,
      allLoops: [{
        ...makeLoopInfo('loop-a', 'Loop A'),
        startNode: loopStart,
        runs: 2,
        complete: true,
      }],
      traces: [{
        nodeId: loopStart.id,
        nodeType: 'loop',
        executed: true,
        value: {
          kind: 'loop',
          markerKind: 'start',
          label: 'Loop A',
          runs: 2,
        },
      } satisfies RotNspcEnt],
      choices: [],
    })

    expect(rows.map((row) => ({
      label: row.label,
      disabled: row.disabled,
      valueText: row.valueText,
    }))).toEqual([
      { label: 'Loop A #1/2', disabled: false, valueText: '2 times' },
      { label: 'Loop A #2/2', disabled: false, valueText: '2 times' },
    ])
  })

  it('serializes and parses multi-entry saved rotation clipboard payloads', () => {
    const savedEntries = [
      makeInvRot({
        name: 'Alpha Rotation',
        mode: 'personal',
        resonatorId: '1501',
        resonatorName: 'Alpha',
        items: [makeFeature('feature:alpha')],
        duration: 12,
        note: 'First',
      }, 1000),
      makeInvRot({
        name: 'Bravo Rotation',
        mode: 'team',
        resonatorId: '1603',
        resonatorName: 'Bravo',
        team: ['1604', null, null],
        items: [makeCondition('condition:bravo'), makeFeature('feature:bravo', '1604')],
        duration: 24,
        note: 'Second',
      }, 2000),
    ]

    const payload: RotClpbPay = {
      kind: 'rotation-clipboard',
      version: 1,
      source: 'saved',
      mode: savedEntries[0].mode,
      resonatorId: savedEntries[0].resonatorId,
      resName: savedEntries[0].resonatorName,
      items: [...savedEntries[0].items, ...savedEntries[1].items],
      name: savedEntries[0].name,
      duration: savedEntries[0].duration,
      note: savedEntries[0].note,
      savedEntries,
    }

    const parsed = prsRotClpbPa(serRotClpbPa(payload))

    expect(parsed?.savedEntries).toHaveLength(2)
    expect(parsed?.savedEntries?.map((entry) => entry.name)).toEqual(['Alpha Rotation', 'Bravo Rotation'])
    expect(parsed?.items).toHaveLength(3)
    expect(parsed?.savedEntries?.[1]?.items).toHaveLength(2)
  })

  it('keeps legacy single-entry saved clipboard payloads readable', () => {
    const savedEntry = makeInvRot({
      name: 'Legacy Rotation',
      mode: 'personal',
      resonatorId: '1501',
      resonatorName: 'Alpha',
      items: [makeFeature('feature:legacy')],
    }, 3000)

    const parsed = prsRotClpbPa(JSON.stringify({
      kind: 'rotation-clipboard',
      version: 1,
      source: 'saved',
      mode: savedEntry.mode,
      resonatorId: savedEntry.resonatorId,
      resonatorName: savedEntry.resonatorName,
      items: savedEntry.items,
      savedEntry,
    }))

    expect(parsed?.savedEntries).toHaveLength(1)
    expect(parsed?.savedEntries?.[0]?.name).toBe('Legacy Rotation')
    expect(parsed?.items).toHaveLength(1)
  })
})
