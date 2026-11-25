/*
  Author: Runor Ewhro
  description: players listed on the page this session, used by the finder for
               names since the service has no name search.
*/

import type { Row } from './listed'

export const seenPlayers = new Map<string, { uid: string | null; buildId: string; name: string | null }>()

export function seeRows(rows: Array<Pick<Row, 'uid' | 'buildId' | 'name'>>) {
  for (const row of rows) {
    const key = row.uid ?? `b:${row.buildId}`
    if (!seenPlayers.has(key)) seenPlayers.set(key, { uid: row.uid, buildId: row.buildId, name: row.name })
  }
}
