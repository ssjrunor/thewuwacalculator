import type { OptimizerBagResultRef } from '@/engine/optimizer/types.ts'

type OptimizerBagResultSetKey = bigint | string

function compareBagResults(left: OptimizerBagResultRef, right: OptimizerBagResultRef): number {
  return left.damage - right.damage
}

export function buildOptimizerBagResultSetKey(ids: readonly number[]): OptimizerBagResultSetKey {
  if (ids.length !== 5) {
    return [...ids].sort((left, right) => left - right).join('|')
  }

  return buildOptimizerBagResultSetKey5(ids[0], ids[1], ids[2], ids[3], ids[4])
}

export function buildOptimizerBagResultSetKey5(
  i0: number,
  i1: number,
  i2: number,
  i3: number,
  i4: number,
): OptimizerBagResultSetKey {
  let a = i0
  let b = i1
  let c = i2
  let d = i3
  const e = i4

  if (a > b) [a, b] = [b, a]
  if (c > d) [c, d] = [d, c]
  if (a > c) [a, c] = [c, a]
  if (b > d) [b, d] = [d, b]
  if (b > c) [b, c] = [c, b]

  if (e < b) {
    if (e < a) {
      return packResultKey(e, a, b, c, d)
    }
    return packResultKey(a, e, b, c, d)
  }
  if (e < d) {
    if (e < c) {
      return packResultKey(a, b, e, c, d)
    }
    return packResultKey(a, b, c, e, d)
  }
  return packResultKey(a, b, c, d, e)
}

function packResultKey(a: number, b: number, c: number, d: number, e: number): bigint {
  const A = BigInt(a >>> 0)
  const B = BigInt(b >>> 0)
  const C = BigInt(c >>> 0)
  const D = BigInt(d >>> 0)
  const E = BigInt(e >>> 0)
  return (((((A << 32n) | B) << 32n | C) << 32n | D) << 32n) | E
}

function nextPowerOfTwo(value: number): number {
  let out = 1
  while (out < value) {
    out <<= 1
  }
  return out
}

class OptimizerBagResultLookup {
  private capacity: number
  private mask: number
  private count = 0
  private used: Uint8Array
  private keys0: Int32Array
  private keys1: Int32Array
  private keys2: Int32Array
  private keys3: Int32Array
  private keys4: Int32Array
  private damages: Float64Array
  private readonly scratch = new Int32Array(5)

  constructor(minCapacity = 256) {
    this.capacity = nextPowerOfTwo(Math.max(16, minCapacity))
    this.mask = this.capacity - 1
    this.used = new Uint8Array(this.capacity)
    this.keys0 = new Int32Array(this.capacity)
    this.keys1 = new Int32Array(this.capacity)
    this.keys2 = new Int32Array(this.capacity)
    this.keys3 = new Int32Array(this.capacity)
    this.keys4 = new Int32Array(this.capacity)
    this.damages = new Float64Array(this.capacity)
  }

  get size(): number {
    return this.count
  }

  clear(): void {
    this.used.fill(0)
    this.count = 0
  }

  getDamage(i0: number, i1: number, i2: number, i3: number, i4: number): number | null {
    const normalized = this.normalizeIntoScratch(i0, i1, i2, i3, i4)
    const slot = this.findSlot(
      normalized[0],
      normalized[1],
      normalized[2],
      normalized[3],
      normalized[4],
    )
    return this.used[slot] ? this.damages[slot] : null
  }

  recordDamage(i0: number, i1: number, i2: number, i3: number, i4: number, damage: number): number | null {
    const normalized = this.normalizeIntoScratch(i0, i1, i2, i3, i4)
    this.ensureCapacity()
    const slot = this.findSlot(
      normalized[0],
      normalized[1],
      normalized[2],
      normalized[3],
      normalized[4],
    )
    if (!this.used[slot]) {
      this.writeSlot(slot, normalized[0], normalized[1], normalized[2], normalized[3], normalized[4], damage)
      this.count += 1
      return null
    }

    const previous = this.damages[slot]
    this.damages[slot] = damage
    return previous
  }

  rebuildFromResults(results: readonly OptimizerBagResultRef[]): void {
    this.clear()
    for (const entry of results) {
      const previous = this.getDamage(entry.i0, entry.i1, entry.i2, entry.i3, entry.i4)
      if (previous == null || entry.damage > previous) {
        this.recordDamage(entry.i0, entry.i1, entry.i2, entry.i3, entry.i4, entry.damage)
      }
    }
  }

  private normalizeIntoScratch(i0: number, i1: number, i2: number, i3: number, i4: number): Int32Array {
    let a = i0
    let b = i1
    let c = i2
    let d = i3
    const e = i4

    if (a > b) [a, b] = [b, a]
    if (c > d) [c, d] = [d, c]
    if (a > c) [a, c] = [c, a]
    if (b > d) [b, d] = [d, b]
    if (b > c) [b, c] = [c, b]

    if (e < b) {
      if (e < a) {
        this.scratch[0] = e
        this.scratch[1] = a
        this.scratch[2] = b
        this.scratch[3] = c
        this.scratch[4] = d
        return this.scratch
      }
      this.scratch[0] = a
      this.scratch[1] = e
      this.scratch[2] = b
      this.scratch[3] = c
      this.scratch[4] = d
      return this.scratch
    }
    if (e < d) {
      if (e < c) {
        this.scratch[0] = a
        this.scratch[1] = b
        this.scratch[2] = e
        this.scratch[3] = c
        this.scratch[4] = d
        return this.scratch
      }
      this.scratch[0] = a
      this.scratch[1] = b
      this.scratch[2] = c
      this.scratch[3] = e
      this.scratch[4] = d
      return this.scratch
    }

    this.scratch[0] = a
    this.scratch[1] = b
    this.scratch[2] = c
    this.scratch[3] = d
    this.scratch[4] = e
    return this.scratch
  }

  private hash(a: number, b: number, c: number, d: number, e: number): number {
    let hash = 2166136261 >>> 0
    hash = Math.imul(hash ^ (a >>> 0), 16777619)
    hash = Math.imul(hash ^ (b >>> 0), 16777619)
    hash = Math.imul(hash ^ (c >>> 0), 16777619)
    hash = Math.imul(hash ^ (d >>> 0), 16777619)
    hash = Math.imul(hash ^ (e >>> 0), 16777619)
    return hash >>> 0
  }

  private findSlot(a: number, b: number, c: number, d: number, e: number): number {
    let slot = this.hash(a, b, c, d, e) & this.mask
    while (this.used[slot]) {
      if (
        this.keys0[slot] === a &&
        this.keys1[slot] === b &&
        this.keys2[slot] === c &&
        this.keys3[slot] === d &&
        this.keys4[slot] === e
      ) {
        return slot
      }
      slot = (slot + 1) & this.mask
    }
    return slot
  }

  private ensureCapacity(): void {
    if ((this.count + 1) * 4 < this.capacity * 3) {
      return
    }

    const oldUsed = this.used
    const oldKeys0 = this.keys0
    const oldKeys1 = this.keys1
    const oldKeys2 = this.keys2
    const oldKeys3 = this.keys3
    const oldKeys4 = this.keys4
    const oldDamages = this.damages

    this.capacity <<= 1
    this.mask = this.capacity - 1
    this.used = new Uint8Array(this.capacity)
    this.keys0 = new Int32Array(this.capacity)
    this.keys1 = new Int32Array(this.capacity)
    this.keys2 = new Int32Array(this.capacity)
    this.keys3 = new Int32Array(this.capacity)
    this.keys4 = new Int32Array(this.capacity)
    this.damages = new Float64Array(this.capacity)
    const previousCount = this.count
    this.count = 0

    for (let index = 0; index < oldUsed.length; index += 1) {
      if (!oldUsed[index]) {
        continue
      }
      this.recordDamage(
        oldKeys0[index],
        oldKeys1[index],
        oldKeys2[index],
        oldKeys3[index],
        oldKeys4[index],
        oldDamages[index],
      )
    }

    this.count = previousCount
  }

  private writeSlot(
    slot: number,
    a: number,
    b: number,
    c: number,
    d: number,
    e: number,
    damage: number,
  ): void {
    this.used[slot] = 1
    this.keys0[slot] = a
    this.keys1[slot] = b
    this.keys2[slot] = c
    this.keys3[slot] = d
    this.keys4[slot] = e
    this.damages[slot] = damage
  }
}

export function buildOptimizerBagResultRef(
  damage: number,
  comboIds: Int32Array,
  mainIndex: number,
): OptimizerBagResultRef | null {
  if (mainIndex < 0) {
    return null
  }

  let i1 = -1
  let i2 = -1
  let i3 = -1
  let i4 = -1
  let cursor = 0
  for (let index = 0; index < comboIds.length; index += 1) {
    const echoIndex = comboIds[index]
    if (echoIndex === mainIndex) {
      continue
    }

    if (echoIndex < 0) {
      return null
    }

    switch (cursor) {
      case 0:
        i1 = echoIndex
        break
      case 1:
        i2 = echoIndex
        break
      case 2:
        i3 = echoIndex
        break
      case 3:
        i4 = echoIndex
        break
      default:
        return null
    }

    cursor += 1
  }

  if (cursor !== 4) {
    return null
  }

  return {
    damage,
    i0: mainIndex,
    i1,
    i2,
    i3,
    i4,
  }
}

export function fillOptimizerBagResultComboIds(
  target: Int32Array,
  result: OptimizerBagResultRef,
): Int32Array {
  if (target.length < 5) {
    throw new Error('Optimizer combo id target must have room for 5 ids')
  }

  target[0] = result.i0
  target[1] = result.i1
  target[2] = result.i2
  target[3] = result.i3
  target[4] = result.i4
  return target
}

export class OptimizerBagResultCollector {
  private readonly k: number
  private bestDamageBySet: OptimizerBagResultLookup
  private readonly heap: OptimizerBagResultRef[] = []
  private static readonly PRUNE_TRIGGER_MULTIPLIER = 8

  constructor(k: number) {
    this.k = Math.max(1, Math.floor(k))
    this.bestDamageBySet = new OptimizerBagResultLookup(Math.max(this.k * 4, 256))
  }

  get size(): number {
    return this.bestDamageBySet.size
  }

  push(entry: OptimizerBagResultRef): void {
    this.push5(entry.damage, entry.i0, entry.i1, entry.i2, entry.i3, entry.i4)
  }

  push5(
    damage: number,
    i0: number,
    i1: number,
    i2: number,
    i3: number,
    i4: number,
  ): void {
    if (damage <= 0) {
      return
    }

    const previous = this.bestDamageBySet.getDamage(i0, i1, i2, i3, i4)
    if (previous != null && previous >= damage) {
      return
    }

    this.bestDamageBySet.recordDamage(i0, i1, i2, i3, i4, damage)
    this.pushHeap({
      damage,
      i0,
      i1,
      i2,
      i3,
      i4,
    })
    this.maybePruneBestDamageMap()
  }

  pushOrderedCombo(damage: number, comboIds: Int32Array, mainIndex: number): void {
    if (mainIndex < 0) {
      return
    }

    let i1 = -1
    let i2 = -1
    let i3 = -1
    let i4 = -1
    let cursor = 0

    for (let index = 0; index < comboIds.length; index += 1) {
      const echoIndex = comboIds[index]
      if (echoIndex === mainIndex) {
        continue
      }

      if (echoIndex < 0) {
        return
      }

      switch (cursor) {
        case 0:
          i1 = echoIndex
          break
        case 1:
          i2 = echoIndex
          break
        case 2:
          i3 = echoIndex
          break
        case 3:
          i4 = echoIndex
          break
        default:
          return
      }

      cursor += 1
    }

    if (cursor !== 4) {
      return
    }

    this.push5(damage, mainIndex, i1, i2, i3, i4)
  }

  private pushHeap(candidate: OptimizerBagResultRef): void {
    if (this.heap.length < this.k) {
      this.heap.push(candidate)
      this.siftHeapUp(this.heap.length - 1)
      return
    }

    if (compareBagResults(candidate, this.heap[0]) <= 0) {
      return
    }

    this.heap[0] = candidate
    this.siftHeapDown(0)
  }

  private maybePruneBestDamageMap(): void {
    if (this.heap.length < this.k) {
      return
    }

    const pruneThreshold = Math.max(this.k * OptimizerBagResultCollector.PRUNE_TRIGGER_MULTIPLIER, 256)
    if (this.bestDamageBySet.size <= pruneThreshold) {
      return
    }

    this.bestDamageBySet = new OptimizerBagResultLookup(Math.max(this.k * 4, 256))
    this.bestDamageBySet.rebuildFromResults(this.heap)
  }

  private siftHeapUp(index: number): void {
    let current = index

    while (current > 0) {
      const parent = (current - 1) >> 1
      if (compareBagResults(this.heap[current], this.heap[parent]) >= 0) {
        break
      }

      ;[this.heap[current], this.heap[parent]] = [this.heap[parent], this.heap[current]]
      current = parent
    }
  }

  private siftHeapDown(index: number): void {
    let current = index

    while (true) {
      let smallest = current
      const left = current * 2 + 1
      const right = current * 2 + 2

      if (left < this.heap.length && compareBagResults(this.heap[left], this.heap[smallest]) < 0) {
        smallest = left
      }

      if (right < this.heap.length && compareBagResults(this.heap[right], this.heap[smallest]) < 0) {
        smallest = right
      }

      if (smallest === current) {
        break
      }

      ;[this.heap[current], this.heap[smallest]] = [this.heap[smallest], this.heap[current]]
      current = smallest
    }
  }

  sorted(limit = this.k): OptimizerBagResultRef[] {
    const maxItems = Math.max(1, Math.floor(limit))
    const seen = new OptimizerBagResultLookup(Math.max(maxItems * 2, 16))
    const out: OptimizerBagResultRef[] = []

    const sortedHeap = [...this.heap]
      .sort((left, right) => compareBagResults(right, left))

    for (const entry of sortedHeap) {
      const currentDamage = this.bestDamageBySet.getDamage(entry.i0, entry.i1, entry.i2, entry.i3, entry.i4)
      if (currentDamage == null || currentDamage !== entry.damage || seen.getDamage(entry.i0, entry.i1, entry.i2, entry.i3, entry.i4) != null) {
        continue
      }

      seen.recordDamage(entry.i0, entry.i1, entry.i2, entry.i3, entry.i4, entry.damage)
      out.push(entry)

      if (out.length >= maxItems) {
        break
      }
    }

    return out
  }
}
