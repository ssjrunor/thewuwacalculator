/*
  Author: Runor Ewhro
  Description: Shared radix-tooltip wrapper with app-level defaults for delay,
               placement, and close timing.
*/

import React from 'react'
import * as RadixTooltip from '@radix-ui/react-tooltip'
import type { ReactNode } from 'react'

export interface TooltipProps {
  children: ReactNode
  content: ReactNode
  placement?: 'top' | 'right' | 'bottom' | 'left'
  className?: string
  delay?: number
}

const TLTPCLSDURMS = 180

export function AppTltpProv({ children }: { children: ReactNode }) {
  return (
    <RadixTooltip.Provider delayDuration={140} skipDelayDuration={120} disableHoverableContent>
      {children}
    </RadixTooltip.Provider>
  )
}

export const Tooltip: React.FC<TooltipProps> = ({
  children,
  content,
  placement = 'top',
  className = '',
  delay = 200,
}) => {
  const [open, setOpen] = React.useState(false)
  const [present, setPresent] = React.useState(false)
  const [closing, setClosing] = React.useState(false)
  const clsTmrRef = React.useRef<number | null>(null)

  React.useEffect(() => {
    return () => {
      if (clsTmrRef.current !== null) {
        window.clearTimeout(clsTmrRef.current)
      }
    }
  }, [])

  const syncPresence = React.useCallback((nextOpen: boolean) => {
    if (clsTmrRef.current !== null) {
      window.clearTimeout(clsTmrRef.current)
      clsTmrRef.current = null
    }

    if (nextOpen) {
      setPresent(true)
      setClosing(false)
      setOpen(true)
      return
    }

    setOpen(false)
    setPresent(true)
    setClosing(true)
    clsTmrRef.current = window.setTimeout(() => {
      setPresent(false)
      setClosing(false)
      clsTmrRef.current = null
    }, TLTPCLSDURMS)
  }, [])

  const changeOpen = (nextOpen: boolean) => {
    syncPresence(nextOpen)
  }

  return (
    <RadixTooltip.Root
      open={open}
      onOpenChange={changeOpen}
      delayDuration={delay}
      disableHoverableContent
    >
      <RadixTooltip.Trigger asChild>
        <span className={`tooltip-trigger ${className}`.trim()} style={{ display: 'inline-flex' }}>
          {children}
        </span>
      </RadixTooltip.Trigger>
      {present ? (
        <RadixTooltip.Portal>
          <RadixTooltip.Content
            forceMount
            side={placement}
            sideOffset={8}
            collisionPadding={12}
            className={`app-tooltip-container radix-tooltip-content ${closing ? 'is-closing' : 'is-opening'}`.trim()}
            style={{ zIndex: 99999 }}
          >
            <div className="app-tooltip-content">{content}</div>
          </RadixTooltip.Content>
        </RadixTooltip.Portal>
      ) : null}
    </RadixTooltip.Root>
  )
}

interface DmgTltpPrps {
  label: string
  metric: 'normal' | 'crit' | 'avg'
  formula?: string
}

export const DmgTltp: React.FC<DmgTltpPrps> = ({ label, metric, formula }) => {
  return (
    <div className="trace-node-tooltip damage-tooltip-wrapper">
      <div className="tooltip-header">
        <div className="tooltip-title">{label}</div>
      </div>

      {formula && (
        <div className="tooltip-section">
          <code className="formula-code">{`out.${metric} = ${formula}`}</code>
        </div>
      )}
    </div>
  )
}
