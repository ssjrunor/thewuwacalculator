/*
  Author: Runor Ewhro
  Description: Provides shared suggestion target, result, summary, and configuration primitives.
*/

import type { ComponentType, CSSProperties as CssProps, KeyboardEvent, ReactNode } from 'react'
import { BsCrosshair } from 'react-icons/bs'
import { getSntSetIco, getSntSetNam } from '@/data/gameData/catalog/sonataSets.ts'
import { AppModal } from '@/shared/ui/AppModal.tsx'
import { ModalHeader } from '@/shared/ui/AppModalShell'
import { withDefIconM } from '@/shared/lib/imageFallback.ts'
import { getDiffLabel, getDiffTone } from '@/modules/simulation/surfaces/suggestions/lib/suggestions.ts'
import AppLdrVrly from '@/shared/ui/AppLoaderOverlay.tsx'

// letting callers pass one string through existing state channels.
export function SuggsMdl(props: {
  open: boolean
  closing: boolean
  visible: boolean
  title: string
  onClose: () => void
  onApply?: () => void
  xtrClssName?: string
  children: ReactNode
}) {
  const { open, closing, visible, title, onClose, onApply, xtrClssName: xtrClssName, children } = props
  const dashIdx = title.indexOf(' - ')
  const eyebrow = dashIdx !== -1 ? title.slice(0, dashIdx) : null
  const mainTitle = dashIdx !== -1 ? title.slice(dashIdx + 3) : title
  const variant = xtrClssName ? xtrClssName : 'suggestions'

  return (
    <AppModal
      state={{ visible, open, closing }}
      variant={variant}
      ariaLabel={title}
      onClose={onClose}
    >
      <div className="amdl">
        <ModalHeader over={eyebrow ?? undefined} title={mainTitle} onClose={onClose}>
          {onApply && (
            <button
              type="button" className="amdl__act is-go"
              onClick={() => { onApply(); onClose() }}
            >
              Apply
            </button>
          )}
        </ModalHeader>
        <div className="suggestions-modal-body">{children}</div>
      </div>
    </AppModal>
  )
}

export function SetBadge({
  setId,
  pieces,
  className = 'echo-buff set-badge',
}: {
  setId: number
  pieces: number
  className?: string
}) {
  const label = getSntSetNam(setId)
  const icon = getSntSetIco(setId)

  return (
    <span className={className}>
      {icon ? (
        <img
          src={icon}
          alt={label}
          loading="lazy"
          onError={withDefIconM}
        />
      ) : null}
      {pieces}pc {label}
    </span>
  )
}

export function SuggToolbar({
  target,
  dense = false,
  children,
}: {
  target: ReactNode
  dense?: boolean
  children: ReactNode
}) {
  return (
    <div className={`suggestions-controls sgc${dense ? ' sgc--dense' : ''}`}>
      <BsCrosshair size="1.25rem" className="co-skill-bar__icon" aria-hidden="true" />
      {target}
      <div className="sgc__acts">{children}</div>
    </div>
  )
}

export function SgcBtn({
  variant,
  icon: Icon,
  label,
  onClick,
  disabled = false,
}: {
  variant: 'ghost' | 'primary' | 'danger'
  icon: ComponentType<{ size?: string | number }>
  label: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button type="button" className={`sgc-btn sgc-btn--${variant}`} onClick={onClick} disabled={disabled}>
      <Icon size="0.95rem" aria-hidden="true" />
      <span className="sgc-btn__label">{label}</span>
    </button>
  )
}

export function SuggEmpty({
  running,
  loadingText,
  idleText,
}: {
  running: boolean
  loadingText: string
  idleText?: ReactNode
}) {
  return (
    <div className="suggestions-empty-state">
      {running ? <AppLdrVrly text={loadingText} /> : idleText}
    </div>
  )
}

export function ResultBlock({
  name,
  count,
  note = 'ranked by avg dmg',
  children,
}: {
  name: string
  count: number
  note?: string
  children: ReactNode
}) {
  return (
    <div className="spx-block">
      <div className="spx-cap">
        <b className="spx-cap__name">{name} ({count})</b>
        <span className="spx-cap__rule" aria-hidden="true" />
        <span className="spx-cap__count">{note}</span>
      </div>
      {children}
    </div>
  )
}

export function SpxRank({ n }: { n: number }) {
  return (
    <span className="spx-rank">
      <span className="spx-rank__pip" aria-hidden="true" />
      <span className="spx-rank__n">{n}</span>
    </span>
  )
}

export function SpxResult({
  value,
  isCurrent,
  diff,
}: {
  value: string
  isCurrent: boolean
  diff: number
}) {
  const tone = getDiffTone(diff)
  const deltaTone = isCurrent || tone === 'zero' ? '' : tone === 'positive' ? ' is-gain' : ' is-loss'
  return (
    <div className="spx-result">
      <span className="spx-avg">{value}</span>
      <span className={`spx-delta${deltaTone}`}>
        {isCurrent ? 'base' : `${diff > 0 ? '+' : diff < 0 ? '−' : ''}${getDiffLabel(diff, false)}`}
      </span>
    </div>
  )
}

export function StatTray({
  cost,
  costUnit = 'c',
  title,
  style,
  primaryVal,
  primaryIcon,
  subVal,
  subIcon,
}: {
  cost: number
  costUnit?: string
  title: string
  style?: CssProps
  primaryVal: string
  primaryIcon?: CssProps
  subVal?: string | null
  subIcon?: CssProps
}) {
  return (
    <div className="spx-tray" style={style} title={title}>
      <span className="spx-tray__pc">{cost}<small>{costUnit}</small></span>
      <span className="sst-stats">
        <span className="sst-line">
          {primaryIcon ? <span className="sst-icon" style={primaryIcon} aria-hidden="true" /> : null}
          <span className="sst-val">{primaryVal}</span>
        </span>
        {subVal != null ? (
          <span className="sst-line sst-line--sub">
            {subIcon ? <span className="sst-icon" style={subIcon} aria-hidden="true" /> : null}
            <span className="sst-val">{subVal}</span>
          </span>
        ) : null}
      </span>
    </div>
  )
}

export function SubStrip({
  subs,
}: {
  subs: { key: string; label: string; value: string; icon?: CssProps }[]
}) {
  if (subs.length === 0) return null
  return (
    <div className="sst-subs">
      <span className="sst-subs__lbl">Substats</span>
      {subs.map((entry) => (
        <span key={entry.key} className="sst-sub" title={`${entry.label} ${entry.value}`}>
          {entry.icon ? <span className="sst-sub__icon" style={entry.icon} aria-hidden="true" /> : null}
          <span className="sst-sub__val">{entry.value}</span>
        </span>
      ))}
    </div>
  )
}

// Keep mouse and keyboard selection wired identically for every ranked row/card.
export function selectableProps(selected: boolean, onSelect: () => void) {
  return {
    role: 'button' as const,
    tabIndex: 0,
    'aria-pressed': selected,
    onClick: onSelect,
    onKeyDown: (event: KeyboardEvent) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        onSelect()
      }
    },
  }
}
