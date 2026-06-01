/*
  Author: Runor Ewhro
  Description: builds combinadic lookup data for optimizer combo ranking and
               unranking across both full and locked-main search modes.
*/

import { ECHOES_PER_SET } from '@/engine/optimizer/config/constants.ts'

const MAX_U32 = 0xFFFFFFFF

function clampU32(value: number): number {
  return value > MAX_U32 ? MAX_U32 : value
}

export interface ComboIndex {
  comboN: number
  comboK: number
  totalCombos: number
  indexMap: Int32Array
  binom: Uint32Array
  lockedIndex?: number
}

// build a flattened binomial table so hot search code can rank and unrank
// combinations without recomputing coefficients repeatedly
export function mkCmbnTbl(n: number, kMax = ECHOES_PER_SET): Uint32Array {
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

// build the shared indexing bundle for one already-filtered candidate id list
export function mkCmbnNdxn(indexMap: Int32Array, comboK: number): ComboIndex {
  const comboN = indexMap.length
  const binom = mkCmbnTbl(comboN, Math.max(comboK, ECHOES_PER_SET))
  const totalCombos = binom[comboN * (Math.max(comboK, ECHOES_PER_SET) + 1) + comboK]

  return {
    comboN,
    comboK,
    totalCombos,
    indexMap,
    binom,
  }
}

export function mkTailCmbNdx(totalEchoes: number, mainIndex: number): ComboIndex {
  const indexMap = new Int32Array(totalEchoes - 1)
  let cursor = 0

  for (let index = 0; index < totalEchoes; index += 1) {
    if (index === mainIndex) {
      continue
    }

    indexMap[cursor] = index
    cursor += 1
  }

  return mkCmbnNdxn(indexMap, ECHOES_PER_SET - 1)
}

export function mkOptCmbnNdx(options: {
  echoCount: number
  lockEchoIdx?: number | null
}): ComboIndex {
  const n = options.echoCount
  const lockedIndex = options.lockEchoIdx ?? -1

  if (lockedIndex < 0) {
    const indexMap = new Int32Array(n)
    for (let i = 0; i < n; i += 1) {
      indexMap[i] = i
    }
    return {
      ...mkCmbnNdxn(indexMap, ECHOES_PER_SET),
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
    ...mkCmbnNdxn(indexMap, ECHOES_PER_SET - 1),
    lockedIndex,
  }
}

export function nrnkCmbn(
  rankInput: number,
  comboIndex: ComboIndex,
  maxSize = comboIndex.lockedIndex != null && comboIndex.lockedIndex >= 0
    ? ECHOES_PER_SET
    : comboIndex.comboK,
): Int32Array {
  const out = new Int32Array(maxSize)
  return nrnkCmbnInto(rankInput, comboIndex, out, maxSize)
}

export function nrnkCmbnInto(
  rankInput: number,
  comboIndex: ComboIndex,
  out: Int32Array,
  maxSize = out.length,
): Int32Array {
  const { comboN, comboK, indexMap, binom, lockedIndex = -1 } = comboIndex
  const stride = Math.max(comboK, ECHOES_PER_SET) + 1

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

export function nrnkCmbnPstn(
  rankInput: number,
  comboIndex: ComboIndex,
  out: Int32Array,
): Int32Array {
  const { comboN, comboK, binom } = comboIndex
  const stride = Math.max(comboK, ECHOES_PER_SET) + 1

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

export function fillCmbnEcho(
  comboIndex: ComboIndex,
  positions: Int32Array,
  out: Int32Array,
  maxSize = out.length,
): Int32Array {
  const { comboK, indexMap, lockedIndex = -1 } = comboIndex
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

export function dvncCmbnPstn(
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
