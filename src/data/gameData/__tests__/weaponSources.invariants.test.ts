/*
  Author: Runor Ewhro
  description: checks that generated weapon controls and effect reads stay connected.
*/

import { describe, expect, it } from 'vitest'
import type { SrcPkg } from '@/domain/gameData/contracts.ts'
import betaSourcesRaw from '../../../../public/data/beta/weapons/sources.json?raw'
import liveSourcesRaw from '../../../../public/data/live/weapons/sources.json?raw'

const MODES = [
  ['beta', betaSourcesRaw],
  ['live', liveSourcesRaw],
] as const

function collectControlPaths(value: unknown, paths = new Set<string>()): Set<string> {
  if (!value || typeof value !== 'object') return paths
  if (Array.isArray(value)) {
    for (const entry of value) collectControlPaths(entry, paths)
    return paths
  }

  const record = value as Record<string, unknown>
  if (
    record.from === 'sourceRuntime' &&
    typeof record.path === 'string' &&
    record.path.startsWith('state.controls.weapon:')
  ) {
    paths.add(record.path)
  }
  for (const entry of Object.values(record)) collectControlPaths(entry, paths)
  return paths
}

describe('generated weapon source invariants', () => {
  it.each(MODES)('%s keeps every authored control connected to its effects', (_mode, sourcesRaw) => {
    const sources = JSON.parse(sourcesRaw) as SrcPkg[]

    for (const source of sources.filter((candidate) => candidate.source.type === 'weapon')) {
      const declared = new Set((source.states ?? []).map((state) => state.path.replace(/^runtime\./, '')))
      const referenced = collectControlPaths(source.effects ?? [])

      expect(
        [...referenced].filter((path) => !declared.has(path)),
        `${source.source.id} references an undeclared weapon control`,
      ).toEqual([])
      expect(
        [...declared].filter((path) => !referenced.has(path)),
        `${source.source.id} declares a weapon control that no effect reads`,
      ).toEqual([])
    }
  })
})
