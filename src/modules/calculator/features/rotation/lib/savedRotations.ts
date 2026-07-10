/*
  Author: Runor Ewhro
  Description: Normalizes saved-rotation metadata and cloning helpers used
               when persisting or restoring authored calculator rotations.
*/

import { cloneRotNds, normInvRotDu, normInvRotNo } from '@/domain/entities/inventoryStorage.ts'
import type { InvRotEnt } from '@/domain/entities/inventoryStorage.ts'
import type { RotationNode } from '@/domain/gameData/contracts.ts'
import type { ResRuntime } from '@/domain/entities/runtime.ts'
import type { SvdRotDtrDrf, SvdRotDtrTgt } from './types.ts'
import { formatTruncCompact } from '@/shared/lib/number.ts'

export function fmtSvdRotDur(durScnd: number): string {
  return `${formatTruncCompact(Math.max(0, durScnd), 1)}s`
}

export function fmtSvdRotNtg(value: number): string {
  return Math.round(value).toLocaleString()
}

export function getSvdRotDps(entry: InvRotEnt): number | null {
  const avg = entry.summary?.total.avg ?? 0
  return entry.duration > 0 && avg > 0 ? avg / entry.duration : null
}

export function mkSvdRotDtrD(
  target: SvdRotDtrTgt | null | undefined,
): SvdRotDtrDrf {
  const rotation = target?.rotation
  return {
    name: rotation?.name ?? '',
    duration: String(target?.kind === 'edit' ? target.rotation.duration : 0),
    note: target?.kind === 'edit' ? target.rotation.note : '',
  }
}

export function slgfRotFileN(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function mkRotXprtPay(entry: InvRotEnt) {
  return {
    source: 'wuwa-calculator',
    kind: 'rotation-export',
    version: 1,
    exportedAt: new Date().toISOString(),
    rotation: {
      name: entry.name,
      mode: entry.mode,
      resonatorId: entry.resonatorId,
      resonatorName: entry.resonatorName,
      duration: entry.duration,
      note: entry.note,
      team: entry.team ?? [],
      items: cloneRotNds(entry.items),
      snapshot: entry.snapshot ?? null,
      summary: entry.summary ?? null,
    },
  }
}

export function dwnlJsonFile(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/json',
  })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

export function normMprtRot(
  raw: unknown,
): {
  name: string
  mode: 'personal' | 'team'
  resonatorId: string
  resName: string
  duration?: number
  note?: string
  team?: ResRuntime['build']['team']
  items: RotationNode[]
  snapshot?: InvRotEnt['snapshot']
  summary?: InvRotEnt['summary']
} | null {
  if (!raw || typeof raw !== 'object') {
    return null
  }

  const value = raw as Record<string, unknown>
  const mode =
    value.mode === 'team'
      ? 'team'
      : value.mode === 'personal'
        ? 'personal'
        : null

  const resonatorId = typeof value.resonatorId === 'string' ? value.resonatorId : null
  const resName = typeof value.resonatorName === 'string' ? value.resonatorName : null
  const name = typeof value.name === 'string' ? value.name : null
  const items = Array.isArray(value.items)
    ? cloneRotNds(value.items as RotationNode[], { freshIds: true })
    : null

  if (!mode || !resonatorId || !resName || !name || !items) {
    return null
  }

  const team = Array.isArray(value.team)
    ? value.team.filter((entry): entry is string => typeof entry === 'string')
    : undefined

  return {
    name,
    mode,
    resonatorId,
    resName: resName,
    duration: normInvRotDu(value.duration),
    note: normInvRotNo(value.note),
    ...(team ? { team: team as ResRuntime['build']['team'] } : {}),
    items,
    ...(value.snapshot ? { snapshot: value.snapshot as InvRotEnt['snapshot'] } : {}),
    ...(value.summary ? { summary: value.summary as InvRotEnt['summary'] } : {}),
  }
}
