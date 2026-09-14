/*
  Author: Runor Ewhro
  Description: The transport bar's popup hosts and the rows their bodies use.
*/

import { useRef } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { echoStatIconSrc } from '@/modules/simulation/features/echoes/lib/statGlyph.tsx'
import {
  AnchoredAppPopup,
  AppPopupFill,
  AppPopupHeader,
  useAppPopupDismiss,
} from '@/shared/ui/AppPopup.tsx'

export function Glyph({ statKey, size = 0.8 }: { statKey: string; size?: number }) {
  const icon = echoStatIconSrc(statKey)
  if (!icon) {
    return null
  }

  return (
    <span className="opb-glyph"
      aria-hidden="true"
      style={{
        width: `${size}rem`,
        height: `${size}rem`,
        WebkitMaskImage: `url("${icon}")`,
        maskImage: `url("${icon}")`,
      } as CSSProperties}
    />
  )
}

export function DropHost({
  id,
  openId,
  onOpen,
  label,
  trigger,
  children,
}: {
  id: string
  openId: string | null
  onOpen: (id: string | null) => void
  label: string
  // the trigger renders itself so each control can wear the shape it needs: a
  // tag with a value, an icon tool, or an echo it is locked to.
  trigger: (args: { open: boolean; toggle: () => void }) => ReactNode
  children: ReactNode
}) {
  const open = openId === id
  const toggle = () => onOpen(open ? null : id)
  const hostRef = useRef<HTMLSpanElement | null>(null)
  const popupRef = useRef<HTMLDivElement | null>(null)

  useAppPopupDismiss({
    open,
    onDismiss: () => onOpen(null),
    hostRef,
    popupRef,
  })

  return (
    <span className="opb-host" ref={hostRef}>
      {trigger({ open, toggle })}
      <AnchoredAppPopup
        visible={open}
        anchorRef={hostRef}
        popupRef={popupRef}
        preferredPlacement="up"
        maxHeight={640} className="opb-drop"
        open={open}
        role="dialog"
        aria-label={label}
      >
        {children}
      </AnchoredAppPopup>
    </span>
  )
}

export function DropHead({
  title,
  value,
  unit,
  action,
}: {
  title: string
  value?: ReactNode
  unit?: string
  action?: ReactNode
}) {
  return (
    <AppPopupHeader>
      <span>{title}</span>
      <AppPopupFill />
      {value != null ? (
        <span className="app-popup__metric">
          {value}
          {unit ? <i>{unit}</i> : null}
        </span>
      ) : null}
      {action}
    </AppPopupHeader>
  )
}

export function Choice({
  on,
  label,
  tail,
  accent,
  onSelect,
}: {
  on: boolean
  label: string
  tail?: string
  accent?: string
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      className={`rte-choice__option opb-choice${on ? ' is-on' : ''}`}
      style={accent ? { '--opb-choice-accent': accent } as CSSProperties : undefined}
      aria-pressed={on}
      onClick={onSelect}
    >
      <span className="opb-choice__dot" aria-hidden="true" />
      <span>{label}</span>
      {tail ? <span className="opb-choice__tail">{tail}</span> : null}
    </button>
  )
}

export function Toggle({
  on,
  label,
  onToggle,
}: {
  on: boolean
  label: string
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      className={`opb-toggle${on ? ' is-on' : ''}`}
      aria-pressed={on}
      onClick={onToggle}
    >
      {label}
      <span className="opb-toggle__sw" aria-hidden="true" />
    </button>
  )
}

export function OutRow({
  label,
  at,
  disabled = false,
  onOpen,
}: {
  label: string
  at?: string
  disabled?: boolean
  onOpen: () => void
}) {
  return (
    <button type="button" className="opb-out" disabled={disabled} onClick={onOpen}>
      {label}
      {at ? <span className="opb-out__at">{at}</span> : null}
      <span className="opb-out__arw" aria-hidden="true">↗</span>
    </button>
  )
}

export function Slide({
  label,
  value,
  read,
  min = 0,
  max = 100,
  step = 1,
  disabled = false,
  onChange,
}: {
  label: string
  value: number
  read: string
  min?: number
  max?: number
  step?: number
  disabled?: boolean
  onChange: (value: number) => void
}) {
  const fill = max === min ? 0 : ((value - min) / (max - min)) * 100
  return (
    <label className="opb-slide">
      {label}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        style={{ '--fill': `${fill}%` } as CSSProperties}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <b>{read}</b>
    </label>
  )
}
