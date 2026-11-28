/*
  Author: Runor Ewhro
  description: applies mobile slot selection and legal-roll changes to the
               shared unsaved echo draft.
*/

import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPtrEvt } from 'react'
import { ChevronLeft, ChevronRight, Plus, X } from 'lucide-react'
import { DisplayImage } from '@/shared/ui/DisplayImage'
import { AppModal } from '@/shared/ui/AppModal'
import type { AppModalState } from '@/shared/ui/AppModal'
import { SUBSTAT_KEYS, getSbstStepP } from '@/data/gameData/catalog/echoStats.ts'
import { getSntSetNam, getSntSetIco, getSntSetClr } from '@/data/gameData/catalog/sonataSets.ts'
import { withDefEchoMg, withDefIconM } from '@/shared/lib/imageFallback'
import { StatGlyph } from '@/modules/simulation/workspace/ui.tsx'
import { formatStatKeyLabel } from '@/modules/simulation/model/statsView.ts'
import { MAX_SUBSTATS, fmtStatValue, stepIndex } from '@/modules/simulation/features/echoes/lib/echoDraft.ts'
import type { EchoDraft } from '@/modules/simulation/features/echoes/lib/echoDraft.ts'
import { formatTruncCompact } from '@/shared/lib/number'

const ROW_H = 56
const SWIPE = 50

interface MobileEchoEditP {
  state: AppModalState
  draft: EchoDraft
  mainEcho: boolean
  onRecast?: () => void
  onSave: () => void
  onClose: () => void
}

function BigReel({ statKey, value, onChange }: { statKey: string, value: number, onChange: (next: number) => void }) {
  const steps = getSbstStepP(statKey)
  const index = stepIndex(statKey, value)
  const scroller = useRef<HTMLDivElement | null>(null)
  const settle = useRef(0)
  const last = steps.length - 1

  useEffect(() => {
    const node = scroller.current
    if (node) node.scrollTop = index * ROW_H
    // the reel recenters only when the stat identity changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statKey])

  const onScroll = () => {
    window.clearTimeout(settle.current)
    settle.current = window.setTimeout(() => {
      const node = scroller.current
      if (!node) return
      const next = Math.max(0, Math.min(last, Math.round(node.scrollTop / ROW_H)))
      if (steps[next] !== value) onChange(steps[next])
    }, 90)
  }

  const jump = (position: number) => {
    scroller.current?.scrollTo({ top: position * ROW_H, behavior: 'smooth' })
  }

  const onRail = (event: ReactPtrEvt<HTMLSpanElement>) => {
    const node = event.currentTarget
    const rect = node.getBoundingClientRect()
    const read = (clientY: number) => {
      const fraction = 1 - (clientY - rect.top) / rect.height
      const position = Math.max(0, Math.min(last, Math.round(fraction * last)))
      if (scroller.current) scroller.current.scrollTop = position * ROW_H
    }
    node.setPointerCapture(event.pointerId)
    read(event.clientY)
    const move = (e: PointerEvent) => read(e.clientY)
    const stop = () => {
      node.removeEventListener('pointermove', move)
      node.removeEventListener('pointerup', stop)
      node.removeEventListener('pointercancel', stop)
    }
    node.addEventListener('pointermove', move)
    node.addEventListener('pointerup', stop)
    node.addEventListener('pointercancel', stop)
  }

  return (
    <div className="mee-reel">
      <div
        className="mee-reel__scroll"
        ref={scroller}
        onScroll={onScroll}
        role="spinbutton"
        tabIndex={0}
        aria-label={`${formatStatKeyLabel(statKey)} roll`}
        aria-valuenow={value}
        aria-valuetext={fmtStatValue(statKey, value)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowUp' && index > 0) { event.preventDefault(); jump(index - 1) }
          if (event.key === 'ArrowDown' && index < last) { event.preventDefault(); jump(index + 1) }
        }}
      >
        <span className="mee-reel__pad" aria-hidden="true" />
        {steps.map((step, position) => (
          <button
            type="button"
            key={step}
            tabIndex={-1}
            className={`mee-reel__roll${position === index ? ' is-on' : ''}${position === last ? ' is-top' : ''}`}
            onClick={() => jump(position)}
          >
            {fmtStatValue(statKey, step)}
          </button>
        ))}
        <span className="mee-reel__pad" aria-hidden="true" />
      </div>
      <span className="mee-reel__band" aria-hidden="true" />
      <span className="mee-rail" aria-hidden="true" onPointerDown={onRail}>
        <span className="mee-rail__dot" style={{ '--p': last > 0 ? index / last : 0 } as CSSProperties} />
      </span>
    </div>
  )
}

function StatSelect({ value, options, used, label, placeholder, onPick }: {
  value: string
  options: string[]
  used?: Set<string>
  label: string
  placeholder?: string
  onPick: (key: string) => void
}) {
  return (
    <select
      className="mee-select"
      aria-label={label}
      value={value}
      onChange={(event) => { if (event.target.value) onPick(event.target.value) }}
    >
      {placeholder ? <option value="">{placeholder}</option> : null}
      {options.map((key) => (
        <option key={key} value={key} disabled={key !== value && Boolean(used?.has(key))}>
          {formatStatKeyLabel(key)}
        </option>
      ))}
    </select>
  )
}

export function MobileEchoEdit({ state, draft, mainEcho, onRecast, onSave, onClose }: MobileEchoEditP) {
  const {
    definition,
    cost,
    mainStatKey,
    setMainStatK,
    selectedSet,
    setSelSet,
    lclSbst,
    primaryOptions,
    primaryKeys,
    setOptions,
    usedKeys,
    setSubValue,
    pickSubstat,
    removeSubstat,
    critValue,
    topRolls,
  } = draft
  const [slot, setSlot] = useState(0)
  const swipeFrom = useRef<number | null>(null)

  // clamp the selection after a removal shortens the draft
  const open = Math.min(slot, Math.max(0, Math.min(lclSbst.length, MAX_SUBSTATS - 1)))
  const entry = lclSbst[open]

  if (!definition) return null

  const go = (next: number) => setSlot(Math.max(0, Math.min(MAX_SUBSTATS - 1, next)))
  const setIcon = getSntSetIco(selectedSet)

  return (
    <AppModal
      state={state}
      variant="echo-edit"
      ariaLabel={`${definition.name} echo editor`}
      onClose={onClose}
    >
      <div className="amdl mee mpg-native" onClick={(event) => event.stopPropagation()}>
        <header className="mee-head">
          <button
            type="button"
            className="mee-id"
            onClick={onRecast}
            disabled={!onRecast}
            aria-label={`Change echo, currently ${definition.name}`}
          >
            <span className="mee-id__icon">
              <DisplayImage src={definition.icon} alt="" onError={withDefEchoMg} />
              {onRecast ? <em>Change</em> : null}
            </span>
            <span className="mee-id__text">
              <span className="mee-over">Echo</span>
              <strong>{definition.name}</strong>
              <span className="mee-set" style={{ '--set-clr': getSntSetClr(selectedSet) ?? 'var(--amdl-accent)' } as CSSProperties}>
                {setIcon ? <DisplayImage src={setIcon} alt="" onError={withDefIconM} /> : null}
                {getSntSetNam(selectedSet)}
              </span>
            </span>
          </button>
          <span className="mee-tags">
            <span>{cost}C</span>
            {mainEcho ? <span className="is-main">Main</span> : null}
          </span>
          <button type="button" className="mee-close" aria-label="Close" onClick={onClose}>
            <X size={14} />
          </button>
        </header>

        <div className="mee-main">
          {mainStatKey ? <StatGlyph statKey={mainStatKey} size={1.1} /> : null}
          <StatSelect value={mainStatKey} options={primaryKeys} label="Main stat" onPick={setMainStatK} />
          <strong className="mee-main__val">{fmtStatValue(mainStatKey, primaryOptions[mainStatKey] ?? 0)}</strong>
          {setOptions.length > 1 ? (
            <span className="mee-sets" role="group" aria-label="Sonata set">
              {setOptions.map((setId) => (
                <button
                  key={setId}
                  type="button"
                  className="mee-sets__mark"
                  aria-pressed={selectedSet === setId}
                  aria-label={getSntSetNam(setId)}
                  style={{ '--set-clr': getSntSetClr(setId) ?? 'var(--amdl-accent)' } as CSSProperties}
                  onClick={() => setSelSet(setId)}
                >
                  {getSntSetIco(setId) ? <DisplayImage src={getSntSetIco(setId) ?? undefined} alt="" onError={withDefIconM} /> : null}
                </button>
              ))}
            </span>
          ) : null}
        </div>

        <nav className="mee-slots" aria-label="Substat slots">
          {Array.from({ length: MAX_SUBSTATS }, (_, index) => {
            const at = lclSbst[index]
            const steps = at ? getSbstStepP(at[0]) : []
            const roll = at ? stepIndex(at[0], at[1]) : 0
            const reachable = index <= lclSbst.length
            return (
              <button
                type="button"
                key={index}
                className={`mee-slot${index === open ? ' is-on' : ''}${at ? '' : ' is-empty'}`}
                disabled={!reachable}
                aria-current={index === open ? 'true' : undefined}
                aria-label={at ? `${formatStatKeyLabel(at[0])} ${fmtStatValue(at[0], at[1])}` : `Slot ${index + 1}, empty`}
                onClick={() => go(index)}
              >
                {at ? (
                  <>
                    <StatGlyph statKey={at[0]} size={0.85} />
                    <b>{fmtStatValue(at[0], at[1]).replace('%', '')}</b>
                    <i className={roll === steps.length - 1 ? 'is-top' : undefined}>{roll + 1}/{steps.length}</i>
                  </>
                ) : (
                  <>
                    <Plus size={14} />
                    <i>{reachable ? 'Add' : 'Open'}</i>
                  </>
                )}
              </button>
            )
          })}
        </nav>

        <section
          className="mee-page"
          onPointerDown={(event) => {
            if ((event.target as HTMLElement).closest('.mee-reel, select')) return
            swipeFrom.current = event.clientX
          }}
          onPointerUp={(event) => {
            if (swipeFrom.current === null) return
            const dx = event.clientX - swipeFrom.current
            swipeFrom.current = null
            if (Math.abs(dx) > SWIPE) go(open + (dx < 0 ? 1 : -1))
          }}
        >
          <div className="mee-page__head">
            <button type="button" className="mee-step" aria-label="Previous slot" disabled={open === 0} onClick={() => go(open - 1)}>
              <ChevronLeft size={18} />
            </button>
            <span className="mee-page__title">
              <span className="mee-over">
                Slot {open + 1} of {MAX_SUBSTATS}
                {entry ? ` · ${stepIndex(entry[0], entry[1]) + 1}/${getSbstStepP(entry[0]).length}` : ''}
              </span>
              {entry ? (
                <span className="mee-page__stat">
                  <StatGlyph statKey={entry[0]} size={1.05} />
                  <StatSelect
                    value={entry[0]}
                    options={SUBSTAT_KEYS}
                    used={usedKeys}
                    label={`Substat ${open + 1}`}
                    onPick={(key) => pickSubstat(open, key)}
                  />
                </span>
              ) : null}
            </span>
            <button
              type="button"
              className="mee-step"
              aria-label="Next slot"
              disabled={open >= Math.min(lclSbst.length, MAX_SUBSTATS - 1)}
              onClick={() => go(open + 1)}
            >
              <ChevronRight size={18} />
            </button>
          </div>

          {entry ? (
            <>
              <BigReel statKey={entry[0]} value={entry[1]} onChange={(next) => setSubValue(open, next)} />
              <button type="button" className="mee-remove" onClick={() => removeSubstat(open)}>
                Remove {formatStatKeyLabel(entry[0])}
              </button>
            </>
          ) : (
            <div className="mee-add">
              <p>Slot {open + 1} is empty. Pick the substat it rolled.</p>
              <StatSelect
                value=""
                options={SUBSTAT_KEYS}
                used={usedKeys}
                label={`Add substat ${open + 1}`}
                placeholder="Choose a substat"
                onPick={(key) => pickSubstat(open, key)}
              />
            </div>
          )}
        </section>

        <footer className="mee-foot">
          <span>CV <b>{formatTruncCompact(critValue, 1)}</b></span>
          <span className="mee-foot__fill">{topRolls} top {topRolls === 1 ? 'roll' : 'rolls'}</span>
          <button type="button" className="mee-act" onClick={onClose}>Cancel</button>
          <button type="button" className="mee-act is-go" onClick={onSave} disabled={!mainStatKey}>Save changes</button>
        </footer>
      </div>
    </AppModal>
  )
}
