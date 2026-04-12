/*
  Author: Runor Ewhro
  Description: Stores the shared Sonata set-conditional selection format used
               by Suggestions and Optimizer, mirroring the legacy setData flow.
*/

export type RawSonataSetConditionals = Record<number, Record<string, boolean>>

export interface CompactSonataSetConditionals {
  version: 1
  encoding: 'bitset-v1'
  keys: string[]
  setIds: number[]
  wordsPerSet: number
  masks: number[]
}

export type SonataSetConditionals = CompactSonataSetConditionals

export const DEFAULT_SONATA_SET_PART_SELECTION: RawSonataSetConditionals = {
  1: { twoPiece: true, frost5pc: true },
  2: { twoPiece: true, molten5: true },
  3: { twoPiece: true, void5pc: true },
  4: { twoPiece: true, sierra5: true },
  5: { twoPiece: true, celestial5: true },
  6: { twoPiece: true, eclipse5pc: true },
  7: { twoPiece: true, rejuvenating5: true },
  8: { twoPiece: true },
  9: { twoPiece: true, fivePiece: true, lingering5p1: true },
  10: { twoPiece: true, frosty5p1: true, frosty5p2: true },
  11: { twoPiece: true, radiance5p1: true, radiance5p2: true },
  12: { twoPiece: true },
  13: { twoPiece: true, fivePiece: true, empyrean5: true },
  14: { twoPiece: true, fivePiece: true },
  16: { twoPiece: true, welkin5: true },
  17: { twoPiece: true, windward5: true },
  18: { twoPiece: true, clawprint5: true },
  19: { dreamOfTheLost3pc: true },
  20: { crownOfValor3pc: true },
  21: { lawOfHarmony3p: true },
  22: { flamewingsShadow2pcP1: true, flamewingsShadow2pcP2: true },
  23: { threadOfSeveredFate3pc: true },
  24: { twoPiece: true },
  25: { twoPiece: true, starryRadiance5pc: true },
  26: { twoPiece: true, gildedRevelationStacks: true, gildedRevelationBasicBuff: true },
  27: { twoPiece: true, trailblazingStar5pc: true },
  28: { twoPiece: true, chromaticFoamSelf: true },
  29: { twoPiece: true, soundOfTrueName5pc: true },
}

const BIT_WORD_SIZE = 32
const COMPACT_ENCODING = 'bitset-v1'
const DEFAULT_COMPACT_VERSION = 1 as const
const compactIndexCache = new WeakMap<CompactSonataSetConditionals, {
  setRowById: Map<number, number>
  bitByKey: Map<string, number>
}>()

export function convertRawSonataSetConditionalsToCompact(
    rawSelection: RawSonataSetConditionals = DEFAULT_SONATA_SET_PART_SELECTION,
): CompactSonataSetConditionals {
  const source = (rawSelection && typeof rawSelection === 'object')
    ? rawSelection
    : {}

  const setIds = Object.keys(source)
    .map((setId) => Number(setId))
    .filter((setId) => Number.isFinite(setId))
    .sort((a, b) => a - b)

  const keys: string[] = []
  const keyToBit = new Map<string, number>()

  for (const setId of setIds) {
    const setParts = source[setId]
    if (!setParts || typeof setParts !== 'object') {
      continue
    }

    for (const [partKey, checked] of Object.entries(setParts)) {
      if (typeof checked !== 'boolean' || keyToBit.has(partKey)) {
        continue
      }

      keyToBit.set(partKey, keys.length)
      keys.push(partKey)
    }
  }

  const wordsPerSet = Math.ceil(keys.length / BIT_WORD_SIZE)
  const masks = new Array(setIds.length * wordsPerSet).fill(0)

  for (let row = 0; row < setIds.length; row += 1) {
    const setId = setIds[row]
    const setParts = source[setId]
    if (!setParts || typeof setParts !== 'object') {
      continue
    }

    for (const [partKey, checked] of Object.entries(setParts)) {
      if (!checked) {
        continue
      }

      const bitIndex = keyToBit.get(partKey)
      if (bitIndex == null) {
        continue
      }

      const wordIndex = bitIndex >>> 5
      const bitMask = (1 << (bitIndex & 31)) >>> 0
      const offset = row * wordsPerSet + wordIndex
      masks[offset] = ((masks[offset] >>> 0) | bitMask) >>> 0
    }
  }

  return {
    version: DEFAULT_COMPACT_VERSION,
    encoding: COMPACT_ENCODING,
    keys,
    setIds,
    wordsPerSet,
    masks,
  }
}

export const DEFAULT_SONATA_SET_CONDITIONALS =
  convertRawSonataSetConditionalsToCompact(DEFAULT_SONATA_SET_PART_SELECTION)

export function isCompactSonataSetConditionals(value: unknown): value is CompactSonataSetConditionals {
  return !!value
    && typeof value === 'object'
    && (value as { encoding?: unknown }).encoding === COMPACT_ENCODING
    && Array.isArray((value as { keys?: unknown }).keys)
    && Array.isArray((value as { setIds?: unknown }).setIds)
    && Array.isArray((value as { masks?: unknown }).masks)
    && Number.isInteger((value as { wordsPerSet?: unknown }).wordsPerSet)
    && Number((value as { wordsPerSet?: unknown }).wordsPerSet) >= 0
}

function getCompactIndexes(compactSelection: CompactSonataSetConditionals) {
  const cached = compactIndexCache.get(compactSelection)
  if (cached) {
    return cached
  }

  const indexes = {
    setRowById: new Map(compactSelection.setIds.map((setId, row) => [Number(setId), row])),
    bitByKey: new Map(compactSelection.keys.map((partKey, bitIndex) => [partKey, bitIndex])),
  }

  compactIndexCache.set(compactSelection, indexes)
  return indexes
}

export function getCompactSonataSetPart(
    compactSelection: CompactSonataSetConditionals,
    setId: number,
    partKey: string,
    fallback = false,
): boolean {
  if (compactSelection.wordsPerSet === 0) {
    return fallback
  }

  const indexes = getCompactIndexes(compactSelection)
  const row = indexes.setRowById.get(Number(setId))
  const bitIndex = indexes.bitByKey.get(partKey)
  if (row == null || bitIndex == null) {
    return fallback
  }

  const wordIndex = bitIndex >>> 5
  if (wordIndex >= compactSelection.wordsPerSet) {
    return fallback
  }

  const offset = row * compactSelection.wordsPerSet + wordIndex
  if (offset < 0 || offset >= compactSelection.masks.length) {
    return fallback
  }

  const word = compactSelection.masks[offset] >>> 0
  return ((word >>> (bitIndex & 31)) & 1) === 1
}

function createEmptyCompactMasks(setCount: number, wordsPerSet: number): number[] {
  return new Array(Math.max(0, setCount * wordsPerSet)).fill(0)
}

function normalizeCompactMasks(
    compactSelection: CompactSonataSetConditionals,
    keys: string[],
    setIds: number[],
    wordsPerSet: number,
): number[] {
  const masks = createEmptyCompactMasks(setIds.length, wordsPerSet)
  const sourceWordsPerSet = Math.max(0, compactSelection.wordsPerSet)

  if (sourceWordsPerSet === 0 || wordsPerSet === 0) {
    return masks
  }

  const wordsToCopy = Math.min(sourceWordsPerSet, wordsPerSet)
  const sourceSetIds = compactSelection.setIds.map((setId) => Number(setId))

  for (let sourceRow = 0; sourceRow < sourceSetIds.length; sourceRow += 1) {
    const targetRow = setIds.indexOf(sourceSetIds[sourceRow])
    if (targetRow < 0) {
      continue
    }

    for (let wordIndex = 0; wordIndex < wordsToCopy; wordIndex += 1) {
      const sourceOffset = sourceRow * sourceWordsPerSet + wordIndex
      const targetOffset = targetRow * wordsPerSet + wordIndex
      masks[targetOffset] = compactSelection.masks[sourceOffset] >>> 0
    }
  }

  for (let bitIndex = keys.length; bitIndex < wordsPerSet * BIT_WORD_SIZE; bitIndex += 1) {
    const wordIndex = bitIndex >>> 5
    const bitMask = (1 << (bitIndex & 31)) >>> 0
    for (let row = 0; row < setIds.length; row += 1) {
      const offset = row * wordsPerSet + wordIndex
      masks[offset] = (masks[offset] & ~bitMask) >>> 0
    }
  }

  return masks
}

export function withCompactSonataSetUpdates(
    compactSelection: CompactSonataSetConditionals,
    updates: Array<{ setId: number; partKey: string; checked: boolean }> = [],
): CompactSonataSetConditionals {
  if (!Array.isArray(updates) || updates.length === 0) {
    return compactSelection
  }

  const keys = [...compactSelection.keys]
  const setIds = compactSelection.setIds.map((setId) => Number(setId))
  let wordsPerSet = Math.ceil(keys.length / BIT_WORD_SIZE)
  let masks = normalizeCompactMasks(compactSelection, keys, setIds, wordsPerSet)
  const bitByKey = new Map(keys.map((partKey, bitIndex) => [partKey, bitIndex]))
  const rowBySetId = new Map(setIds.map((setId, row) => [setId, row]))
  let changed = false

  for (const update of updates) {
    const setId = Number(update.setId)
    if (!Number.isFinite(setId) || !update.partKey) {
      continue
    }

    let row = rowBySetId.get(setId)
    let bitIndex = bitByKey.get(update.partKey)

    if (row == null || bitIndex == null) {
      if (!update.checked) {
        continue
      }

      if (bitIndex == null) {
        bitIndex = keys.length
        keys.push(update.partKey)
        bitByKey.set(update.partKey, bitIndex)

        const nextWordsPerSet = Math.ceil(keys.length / BIT_WORD_SIZE)
        if (nextWordsPerSet !== wordsPerSet) {
          const nextMasks = createEmptyCompactMasks(setIds.length, nextWordsPerSet)
          for (let currentRow = 0; currentRow < setIds.length; currentRow += 1) {
            for (let wordIndex = 0; wordIndex < wordsPerSet; wordIndex += 1) {
              nextMasks[currentRow * nextWordsPerSet + wordIndex] =
                masks[currentRow * wordsPerSet + wordIndex] >>> 0
            }
          }
          masks = nextMasks
          wordsPerSet = nextWordsPerSet
        }
      }

      if (row == null) {
        row = setIds.length
        setIds.push(setId)
        rowBySetId.set(setId, row)
        masks.push(...createEmptyCompactMasks(1, wordsPerSet))
      }
    }

    if (wordsPerSet === 0 || row == null || bitIndex == null) {
      continue
    }

    const wordIndex = bitIndex >>> 5
    const offset = row * wordsPerSet + wordIndex
    const bitMask = (1 << (bitIndex & 31)) >>> 0
    const previous = ((masks[offset] >>> (bitIndex & 31)) & 1) === 1

    if (previous === update.checked) {
      continue
    }

    if (update.checked) {
      masks[offset] = ((masks[offset] >>> 0) | bitMask) >>> 0
    } else {
      masks[offset] = ((masks[offset] >>> 0) & ~bitMask) >>> 0
    }
    changed = true
  }

  if (!changed) {
    return compactSelection
  }

  return {
    version: DEFAULT_COMPACT_VERSION,
    encoding: COMPACT_ENCODING,
    keys,
    setIds,
    wordsPerSet,
    masks,
  }
}

export function cloneCompactSonataSetConditionals(
    compactSelection: CompactSonataSetConditionals,
): CompactSonataSetConditionals {
  return {
    ...compactSelection,
    keys: [...compactSelection.keys],
    setIds: [...compactSelection.setIds],
    masks: [...compactSelection.masks],
  }
}
