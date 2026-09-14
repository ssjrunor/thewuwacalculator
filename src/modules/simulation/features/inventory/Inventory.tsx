/*
  Author: Runor Ewhro
  Description: Renders the inventory surface shared by Simulation tools.
*/

import { Suspense, lazy } from 'react'
import { useAppStore } from '@/domain/state/store.ts'
import AppLdrVrly from '@/shared/ui/AppLoaderOverlay.tsx'

const LazyInventoryLayer = lazy(async () => ({
  default: (await import('@/modules/simulation/features/inventory/InventoryLayer.tsx')).InvLyr,
}))

// defers the inventory modal until the store marks it as mounted.
export function Inventory() {
  const invHasMntd = useAppStore((state) => state.invMounted)

  if (!invHasMntd) {
    return null
  }

  return (
    <Suspense fallback={<AppLdrVrly mode="scrim" text="Loading inventory..." />}>
      <LazyInventoryLayer />
    </Suspense>
  )
}
