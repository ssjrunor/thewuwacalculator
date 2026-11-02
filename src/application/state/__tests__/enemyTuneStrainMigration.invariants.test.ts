/*
  Author: Runor Ewhro
  description: preserves enemy stack counts and nested rotation references
               when retiring Nameless Explorer's duplicate Tune Strain field.
*/

import { describe, expect, it } from 'vitest'
import { parseScenarioTarget, parseScenarioProgram } from '@/engine/runtime/schema'
import { migrateLegacyEnemyProfile, migrateLegacyEnemyStatePaths } from '@/domain/gameData/enemyStateMigration'
import { cloneEnemyPr } from '@/engine/runtime/runtimeCloning'
import { makeAppState, makeEnemy } from '@/engine/runtime/defaults'
import { parsePersisted } from '@/application/persistence/storage'
import { makeSavedRotation, makeSavedScenario } from '@/domain/entities/inventoryStorage'
import { normalizeImportedRotationEntries } from '@/application/imports/rotationPayload'
import type { RotationNode } from '@/domain/gameData/contracts'

const oldPath = 'enemy.status.tuneStrainInterfered'
const newPath = 'enemy.status.tuneStrain'
const condition = (id: string, path = oldPath): Extract<RotationNode, { type: 'condition' }> => ({
  id, type: 'condition', changes: [{ type: 'set', path, value: 3 }],
})

describe('shared enemy Tune Strain migration', () => {
  it.each([[0, 3, 3], [4, 2, 4], [2, 4, 4], [0, 0, 0]])(
    'merges shared %s and legacy %s stacks as %s, without adding them', (shared, legacy, expected) => {
      const enemy = { ...makeEnemy(), id: '340000260', status: { tuneStrain: shared, tuneStrainInterfered: legacy, frostbind: true } }
      const parsed = parseScenarioTarget(enemy)
      expect(parsed.success).toBe(true)
      expect(parsed.data?.status).toEqual({ tuneStrain: expected, frostbind: true })
      expect(cloneEnemyPr(enemy).status).toEqual(parsed.data?.status)
      expect(migrateLegacyEnemyProfile(parsed.data)).toBe(parsed.data)
      expect(enemy.status.tuneStrainInterfered).toBe(legacy)
    },
  )

  it('accepts legacy-only counts without concealing malformed shared values', () => {
    const enemy = { ...makeEnemy(), status: { tuneStrainInterfered: '3' } }
    expect(parseScenarioTarget(enemy).data?.status).toEqual({ tuneStrain: 3 })
    expect(parseScenarioTarget({ ...enemy, status: { tuneStrain: 'bad', tuneStrainInterfered: 3 } }).success).toBe(false)
    expect(parseScenarioTarget({ ...enemy, status: { tuneStrain: 2, tuneStrainInterfered: 'bad' } }).data?.status).toEqual({ tuneStrain: 2 })
  })

  it('redirects nested writes and formula reads while preserving annotation text', () => {
    const items: RotationNode[] = [
      { id: 'annotation', type: 'note', text: oldPath },
      { id: 'repeat', type: 'repeat', times: { type: 'read', from: 'context', path: oldPath }, setup: [condition('repeat-setup')], items: [
        { id: 'uptime', type: 'uptime', ratio: 0.5, setup: [condition('uptime-setup', `context.${oldPath}`)], items: [condition('body')] },
      ] },
      { id: 'hit', type: 'feature', featureId: 'damage:1209001', attached: { conditions: [condition('attached')], features: [] } },
      { id: 'loop-start', type: 'loop', kind: 'start', loopId: 'loop', runs: 2, passForks: { '2': [condition('fork')] } },
      condition('loop-body'),
      { id: 'loop-end', type: 'loop', kind: 'end', loopId: 'loop' },
    ]
    const parsed = parseScenarioProgram({ sequence: items, program: items, lastRanAt: null })
    expect(parsed.success).toBe(true)
    const serialized = JSON.stringify(parsed.data)
    expect(serialized).not.toContain(`"path":"${oldPath}"`)
    expect(serialized).not.toContain(`"path":"context.${oldPath}"`)
    expect(serialized).toContain(`"path":"${newPath}"`)
    expect(serialized).toContain(`"path":"context.${newPath}"`)
    expect(serialized).toContain(`"text":"${oldPath}"`)
    expect(JSON.stringify(items)).toContain(`"path":"${oldPath}"`)
    expect(migrateLegacyEnemyStatePaths({ path: 'enemy.status.paradox' })).toEqual({ path: 'enemy.status.paradox' })
  })

  it('migrates working scenarios, saved rotations, saved scenarios, and rotation shares', () => {
    const state = makeAppState()
    const scenario = state.combat.scenariosById[state.combat.selectedScenarioId]
    scenario.target = { ...makeEnemy(), id: '340000260', source: 'catalog', status: { tuneStrain: 0, tuneStrainInterfered: 3 } }
    scenario.program = { sequence: [], program: [condition('saved-condition')], lastRanAt: null }
    state.library.rotations = [makeSavedRotation({ name: 'Legacy stacks', scenario })]
    state.library.scenarios = [makeSavedScenario({ name: 'Legacy scenario', scenario })]
    const loaded = parsePersisted(JSON.stringify(state))
    for (const migrated of [
      loaded.combat.scenariosById[loaded.combat.selectedScenarioId],
      loaded.library.rotations[0].scenario,
      loaded.library.scenarios[0].scenario,
      normalizeImportedRotationEntries(state.library.rotations[0])[0].scenario,
    ]) {
      expect(migrated.target.status).toEqual({ tuneStrain: 3 })
      expect(migrated.program.program[0]).toMatchObject({ changes: [{ path: newPath, value: 3 }] })
    }
    const roundTrip = parsePersisted(JSON.stringify(loaded))
    expect(roundTrip.combat.scenariosById[roundTrip.combat.selectedScenarioId].target.status).toEqual({ tuneStrain: 3 })
  })
})
