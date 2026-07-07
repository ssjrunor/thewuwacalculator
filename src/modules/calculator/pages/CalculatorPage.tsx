/*
  Author: Runor Ewhro
  Description: renders the calculator page.
*/

import { Suspense, lazy, useEffect, useRef, useState } from 'react'
import { useAppStore } from '@/domain/state/store'
import { selActResId, selWorkDrvd } from '@/domain/state/selectors'
import { seedRsnt, seedRsntById } from '@/modules/calculator/features/resonator/lib/seedData.ts'
import { ATTR_COLORS } from '@/modules/calculator/model/display'
import { usePrefetchAsmBench } from '@/modules/calculator/model/useBuildBenchmark.ts'
import { ResQBbbl } from '@/shared/ui/ResonatorQueueBubble'
import { useResQStr } from '@/shared/util/resonatorQueueStore.ts'
import { Inventory } from '@/modules/calculator/features/inventory/Inventory.tsx'
import { Calculator } from '@/modules/calculator/features/main/Calculator.tsx'
import { CalcProv } from '@/modules/calculator/features/main/lib/ctx.tsx'
import AppLdrVrly from '@/shared/ui/AppLoaderOverlay'

export type CalcSurface = 'calculator' | 'optimizer' | 'benchmark'

const LazyCalcOptS = lazy(async () => ({
  default: (await import('@/modules/calculator/features/optimizer/Optimizer.tsx')).Optimizer,
}))

const LazyCalcBnch = lazy(async () => ({
  default: (await import('@/modules/calculator/features/benchmark/Page.tsx')).Benchmark,
}))

interface CalcPageProps {
  surface?: CalcSurface
}

// orchestrates the calculator shell, route-selected stage, and theme accent around the main.
export function CalcPage({ surface = 'calculator' }: CalcPageProps) {
  const layoutRef = useRef<HTMLDivElement | null>(null)
  const actResId = useAppStore(selActResId)
  const hasActProf = useAppStore((state) => {
    const resonatorId = state.calculator.session.activeResonatorId
    return Boolean(resonatorId && state.calculator.profiles[resonatorId])
  })
  const {
    actRt: actRt,
    partRtsById: partRntmById,
    actTgtSels,
  } = useAppStore(selWorkDrvd)
  const swtcToRes = useAppStore((state) => state.swRes)
  const bumpPickerFreq = useAppStore((state) => state.bumpPickFr)
  const [isCllpMode, setIsCllpMod] = useState(() =>
      typeof window !== 'undefined' ? window.innerWidth < 910 : false,
  )

  const activeSeed = actResId ? seedRsntById[actResId] ?? null : null
  const actTtrb = activeSeed?.attribute ?? 'aero'
  const curCcnt = ATTR_COLORS[actTtrb] ?? '#20bfb9'
  const pushToQueue = useResQStr((s) => s.pushToQueue)
  const prevResIdRef = useRef<string | null>(null)
  const shldSeedNtlF = useRef(Boolean(actResId && hasActProf))

  useEffect(() => {
    const prevId = prevResIdRef.current
    if (prevId && prevId !== actResId) {
      const prevSeed = seedRsntById[prevId]
      if (prevSeed) {
        pushToQueue({
          id: prevId,
          name: prevSeed.name,
          icon: prevSeed.profile ?? '/assets/default.webp',
        })
      }
    }
    prevResIdRef.current = actResId
  }, [actResId, pushToQueue])

  useEffect(() => {
    if (!shldSeedNtlF.current || !actResId || !hasActProf) {
      return
    }

    shldSeedNtlF.current = false
    bumpPickerFreq([
      {
        bucket: 'resonator',
        ids: [actResId],
      },
      {
        bucket: 'teamResonator',
        slot: 'active',
        ids: [actResId],
      },
    ])
  }, [actResId, bumpPickerFreq, hasActProf])

  useEffect(() => {
    if (!hasActProf) {
      const fallbackId = actResId ?? seedRsnt[0]?.id
      if (fallbackId) swtcToRes(fallbackId)
    }
  }, [actResId, swtcToRes, hasActProf])

  useEffect(() => {
    const onResize = () => {
      setIsCllpMod(window.innerWidth < 910)
    }

    onResize()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty('--resonator-accent', curCcnt)

    return () => {
      root.style.removeProperty('--resonator-accent')
    }
  }, [curCcnt])

  usePrefetchAsmBench({
    runtime: actRt,
    runtimesById: partRntmById,
    targetSelections: actTgtSels,
    enabled: hasActProf,
  })

  return (
      <CalcProv
        actResId={actResId}
        actRt={actRt}
        prtcRntmById={partRntmById}
      >
      <div ref={layoutRef} className={`layout ${isCllpMode ? 'collapsed-mode' : ''}`}>
        <Inventory />

        {surface === 'optimizer' ? (
          <Suspense fallback={<AppLdrVrly mode="centered" text="Loading optimizer..." />}>
            <LazyCalcOptS />
          </Suspense>
        ) : null}
        {surface === 'benchmark' ? (
          <Suspense fallback={<AppLdrVrly mode="centered" text="Loading benchmark..." />}>
            <LazyCalcBnch />
          </Suspense>
        ) : null}
        {surface === 'calculator' ? <Calculator isCllpMode={isCllpMode} /> : null}

        <ResQBbbl />
      </div>
      </CalcProv>
  )
}
