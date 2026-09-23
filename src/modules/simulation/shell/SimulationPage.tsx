/*
  Author: Runor Ewhro
  Description: Mounts canonical Simulation tools and temporary legacy surfaces,
               and owns initialization shared by every simulation route.
*/

import { Suspense, useEffect, useRef, useState } from 'react'
import { useAppStore } from '@/application/state'
import { selSubjectResonatorId } from '@/application/state'
import { seedRsnt, seedRsntById } from '@/modules/simulation/features/resonator/lib/seedData.ts'
import { ATTR_COLORS } from '@/modules/simulation/model/display'
import { ResQBbbl } from '@/modules/simulation/shell/ResonatorQueueBubble'
import { useResQStr } from '@/shared/util/resonatorQueueStore.ts'
import { Inventory } from '@/modules/simulation/features/inventory/Inventory.tsx'
import { SimulationProvider } from '@/modules/simulation/shell/context/SimulationContext.tsx'
import AppLdrVrly from '@/shared/ui/AppLoaderOverlay'
import {
  buildWorkspacePane,
  legacyCalculatorPane,
  legacyOptimizerPane,
  rotationPane,
} from '@/modules/simulation/shell/surfaceChunks'
import { ImportSurfaceProvider } from '@/modules/simulation/shell/imports/ImportSurface.tsx'
import { ShareLinkWatcher } from '@/modules/simulation/shell/imports/ShareLinkWatcher.tsx'
import { useSimulationSurface } from '@/modules/simulation/shell/simulationSurface'
import { SIMULATION_SURFACES, isWorkspaceSurface } from '@/shared/lib/appRoutes'
import type { SimulationSurface } from '@/shared/lib/appRoutes'

// the panes are the same warmable chunks the rail fetches on intent, so a
// surface reached from the rail mounts without a loader in the way
const LazyWorkspace = buildWorkspacePane.Mount
const LazyLegacyCalculator = legacyCalculatorPane.Mount
const LazyLegacyOptimizer = legacyOptimizerPane.Mount
const LazyRotation = rotationPane.Mount

const LOADING_TEXT: Record<SimulationSurface, string> = {
  modulation: 'Loading Modulation...',
  optimizer: 'Loading optimizer...',
  showcase: 'Loading showcase...',
  suggestions: 'Loading suggestions...',
  rotation: 'Loading rotation editor...',
  'legacy-calculator': 'Loading legacy calculator...',
  'legacy-optimizer': 'Loading legacy optimizer...',
}

export function SimulationPage() {
  const surface = useSimulationSurface()
  const pane = surface ? SIMULATION_SURFACES[surface].pane : null
  const layoutRef = useRef<HTMLDivElement | null>(null)
  const subjectResonatorId = useAppStore(selSubjectResonatorId)
  const hasSubjectProfile = Boolean(subjectResonatorId)
  const swtcToRes = useAppStore((state) => state.swRes)
  const bumpPickerFreq = useAppStore((state) => state.bumpPickFr)
  const [isCllpMode, setIsCllpMod] = useState(() =>
      typeof window !== 'undefined' ? window.innerWidth < 910 : false,
  )

  const subjectSeed = subjectResonatorId
    ? seedRsntById[subjectResonatorId] ?? null
    : null
  const curCcnt = ATTR_COLORS[subjectSeed?.attribute ?? 'aero'] ?? '#20bfb9'
  const pushToQueue = useResQStr((s) => s.pushToQueue)
  const prevResIdRef = useRef<string | null>(null)
  const shldSeedNtlF = useRef(Boolean(subjectResonatorId && hasSubjectProfile))

  useEffect(() => {
    const prevId = prevResIdRef.current
    if (prevId && prevId !== subjectResonatorId) {
      const prevSeed = seedRsntById[prevId]
      if (prevSeed) {
        pushToQueue({
          id: prevId,
          name: prevSeed.name,
          icon: prevSeed.profile ?? '/assets/game/default.webp',
        })
      }
    }
    prevResIdRef.current = subjectResonatorId
  }, [pushToQueue, subjectResonatorId])

  useEffect(() => {
    if (!shldSeedNtlF.current || !subjectResonatorId || !hasSubjectProfile) {
      return
    }

    shldSeedNtlF.current = false
    bumpPickerFreq([
      {
        bucket: 'resonator',
        ids: [subjectResonatorId],
      },
      {
        bucket: 'teamResonator',
        slot: 'active',
        ids: [subjectResonatorId],
      },
    ])
  }, [bumpPickerFreq, hasSubjectProfile, subjectResonatorId])

  useEffect(() => {
    if (!hasSubjectProfile) {
      const fallbackId = subjectResonatorId ?? seedRsnt[0]?.id
      if (fallbackId) swtcToRes(fallbackId)
    }
  }, [hasSubjectProfile, subjectResonatorId, swtcToRes])

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

  return (
      <SimulationProvider actResId={subjectResonatorId}>
      <ImportSurfaceProvider>
      <ShareLinkWatcher enabled />
      <div ref={layoutRef} className={`layout ${isCllpMode ? 'collapsed-mode' : ''}`}>
        <Inventory />

        {surface ? (
          <Suspense key={pane} fallback={(
            <AppLdrVrly
              mode="centered" className="app-loader-fallback--route"
              text={LOADING_TEXT[surface]}
            />
          )}>
            {isWorkspaceSurface(surface) ? <LazyWorkspace page={surface} /> : null}
            {pane === 'rotation' ? <LazyRotation /> : null}
            {pane === 'legacy-optimizer' ? <LazyLegacyOptimizer /> : null}
            {pane === 'legacy-calculator' ? <LazyLegacyCalculator isCllpMode={isCllpMode} /> : null}
          </Suspense>
        ) : null}

        <ResQBbbl />
      </div>
      </ImportSurfaceProvider>
      </SimulationProvider>
  )
}
