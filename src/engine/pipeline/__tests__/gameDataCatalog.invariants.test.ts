/*
  Author: Runor Ewhro
  Description: checks generated game-data catalogs for cross-file references
               that would otherwise fail only at runtime after ingestion changes.
*/

import { describe, expect, it } from 'vitest'
import { listResonators } from '@/domain/services/catalogService'
import { listSources } from '@/domain/services/gameDataService'

describe('game-data catalog invariants', () => {
  it('registers generated resonators, echoes, weapons, and echo sets as source packages', () => {
    // every generated catalog entry needs a matching source record so source
    // badges and source-state tooling can resolve provenance consistently
    const resonatorSources = listSources('resonator')
    const echoSources = listSources('echo')
    const weaponSources = listSources('weapon')
    const echoSetSources = listSources('echoSet')

    expect(resonatorSources.length).toBeGreaterThan(0)
    expect(echoSources.length).toBeGreaterThan(0)
    expect(weaponSources.length).toBeGreaterThan(0)
    expect(echoSetSources.length).toBeGreaterThan(0)

    const resonatorKeys = resonatorSources.map((source) => `${source.type}:${source.id}`)
    expect(new Set(resonatorKeys).size).toBe(resonatorKeys.length)

    for (const resonator of listResonators()) {
      expect(resonatorKeys).toContain(`resonator:${resonator.id}`)
    }
  })

  it('keeps generated damage-family skills on concrete hit arrays', () => {
    // damage math iterates hits directly; generated damage skills must not fall
    // back to implicit single-hit behavior or empty hit arrays
    for (const resonator of listResonators()) {
      for (const skill of resonator.skills) {
        if (skill.aggregationType !== 'damage') {
          continue
        }

        expect(Array.isArray(skill.hits)).toBe(true)
        expect(skill.hits.length).toBeGreaterThan(0)

        for (const hit of skill.hits) {
          expect(hit.count).toBeGreaterThan(0)
          expect(Number.isFinite(hit.multiplier)).toBe(true)
        }
      }
    }
  })

  it('keeps generated rotation feature refs aligned with the resonator feature catalog', () => {
    // default rotations are authored separately from feature generation, so
    // every feature node is checked against the final catalog id set
    for (const resonator of listResonators()) {
      const featureIds = new Set(resonator.features.map((feature) => feature.id))

      for (const rotation of resonator.rotations) {
        for (const item of rotation.items) {
          if (item.type !== 'feature') {
            continue
          }

          expect(featureIds.has(item.featureId)).toBe(true)
        }
      }
    }
  })
})
