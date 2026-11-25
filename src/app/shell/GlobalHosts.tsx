/*
  Author: Runor Ewhro
  description: mounts app-wide hosts outside route lifecycle.
*/

import { lazy, Suspense, useState } from 'react'
import { NavHold } from '@/app/nav/NavHold'
import { DlyNtc } from '@/app/shell/DailyNotice'
import { NtfcTstCntn } from '@/shared/ui/NotificationToast'
import { CookieBanner } from '@/app/shell/CookieBanner'
import { BetaNoticeModal } from '@/app/shell/BetaNoticeModal'
import { useCkBnnr } from '@/app/hooks/useCookieBanner.ts'
import { useEchoImportRequested, useGameImportRequested } from '@/modules/simulation/api/chromeRequests'
import { useLocation } from 'react-router-dom'
import { useLbChrome } from '@/modules/leaderboard/chrome/chrome'
import { APP_ROUTES } from '@/shared/lib/appRoutes'

const EchoImportHost = lazy(async () => ({ default: (await import('@/modules/simulation/api/globalHosts')).EchoImportHost }))
const ImportStamp = lazy(async () => ({ default: (await import('@/modules/simulation/api/globalHosts')).ImportStamp }))
const GameImportHost = lazy(async () => ({ default: (await import('@/modules/simulation/api/globalHosts')).Host }))
const SubmitDock = lazy(async () => ({ default: (await import('@/modules/leaderboard/chrome/SubmitDock')).SubmitDock }))
const EnemyConsoleHost = lazy(async () => ({ default: (await import('@/modules/simulation/api/globalHosts')).EnemyConsoleHost }))

export function GlobalHosts({ simulating }: { simulating: boolean }) {
  const cookieBanner = useCkBnnr()
  const echoImportRequested = useEchoImportRequested()
  const gameImportRequested = useGameImportRequested()
  // the submit dock waits on the leaderboard; elsewhere it loads once a card is being submitted or followed.
  const onBoards = useLocation().pathname.startsWith(APP_ROUTES.leaderboard)
  const submitting = useLbChrome((s) => s.open || s.sent.length > 0)
  const [simulationVisited, setSimulationVisited] = useState(simulating)
  const [echoImportVisited, setEchoImportVisited] = useState(echoImportRequested)
  if (simulating && !simulationVisited) setSimulationVisited(true)
  if (echoImportRequested && !echoImportVisited) setEchoImportVisited(true)

  return (
    <>
      {simulationVisited || echoImportVisited ? <Suspense fallback={null}><EchoImportHost /><ImportStamp />
        {simulationVisited ? <EnemyConsoleHost /> : null}</Suspense> : null}
      {gameImportRequested ? <Suspense fallback={null}><GameImportHost /></Suspense> : null}
      {onBoards || submitting ? <Suspense fallback={null}><SubmitDock /></Suspense> : null}
      <NavHold />
      <DlyNtc />
      <NtfcTstCntn />
      <CookieBanner
        visible={cookieBanner.visible}
        open={cookieBanner.open}
        closing={cookieBanner.closing}
        onAccept={cookieBanner.accept}
      />
      {import.meta.env.MODE === 'beta' ? <BetaNoticeModal /> : null}
    </>
  )
}
