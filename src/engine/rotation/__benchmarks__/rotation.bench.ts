/*
  Author: Runor Ewhro
  Description: Measures rotation execution throughput and allocation costs.
*/

import { bench, describe } from 'vitest'
import { makeEnemy, makeResRuntime } from '@/domain/state/defaults.ts'
import { getResSeedBy } from '@/domain/services/resonatorSeedService.ts'
import { listResRttn } from '@/domain/services/gameDataService.ts'
import { prepareResSimulation } from '@/engine/pipeline/index.ts'
import {
  executeRotationProgram,
  executeRotationScore,
  prepareRunEnv,
  prepareRotationProgram,
} from '@/engine/rotation/execute.ts'
import type { RotationNode } from '@/domain/gameData/contracts.ts'

const seed = getResSeedBy('1108')
if (!seed) throw new Error('Missing Hiyuki rotation benchmark seed')
const runtime = makeResRuntime(seed)
const authored = (seed.rotations?.[0] ?? listResRttn(seed.id)[0])?.items as RotationNode[] | undefined
if (!authored?.length) throw new Error('Missing Hiyuki authored rotation benchmark')
const { context } = prepareResSimulation(runtime, seed, makeEnemy())
const environment = prepareRunEnv(context, seed)
const prepared = prepareRotationProgram(structuredClone(authored))
const complex = prepareRotationProgram([{
  id: 'benchmark-repeat',
  type: 'repeat',
  times: 12,
  items: structuredClone(authored),
}])

describe('rotation execution', () => {
  bench('cold program lowering', () => {
    prepareRotationProgram(structuredClone(authored))
  })

  bench('baseline rowless score', () => {
    executeRotationScore(environment, prepared)
  })

  bench('baseline detailed projection trace', () => {
    executeRotationProgram(environment, prepared, { inspect: true, includeSnapshots: true })
  })

  bench('complex rowless score', () => {
    executeRotationScore(environment, complex)
  })
})
