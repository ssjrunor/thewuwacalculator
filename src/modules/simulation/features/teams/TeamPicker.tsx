/*
  Author: Runor Ewhro
  Description: Stages an ordered pair of support resonators, maps click and drag
               operations into that tuple, preloads new members, and commits the
               complete team in one scenario update.
*/

import { useCallback, useId, useMemo, useRef, useState } from 'react'
import type { CSSProperties as CssProps, PointerEvent as ReactPointerEvent } from 'react'
import { Lock, X } from 'lucide-react'
import { ensureResonatorData } from '@/data/gameData'
import { useTstStr } from '@/shared/util/toastStore'
import { AppModal } from '@/shared/ui/AppModal'
import { ModalHeader } from '@/shared/ui/AppModalShell'
import { PickerCard, useDeferredImages } from '@/modules/simulation/ui/PickerModal.tsx'
import { usePickerMotion, type PickerMove } from '@/modules/simulation/ui/pickerMotion.ts'
import { usePickerFilters, useResPickerView } from '@/modules/simulation/features/resonator/Picker.tsx'
import { RES_MENU } from '@/modules/simulation/features/resonator/lib/resonator.ts'
import { ATTR_COLORS } from '@/modules/simulation/model/display.ts'
import { withDefIconM } from '@/shared/lib/imageFallback.ts'

type Supports = [string | null, string | null]

interface TeamPickerProps {
  visible: boolean
  open: boolean
  closing?: boolean
  portalTarget: HTMLElement | null
  leadId: string
  team: readonly (string | null)[]
  onCommit: (supports: Supports) => void
  onClose: () => void
}

const MENU_BY_ID = new Map(RES_MENU.map((entry) => [entry.id, entry]))
const FLIGHT_EASE = 'cubic-bezier(.3, .7, .2, 1)'
const SETTLE_EASE = 'cubic-bezier(.2, .8, .2, 1)'

const calm = () => document.documentElement.classList.contains('reduce-animation')

// Keep ordinary clicks distinct from pointer drags.
const DRAG_START_PX = 6
// Begin automatic scrolling before a drag leaves the scroll container.
const EDGE_SCROLL_PX = 48

type DropTarget = { kind: 'seat'; seat: number } | { kind: 'card'; id: string } | { kind: 'out' } | null

function toneOf(id: string) {
  const attribute = MENU_BY_ID.get(id)?.attribute
  return attribute ? ATTR_COLORS[attribute] : undefined
}

function profileOf(id: string) {
  return MENU_BY_ID.get(id)?.profile ?? ''
}

export function TeamPicker(props: TeamPickerProps) {
  const teamKey = `${props.leadId}|${props.team[1] ?? ''}|${props.team[2] ?? ''}`
  return props.visible && props.portalTarget ? <TeamPickerContent key={teamKey} {...props} /> : null
}

function TeamPickerContent({
  visible,
  open,
  closing = false,
  leadId,
  team,
  onCommit,
  onClose,
}: TeamPickerProps) {
  const titleId = useId()
  const support1 = team[1] ?? null
  const support2 = team[2] ?? null
  const applied = useMemo<Supports>(() => [support1, support2], [support1, support2])
  const [seats, setSeats] = useState<Supports>(applied)
  const [docked, setDocked] = useState(false)
  const [saving, setSaving] = useState(false)
  const filterState = usePickerFilters()

  const bodyRef = useRef<HTMLDivElement>(null)
  const rowRef = useRef<HTMLDivElement>(null)
  // Identifies the one positional move consumed by the transfer animation.
  const lifted = useRef<string | null>(null)

  const changed = seats[0] !== applied[0] || seats[1] !== applied[1]
  const full = Boolean(seats[0] && seats[1])
  const nextSeat = seats[0] ? (seats[1] ? null : 1) : 0

  // Consume only the explicitly lifted card; the shared motion hook handles all
  // other position deltas.
  const arc = useCallback(({ el, id, dx, dy }: PickerMove) => {
    if (id !== lifted.current) return false
    lifted.current = null
    el.classList.add('is-flying')
    const flight = el.animate([
      { transform: `translate(${dx}px, ${dy}px)` },
      { transform: `translate(${dx * 0.45}px, ${dy * 0.45 - 28}px) scale(1.08)`, offset: 0.5 },
      { transform: 'none' },
    ], { duration: 620, easing: FLIGHT_EASE })
    flight.oncancel = () => el.classList.remove('is-flying')
    flight.onfinish = () => {
      el.classList.remove('is-flying')
      const art = el.querySelector('.picker-modal__card-art')
      if (!art || !el.closest('.tpk-row')) return
      const ring = document.createElement('i')
      ring.className = 'tpk-ring'
      art.appendChild(ring)
      const pulse = ring.animate([{ opacity: 0.9, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(1.18)' }], { duration: 620, easing: SETTLE_EASE })
      pulse.onfinish = () => ring.remove()
      pulse.oncancel = () => ring.remove()
    }
    return true
  }, [])
  const capture = usePickerMotion(bodyRef, arc)
  // Non-selection layout changes must not reuse a stale transfer marker.
  const reflow = useCallback(() => {
    lifted.current = null
    capture()
  }, [capture])

  // When the real destination card is not mounted, animate a detached clone and
  // remove it after the transfer completes.
  const flyToStrip = useCallback((id: string, seat: number) => {
    const body = bodyRef.current
    const from = body?.querySelector<HTMLImageElement>(`[data-pick-id="${id}"] .picker-modal__media-image`)
    const to = body?.querySelector<HTMLElement>(`[data-tpk-mini="${seat + 1}"]`)
    if (!from || !to || calm()) return
    const a = from.getBoundingClientRect()
    const b = to.getBoundingClientRect()
    const ghost = document.createElement('img')
    ghost.src = from.currentSrc || from.src
    ghost.className = 'tpk-ghost'
    Object.assign(ghost.style, { left: `${a.left}px`, top: `${a.top}px`, width: `${a.width}px`, height: `${a.height}px` })
    document.body.appendChild(ghost)
    const scale = b.width / a.width
    const dx = b.left - a.left
    const dy = b.top - a.top
    const flight = ghost.animate([
      { transform: 'none', borderRadius: '1.15rem' },
      { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 40}px) scale(${(1 + scale) / 2})`, offset: 0.5 },
      { transform: `translate(${dx}px, ${dy}px) scale(${scale})`, borderRadius: `${a.width}px`, opacity: 0.9 },
    ], { duration: 620, easing: FLIGHT_EASE })
    flight.onfinish = () => ghost.remove()
    flight.oncancel = () => ghost.remove()
  }, [])

  const nudge = useCallback(() => {
    if (calm()) return
    bodyRef.current?.querySelectorAll('.tpk-row .is-seat .picker-modal__card-art, .tpk-strip').forEach((el) => {
      el.animate([
        { transform: 'translateX(0)' },
        { transform: 'translateX(-4px)' },
        { transform: 'translateX(4px)' },
        { transform: 'translateX(0)' },
      ], { duration: 360 })
    })
  }, [])

  const pick = useCallback((id: string) => {
    if (id === leadId) return
    const seat = seats.indexOf(id)
    if (seat >= 0) {
      capture()
      lifted.current = id
      setSeats(seats.map((seated) => (seated === id ? null : seated)) as Supports)
      return
    }
    if (nextSeat === null) {
      nudge()
      return
    }
    // Start loading on selection, while commit still verifies every new member.
    void ensureResonatorData([id]).catch(() => {})
    if (docked) flyToStrip(id, nextSeat)
    capture()
    lifted.current = docked ? null : id
    const next: Supports = [...seats]
    next[nextSeat] = id
    setSeats(next)
  }, [capture, docked, flyToStrip, leadId, nextSeat, nudge, seats])

  // Suppress the synthetic click emitted after a completed pointer drag.
  const dragged = useRef(false)
  const frameRef = useRef<HTMLDivElement>(null)

  const onPointerDown = useCallback((event: ReactPointerEvent) => {
    if (event.button !== 0 || event.pointerType === 'touch') return
    const card = (event.target as Element).closest<HTMLElement>('[data-pick-id]')
    const frame = frameRef.current
    const body = bodyRef.current
    if (!card || !frame || !body || card.classList.contains('is-lead')) return
    const id = card.dataset.pickId!
    const from = seats.indexOf(id)
    const startX = event.clientX
    const startY = event.clientY
    const rect = card.getBoundingClientRect()
    let ghost: HTMLElement | null = null
    let target: DropTarget = null
    let lit: Element | null = null

    const hit = (x: number, y: number): { drop: DropTarget; el: Element | null } => {
      const under = document.elementFromPoint(x, y)
      const seatEl = under?.closest<HTMLElement>('[data-tpk-drop]')
      if (seatEl && frame.contains(seatEl)) return { drop: { kind: 'seat', seat: Number(seatEl.dataset.tpkDrop) }, el: seatEl }
      const other = under?.closest<HTMLElement>('.picker-modal__grid [data-pick-id]')
      if (other && from >= 0 && other.dataset.pickId !== id) return { drop: { kind: 'card', id: other.dataset.pickId! }, el: other }
      // Dropping a seated member outside every team target removes that member.
      const inRow = under?.closest('.tpk-row, .tpk-strip, .tpk-seat')
      if (from >= 0 && !inRow) return { drop: { kind: 'out' }, el: null }
      return { drop: null, el: null }
    }

    const move = (moveEvent: PointerEvent) => {
      const x = moveEvent.clientX
      const y = moveEvent.clientY
      if (!ghost) {
        if (Math.hypot(x - startX, y - startY) < DRAG_START_PX) return
        const frameRect = frame.getBoundingClientRect()
        ghost = card.cloneNode(true) as HTMLElement
        ghost.removeAttribute('data-pick-id')
        ghost.setAttribute('aria-hidden', 'true')
        ghost.inert = true
        ghost.classList.add('tpk-drag')
        Object.assign(ghost.style, {
          left: `${rect.left - frameRect.left}px`,
          top: `${rect.top - frameRect.top}px`,
          width: `${rect.width}px`,
          height: `${rect.height}px`,
        })
        frame.appendChild(ghost)
        card.classList.add('is-drag-source')
        frame.classList.add('is-dragging')
      }
      ghost.style.translate = `${x - startX}px ${y - startY}px`
      const found = hit(x, y)
      target = found.drop
      if (lit !== found.el) {
        lit?.classList.remove('is-drop')
        found.el?.classList.add('is-drop')
        lit = found.el
      }
      ghost.classList.toggle('is-leaving', target?.kind === 'out')
      const view = body.getBoundingClientRect()
      if (y < view.top + EDGE_SCROLL_PX) body.scrollTop -= 14
      else if (y > view.bottom - EDGE_SCROLL_PX) body.scrollTop += 14
    }

    const finish = (commit: boolean) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', cancel)
      lit?.classList.remove('is-drop')
      card.classList.remove('is-drag-source')
      frame.classList.remove('is-dragging')
      if (!ghost) return
      const landing = ghost.getBoundingClientRect()
      ghost.remove()
      if (!commit) return
      dragged.current = true
      window.setTimeout(() => { dragged.current = false }, 0)
      if (!target) return

      const next: Supports = [...seats]
      if (target.kind === 'seat') {
        if (from === target.seat) return
        if (from >= 0) [next[from], next[target.seat]] = [next[target.seat], next[from]]
        else next[target.seat] = id
      } else if (target.kind === 'card') {
        next[from] = target.id
      } else {
        next[from] = null
      }
      for (const incoming of next) {
        if (incoming && !seats.includes(incoming)) void ensureResonatorData([incoming]).catch(() => {})
      }
      lifted.current = null
      // Seed the next position snapshot with pointer-up geometry rather than
      // the card's original grid rectangle.
      capture(new Map([[id, landing]]))
      setSeats(next)
    }
    const end = () => finish(true)
    const cancel = () => finish(false)

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', cancel)
  }, [capture, seats])

  const candidates = useMemo(() => RES_MENU.filter((entry) => entry.id !== leadId), [leadId])
  const view = useResPickerView({
    resonators: candidates,
    selLbl: '',
    closing,
    preload: false,
    onSelect: pick,
    filterState,
  })

  const seated = new Set(seats.filter(Boolean))
  const rosterItems = view.items.filter((item) => !seated.has(item.id))
  const seatItem = (id: string, lead = false) => {
    const entry = MENU_BY_ID.get(id)
    if (!entry) return null
    const item = view.toItem(entry)
    return {
      ...item,
      selected: false,
      trailing: undefined,
      onSelect: lead ? () => {} : item.onSelect,
    }
  }

  const imageKey = `${rosterItems.map((item) => item.id).join('|')}|${seats.join('|')}`
  useDeferredImages(bodyRef, visible, imageKey)

  const onScroll = useCallback(() => {
    const body = bodyRef.current
    const row = rowRef.current
    if (!body || !row) return
    setDocked(row.getBoundingClientRect().bottom < body.getBoundingClientRect().top + 60)
  }, [])

  const commit = useCallback(() => {
    if (!changed || saving) return
    const incoming = seats.filter((id): id is string => Boolean(id) && !applied.includes(id))
    setSaving(true)
    ensureResonatorData(incoming).then(() => onCommit(seats)).catch((error: unknown) => {
      setSaving(false)
      useTstStr.getState().show({ content: error instanceof Error ? error.message : 'Could not load resonator data.', variant: 'error' })
    })
  }, [applied, changed, onCommit, saving, seats])

  const leadItem = seatItem(leadId, true)

  return (
    <AppModal
      state={{ visible, open, closing }}
      variant="picker"
      size="regular"
      ariaLabelBy={titleId}
      onClose={onClose}
    >
      <div
        ref={frameRef}
        className={`amdl picker-modal__frame tpk${full ? ' is-full' : ''}`}
        data-variant="resonator"
        onClick={(event) => event.stopPropagation()}
      >
        <ModalHeader over="Team Slots" title={<h2 id={titleId}>Set Team</h2>} onClose={onClose}>
          {view.summary ? <div className="amdl__gauge">{view.summary}</div> : null}
          <div className="tpk-acts">
            <button
              type="button" className="tpk-revert"
              disabled={!changed}
              onClick={() => { reflow(); setSeats(applied) }}
            >
              Revert
            </button>
            <button type="button" className="amdl__act is-go tpk-go" disabled={!changed || saving} onClick={commit}>
              Set team
            </button>
          </div>
        </ModalHeader>

        <div className="picker-modal__stage has-rail">
          <nav className="amdl__rail pkr-rail" aria-label="Filters" onClickCapture={reflow} onChangeCapture={reflow}>
            {view.filters}
            <div className="amdl__rail-foot">{view.shown} of {RES_MENU.length - 1} roster</div>
          </nav>

          <div
            className="picker-modal__body"
            ref={bodyRef}
            onScroll={onScroll}
            onPointerDown={onPointerDown}
            onDragStart={(event) => event.preventDefault()}
            onClickCapture={(event) => {
              if (!dragged.current) return
              dragged.current = false
              event.stopPropagation()
              event.preventDefault()
            }}
          >
            <div className={`tpk-dock${docked ? ' is-on' : ''}`} aria-hidden={!docked}>
              <div className="tpk-strip" role="group" aria-label="Team">
                {[leadId, ...seats].map((id, index) => (
                  <button
                    key={index}
                    type="button"
                    tabIndex={docked ? 0 : -1}
                    className={`tpk-mini${index === 0 ? ' is-lead' : ''}${id ? '' : ' is-empty'}`}
                    data-tpk-mini={index}
                    data-tpk-drop={index > 0 ? index - 1 : undefined}
                    style={id ? { '--tpk-tone': toneOf(id) } as CssProps : undefined}
                    aria-label={id
                      ? `${index === 0 ? 'Lead' : `Seat ${index + 1}`}: ${MENU_BY_ID.get(id)?.displayName ?? id}${index ? '. Click to take out' : ''}`
                      : `Seat ${index + 1} open`}
                    onClick={() => { if (index > 0 && id) pick(id) }}
                  >
                    {id ? <img src={profileOf(id)} alt="" onError={withDefIconM} /> : index + 1}
                  </button>
                ))}
              </div>
            </div>

            <div className="tpk-row" ref={rowRef}>
              <div className="tpk-seat">
                {leadItem ? (
                  <PickerCard
                    item={leadItem}
                    className="is-seat is-lead"
                    art={<span className="tpk-key">1<Lock size="0.55rem" strokeWidth={2.6} /></span>}
                  />
                ) : null}
              </div>
              {seats.map((id, index) => {
                const item = id ? seatItem(id) : null
                return (
                  <div key={index} className="tpk-seat" data-tpk-drop={index}>
                    {item ? (
                      // The deferred loader owns img.src, so a new member needs a new image node.
                      <PickerCard
                        key={id}
                        item={item}
                        className="is-seat"
                        art={(
                          <>
                            <span className="tpk-key">{index + 2}</span>
                            <span className="tpk-x" aria-hidden="true"><X size="0.7rem" strokeWidth={2.4} /></span>
                          </>
                        )}
                      />
                    ) : (
                      <div className={`tpk-empty${nextSeat === index ? ' is-next' : ''}`}>
                        <div className="tpk-empty-art"><b>{index + 2}</b></div>
                        <div className="tpk-empty-cap">
                          Open seat
                          <small>{nextSeat === index ? 'Click or drag a resonator' : 'Drag a resonator here'}</small>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {rosterItems.length === 0 ? (
              <div className="picker-modal__empty"><p>No resonators match these filters.</p></div>
            ) : (
              <div className="picker-modal__grid picker-modal__grid--cards">
                {rosterItems.map((item) => <PickerCard key={item.id} item={item} />)}
              </div>
            )}
          </div>
        </div>
      </div>
    </AppModal>
  )
}
