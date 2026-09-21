/*
  Author: Runor Ewhro
  Description: Encodes Brotli app exports behind a magic header while retaining plain-JSON import compatibility.
*/

import type { BrotliWasmType } from 'brotli-wasm'

// "WWCB1" identifies a wwcalc compressed file; version byte lives in the tag.
const WWCB_MAGIC = new Uint8Array([0x57, 0x57, 0x43, 0x42, 0x31])
const BROTLI_QUALITY = 10

export const WWCB_FILE_EXT = '.wwcalc'
// import pickers should accept both compressed and plain exports.
export const APP_FILE_ACCEPT = 'application/json,.json,.wwcalc'

let brotliLoad: Promise<BrotliWasmType> | null = null

function loadBrotli(): Promise<BrotliWasmType> {
  brotliLoad ??= import('brotli-wasm').then((mod) => mod.default)
  return brotliLoad
}

export function hasWwcbMgc(bytes: Uint8Array): boolean {
  if (bytes.length < WWCB_MAGIC.length) {
    return false
  }
  return WWCB_MAGIC.every((byte, index) => bytes[index] === byte)
}

export async function encAppFileBy(json: string): Promise<Uint8Array> {
  const brotli = await loadBrotli()
  const packed = brotli.compress(new TextEncoder().encode(json), { quality: BROTLI_QUALITY })
  const out = new Uint8Array(WWCB_MAGIC.length + packed.length)
  out.set(WWCB_MAGIC, 0)
  out.set(packed, WWCB_MAGIC.length)
  return out
}

export async function decAppFileBy(bytes: Uint8Array): Promise<string> {
  if (!hasWwcbMgc(bytes)) {
    // plain text file (json, css, older exports): pass through unchanged.
    return new TextDecoder().decode(bytes)
  }
  const brotli = await loadBrotli()
  return new TextDecoder().decode(brotli.decompress(bytes.slice(WWCB_MAGIC.length)))
}

export async function encAppFileBlob(json: string): Promise<Blob> {
  return new Blob([await encAppFileBy(json) as unknown as BlobPart], { type: 'application/octet-stream' })
}

// reads any app export file (compressed or plain) back to its text content.
export async function readAppFile(file: File): Promise<string> {
  return decAppFileBy(new Uint8Array(await file.arrayBuffer()))
}

export function dwnlAppFile(filename: string, content: Uint8Array | string): void {
  const blob = content instanceof Uint8Array
    ? new Blob([content as BlobPart], { type: 'application/octet-stream' })
    : new Blob([content], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

// the store loads lazily so contexts that only read files never pull the
// state graph in through the codec.
async function rslvCmprPref(): Promise<boolean> {
  const { useAppStore } = await import('@/application/state')
  return useAppStore.getState().ui.compressedExports
}

// downloads an export honoring the compressed-exports preference and returns
// the filename that was written.
export async function xprtAppFile(filename: string, json: string): Promise<string> {
  if (!(await rslvCmprPref())) {
    dwnlAppFile(filename, json)
    return filename
  }
  const name = wwcbFileName(filename)
  dwnlAppFile(name, await encAppFileBy(json))
  return name
}

// swaps a plain export extension for the compressed one.
export function wwcbFileName(filename: string): string {
  return filename.replace(/\.json$/i, '') + WWCB_FILE_EXT
}
