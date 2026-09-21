/*
  Author: Runor Ewhro
  Description: Lazy-loads the inventory layer and keeps the global loader active
               until the opened modal has committed.
*/

import { Suspense, lazy, useCallback, useEffect, useState } from 'react'
import { useAppStore } from '@/application/state'
import AppLdrVrly from '@/shared/ui/AppLoaderOverlay.tsx'
import { useInventoryLease } from '@/application/hooks/useInventoryLease.ts'

const LazyInventoryLayer = lazy(async () => ({
  default: (await import('@/modules/simulation/features/inventory/InventoryLayer.tsx')).InvLyr,
}))

export function Inventory() {
  const invHasMntd = useAppStore((state) => state.invMounted)
  const invOpen = useAppStore((state) => state.invOpen)
  const [invReady, setInvReady] = useState(false)
  useInventoryLease(invOpen)

  useEffect(() => {
    if (!invOpen) {
      // Each opening must wait for a new modal commit before releasing the loader.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setInvReady(false)
    }
  }, [invOpen])

  const markInvReady = useCallback(() => {
    setInvReady(true)
  }, [])

  if (!invHasMntd) {
    return null
  }

  return (
    <>
      <Suspense fallback={null}>
        <LazyInventoryLayer onReady={markInvReady} />
      </Suspense>
      {invOpen && !invReady ? <AppLdrVrly mode="scrim" text="Loading inventory..." /> : null}
    </>
  )
}
