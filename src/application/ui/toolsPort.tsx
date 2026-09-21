/*
  Author: Runor Ewhro
  Description: Provides the persistent chrome portal target used by route-owned tool controls.
*/

import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'

// the node is not there on the pass that first draws the page under it, so what
// is handed down is the node once it stands, and nothing before that
const PortCtx = createContext<HTMLElement | null>(null)

export function ChromeToolsProv({ port, children }: { port: HTMLElement | null, children: ReactNode }) {
  return <PortCtx.Provider value={port}>{children}</PortCtx.Provider>
}

export function ChromeTools({ children }: { children: ReactNode }) {
  const port = useContext(PortCtx)

  return port ? createPortal(children, port) : null
}
