import { describe, expect, it } from 'vitest'
import { buildGameDataRegistry } from '@/domain/gameData/registry'
import { makeControlKey, makeControlPath, makeOwnerKey, parseControlKey, parseOwnerKey } from '@/domain/gameData/stateKeys'
import type { SourcePackage } from '@/domain/gameData/contracts'

describe('state keying', () => {
  it('builds and parses owner keys', () => {
    const ownerKey = makeOwnerKey('sequence', '1506', 's4')

    expect(ownerKey).toBe('sequence:1506:s4')
    expect(parseOwnerKey(ownerKey)).toEqual({
      scope: 'sequence',
      sourceId: '1506',
      ownerId: 's4',
    })
  })

  it('builds and parses control keys', () => {
    const ownerKey = makeOwnerKey('sequence', '1506', 's4')
    const controlKey = makeControlKey(ownerKey, 'active')

    expect(controlKey).toBe('sequence:1506:s4:active')
    expect(makeControlPath(controlKey)).toBe('runtime.state.controls.sequence:1506:s4:active')
    expect(parseControlKey(controlKey)).toEqual({
      ownerKey: 'sequence:1506:s4',
      stateId: 'active',
    })
  })

  it('indexes states and effects by owner and control key', () => {
    const ownerKey = makeOwnerKey('sequence', '1506', 's4')
    const controlKey = makeControlKey(ownerKey, 'active')
    const source: SourcePackage = {
      source: {
        type: 'resonator',
        id: '1506',
      },
      owners: [
        {
          id: 's4',
          label: 'Node 4',
          source: {
            type: 'resonator',
            id: '1506',
          },
          scope: 'sequence',
          kind: 'sequence',
          ownerKey,
        },
      ],
      states: [
        {
          id: 'active',
          label: 'Node 4 Active',
          source: {
            type: 'resonator',
            id: '1506',
          },
          ownerKey,
          controlKey,
          path: makeControlPath(controlKey),
          kind: 'toggle',
          defaultValue: false,
        },
      ],
      conditions: [
        {
          id: 's4-active-condition',
          label: 'Node 4 Active',
          source: {
            type: 'resonator',
            id: '1506',
          },
          ownerKey,
          controlKey,
          path: makeControlPath(controlKey),
          kind: 'toggle',
          defaultValue: false,
        },
      ],
      effects: [
        {
          id: '1506:s4:crit-dmg',
          label: 'Node 4 Crit DMG',
          source: {
            type: 'resonator',
            id: '1506',
          },
          ownerKey,
          trigger: 'runtime',
          operations: [
            {
              type: 'add_top_stat',
              stat: 'critDmg',
              value: {
                type: 'const',
                value: 20,
              },
            },
          ],
        },
      ],
    }

    const registry = buildGameDataRegistry([source])

    expect(registry.ownersByKey[ownerKey]?.label).toBe('Node 4')
    expect(registry.statesByControlKey[controlKey]?.label).toBe('Node 4 Active')
    expect(registry.statesByOwnerKey[ownerKey]?.map((state) => state.id)).toEqual(['active'])
    expect(registry.conditionsByOwnerKey[ownerKey]?.map((condition) => condition.id)).toEqual([
      's4-active-condition',
    ])
    expect(registry.effectsByOwnerKey[ownerKey]?.map((effect) => effect.id)).toEqual([
      '1506:s4:crit-dmg',
    ])
  })
})
