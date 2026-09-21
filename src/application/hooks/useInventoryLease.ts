/*
  Author: Runor Ewhro
  Description: Keeps lazy inventory data resident only while an active surface
               owns it. The store delays final eviction so quick reopenings do
               not repeatedly parse storage.
*/

import { useEffect } from 'react'
import { useAppStore } from '@/application/state'

export function useInventoryLease(active = true): void {
  const acquire = useAppStore((state) => state.acquireInvLease)

  useEffect(() => {
    if (!active) return undefined
    return acquire()
  }, [acquire, active])
}
