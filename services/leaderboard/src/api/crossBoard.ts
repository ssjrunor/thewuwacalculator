/*
  Author: Runor Ewhro
  description: builds from several boards at once (bookmarks, a profile's
               featured builds, the feed and activity): ids grouped by board,
               one standings call per board, in parallel.
*/

import type { ApiEnv } from '../env.ts'
import { formatBuildId, parseBuildId } from '../lib/ids.ts'
import type { RowView } from '../board/reads.ts'
import { boardOf } from './stubs.ts'

/** each id's row on its board; an id that is not one, or names no build, is left out. */
export async function rowsOf(env: Pick<ApiEnv, 'BOARDS'>, ids: string[]): Promise<Map<string, RowView>> {
  const byBoard = new Map<number, number[]>()
  for (const id of new Set(ids)) {
    const key = parseBuildId(id)
    if (key) byBoard.set(key.resonator, [...byBoard.get(key.resonator) ?? [], key.local])
  }
  const found = new Map<string, RowView>()
  await Promise.all([...byBoard].map(async ([resonator, locals]) => {
    const rows = await boardOf(env, resonator).standings(resonator, locals)
    rows.forEach((row, i) => { if (row) found.set(formatBuildId({ resonator, local: locals[i] }), row) })
  }))
  return found
}

/** a build others may open: kept and not hidden by its owner; the player listing is checked in D1. */
export const isOpen = (row: RowView | undefined): row is RowView =>
  !!row && row.state === 'active' && !row.ownerHidden

/** reads the resonator from a build id. */
export const resonatorOfId = (id: string): string | null => {
  const key = parseBuildId(id)
  return key ? String(key.resonator) : null
}
