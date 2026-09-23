/*
  Author: Runor Ewhro
  Description: Application bootstrap. Loads game data async then mounts the
               react component tree into the dom root with router and global
               provider context.
*/
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { initGameData } from '@/data/gameData/index'
import { readBootstrapResonatorIds } from '@/application/persistence/resonatorScope'
import { readPersistedGameDataMode } from '@/application/persistence/gameDataMode'
import '@/index.css'

const gameDataMode = readPersistedGameDataMode()

initGameData({ mode: gameDataMode, resonatorIds: readBootstrapResonatorIds() }).then(async () => {
  const { AppRoot } = await import('@/app/AppRoot')

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <AppRoot />
    </StrictMode>,
  )

  // field telemetry loads after mount so it never delays first paint.
  import('@/shared/lib/webVitals').then(({ initWebVitals }) => initWebVitals())
}).catch((error) => {
  console.error('Failed to load game data:', error)
  const root = document.getElementById('root')!
  root.textContent = 'Failed to load game data. Please refresh.'
})
