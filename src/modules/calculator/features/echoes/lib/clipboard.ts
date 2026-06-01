/*
  Author: Runor Ewhro
  Description: shared echo clipboard helpers for serializing equipped or
               inventory echoes, reading/writing clipboard contents, and
               applying pasted echoes to loadout slots in a predictable order.
*/

import type { EchoInstance, ResonatorId } from '@/domain/entities/runtime.ts'
import { areEchoNstnQ, cloneEchoFor } from '@/domain/entities/inventoryStorage.ts'
import { getEchoCostB } from '@/modules/calculator/features/echoes/lib/echoes.ts'

export const ECHO_CLIP_KIND = 'echo-clipboard'
export const ECHO_CLIP_VER = 1
const MAXECHOCOST = 12

type EchoClipSource = 'loadout' | 'inventory'

export interface EchoClipPayload {
  kind: typeof ECHO_CLIP_KIND
  version: typeof ECHO_CLIP_VER
  source: EchoClipSource
  resonatorId: ResonatorId
  resName: string
  echoes: EchoInstance[]
}

export interface EchoPasteResult {
  nextEchoes: Array<EchoInstance | null>
  pastedCount: number
  skippedCount: number
}

export interface EchoInvPstRs {
  echoesToAdd: EchoInstance[]
  addedCount: number
  skippedCount: number
}

let cchdEchoClpb: EchoClipPayload | null = null

function cloneEcho(echo: EchoInstance): EchoInstance {
  return {
    uid: echo.uid,
    id: echo.id,
    set: echo.set,
    mainEcho: echo.mainEcho,
    mainStats: {
      primary: { ...echo.mainStats.primary },
      secondary: { ...echo.mainStats.secondary },
    },
    substats: { ...echo.substats },
  }
}

export function cloneClpbChs(echoes: EchoInstance[]): EchoInstance[] {
  return echoes.map((echo) => cloneEcho(echo))
}

export function mkEchoClpbPa(args: {
  source: EchoClipSource
  resonatorId: ResonatorId
  resName: string
  echoes: EchoInstance[]
}): EchoClipPayload {
  return {
    kind: ECHO_CLIP_KIND,
    version: ECHO_CLIP_VER,
    source: args.source,
    resonatorId: args.resonatorId,
    resName: args.resName,
    echoes: cloneClpbChs(args.echoes),
  }
}

export function serEcho(payload: EchoClipPayload): string {
  return JSON.stringify({
    ...payload,
    echoes: cloneClpbChs(payload.echoes),
  })
}

export function prsEchoClpbP(raw: string): EchoClipPayload | null {
  if (!raw) {
    return null
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const source = parsed.source
    const resonatorId = parsed.resonatorId
    const resName = parsed.resName ?? parsed.resonatorName
    const echoes = parsed.echoes

    if (
      parsed.kind !== ECHO_CLIP_KIND ||
      parsed.version !== ECHO_CLIP_VER ||
      (source !== 'loadout' && source !== 'inventory') ||
      typeof resonatorId !== 'string' ||
      typeof resName !== 'string' ||
      !Array.isArray(echoes)
    ) {
      return null
    }

    // clone entries after structural validation so pasted payloads cannot share
    // object references with parser output or the clipboard cache.
    const nrmlChs = echoes
      .filter((entry): entry is EchoInstance => Boolean(entry && typeof entry === 'object'))
      .map((echo) => cloneEcho(echo))

    if (nrmlChs.length === 0) {
      return null
    }

    return {
      kind: ECHO_CLIP_KIND,
      version: ECHO_CLIP_VER,
      source,
      resonatorId,
      resName: resName,
      echoes: nrmlChs,
    }
  } catch {
    return null
  }
}

export async function writeEchoClp(payload: EchoClipPayload): Promise<boolean> {
  const nrmlPay: EchoClipPayload = {
    ...payload,
    echoes: cloneClpbChs(payload.echoes),
  }

  // cache first so same-session paste still works when browser permissions
  // reject the system clipboard write.
  cchdEchoClpb = nrmlPay

  if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
    return true
  }

  try {
    await navigator.clipboard.writeText(serEcho(nrmlPay))
    return true
  } catch {
    return false
  }
}

export async function readEchoClpb(): Promise<EchoClipPayload | null> {
  if (typeof navigator === 'undefined' || !navigator.clipboard?.readText) {
    return cchdEchoClpb
      ? { ...cchdEchoClpb, echoes: cloneClpbChs(cchdEchoClpb.echoes) }
      : null
  }

  try {
    const text = await navigator.clipboard.readText()
    const parsed = prsEchoClpbP(text)
    // cache parsed system clipboard data so later read failures fall back to
    // the most recent valid echo payload, not stale pre-read data.
    cchdEchoClpb = parsed
      ? { ...parsed, echoes: cloneClpbChs(parsed.echoes) }
      : null
    return parsed
  } catch {
    return cchdEchoClpb
      ? { ...cchdEchoClpb, echoes: cloneClpbChs(cchdEchoClpb.echoes) }
      : null
  }
}

export function pstChsIntoLd(
  curChs: Array<EchoInstance | null>,
  payload: EchoClipPayload,
  startSlotNdx: number,
): EchoPasteResult {
  const nextEchoes = [...curChs]
  let nextTtlCost = nextEchoes.reduce((total, echo) => (
    total + (echo ? getEchoCostB(echo.id) : 0)
  ), 0)
  let pastedCount = 0
  let skippedCount = 0
  let slotIndex = startSlotNdx

  // paste sequentially from the requested slot and count over-budget or
  // overflow echoes as skipped instead of partially reshuffling the loadout.
  for (const echo of payload.echoes) {
    if (slotIndex >= nextEchoes.length) {
      skippedCount += 1
      continue
    }

    const curSlotEcho = nextEchoes[slotIndex]
    const curSlotCost = curSlotEcho ? getEchoCostB(curSlotEcho.id) : 0
    const nextEchoCost = getEchoCostB(echo.id)
    if (nextTtlCost - curSlotCost + nextEchoCost > MAXECHOCOST) {
      skippedCount += 1
      slotIndex += 1
      continue
    }

    nextEchoes[slotIndex] = cloneEchoFor(echo, slotIndex)
    nextTtlCost = nextTtlCost - curSlotCost + nextEchoCost
    pastedCount += 1
    slotIndex += 1
  }

  return {
    nextEchoes,
    pastedCount,
    skippedCount,
  }
}

export function resInvEchoPs(
  xstnChs: EchoInstance[],
  payload: EchoClipPayload,
): EchoInvPstRs {
  const echoesToAdd: EchoInstance[] = []
  let skippedCount = 0

  // inventory paste dedupes against both existing bag entries and earlier
  // entries in the same payload so repeated clips stay idempotent.
  for (const echo of payload.echoes) {
    const dplcXsts = xstnChs.some((existing) => areEchoNstnQ(existing, echo))
      || echoesToAdd.some((existing) => areEchoNstnQ(existing, echo))

    if (dplcXsts) {
      skippedCount += 1
      continue
    }

    echoesToAdd.push(cloneEcho(echo))
  }

  return {
    echoesToAdd,
    addedCount: echoesToAdd.length,
    skippedCount,
  }
}
