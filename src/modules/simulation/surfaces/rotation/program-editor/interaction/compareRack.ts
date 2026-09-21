/*
  Author: Runor Ewhro
  Description: Retains removed comparison ids for a bounded exit interval and
               returns a stable ordered projection of active and leaving ids.
*/

import { useEffect, useMemo, useState } from 'react'

export const CMP_OUT_MS = 320

interface CompareMount {
  id: string
  index: number
  leaving: boolean
}

/**
 * Active comparison ids plus recently removed ids retained for the exit delay.
 */
export function useCompareMount(ids: readonly string[]): CompareMount[] {
  // Content identity prevents equal array instances from restarting retention.
  const key = ids.join('\u0000')
  const [held, setHeld] = useState({ key, ids: [...ids] })
  const [leaving, setLeaving] = useState<CompareMount[]>([])

  if (held.key !== key) {
    const gone = held.ids
      .map((id, index) => ({ id, index, leaving: true }))
      .filter((entry) => !ids.includes(entry.id))
    setHeld({ key, ids: [...ids] })
    if (gone.length > 0) {
      setLeaving((current) => [
        ...current.filter((entry) => !gone.some((left) => left.id === entry.id)),
        ...gone,
      ])
    }
  }

  // Removed ids expire together after the bounded retention interval.
  useEffect(() => {
    if (leaving.length === 0) {
      return
    }

    const timer = window.setTimeout(() => setLeaving([]), CMP_OUT_MS)
    return () => window.clearTimeout(timer)
  }, [leaving])

  // Memoize by content key so equal inputs preserve the projected array.
  return useMemo(() => [
    ...ids.map((id, index) => ({ id, index, leaving: false })),
    ...leaving.filter((entry) => !ids.includes(entry.id)),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [key, leaving])
}
