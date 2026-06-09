/*
  Author: Runor Ewhro
  Description: Validates the max-state-path enumerator against real resonator
               data — confirming the divergence classifier yields the expected
               number of distinct maximal state configurations per resonator.
*/

import { describe, expect, it } from 'vitest'
import { getResDtlsBy } from '@/data/gameData/resonators/resonatorDataStore'
import { getResonatorById } from '@/domain/services/catalogService'
import { makeResRuntime } from '@/domain/state/defaults'
import { enumerateMaxStatePaths, maxStateDivergences } from './maxStatePaths'

function pathsFor(resonatorId: string, targetSequence = 6) {
  const seed = getResonatorById(resonatorId)
  if (!seed) {
    throw new Error(`missing resonator ${resonatorId}`)
  }

  const details = getResDtlsBy()[resonatorId]
  return enumerateMaxStatePaths(makeResRuntime(seed), details, { targetSequence })
}

describe('enumerateMaxStatePaths', () => {
  // [id, name, expected distinct max-state configs]
  const cases: Array<[string, string, number]> = [
    ['1109', 'Lucilla', 2], // glacio_chafe vs echo mode
    ['1508', 'Chisa', 1], // no exclusive groups → single max path
    ['1210', 'Aemeath', 2], // tune_rupture vs fusion_burst
    ['1308', 'Rebecca', 3], // huntress / guts / a_girl_gets_what_she_wants
    ['1506', 'Phoebe', 2], // absolution vs confession (none excluded)
    ['1211', 'Denia', 2], // fusion_burst vs tune_strain
  ]

  it.each(cases)('%s (%s) yields %i distinct max paths', (id, _name, expected) => {
    const paths = pathsFor(id)
    expect(paths.length).toBe(expected)
    // every emitted path is a genuinely distinct control configuration
    expect(new Set(paths.map((path) => path.signature)).size).toBe(paths.length)
  })

  it('Lucilla branches glacio vs echo on the mode control', () => {
    const paths = pathsFor('1109')
    const modes = paths
      .map((path) => path.runtime.state.controls['resonator:1109:mode:value'])
      .sort()
    expect(modes).toEqual(['echo', 'glacio_chafe'])
  })

  it('Rebecca exposes all three gear branches as distinct max states', () => {
    const gears = ['huntress', 'guts', 'a_girl_gets_what_she_wants'] as const
    const paths = pathsFor('1308')
    const activeGear = paths.map((path) =>
      gears.find((gear) => path.runtime.state.controls[`resonator:1308:${gear}:active`] === true),
    )
    expect(new Set(activeGear)).toEqual(new Set(gears))
  })

  it('excludes the none branch by default but can include it', () => {
    const phoebe = getResDtlsBy()['1506']
    expect(maxStateDivergences(phoebe).flatMap((d) => d.options)).not.toContain('none')
    expect(maxStateDivergences(phoebe, { includeNone: true }).flatMap((d) => d.options)).toContain('none')
  })

  it('keeps the mode-branch count stable across sequence (s0 and s6)', () => {
    expect(pathsFor('1109', 0).length).toBe(2)
    expect(pathsFor('1109', 6).length).toBe(2)
  })

  it('a resonator with no exclusive groups returns exactly one max path', () => {
    const paths = pathsFor('1508')
    expect(paths).toHaveLength(1)
    expect(paths[0].pins).toEqual({})
  })
})
