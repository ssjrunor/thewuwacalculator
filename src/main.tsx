/*
  Author: Runor Ewhro
  Description: Application bootstrap. Loads game data async then mounts the
               react component tree into the dom root with router and global
               provider context.
*/
import { StrictMode, Suspense, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import '@/appearanceEntry'
import { initGameData } from '@/data/gameData/index'
import { readBootstrapResonatorIds } from '@/application/persistence/resonatorScope'
import { readPersistedGameDataMode } from '@/application/persistence/gameDataMode'
import { StartupErrorNotice } from '@/modules/system/pages/StartupErrorNotice'
import { RootErrorBoundary } from '@/modules/system/pages/RootErrorBoundary'
const root = createRoot(document.getElementById('root')!)

function BootLoading() {
  useEffect(() => {
    document.documentElement.dataset.appEntryStarted = 'true'
    document.getElementById('boot-fallback')?.setAttribute('hidden', '')
  }, [])
  return <div className="boot-loading" role="status">Loading game data...</div>
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
    await initGameData({ mode: gameDataMode, resonatorIds: readBootstrapResonatorIds() })
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

    // Telemetry is non-critical; initialize it only after startup failure
    // handling and the application root are installed.
    void import('@/shared/lib/webVitals').then(({ initWebVitals }) => initWebVitals())
      .catch((error) => console.warn('Failed to load field telemetry:', error))
  } catch (error) {
    showStartupError(error)
  }
}

void startApp()
