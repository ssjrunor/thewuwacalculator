/*
  Author: Runor Ewhro
  Description: Application bootstrap. Loads game data async then mounts the
               react component tree into the dom root with router and global
               provider context.
*/
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter as BrwsRtr } from 'react-router-dom'
import { initGameData } from '@/data/gameData/index'
import '@/index.css'

initGameData().then(async () => {
  const [{ AppRoot }, { AppProviders }] = await Promise.all([
    import('@/app/AppRoot'),
    import('@/app/providers/AppProviders'),
  ])

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <BrwsRtr>
        <AppProviders>
          <AppRoot />
        </AppProviders>
      </BrwsRtr>
    </StrictMode>,
  )
}).catch((error) => {
  console.error('Failed to load game data:', error)
  const root = document.getElementById('root')!
  root.textContent = 'Failed to load game data. Please refresh.'
})
