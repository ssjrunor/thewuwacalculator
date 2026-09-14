/*
  Author: Runor Ewhro
  Description: Pins what the rotation engine computes for real authored
               rotations, so the execution path can be rewritten for speed and
               still be proven to produce the same numbers. Score mode and
               capture mode are both pinned, because they are two readings of
               one execution and are expected to agree.
*/

import { describe, expect, it } from 'vitest'
import { makeEnemy, makeResRuntime } from '@/domain/state/defaults'
import { getResSeedBy } from '@/domain/services/resonatorSeedService'
import { listResRttn } from '@/domain/services/gameDataService'
import { prepareResSimulation } from '@/engine/pipeline'
import type { RotationNode } from '@/domain/gameData/contracts'
import {
  executeRotationProgram,
  executeRotationScore,
  prepareRunEnv,
  prepareRotationProgram,
  type RunEnvironment,
  type PreparedRotationProgram,
} from '@/engine/rotation/execute.ts'
import {
  packTape,
  recordRotationTape,
  replayTape,
  replayTapeBatch,
  unpackTape,
} from '@/engine/rotation/experimental/tape.ts'
import { NUMERIC_FINAL_CELL_COUNT } from '@/engine/rotation/numericLayout.ts'
import fixture from './fixtures/rotationScores.json'

interface PinnedRotation {
  kind: 'saved' | 'preset'
  name: string
  resonatorId: string
  team: (string | null)[] | null
  nodes: number
  score: { normal: number; crit: number; avg: number }
  resonators: Array<{ id: string; avg: number }>
  capture: { entries: number; avg: number }
}

const pinned = fixture.rotations as PinnedRotation[]

/** Relative comparison: these are damage totals in the millions. */
function expectClose(actual: number, expected: number, label: string): void {
  const tolerance = Math.max(Math.abs(expected) * 1e-9, 1e-6)
  expect(Math.abs(actual - expected), `${label}: ${actual} vs pinned ${expected}`)
    .toBeLessThanOrEqual(tolerance)
}

function checkAgainstPin(
  environment: RunEnvironment,
  program: PreparedRotationProgram,
  pin: PinnedRotation,
): void {
  const score = executeRotationScore(environment, program)
  expectClose(score.total.normal, pin.score.normal, `${pin.name} normal`)
  expectClose(score.total.crit, pin.score.crit, `${pin.name} crit`)
  expectClose(score.total.avg, pin.score.avg, `${pin.name} avg`)

  const byId = new Map(score.resonators.map((entry) => [entry.id, entry.avg]))
  for (const expected of pin.resonators) {
    expectClose(byId.get(expected.id) ?? 0, expected.avg, `${pin.name} ${expected.id} avg`)
  }

  const captured = executeRotationProgram(environment, program, { detail: 'summary' })
  expect(captured.entries.length, `${pin.name} captured rows`).toBe(pin.capture.entries)
  expectClose(
    captured.entries.reduce((sum, entry) => sum + entry.avg, 0),
    pin.capture.avg,
    `${pin.name} captured avg`,
  )

  /*
    A recorded tape is the same execution read back. It has to agree with the
    interpreter exactly, or replaying it is scoring a different rotation.
  */
  const tape = recordRotationTape(environment, program)
  expect(tape.replayDomain).toBe('final-stat-planes')
  const replayed = replayTape(tape)
  expectClose(replayed.total.normal, pin.score.normal, `${pin.name} replay normal`)
  expectClose(replayed.total.crit, pin.score.crit, `${pin.name} replay crit`)
  expectClose(replayed.total.avg, pin.score.avg, `${pin.name} replay avg`)
  const replayedById = new Map(replayed.resonators.map((entry) => [entry.id, entry.avg]))
  for (const expected of pin.resonators) {
    expectClose(replayedById.get(expected.id) ?? 0, expected.avg, `${pin.name} replay ${expected.id}`)
  }

  /*
    A batch is only worth having if a variant inside it scores the same as it
    would alone, so two copies of the recorded planes must produce two copies
    of the recorded score.
  */
  const stride = tape.planeCount * NUMERIC_FINAL_CELL_COUNT
  const planeSets = new Float64Array(stride * 2)
  planeSets.set(tape.planes, 0)
  planeSets.set(tape.planes, stride)
  const width = (tape.resonatorIds.length + 1) * 3
  const batch = replayTapeBatch(tape, planeSets)
  for (const variant of [0, 1]) {
    expectClose(batch[variant * width + 2] ?? 0, pin.score.avg, `${pin.name} batch variant ${variant}`)
  }

  // and a tape that has been packed for a worker is still the same tape
  const roundTripped = replayTape(unpackTape(packTape(tape)))
  expectClose(roundTripped.total.avg, pin.score.avg, `${pin.name} packed replay avg`)
}

describe('rotation execution parity', () => {
  const presets = pinned.filter((entry) => entry.kind === 'preset')

  it.each(presets.map((pin) => [pin.name, pin] as const))(
    'preset rotation %s matches its pinned totals',
    (_name, pin) => {
      const seed = getResSeedBy(pin.resonatorId)
      expect(seed, `missing seed ${pin.resonatorId}`).toBeTruthy()
      const rotation = seed!.rotations?.[0] ?? listResRttn(pin.resonatorId)[0] ?? null
      expect(rotation?.items.length, `missing rotation for ${pin.resonatorId}`).toBeTruthy()

      const runtime = makeResRuntime(seed!)
      const prepared = prepareResSimulation(runtime, seed!, makeEnemy(), {}, {})
      const environment = prepareRunEnv(prepared.context, seed!)
      const program = prepareRotationProgram(rotation!.items as RotationNode[])

      checkAgainstPin(environment, program, pin)
    },
  )
})
