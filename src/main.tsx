/*
  Author: Runor Ewhro
  description: application bootstrap. loads game data async then mounts the
               react component tree into the dom root with router and global
               provider context.
*/
import { StrictMode, Suspense, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import '@/appearanceEntry'
import { initCoreGameData, initGameData, setCalculationDataPolicy } from '@/data/gameData/index'
import { readBootstrapResonatorIds } from '@/application/persistence/resonatorScope'
import { readPersistedGameDataMode } from '@/application/persistence/gameDataMode'
import { StartupErrorNotice } from '@/modules/system/pages/StartupErrorNotice'
import { RootErrorBoundary } from '@/modules/system/pages/RootErrorBoundary'
import { isSimulationRoute } from '@/shared/lib/appRoutes'
import AppLoaderOverlay from '@/shared/ui/AppLoaderOverlay'
setCalculationDataPolicy(() => isSimulationRoute(window.location.pathname))

const root = createRoot(document.getElementById('root')!)

function BootLoading() {
  useEffect(() => {
    document.documentElement.dataset.appEntryStarted = 'true'
    document.getElementById('boot-fallback')?.setAttribute('hidden', '')
  }, [])
  return <AppLoaderOverlay mode="centered" className="boot-loading" text="Loading game data..." />
}

function showStartupError(error: unknown) {
  console.error('Failed to start app:', error)
  root.render(<StartupErrorNotice error={error} />)
}

async function startApp() {
  root.render(
    <BootLoading />,
  )
  try {
    const gameDataMode = readPersistedGameDataMode()
    const options = { mode: gameDataMode, resonatorIds: readBootstrapResonatorIds() }
    if (isSimulationRoute(window.location.pathname)) await initGameData(options)
    else await initCoreGameData(options)
    const { AppRoot } = await import('@/app/AppRoot')

    root.render(
      <StrictMode>
        <RootErrorBoundary>
          <Suspense fallback={<BootLoading />}>
            <AppRoot />
          </Suspense>
        </RootErrorBoundary>
      </StrictMode>,
    )

    // telemetry is non-critical; initialize it only after startup failure
    // handling and the application root are installed.
    void import('@/shared/lib/webVitals').then(({ initWebVitals }) => initWebVitals())
      .catch((error) => console.warn('Failed to load field telemetry:', error))
  } catch (error) {
    showStartupError(error)
  }
}

void startApp()
