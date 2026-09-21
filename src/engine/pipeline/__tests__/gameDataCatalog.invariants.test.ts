/*
  Author: Runor Ewhro
  Description: checks generated game-data catalogs for cross-file references
               that would otherwise fail only at runtime after ingestion changes.
*/

import { describe, expect, it } from 'vitest'
import { listEchoes, listResonators } from '@/data/catalog/catalogService'
import { listSources } from '@/data/catalog/gameDataService'

const CANONICAL_LEGACY_ECHO_IDS = [
  '390070067',
  '390070068',
  '390070069',
  '390070076',
  '390077013',
  '390077022',
  '390077024',
]

const NON_CATALOG_ECHO_ALIASES = [
  '6020002',
  '6020004',
  '6020006',
  '6020007',
  '6020012',
  '6020019',
  '6020025',
]

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

  it('keeps canonical Echo ids instead of same-name combat aliases', () => {
    // The upstream Encore index exposes PhantomType 2 combat records before
    // these real Echoes. Keeping the aliases drops the authored multiplier and
    // behavior packages keyed by the canonical ids.
    const catalogIds = new Set(listEchoes().map((echo) => echo.id))
    const sourceIds = new Set(listSources('echo').map((source) => source.id))

    for (const echoId of CANONICAL_LEGACY_ECHO_IDS) {
      expect(catalogIds.has(echoId), `canonical Echo ${echoId} is missing from the catalog`).toBe(true)
      expect(sourceIds.has(echoId), `canonical Echo ${echoId} is missing its source package`).toBe(true)
    }

    for (const echoId of NON_CATALOG_ECHO_ALIASES) {
      expect(catalogIds.has(echoId), `combat alias ${echoId} leaked into the Echo catalog`).toBe(false)
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
