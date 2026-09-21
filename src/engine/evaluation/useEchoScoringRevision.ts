/*
  Author: Runor Ewhro
  Description: Subscribes React score displays to simulation-profile changes.
*/

import { useCallback, useMemo, useSyncExternalStore } from 'react'
import type { EchoInstance } from '@/domain/entities/runtime'
import {
  getEchoLoadoutScores,
  getEchoScoringRevision,
  getMaxEchoSc,
  subscribeEchoScoring,
} from '@/engine/evaluation/echoScoring'

export function useEchoScoringRevision(charId: string | null | undefined): number {
  const subscribe = useCallback((listener: () => void) => (
    charId ? subscribeEchoScoring(charId, listener) : () => undefined
  ), [charId])
  const getSnapshot = useCallback(
    () => charId ? getEchoScoringRevision(charId) : 0,
    [charId],
  )

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

export function useEchoScores(
  charId: string | null | undefined,
  echoes: Array<EchoInstance | null>,
): Array<number | null> | null {
  const revision = useEchoScoringRevision(charId)

  return useMemo(() => {
    void revision
    if (!charId || getMaxEchoSc(charId) <= 0) return null
    return getEchoLoadoutScores(charId, echoes)
  }, [charId, echoes, revision])
}
