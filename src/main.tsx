/*
  Author: Runor Ewhro
  Description: Application bootstrap. Loads game data async then mounts the
               react component tree into the dom root with router and global
               provider context.
*/
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { initGameData } from '@/data/gameData/index'
import { readPersistedGameDataMode } from '@/infra/persistence/gameDataMode'
import '@/index.css'

const gameDataMode = readPersistedGameDataMode()

initGameData({ mode: gameDataMode }).then(async () => {
  const [{ AppRoot }, { AppProviders }] = await Promise.all([
    import('@/app/AppRoot'),
    import('@/app/providers/AppProviders'),
  ])

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <AppProviders>
        <AppRoot />
      </AppProviders>
    </StrictMode>,
  )

  // field telemetry loads after mount so it never delays first paint.
  import('@/shared/lib/webVitals').then(({ initWebVitals }) => initWebVitals())
}).catch((error) => {
  console.error('Failed to load game data:', error)
  const root = document.getElementById('root')!
  root.textContent = 'Failed to load game data. Please refresh.'
})
