/*
  Author: Runor Ewhro
  Description: Slider-feel scrubber for per-step echo set states.
               Dots are decorative; the whole bar is the hit area.
               The active pill is a motion.div that springs between positions —
               it replaces the dot at the active index rather than floating above.
*/

import './StepScrubber.css'
import { motion, AnimatePresence } from 'motion/react'
import { useState, useMemo, useRef, useEffect, useCallback } from 'react'

const DOT_PITCH_PX = 10
const MAX_DOTS = 50

// Spring feel for the active pill sliding between values
const ACTIVE_SPRING = { type: 'spring' as const, stiffness: 460, damping: 30, mass: 0.75 }
// Snappier spring for the hover ghost appearing/scaling
const HOVER_SPRING  = { type: 'spring' as const, stiffness: 560, damping: 34, mass: 0.6 }

interface StepScrubberProps {
  min: number
  max: number
  value: number
  onChange: (v: number) => void
  disabled?: boolean
  className?: string
}

export function StepScrubber({ min, max, value, onChange, disabled, className }: StepScrubberProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState(0)
  const [hoverRatio, setHoverRatio] = useState<number | null>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setContainerWidth(entry.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const numDots = useMemo(() => {
    if (containerWidth <= 0) return 16
    return Math.max(2, Math.min(MAX_DOTS, Math.floor(containerWidth / DOT_PITCH_PX)))
  }, [containerWidth])

  const valueToRatio = useCallback(
    (v: number) => (max > min ? (v - min) / (max - min) : 0),
    [min, max],
  )

  const ratioToValue = useCallback(
    (r: number) => min + Math.round(Math.max(0, Math.min(1, r)) * (max - min)),
    [min, max],
  )

  const hoverValue  = hoverRatio !== null ? ratioToValue(hoverRatio) : null
  const activeRatio = valueToRatio(value)
  const activeDotIdx = Math.round(activeRatio * (numDots - 1))

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (disabled) return
      const rect = e.currentTarget.getBoundingClientRect()
      setHoverRatio((e.clientX - rect.left) / rect.width)
    },
    [disabled],
  )

  const handleMouseLeave = useCallback(() => setHoverRatio(null), [])

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (disabled) return
      const rect = e.currentTarget.getBoundingClientRect()
      onChange(ratioToValue((e.clientX - rect.left) / rect.width))
    },
    [disabled, onChange, ratioToValue],
  )

  const adjPrev = hoverValue !== null && hoverValue > min ? hoverValue - 1 : null
  const adjNext = hoverValue !== null && hoverValue < max ? hoverValue + 1 : null

  return (
    <div
      ref={containerRef}
      className={`step-scrubber${disabled ? ' step-scrubber--disabled' : ''}${className ? ` ${className}` : ''}`}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onClick={handleClick}
    >
      {/* ── Dot row ──────────────────────────────────────────── */}
      <div className="step-scrubber__dots" aria-hidden>
        {Array.from({ length: numDots }, (_, i) => {
          const dist = Math.abs(i - activeDotIdx)
          const dotMod =
            dist === 0 ? ' step-scrubber__dot--active' :
            dist === 1 ? ' step-scrubber__dot--near1'  :
            dist === 2 ? ' step-scrubber__dot--near2'  : ''
          return <div key={i} className={`step-scrubber__dot${dotMod}`} />
        })}
      </div>

      {/* ── Active pill — springs between positions ──────────── */}
      <motion.div
        className="step-scrubber__active-label"
        aria-hidden
        animate={{ left: `${activeRatio * 100}%` }}
        transition={ACTIVE_SPRING}
      >
        {value}
      </motion.div>

      {/* ── Hover ghost — shows adj · value · adj at cursor ──── */}
      <AnimatePresence>
        {hoverValue !== null && (
          <div
            key="hover-anchor"
            className="step-scrubber__hover-anchor"
            style={{ left: `${valueToRatio(hoverValue) * 100}%` }}
          >
            <motion.div
              className="step-scrubber__hover-tooltip"
              initial={{ opacity: 0, scaleX: 0.7, scaleY: 0.7 }}
              animate={{ opacity: 1, scaleX: 1,   scaleY: 1   }}
              exit={{    opacity: 0, scaleX: 0.7, scaleY: 0.7 }}
              transition={HOVER_SPRING}
            >
              {adjPrev !== null && <span className="step-scrubber__adj">{adjPrev}</span>}
              <span className={`step-scrubber__hover-value${hoverValue === value ? ' is-active' : ''}`}>
                {hoverValue}
              </span>
              {adjNext !== null && <span className="step-scrubber__adj">{adjNext}</span>}
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  )
}
