/*
  Author: Runor Ewhro
  Description: Retains requested resonator bundles while a consumer is mounted
               and reports when their asynchronous data load completes.
*/

import { useEffect, useState } from 'react'
import { ensureResonatorData, hasResonatorData, holdResonatorData } from '@/data/gameData'
import { useTstStr } from '@/shared/util/toastStore'

export function useResonatorData(ids: readonly string[]): boolean {
  const key = [...new Set(ids)].sort().join(',')
  const [, refresh] = useState(0)
  useEffect(() => {
    if (!key) return
    const requested = key.split(',')
    const release = holdResonatorData(requested)
    let canceled = false
    void ensureResonatorData(requested).then(() => {
      if (!canceled) refresh((revision) => revision + 1)
    }).catch(() => {
      if (!canceled) useTstStr.getState().show({ content: 'Could not load resonator data. Please try again.', variant: 'error' })
    })
    return () => { canceled = true; release() }
  }, [key])
  return hasResonatorData(ids)
}
