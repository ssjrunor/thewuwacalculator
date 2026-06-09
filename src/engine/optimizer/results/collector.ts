/*
  Author: Runor Ewhro
  Description: collects optimizer bag results into a deduped lookup keyed by
               equipped echo ids, with a compact bigint fast path for the
               common fixed-width five-echo result layout.
*/

import type { OptBagResult } from '@/engine/optimizer/types.ts'

type OptBagRsltSe = bigint | string

export function mkOptBagRslt(ids: readonly number[]): OptBagRsltSe {
  if (ids.length !== 5) {
    return [...ids].sort((left, right) => left - right).join('|')
  }

  return mkOptBagRssr(ids[0], ids[1], ids[2], ids[3], ids[4])
}

// sort the five ids into canonical order before packing them into one key
export function mkOptBagRssr(
  i0: number,
  i1: number,
  i2: number,
  i3: number,
  i4: number,
): OptBagRsltSe {
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
      return packRsltKey(e, a, b, c, d)
    }
    return packRsltKey(a, e, b, c, d)
  }
  if (e < d) {
    if (e < c) {
      return packRsltKey(a, b, e, c, d)
    }
    return packRsltKey(a, b, c, e, d)
  }
  return packRsltKey(a, b, c, d, e)
}

function packRsltKey(a: number, b: number, c: number, d: number, e: number): bigint {
  const A = BigInt(a >>> 0)
  const B = BigInt(b >>> 0)
  const C = BigInt(c >>> 0)
  const D = BigInt(d >>> 0)
  const E = BigInt(e >>> 0)
  return (((((A << 32n) | B) << 32n | C) << 32n | D) << 32n) | E
}

function nextPwrOfTwo(value: number): number {
  let out = 1
  while (out < value) {
    out <<= 1
  }
  return out
}

class OptBagRsltLk {
  private capacity: number
  private mask: number
  private count = 0
  private used: Uint8Array
  private keys0: Int32Array
  private keys1: Int32Array
  private keys2: Int32Array
  private keys3: Int32Array
  private keys4: Int32Array
  private damages: Float64Array | Float32Array
  // low-memory mode stores damage at f32 precision. it MUST match the heap's
  // damage precision in OptResultSet, because sorted() relies on exact
  // equality between a heap entry's damage and this table's recorded best.
  private readonly useF32: boolean
  private readonly scratch = new Int32Array(5)

  constructor(minCapacity = 256, lowMem = false) {
    this.useF32 = lowMem
    this.capacity = nextPwrOfTwo(Math.max(16, minCapacity))
    this.mask = this.capacity - 1
    this.used = new Uint8Array(this.capacity)
    this.keys0 = new Int32Array(this.capacity)
    this.keys1 = new Int32Array(this.capacity)
    this.keys2 = new Int32Array(this.capacity)
    this.keys3 = new Int32Array(this.capacity)
    this.keys4 = new Int32Array(this.capacity)
    this.damages = lowMem ? new Float32Array(this.capacity) : new Float64Array(this.capacity)
  }

  get size(): number {
    return this.count
  }

  clear(): void {
    this.used.fill(0)
    this.count = 0
  }

  getDamage(i0: number, i1: number, i2: number, i3: number, i4: number): number | null {
    const normalized = this.normIntoScrt(i0, i1, i2, i3, i4)
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
    const normalized = this.normIntoScrt(i0, i1, i2, i3, i4)
    this.ensCpct()
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

  rbldFromRslt(results: readonly OptBagResult[]): void {
    this.clear()
    for (const entry of results) {
      const previous = this.getDamage(entry.i0, entry.i1, entry.i2, entry.i3, entry.i4)
      if (previous == null || entry.damage > previous) {
        this.recordDamage(entry.i0, entry.i1, entry.i2, entry.i3, entry.i4, entry.damage)
      }
    }
  }

  // rebuild the best-per-set table straight from the columnar heap without
  // materializing intermediate result objects.
  rbldFromHeap(
    dmg: Float64Array | Float32Array,
    i0: Int32Array,
    i1: Int32Array,
    i2: Int32Array,
    i3: Int32Array,
    i4: Int32Array,
    len: number,
  ): void {
    this.clear()
    for (let index = 0; index < len; index += 1) {
      const damage = dmg[index]
      const previous = this.getDamage(i0[index], i1[index], i2[index], i3[index], i4[index])
      if (previous == null || damage > previous) {
        this.recordDamage(i0[index], i1[index], i2[index], i3[index], i4[index], damage)
      }
    }
  }

  private normIntoScrt(i0: number, i1: number, i2: number, i3: number, i4: number): Int32Array {
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

  private ensCpct(): void {
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
    this.damages = this.useF32
        ? new Float32Array(this.capacity)
        : new Float64Array(this.capacity)
    const prvsCnt = this.count
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

    this.count = prvsCnt
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

export function mkOptBagRsmi(
  damage: number,
  comboIds: Int32Array,
  mainIndex: number,
): OptBagResult | null {
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

export function fillOptBagRs(
  target: Int32Array,
  result: OptBagResult,
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

export class OptResultSet {
  private readonly k: number
  private bestDamageBySet: OptBagRsltLk
  // columnar min-heap on damage. parallel typed arrays replace the previous
  // array of OptBagResult objects, removing per-result allocation + GC
  // tracking that became significant at high result limits (up to 65536).
  private readonly heapDmg: Float64Array | Float32Array
  private readonly heapI0: Int32Array
  private readonly heapI1: Int32Array
  private readonly heapI2: Int32Array
  private readonly heapI3: Int32Array
  private readonly heapI4: Int32Array
  // best-weapon index carried alongside each build (-1 when no weapon search).
  // a payload column, not part of the dedup key (a build's identity is its echo
  // set; the weapon is the optimizer's choice for that build).
  private readonly heapWeapon: Int32Array
  private heapLen = 0
  private static readonly PRUNE_TRIGGER_MULTIPLIER = 8

  constructor(k: number, lowMem = false) {
    this.k = Math.max(1, Math.floor(k))
    this.bestDamageBySet = new OptBagRsltLk(Math.max(this.k * 4, 256), lowMem)
    // heap is bounded by k, so pre-allocate to k once. f32 in low-memory
    // mode, kept in lockstep with the lookup's damage precision so the
    // exact-equality dedupe in sorted() stays valid.
    this.heapDmg = lowMem ? new Float32Array(this.k) : new Float64Array(this.k)
    this.heapI0 = new Int32Array(this.k)
    this.heapI1 = new Int32Array(this.k)
    this.heapI2 = new Int32Array(this.k)
    this.heapI3 = new Int32Array(this.k)
    this.heapI4 = new Int32Array(this.k)
    this.heapWeapon = new Int32Array(this.k).fill(-1)
  }

  get size(): number {
    return this.bestDamageBySet.size
  }

  push(entry: OptBagResult): void {
    this.push5(entry.damage, entry.i0, entry.i1, entry.i2, entry.i3, entry.i4, entry.weapon ?? -1)
  }

  push5(
    damage: number,
    i0: number,
    i1: number,
    i2: number,
    i3: number,
    i4: number,
    weapon = -1,
  ): void {
    if (damage <= 0) {
      return
    }

    const previous = this.bestDamageBySet.getDamage(i0, i1, i2, i3, i4)
    if (previous != null && previous >= damage) {
      return
    }

    this.bestDamageBySet.recordDamage(i0, i1, i2, i3, i4, damage)
    this.pushHeap(damage, i0, i1, i2, i3, i4, weapon)
    this.mybPrnBestDm()
  }

  pushRdrdCmb(damage: number, comboIds: Int32Array, mainIndex: number, weapon = -1): void {
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

    this.push5(damage, mainIndex, i1, i2, i3, i4, weapon)
  }

  pushMainFrst(damage: number, comboIds: Int32Array, weapon = -1): void {
    this.push5(
        damage,
        comboIds[0],
        comboIds[1],
        comboIds[2],
        comboIds[3],
        comboIds[4],
        weapon,
    )
  }

  // write one result into a heap slot across all parallel arrays.
  private setHeapSlot(
    slot: number,
    damage: number,
    i0: number,
    i1: number,
    i2: number,
    i3: number,
    i4: number,
    weapon: number,
  ): void {
    this.heapDmg[slot] = damage
    this.heapI0[slot] = i0
    this.heapI1[slot] = i1
    this.heapI2[slot] = i2
    this.heapI3[slot] = i3
    this.heapI4[slot] = i4
    this.heapWeapon[slot] = weapon
  }

  // swap two heap slots across all parallel arrays.
  private swapHeap(a: number, b: number): void {
    const dmg = this.heapDmg[a]; this.heapDmg[a] = this.heapDmg[b]; this.heapDmg[b] = dmg
    const x0 = this.heapI0[a]; this.heapI0[a] = this.heapI0[b]; this.heapI0[b] = x0
    const x1 = this.heapI1[a]; this.heapI1[a] = this.heapI1[b]; this.heapI1[b] = x1
    const x2 = this.heapI2[a]; this.heapI2[a] = this.heapI2[b]; this.heapI2[b] = x2
    const x3 = this.heapI3[a]; this.heapI3[a] = this.heapI3[b]; this.heapI3[b] = x3
    const x4 = this.heapI4[a]; this.heapI4[a] = this.heapI4[b]; this.heapI4[b] = x4
    const xw = this.heapWeapon[a]; this.heapWeapon[a] = this.heapWeapon[b]; this.heapWeapon[b] = xw
  }

  private pushHeap(
    damage: number,
    i0: number,
    i1: number,
    i2: number,
    i3: number,
    i4: number,
    weapon: number,
  ): void {
    if (this.heapLen < this.k) {
      const slot = this.heapLen
      this.setHeapSlot(slot, damage, i0, i1, i2, i3, i4, weapon)
      this.heapLen += 1
      this.siftHeapUp(slot)
      return
    }

    // heap full: root holds the current minimum. only displace it when the
    // candidate beats it.
    if (damage <= this.heapDmg[0]) {
      return
    }

    this.setHeapSlot(0, damage, i0, i1, i2, i3, i4, weapon)
    this.siftHeapDown(0)
  }

  private mybPrnBestDm(): void {
    if (this.heapLen < this.k) {
      return
    }

    const prnThrs = Math.max(this.k * OptResultSet.PRUNE_TRIGGER_MULTIPLIER, 256)
    if (this.bestDamageBySet.size <= prnThrs) {
      return
    }

    this.bestDamageBySet = new OptBagRsltLk(
      Math.max(this.k * 4, 256),
      this.heapDmg instanceof Float32Array,
    )
    this.bestDamageBySet.rbldFromHeap(
      this.heapDmg,
      this.heapI0,
      this.heapI1,
      this.heapI2,
      this.heapI3,
      this.heapI4,
      this.heapLen,
    )
  }

  private siftHeapUp(index: number): void {
    let current = index

    while (current > 0) {
      const parent = (current - 1) >> 1
      if (this.heapDmg[current] >= this.heapDmg[parent]) {
        break
      }

      this.swapHeap(current, parent)
      current = parent
    }
  }

  private siftHeapDown(index: number): void {
    let current = index

    while (true) {
      let smallest = current
      const left = current * 2 + 1
      const right = current * 2 + 2

      if (left < this.heapLen && this.heapDmg[left] < this.heapDmg[smallest]) {
        smallest = left
      }

      if (right < this.heapLen && this.heapDmg[right] < this.heapDmg[smallest]) {
        smallest = right
      }

      if (smallest === current) {
        break
      }

      this.swapHeap(current, smallest)
      current = smallest
    }
  }

  sorted(limit = this.k): OptBagResult[] {
    const maxItems = Math.max(1, Math.floor(limit))
    const seen = new OptBagRsltLk(Math.max(maxItems * 2, 16))
    const out: OptBagResult[] = []

    // order heap slot indices by descending damage without copying the
    // payload; only the final survivors are materialized into objects.
    const order = Array.from({ length: this.heapLen }, (_, index) => index)
    order.sort((left, right) => this.heapDmg[right] - this.heapDmg[left])

    for (const slot of order) {
      const i0 = this.heapI0[slot]
      const i1 = this.heapI1[slot]
      const i2 = this.heapI2[slot]
      const i3 = this.heapI3[slot]
      const i4 = this.heapI4[slot]
      const damage = this.heapDmg[slot]
      const weapon = this.heapWeapon[slot]

      const curDmg = this.bestDamageBySet.getDamage(i0, i1, i2, i3, i4)
      if (curDmg == null || curDmg !== damage || seen.getDamage(i0, i1, i2, i3, i4) != null) {
        continue
      }

      seen.recordDamage(i0, i1, i2, i3, i4, damage)
      out.push(weapon >= 0 ? { damage, i0, i1, i2, i3, i4, weapon } : { damage, i0, i1, i2, i3, i4 })

      if (out.length >= maxItems) {
        break
      }
    }

    return out
  }
}
