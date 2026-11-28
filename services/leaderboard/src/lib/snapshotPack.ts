/*
  Author: Runor Ewhro
  description: the board's packed copy of a card read: a BuildSnapshot as bytes
               (~200 B against ~1.4 KB of json). packing is lossless: unpack
               returns the snapshot field for field, key order included, so a
               packed snapshot hashes, scores and diffs like the json. numeric
               ids are varints, stat and skill keys come from frozen
               dictionaries, and card values (at most one decimal) are stored as
               tenths; other shapes use an escape (a string or a float64). the
               dictionaries are append-only, so each code maps to one key
               permanently.
*/

import type { BuildSnapshot, SnapshotEcho, SnapshotStat } from '@lb/contract/snapshot'

// the packed format's version, the first byte
const FORMAT = 1

// stat keys by code; new keys are appended
const STAT_KEYS = Object.freeze([
  'atkFlat', 'atkPercent', 'hpFlat', 'hpPercent', 'defFlat', 'defPercent', 'critRate', 'critDmg', 'energyRegen',
  'healingBonus', 'basicAtk', 'heavyAtk', 'resonanceSkill', 'resonanceLiberation', 'glacio', 'fusion', 'electro',
  'aero', 'spectro', 'havoc',
])
// skill level keys by code; new keys are appended
const SKILL_KEYS = Object.freeze(['normalAttack', 'resonanceSkill', 'forteCircuit', 'resonanceLiberation', 'introSkill'])

const statCode = new Map(STAT_KEYS.map((key, code) => [key, code]))
const skillCode = new Map(SKILL_KEYS.map((key, code) => [key, code]))

const encoder = new TextEncoder()
const decoder = new TextDecoder()

class Writer {
  private bytes = new Uint8Array(256)
  private at = 0

  private room(n: number) {
    if (this.at + n <= this.bytes.length) return
    const next = new Uint8Array(Math.max(this.bytes.length * 2, this.at + n))
    next.set(this.bytes)
    this.bytes = next
  }

  byte(value: number) {
    this.room(1)
    this.bytes[this.at++] = value
  }

  // an unsigned integer up to 2^53, 7 bits a byte
  varint(value: number) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`snapshotPack: ${value} is not a varint`)
    this.room(8)
    while (value >= 0x80) {
      this.bytes[this.at++] = (value % 0x80) | 0x80
      value = Math.floor(value / 0x80)
    }
    this.bytes[this.at++] = value
  }

  float(value: number) {
    this.room(8)
    new DataView(this.bytes.buffer).setFloat64(this.at, value, true)
    this.at += 8
  }

  text(value: string) {
    const raw = encoder.encode(value)
    this.varint(raw.length)
    this.room(raw.length)
    this.bytes.set(raw, this.at)
    this.at += raw.length
  }

  done(): Uint8Array {
    return this.bytes.slice(0, this.at)
  }
}

class Reader {
  private at = 0
  private readonly bytes: Uint8Array

  constructor(bytes: Uint8Array) {
    this.bytes = bytes
  }

  byte(): number {
    if (this.at >= this.bytes.length) throw new Error('snapshotPack: truncated')
    return this.bytes[this.at++]
  }

  varint(): number {
    let value = 0
    let scale = 1
    for (;;) {
      const byte = this.byte()
      value += (byte & 0x7f) * scale
      if (byte < 0x80) return value
      scale *= 0x80
    }
  }

  float(): number {
    if (this.at + 8 > this.bytes.length) throw new Error('snapshotPack: truncated')
    const value = new DataView(this.bytes.buffer, this.bytes.byteOffset).getFloat64(this.at, true)
    this.at += 8
    return value
  }

  text(): string {
    const length = this.varint()
    if (this.at + length > this.bytes.length) throw new Error('snapshotPack: truncated')
    const value = decoder.decode(this.bytes.subarray(this.at, this.at + length))
    this.at += length
    return value
  }

  end() {
    if (this.at !== this.bytes.length) throw new Error('snapshotPack: trailing bytes')
  }
}

// decimal ids without leading zeros are written as varints and other ids as text, with the low bit marking which
const NUMERIC_ID = /^[1-9]\d{0,14}$/

function writeId(out: Writer, id: string) {
  if (NUMERIC_ID.test(id) && Number.isSafeInteger(Number(id))) out.varint(Number(id) * 2)
  else {
    const raw = encoder.encode(id)
    out.varint(raw.length * 2 + 1)
    for (const byte of raw) out.byte(byte)
  }
}

function readId(input: Reader): string {
  const head = input.varint()
  if (head % 2 === 0) return String(head / 2)
  const length = (head - 1) / 2
  const raw = new Uint8Array(length)
  for (let index = 0; index < length; index += 1) raw[index] = input.byte()
  return decoder.decode(raw)
}

// a dictionary key: its code + 1, or 0 then the text
function writeKey(out: Writer, codes: Map<string, number>, key: string) {
  const code = codes.get(key)
  if (code === undefined) {
    out.varint(0)
    out.text(key)
  } else out.varint(code + 1)
}

function readKey(input: Reader, keys: readonly string[]): string {
  const code = input.varint()
  if (code === 0) return input.text()
  const key = keys[code - 1]
  if (key === undefined) throw new Error(`snapshotPack: unknown key code ${code}`)
  return key
}

// a card value: tenths as an even varint when exact and not negative, else odd marker + float64
function writeValue(out: Writer, value: number) {
  const tenths = Math.round(value * 10)
  if (value >= 0 && Number.isSafeInteger(tenths * 2) && tenths / 10 === value && !Object.is(value, -0)) out.varint(tenths * 2)
  else {
    out.varint(1)
    out.float(value)
  }
}

function readValue(input: Reader): number {
  const head = input.varint()
  if (head === 1) return input.float()
  if (head % 2 !== 0) throw new Error('snapshotPack: bad value')
  return head / 2 / 10
}

// an optional small integer: 0 for null, else value + 1 (values are safe non-negative integers)
function writeMaybe(out: Writer, value: number | null) {
  if (value === null) out.varint(0)
  else if (Number.isSafeInteger(value) && value >= 0) out.varint(value + 2)
  else {
    out.varint(1)
    out.float(value)
  }
}

function readMaybe(input: Reader): number | null {
  const head = input.varint()
  if (head === 0) return null
  if (head === 1) return input.float()
  return head - 2
}

function writeStat(out: Writer, stat: SnapshotStat) {
  writeKey(out, statCode, stat.key)
  writeValue(out, stat.value)
}

function readStat(input: Reader): SnapshotStat {
  const key = readKey(input, STAT_KEYS)
  return { key, value: readValue(input) }
}

// packs a snapshot, throwing on an unknown version and dropping no field
export function packSnapshot(snapshot: BuildSnapshot): Uint8Array {
  if (snapshot.v !== 1) throw new Error(`snapshotPack: snapshot v${String((snapshot as { v: unknown }).v)} is not packable`)
  const out = new Writer()
  out.byte(FORMAT)
  out.text(snapshot.gameVer)
  out.text(snapshot.uid)
  if (snapshot.name === null) out.varint(0)
  else {
    out.varint(1)
    out.text(snapshot.name)
  }
  const { resonator, weapon, echoes } = snapshot
  writeId(out, resonator.id)
  writeMaybe(out, resonator.level)
  out.varint(resonator.sequence)
  const skills = Object.entries(resonator.skillLevels)
  out.varint(skills.length)
  for (const [key, level] of skills) {
    writeKey(out, skillCode, key)
    writeMaybe(out, level)
  }
  // no weapon packs as the empty id, which no real weapon has
  writeId(out, weapon.id ?? '')
  writeMaybe(out, weapon.level)
  out.varint(echoes.length)
  for (const echo of echoes) {
    out.varint(echo.slot)
    writeId(out, echo.id)
    out.varint(echo.set)
    out.byte(echo.mainEcho ? 1 : 0)
    writeStat(out, echo.main.primary)
    writeStat(out, echo.main.secondary)
    const substats = Object.entries(echo.substats)
    out.varint(substats.length)
    for (const [key, value] of substats) writeStat(out, { key, value })
  }
  return out.done()
}

// the snapshot a packed one was made from, field for field
export function unpackSnapshot(bytes: Uint8Array): BuildSnapshot {
  const input = new Reader(bytes)
  const format = input.byte()
  if (format !== FORMAT) throw new Error(`snapshotPack: format ${format} is not known`)
  const gameVer = input.text()
  const uid = input.text()
  const name = input.varint() === 0 ? null : input.text()
  const id = readId(input)
  const level = readMaybe(input)
  const sequence = input.varint()
  const skillLevels: Record<string, number | null> = {}
  for (let count = input.varint(); count > 0; count -= 1) {
    const key = readKey(input, SKILL_KEYS)
    skillLevels[key] = readMaybe(input)
  }
  const weapon = { id: readId(input) || null, level: readMaybe(input) }
  const echoes: SnapshotEcho[] = []
  for (let count = input.varint(); count > 0; count -= 1) {
    const slot = input.varint()
    const echoId = readId(input)
    const set = input.varint()
    const mainEcho = input.byte() === 1
    const primary = readStat(input)
    const secondary = readStat(input)
    const substats: Record<string, number> = {}
    for (let subs = input.varint(); subs > 0; subs -= 1) {
      const stat = readStat(input)
      substats[stat.key] = stat.value
    }
    echoes.push({ slot, id: echoId, set, mainEcho, main: { primary, secondary }, substats })
  }
  input.end()
  return { v: 1, gameVer, uid, name, resonator: { id, level, sequence, skillLevels }, weapon, echoes }
}

// each echo's id and sonata set, in card order: what a board row's set pieces are counted from
export function snapshotEchoSets(snapshot: BuildSnapshot): Array<{ id: string; set: number }> {
  return snapshot.echoes.map((echo) => ({ id: echo.id, set: echo.set }))
}
