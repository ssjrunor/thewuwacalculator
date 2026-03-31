/**
  Author: Runor Ewhro
  Description: Application bootstrap. Loads game data async then mounts the
               React component tree into the DOM root with router and global
               provider context.
*/
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { initializeGameData } from '@/data/gameData/index'
import '@/index.css'

initializeGameData().then(async () => {
  const [{ AppRoot }, { AppProviders }] = await Promise.all([
    import('@/app/AppRoot'),
    import('@/app/providers/AppProviders'),
  ])

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <BrowserRouter>
        <AppProviders>
          <AppRoot />
        </AppProviders>
      </BrowserRouter>
    </StrictMode>,
  )
}).catch((error) => {
  console.error('Failed to load game data:', error)
  const root = document.getElementById('root')!
  root.textContent = 'Failed to load game data. Please refresh.'
})
