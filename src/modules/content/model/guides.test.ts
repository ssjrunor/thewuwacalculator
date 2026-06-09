import { describe, expect, it } from 'vitest'
import { gdCtgr } from '@/data/content/guidesContent'
import { resGdCtgr } from '@/modules/content/model/guides'

function collectAllBlocks() {
  return gdCtgr.flatMap((category) =>
    category.articles.flatMap((article) =>
      article.sections.flatMap((section) => section.blocks),
    ),
  )
}

function categoryText(id: string) {
  return JSON.stringify(gdCtgr.find((category) => category.id === id))
}

describe('guides content', () => {
  it('resolves legacy category names through aliases', () => {
    expect(resGdCtgr(gdCtgr, 'OverviewLayer')?.id).toBe('overview-and-build-state')
    expect(resGdCtgr(gdCtgr, 'Damage & Scaling')?.id).toBe('damage-results')
    expect(resGdCtgr(gdCtgr, 'Random Echoes')?.id).toBe('suggestions')
    expect(resGdCtgr(gdCtgr, 'Build and Echo Scoring')?.id).toBe('scoring-and-stat-weights')
  })

  it('gives every category at least one article with authored sections', () => {
    for (const category of gdCtgr) {
      expect(category.articles.length).toBeGreaterThan(0)

      for (const article of category.articles) {
        expect(article.sections.length).toBeGreaterThan(0)

        for (const section of article.sections) {
          expect(section.blocks.length).toBeGreaterThan(0)
        }
      }
    }
  })

  it('uses the richer reference block set across the authored manual', () => {
    const types = new Set(collectAllBlocks().map((block) => block.type))

    const requiredTypes = [
      'paragraph',
      'bullets',
      'definitions',
      'note',
      'formula',
      'example',
      'steps',
      'comparison',
      'statTable',
      'warningList',
      'image',
    ] as const

    for (const type of requiredTypes) {
      expect(types.has(type)).toBe(true)
    }
  })

  it('keeps the most technical chapters expanded enough to be real references', () => {
    expect(gdCtgr.find((category) => category.id === 'rotations')?.articles.length).toBeGreaterThanOrEqual(7)
    expect(gdCtgr.find((category) => category.id === 'damage-results')?.articles.length).toBeGreaterThanOrEqual(5)
    expect(gdCtgr.find((category) => category.id === 'scoring-and-stat-weights')?.articles.length).toBeGreaterThanOrEqual(5)
    expect(gdCtgr.find((category) => category.id === 'suggestions')?.articles.length).toBeGreaterThanOrEqual(5)
    expect(gdCtgr.find((category) => category.id === 'optimizer')?.articles.length).toBeGreaterThanOrEqual(5)
  })

  it('documents loop normalization and stat structure explicitly', () => {
    const rotations = gdCtgr.find((category) => category.id === 'rotations')
    const scoring = gdCtgr.find((category) => category.id === 'scoring-and-stat-weights')

    const rotationText = JSON.stringify(rotations)
    const scoringText = JSON.stringify(scoring)

    expect(rotationText).toContain('normalized')
    expect(rotationText).toContain('loop run count')
    expect(scoringText).toContain('Final = base x (1 + percent) + flat')
    expect(scoringText).toContain('Crit Rate x 2 plus Crit Damage')
  })

  it('documents current surface-specific controls in the owning guide categories', () => {
    const optimizer = categoryText('optimizer')
    const resonators = categoryText('resonators')
    const echoes = categoryText('echoes')
    const teamEffects = categoryText('team-effects')
    const overview = categoryText('overview-and-build-state')

    expect(optimizer).toContain('Exclude equipped')
    expect(optimizer).toContain('Include weapons')
    expect(resonators).toContain('mode/status')
    expect(resonators).toContain('Max button')

    expect(echoes).not.toContain('Exclude equipped')
    expect(teamEffects).not.toContain('mode/status')
    expect(overview).not.toContain('Max button')
  })
})
