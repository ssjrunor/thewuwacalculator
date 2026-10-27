/*
  Author: Runor Ewhro
  description: mounts simulation surfaces and initializes shared simulation state.
*/

import { Suspense, useEffect, useRef, useState } from 'react'
import { useAppStore } from '@/application/state'
import { selSubjectResonatorId } from '@/application/state'
import { selectedCombatScenario } from '@/domain/entities/scenarioLibrary'
import { useResonatorData } from '@/application/hooks/useResonatorData'
import { seedRsnt, seedRsntById } from '@/modules/simulation/features/resonator/lib/seedData.ts'
import { ATTR_COLORS } from '@/modules/simulation/model/display'
import { QueuedResonatorPicker } from '@/modules/simulation/shell/QueuedResonatorPicker'
import { useResQStr } from '@/shared/util/resonatorQueueStore.ts'
import { Inventory } from '@/modules/simulation/features/inventory/Inventory.tsx'
import { SimulationProvider } from '@/modules/simulation/shell/context/SimulationContext.tsx'
import AppLdrVrly from '@/shared/ui/AppLoaderOverlay'
import {
  buildWorkspacePane,
  rotationPane,
} from '@/modules/simulation/shell/surfaceChunks'
import { ImportSurfaceProvider } from '@/modules/simulation/shell/imports/Surface.tsx'
import { ShareLinkWatcher } from '@/modules/simulation/shell/imports/ShareLinkWatcher.tsx'
import { useSimulationSurface } from '@/modules/simulation/shell/simulationSurface'
import { SkllDataProv } from '@/modules/simulation/features/resonator/SkillDataHost'
import { releaseEvaluationResources } from '@/engine/evaluation/buildEvaluationClient'
import { clearSuggsSss } from '@/engine/suggestions/sessionCache'
import { releaseCalculationGameData } from '@/data/gameData'
import { SIMULATION_SURFACES, isWorkspaceSurface } from '@/shared/lib/appRoutes'
import { isSimulationRoute } from '@/shared/lib/appRoutes'
import type { SimulationSurface } from '@/shared/lib/appRoutes'
import { layoutViewportWidth } from '@/shared/lib/layoutViewport'

// the panes are the same warmable chunks the rail fetches on intent, so a
// surface reached from the rail mounts without a loader in the way
const LazyWorkspace = buildWorkspacePane.Mount
const LazyRotation = rotationPane.Mount

const LOADING_TEXT: Record<SimulationSurface, string> = {
  modulation: 'Loading Modulation...',
  optimizer: 'Loading optimizer...',
  showcase: 'Loading showcase...',
  suggestions: 'Loading suggestions...',
  rotation: 'Loading rotation editor...',
}

export function SimulationPage() {
  const teamIds = useAppStore((state) => selectedCombatScenario(state.combat).team.members
    .map((member) => member.resonatorId).join(','))
  const dataReady = useResonatorData(teamIds ? teamIds.split(',') : [])

  if (!dataReady) {
    return <AppLdrVrly mode="centered" className="app-loader-fallback--route" text="Loading game data..." />
  }

  return <ReadySimulationPage />
}

function ReadySimulationPage() {
  const surface = useSimulationSurface()
  useEffect(() => () => {
    // strict mode's development effect replay remains on a simulation url.
    if (!isSimulationRoute(window.location.pathname)) releaseCalculationGameData()
  }, [])
  useEffect(() => () => {
    releaseEvaluationResources()
    if (surface === 'suggestions') clearSuggsSss([''])
  }, [surface])
  const pane = surface ? SIMULATION_SURFACES[surface].pane : null
  const layoutRef = useRef<HTMLDivElement | null>(null)
  const subjectResonatorId = useAppStore(selSubjectResonatorId)
  const hasSubjectProfile = Boolean(subjectResonatorId)
  const swtcToRes = useAppStore((state) => state.swRes)
  const bumpPickerFreq = useAppStore((state) => state.bumpPickFr)
  const [isCllpMode, setIsCllpMod] = useState(() =>
      typeof window !== 'undefined' ? layoutViewportWidth() < 910 : false,
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
      setIsCllpMod(layoutViewportWidth() < 910)
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
    <SkllDataProv>
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
          </Suspense>
        ) : null}

        <QueuedResonatorPicker />
      </div>
      </ImportSurfaceProvider>
      </SimulationProvider>
    </SkllDataProv>
  )
}
