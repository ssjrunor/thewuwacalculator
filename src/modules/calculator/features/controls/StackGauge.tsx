/*
  Author: Runor Ewhro
  Description: A segmented, clickable stack meter shared by the enemy
               affliction stacks and the resonator skill levels. Each integer
               step is a skewed accent segment; re-clicking the topmost filled
               segment decrements (clamped to min).
*/

import type { CSSProperties as CssProps } from 'react'
import { clampNumber } from '@/shared/lib/number.ts'
import { withDefIconM } from '@/shared/lib/imageFallback.ts'

interface StackGaugeProps {
  desc: string
  value: number
  min: number
  max: number
  accent?: string
  helper?: string
  icon?: string
  onChange: (value: number) => void
}

export function StackGauge({
  desc,
  value,
  min,
  max,
  accent,
  helper,
  icon,
  onChange,
}: StackGaugeProps) {
  const segments = Array.from({ length: max }, (_, i) => i + 1)

  return (
    <div
      className="stack-gauge"
      style={{ '--gauge': accent ?? 'var(--resonator-accent)' } as CssProps}
    >
      <div className="stack-gauge__head">
        {icon ? (
          <img className="stack-gauge__icon" src={icon} alt="" aria-hidden="true" onError={withDefIconM} />
        ) : (
          <span className="stack-gauge__pip" aria-hidden="true" />
        )}
        <div className="stack-gauge__id">
          <span className="stack-gauge__label">{desc}</span>
          {helper ? <span className="stack-gauge__helper">{helper}</span> : null}
        </div>
        <span className="stack-gauge__readout">
          <span className="stack-gauge__value">{value}</span>
          <span className="stack-gauge__max">/ {max}</span>
        </span>
      </div>
      <div className="stack-gauge__meter" role="group" aria-label={desc}>
        {segments.map((step) => {
          const filled = step <= value
          return (
            <button
              key={step}
              type="button"
              className={filled ? 'stack-gauge__seg is-filled' : 'stack-gauge__seg'}
              aria-pressed={filled}
              aria-label={`${desc}: ${step}`}
              onClick={() => onChange(clampNumber(value === step ? step - 1 : step, min, max))}
            />
          )
        })}
      </div>
    </div>
  )
}
