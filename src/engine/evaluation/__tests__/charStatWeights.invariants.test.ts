/*
  Author: Runor Ewhro
  Description: Guards generated character stat-weight catalog coverage and the
               ER, healer, and beta-inheritance utility contracts.
*/

import { describe, expect, it } from 'vitest'
import betaArtifact from '@/data/scoring/generated/charStatWeights.beta.json'
import liveArtifact from '@/data/scoring/generated/charStatWeights.live.json'
import betaCatalog from '../../../../public/data/beta/resonators/catalog.json'
import liveCatalog from '../../../../public/data/live/resonators/catalog.json'
import betaSources from '../../../../public/data/beta/resonators/sources.json'
import liveSources from '../../../../public/data/live/resonators/sources.json'
import { ER_IGNORED_IDS } from '@/engine/evaluation/energyRegenPolicy'

type CatalogEntry = (typeof betaCatalog)[number]

const ignoredEr = new Set<string>(ER_IGNORED_IDS)

function validateCatalog(
  artifact: typeof betaArtifact | typeof liveArtifact,
  catalog: CatalogEntry[],
  sources: typeof betaSources | typeof liveSources,
): void {
  const catalogIds = catalog.map((entry) => entry.id).sort()
  const healingIds = new Set(sources
    .filter((source) => source.skills.some((skill) => skill.aggregationType === 'healing'))
    .map((source) => source.source.id))
  expect(Object.keys(artifact.weights).sort()).toEqual(catalogIds)

  for (const resonator of catalog) {
    const weights = artifact.weights[resonator.id as keyof typeof artifact.weights]
    expect(weights, `${artifact.mode}:${resonator.id}`).toBeDefined()
    expect(Object.values(weights)).not.toHaveLength(0)
    for (const value of Object.values(weights)) {
      expect(Number.isFinite(value)).toBe(true)
      expect(value).toBeGreaterThan(0)
      expect(value).toBeLessThanOrEqual(1)
    }

    if (ignoredEr.has(resonator.id)) expect(weights).not.toHaveProperty('energyRegen')
    else expect(weights).toHaveProperty('energyRegen', 1)

    const isHealer = healingIds.has(resonator.id) && resonator.tags.some((tag) => tag.id === 'A1')
    if (isHealer) expect(weights).toHaveProperty('healingBonus', 1)
    else expect(weights).not.toHaveProperty('healingBonus')

    expect(weights).toHaveProperty(resonator.attribute, 1)
  }
}

describe('generated character stat weights', () => {
  it('covers each mode catalog and applies catalog-driven utility weights', () => {
    validateCatalog(liveArtifact, liveCatalog, liveSources)
    validateCatalog(betaArtifact, betaCatalog, betaSources)
  })

  it('keeps the shared roster identical when the live artifact is split from beta', () => {
    const betaWeights: Record<string, Record<string, number>> = betaArtifact.weights
    const liveWeights: Record<string, Record<string, number>> = liveArtifact.weights
    expect(betaArtifact.settings).toEqual(liveArtifact.settings)
    for (const resonator of liveCatalog) {
      expect(betaWeights[resonator.id]).toEqual(liveWeights[resonator.id])
    }
    expect(Object.keys(betaArtifact.weights)).toHaveLength(Object.keys(liveArtifact.weights).length + 2)
  })
})
