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

const TOOLTIP_CLOSE_DURATION_MS = 180

export function AppTooltipProvider({ children }: { children: ReactNode }) {
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
  const closeTimerRef = React.useRef<number | null>(null)

  React.useEffect(() => {
    return () => {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current)
      }
    }
  }, [])

  const syncPresence = React.useCallback((nextOpen: boolean) => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
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
    closeTimerRef.current = window.setTimeout(() => {
      setPresent(false)
      setClosing(false)
      closeTimerRef.current = null
    }, TOOLTIP_CLOSE_DURATION_MS)
  }, [])

  const handleOpenChange = (nextOpen: boolean) => {
    syncPresence(nextOpen)
  }

  return (
    <RadixTooltip.Root
      open={open}
      onOpenChange={handleOpenChange}
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

interface DamageTooltipProps {
  label: string
  formula?: string
}

export const DamageTooltip: React.FC<DamageTooltipProps> = ({ label, formula }) => {
  return (
    <div className="damage-tooltip-wrapper">
      <div className="tooltip-header">
        <div className="tooltip-title">{label}</div>
      </div>
      
      {formula && (
        <div className="tooltip-section variant-formula">
          <div className="tooltip-section-title">Hits</div>
          <code className="formula-code">{formula}</code>
        </div>
      )}
    </div>
  )
}
