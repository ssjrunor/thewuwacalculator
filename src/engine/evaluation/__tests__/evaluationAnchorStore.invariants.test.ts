/*
  Author: Runor Ewhro
  Description: Locks persisted evaluation anchors to the current scoring revision.
*/

import { describe, expect, it } from 'vitest'
import type { EvaluationAnchors } from '@/engine/evaluation/evaluation/search.ts'
import {
  EVALUATION_ANCHOR_CACHE_REVISION,
  selectCurrentAnchorEntries,
  type StoredAnchor,
} from '@/engine/evaluation/evaluation/anchorStore.ts'

describe('evaluation anchor persistence', () => {
  it('rejects legacy scoring revisions before hydrating the anchor cache', () => {
    const legacy = { marker: 'legacy' } as unknown as EvaluationAnchors
    const current = { marker: 'current' } as unknown as EvaluationAnchors
    const rows: StoredAnchor[] = [
      { key: 'legacy-unversioned', anchors: legacy, ts: 1 },
      {
        key: 'legacy-versioned',
        anchors: legacy,
        ts: 2,
        revision: EVALUATION_ANCHOR_CACHE_REVISION - 1,
      },
      {
        key: 'current',
        anchors: current,
        ts: 3,
        revision: EVALUATION_ANCHOR_CACHE_REVISION,
      },
    ]

    expect(selectCurrentAnchorEntries(rows)).toEqual([['current', current]])
  })
})
