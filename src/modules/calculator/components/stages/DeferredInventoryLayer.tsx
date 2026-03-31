import { Suspense, lazy } from 'react'
import { useAppStore } from '@/domain/state/store'
import AppLoaderOverlay from '@/shared/ui/AppLoaderOverlay'

const LazyCalculatorInventoryLayer = lazy(async () => ({
  default: (await import('@/modules/calculator/components/inventory/CalculatorInventoryLayer')).CalculatorInventoryLayer,
}))

// defers the inventory modal until the store marks it as mounted.
export function DeferredInventoryLayer() {
  const inventoryHasMounted = useAppStore((state) => state.inventoryHasMounted)

  if (!inventoryHasMounted) {
    return null
  }

  return (
    <Suspense fallback={<AppLoaderOverlay mode="scrim" text="Loading inventory..." />}>
      <LazyCalculatorInventoryLayer />
    </Suspense>
  )
}
