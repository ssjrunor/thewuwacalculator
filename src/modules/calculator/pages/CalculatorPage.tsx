import { Suspense, lazy, useEffect, useRef, useState } from 'react'
import { useAppStore } from '@/domain/state/store'
import { selectActiveResonatorId } from '@/domain/state/selectors'
import { seedResonators, seedResonatorsById } from '@/modules/calculator/model/seedData'
import { ATTRIBUTE_COLORS } from '@/modules/calculator/model/overviewStats'
import { ResonatorQueueBubble } from '@/shared/ui/ResonatorQueueBubble'
import { useResonatorQueueStore } from '@/shared/util/resonatorQueueStore.ts'
import { DeferredInventoryLayer } from '@/modules/calculator/components/stages/DeferredInventoryLayer'
import { CalculatorWorkspaceStage } from '@/modules/calculator/components/stages/CalculatorWorkspaceStage'
import AppLoaderOverlay from '@/shared/ui/AppLoaderOverlay'

const LazyCalculatorOptimizerStage = lazy(async () => ({
  default: (await import('@/modules/calculator/components/optimizer/CalculatorOptimizerStage')).CalculatorOptimizerStage,
}))

const LazyCalculatorOverviewStage = lazy(async () => ({
  default: (await import('@/modules/calculator/components/stages/CalculatorOverviewStage')).CalculatorOverviewStage,
}))

// orchestrates the calculator shell, stage routing, and theme accent around the workspace.
export function CalculatorPage() {
  const layoutRef = useRef<HTMLDivElement | null>(null)
  const ui = useAppStore((state) => state.ui)
  const activeResonatorId = useAppStore(selectActiveResonatorId)
  const hasActiveProfile = useAppStore((state) => {
    const resonatorId = state.calculator.session.activeResonatorId
    return Boolean(resonatorId && state.calculator.profiles[resonatorId])
  })
  const switchToResonator = useAppStore((state) => state.switchToResonator)
  const [isCollapsedMode, setIsCollapsedMode] = useState(() =>
      typeof window !== 'undefined' ? window.innerWidth < 910 : false,
  )

  const activeSeed = activeResonatorId ? seedResonatorsById[activeResonatorId] ?? null : null
  const activeAttribute = activeSeed?.attribute ?? 'aero'
  const currentAccent = ATTRIBUTE_COLORS[activeAttribute] ?? '#20bfb9'
  const pushToQueue = useResonatorQueueStore((s) => s.pushToQueue)
  const prevResonatorIdRef = useRef<string | null>(null)

  useEffect(() => {
    const prevId = prevResonatorIdRef.current
    if (prevId && prevId !== activeResonatorId) {
      const prevSeed = seedResonatorsById[prevId]
      if (prevSeed) {
        pushToQueue({
          id: prevId,
          name: prevSeed.name,
          icon: prevSeed.profile ?? '/assets/default-icon.webp',
        })
      }
    }
    prevResonatorIdRef.current = activeResonatorId
  }, [activeResonatorId, pushToQueue])

  useEffect(() => {
    if (!hasActiveProfile) {
      const fallbackId = activeResonatorId ?? seedResonators[0]?.id
      if (fallbackId) switchToResonator(fallbackId)
    }
  }, [activeResonatorId, switchToResonator, hasActiveProfile])

  useEffect(() => {
    const onResize = () => {
      setIsCollapsedMode(window.innerWidth < 910)
    }

    onResize()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    const body = layoutRef.current?.closest('body')
    if (!(body instanceof HTMLElement)) {
      return
    }

    body.style.setProperty('--resonator-accent', currentAccent)

    return () => {
      body.style.removeProperty('--resonator-accent')
    }
  }, [currentAccent])

  return (
      <div ref={layoutRef} className={`layout ${isCollapsedMode ? 'collapsed-mode' : ''}`}>
        <DeferredInventoryLayer />

        {ui.mainMode === 'optimizer' ? (
          <Suspense fallback={<AppLoaderOverlay mode="centered" text="Loading optimizer..." />}>
            <LazyCalculatorOptimizerStage />
          </Suspense>
        ) : null}
        {ui.mainMode === 'overview' ? (
          <Suspense fallback={<AppLoaderOverlay mode="centered" text="Loading overview..." />}>
            <LazyCalculatorOverviewStage />
          </Suspense>
        ) : null}
        {ui.mainMode === 'default' ? <CalculatorWorkspaceStage isCollapsedMode={isCollapsedMode} /> : null}

        <ResonatorQueueBubble />
      </div>
  )
}
