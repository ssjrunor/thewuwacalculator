/*
  Author: Runor Ewhro
  Description: Mounts canonical Simulation tools and temporary legacy surfaces,
               and owns initialization shared by every simulation route.
*/

import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '@/domain/state/store'
import {
  selEnemyProf,
  selScenarioProfiles,
  selSubjectResonatorId,
  selWorkDrvd,
} from '@/domain/state/selectors'
import { seedRsnt, seedRsntById } from '@/modules/simulation/features/resonator/lib/seedData.ts'
import { ATTR_COLORS } from '@/modules/simulation/model/display'
import { selLiveRun } from '@/modules/simulation/model/selectors.ts'
import { prepareEchoMainStatScoring } from '@/data/scoring/echoMainStatProfile.ts'
import { ResQBbbl } from '@/shared/ui/ResonatorQueueBubble'
import { useResQStr } from '@/shared/util/resonatorQueueStore.ts'
import { Inventory } from '@/modules/simulation/features/inventory/Inventory.tsx'
import { SimulationProvider } from '@/modules/simulation/context/SimulationContext.tsx'
import AppLdrVrly from '@/shared/ui/AppLoaderOverlay'
import {
  buildWorkspacePane,
  legacyCalculatorPane,
  legacyOptimizerPane,
  rotationPane,
} from '@/app/nav/routeChunks'
import { ImportSurfaceProvider } from '@/infra/imports/ImportSurface.tsx'
import { ShareLinkWatcher } from '@/infra/imports/ShareLinkWatcher.tsx'

export type SimulationSurface =
  | 'modulation'
  | 'rotation'
  | 'showcase'
  | 'optimizer'
  | 'suggestions'
  | 'legacy-calculator'
  | 'legacy-optimizer'

// the panes are the same warmable chunks the rail fetches on intent, so a
// surface reached from the rail mounts without a loader in the way
const LazyWorkspace = buildWorkspacePane.Mount
const LazyLegacyCalculator = legacyCalculatorPane.Mount
const LazyLegacyOptimizer = legacyOptimizerPane.Mount
const LazyRotation = rotationPane.Mount

// These pages share one working surface and route identity. Showcase swaps in
// its distinct card-authoring presentation while retaining the shared roster.
const WORKSPACE_PAGES = {
  modulation: 'Loading Modulation...',
  optimizer: 'Loading optimizer...',
  showcase: 'Loading showcase...',
  suggestions: 'Loading suggestions...',
} as const

type WorkspaceRoute = keyof typeof WORKSPACE_PAGES

function isWorkspaceRoute(surface: SimulationSurface): surface is WorkspaceRoute {
  return surface in WORKSPACE_PAGES
}

interface SimulationPageProps {
  surface: SimulationSurface
}

export function SimulationPage({ surface }: SimulationPageProps) {
  const layoutRef = useRef<HTMLDivElement | null>(null)
  const subjectResonatorId = useAppStore(selSubjectResonatorId)
  const profiles = useAppStore(selScenarioProfiles)
  const enemyProfile = useAppStore(selEnemyProf)
  const {
    scenario,
    prepWork,
    actRt: runtime,
    partRtsById: participantRuntimesById,
    actTgtSels,
  } = useAppStore(selWorkDrvd)
  const hasSubjectProfile = Boolean(subjectResonatorId && profiles[subjectResonatorId])
  const swtcToRes = useAppStore((state) => state.swRes)
  const bumpPickerFreq = useAppStore((state) => state.bumpPickFr)
  const [isCllpMode, setIsCllpMod] = useState(() =>
      typeof window !== 'undefined' ? window.innerWidth < 910 : false,
  )

  const subjectSeed = subjectResonatorId
    ? seedRsntById[subjectResonatorId] ?? null
    : null
  const echoScoringSimulation = useMemo(
    () => selLiveRun(subjectSeed ? prepWork : null),
    [prepWork, subjectSeed],
  )
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

  // Prime shared Echo scoring at the Simulation shell so no canonical tool
  // depends on a legacy surface or another tool having mounted first.
  useEffect(() => {
    if (!scenario || !runtime || !subjectSeed || !echoScoringSimulation) {
      return
    }

    const member = scenario.team.members.find(
      (entry) => entry.resonatorId === runtime.id,
    )
    if (!member) {
      return
    }

    void prepareEchoMainStatScoring({
        scenarioId: scenario.id,
        memberId: member.id,
        runtime,
        seed: subjectSeed,
        enemy: enemyProfile,
        runtimesById: participantRuntimesById,
        selectedTargets: actTgtSels,
        setConds: member.local.setConditionals,
        simulation: echoScoringSimulation,
      })
      .catch((error) => {
        console.error('Failed to prepare Echo main-stat scoring.', error)
      })
  }, [
    actTgtSels,
    echoScoringSimulation,
    enemyProfile,
    participantRuntimesById,
    runtime,
    scenario,
    subjectSeed,
  ])

  return (
      <SimulationProvider actResId={subjectResonatorId}>
      <ImportSurfaceProvider>
      <ShareLinkWatcher enabled />
      <div ref={layoutRef} className={`layout ${isCllpMode ? 'collapsed-mode' : ''}`}>
        <Inventory />

        {isWorkspaceRoute(surface) ? (
          <Suspense fallback={(
            <AppLdrVrly
              mode="centered" className="app-loader-fallback--route"
              text={WORKSPACE_PAGES[surface]}
            />
          )}>
            <LazyWorkspace page={surface} />
          </Suspense>
        ) : null}
        {surface === 'legacy-optimizer' ? (
          <Suspense fallback={(
            <AppLdrVrly
              mode="centered" className="app-loader-fallback--route"
              text="Loading legacy optimizer..."
            />
          )}>
            <LazyLegacyOptimizer />
          </Suspense>
        ) : null}
        {surface === 'rotation' ? (
          <Suspense fallback={(
            <AppLdrVrly
              mode="centered" className="app-loader-fallback--route"
              text="Loading rotation editor..."
            />
          )}>
            <LazyRotation />
          </Suspense>
        ) : null}
        {surface === 'legacy-calculator' ? (
          <Suspense fallback={(
            <AppLdrVrly
              mode="centered" className="app-loader-fallback--route"
              text="Loading legacy calculator..."
            />
          )}>
            <LazyLegacyCalculator isCllpMode={isCllpMode} />
          </Suspense>
        ) : null}

        <ResQBbbl />
      </div>
      </ImportSurfaceProvider>
      </SimulationProvider>
  )
}
