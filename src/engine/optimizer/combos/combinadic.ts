import { OPTIMIZER_ECHOS_PER_COMBO } from '@/engine/optimizer/config/constants.ts'

const MAX_U32 = 0xFFFFFFFF

function clampU32(value: number): number {
  return value > MAX_U32 ? MAX_U32 : value
}

export interface CombinadicIndexing {
  comboN: number
  comboK: number
  totalCombos: number
  indexMap: Int32Array
  binom: Uint32Array
  lockedIndex?: number
}

export function buildCombinadicTable(n: number, kMax = OPTIMIZER_ECHOS_PER_COMBO): Uint32Array {
  const stride = kMax + 1
  const out = new Uint32Array((n + 1) * stride)

  for (let i = 0; i <= n; i += 1) {
    out[i * stride] = 1
  }

  for (let k = 1; k <= kMax; k += 1) {
    out[k] = 0
  }

  for (let i = 1; i <= n; i += 1) {
    for (let k = 1; k <= kMax; k += 1) {
      const without = out[(i - 1) * stride + k]
      const withItem = out[(i - 1) * stride + (k - 1)]
      out[i * stride + k] = clampU32(without + withItem)
    }
  }

  return out
}

export function buildCombinadicIndexing(indexMap: Int32Array, comboK: number): CombinadicIndexing {
  const comboN = indexMap.length
  const binom = buildCombinadicTable(comboN, Math.max(comboK, OPTIMIZER_ECHOS_PER_COMBO))
  const totalCombos = binom[comboN * (Math.max(comboK, OPTIMIZER_ECHOS_PER_COMBO) + 1) + comboK]

  return {
    comboN,
    comboK,
    totalCombos,
    indexMap,
    binom,
  }
}

export function buildTailComboIndexing(totalEchoes: number, mainIndex: number): CombinadicIndexing {
  const indexMap = new Int32Array(totalEchoes - 1)
  let cursor = 0

  for (let index = 0; index < totalEchoes; index += 1) {
    if (index === mainIndex) {
      continue
    }

    indexMap[cursor] = index
    cursor += 1
  }

  return buildCombinadicIndexing(indexMap, OPTIMIZER_ECHOS_PER_COMBO - 1)
}

export function buildOptimizerCombinadicIndexing(options: {
  echoCount: number
  lockedEchoIndex?: number | null
}): CombinadicIndexing {
  const n = options.echoCount
  const lockedIndex = options.lockedEchoIndex ?? -1

  if (lockedIndex < 0) {
    const indexMap = new Int32Array(n)
    for (let i = 0; i < n; i += 1) {
      indexMap[i] = i
    }
    return {
      ...buildCombinadicIndexing(indexMap, OPTIMIZER_ECHOS_PER_COMBO),
      lockedIndex: -1,
    }
  }

  const indexMap = new Int32Array(n - 1)
  let cursor = 0
  for (let i = 0; i < n; i += 1) {
    if (i === lockedIndex) continue
    indexMap[cursor] = i
    cursor += 1
  }

  return {
    ...buildCombinadicIndexing(indexMap, OPTIMIZER_ECHOS_PER_COMBO - 1),
    lockedIndex,
  }
}

export function unrankCombinadic(
  rankInput: number,
  comboIndexing: CombinadicIndexing,
  maxSize = comboIndexing.lockedIndex != null && comboIndexing.lockedIndex >= 0
    ? OPTIMIZER_ECHOS_PER_COMBO
    : comboIndexing.comboK,
): Int32Array {
  const out = new Int32Array(maxSize)
  return unrankCombinadicInto(rankInput, comboIndexing, out, maxSize)
}

export function unrankCombinadicInto(
  rankInput: number,
  comboIndexing: CombinadicIndexing,
  out: Int32Array,
  maxSize = out.length,
): Int32Array {
  const { comboN, comboK, indexMap, binom, lockedIndex = -1 } = comboIndexing
  const stride = Math.max(comboK, OPTIMIZER_ECHOS_PER_COMBO) + 1

  out.fill(-1)

  let rank = rankInput >>> 0
  let start = 0
  let remainingK = comboK

  for (let pos = 0; pos < comboK; pos += 1) {
    for (let i = start; i < comboN; i += 1) {
      const remaining = comboN - i - 1
      const count = binom[remaining * stride + (remainingK - 1)]
      if (rank >= count) {
        rank -= count
        continue
      }

      out[pos] = indexMap[i]
      start = i + 1
      remainingK -= 1
      break
    }
  }

  if (lockedIndex >= 0 && comboK < maxSize) {
    out[maxSize - 1] = lockedIndex
  }

  return out
}

export function unrankCombinadicPositionsInto(
  rankInput: number,
  comboIndexing: CombinadicIndexing,
  out: Int32Array,
): Int32Array {
  const { comboN, comboK, binom } = comboIndexing
  const stride = Math.max(comboK, OPTIMIZER_ECHOS_PER_COMBO) + 1

  out.fill(-1)

  let rank = rankInput >>> 0
  let start = 0
  let remainingK = comboK

  for (let pos = 0; pos < comboK; pos += 1) {
    for (let i = start; i < comboN; i += 1) {
      const remaining = comboN - i - 1
      const count = binom[remaining * stride + (remainingK - 1)]
      if (rank >= count) {
        rank -= count
        continue
      }

      out[pos] = i
      start = i + 1
      remainingK -= 1
      break
    }
  }

  return out
}

export function fillCombinadicEchoIdsFromPositions(
  comboIndexing: CombinadicIndexing,
  positions: Int32Array,
  out: Int32Array,
  maxSize = out.length,
): Int32Array {
  const { comboK, indexMap, lockedIndex = -1 } = comboIndexing
  out.fill(-1)

  for (let pos = 0; pos < comboK; pos += 1) {
    const position = positions[pos]
    if (position < 0 || position >= indexMap.length) {
      break
    }
    out[pos] = indexMap[position]
  }

  if (lockedIndex >= 0 && comboK < maxSize) {
    out[maxSize - 1] = lockedIndex
  }

  return out
}

export function advanceCombinadicPositionsInPlace(
  positions: Int32Array,
  comboN: number,
  comboK: number,
): boolean {
  for (let index = comboK - 1; index >= 0; index -= 1) {
    const maxVal = comboN - comboK + index
    if (positions[index] >= maxVal) {
      continue
    }

    positions[index] += 1
    for (let tail = index + 1; tail < comboK; tail += 1) {
      positions[tail] = positions[tail - 1] + 1
    }
    return true
  }

  return false
}
