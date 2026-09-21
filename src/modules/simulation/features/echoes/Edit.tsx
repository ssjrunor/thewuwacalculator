/*
  Author: Runor Ewhro
  Description: Drafts Echo identity, main stats, Sonata, and legal substat rolls;
               normalizes retained stats when replacing a catalog piece.
*/

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties as CssProps, KeyboardEvent as ReactKeyEvt, PointerEvent as ReactPtrEvt } from 'react'
import { X } from 'lucide-react'
import type { EchoDef } from '@/domain/entities/catalog.ts'
import type { EchoInstance } from '@/domain/entities/runtime.ts'
import { makeEchoUid } from '@/domain/entities/runtime.ts'
import { getEchoById } from '@/data/catalog/echoCatalogService.ts'
import {
  ECHO_MAIN_STATS,
  ECHO_SIDE_STATS,
  SUBSTAT_KEYS,
  getSbstStepP,
  snapToNrstSb,
} from '@/data/gameData/catalog/echoStats.ts'
import { getSntSetNam, getSntSetIco, getSntSetClr } from '@/data/gameData/catalog/sonataSets.ts'
import { withDefEchoMg, withDefIconM } from '@/shared/lib/imageFallback'
import { AppModal } from '@/shared/ui/AppModal'
import { useAppModal } from '@/shared/ui/useAppModal.ts'
import { EchoPicker } from '@/modules/simulation/features/echoes/Picker.tsx'
import { StatGlyph } from '@/modules/simulation/workspace/ui.tsx'
import { truncTo } from '@/shared/lib/number.ts'
import { formatStatKeyLabel } from '@/modules/simulation/model/statsView.ts'

const MAX_SUBSTATS = 5

// Accepted aliases resolve to canonical stat keys before committing an edit.
const STAT_ALIASES: Record<string, string[]> = {
  critRate: ['cr'],
  critDmg: ['cd'],
  energyRegen: ['er'],
  atkPercent: ['atk%'],
  hpPercent: ['hp%'],
  defPercent: ['def%'],
  atkFlat: ['flat atk'],
  hpFlat: ['flat hp'],
  defFlat: ['flat def'],
  basicAtk: ['ba'],
  heavyAtk: ['ha'],
  resonanceSkill: ['rs', 'skill'],
  resonanceLiberation: ['rl', 'lib', 'ult'],
}

function fmtStatKey(key: string): string {
  return formatStatKeyLabel(key)
}

function fmtStatValue(key: string, value: number): string {
  if (key.endsWith('Flat')) {
    return String(Math.round(value))
  }

  if (key === 'tuneBreakBoost') {
    const truncated = truncTo(value, 2)
    return Number.isInteger(truncated) ? String(truncated) : truncated.toFixed(2).replace(/\.?0+$/, '')
  }

  return `${value}%`
}

// Map an arbitrary stored value to its nearest legal roll index.
function stepIndex(key: string, value: number): number {
  const steps = getSbstStepP(key)
  let best = 0
  steps.forEach((step, index) => {
    if (Math.abs(step - value) < Math.abs(steps[best] - value)) best = index
  })
  return best
}

// Preserve relative roll quality when stat families have different tier counts.
function carryTier(fromKey: string, fromValue: number, toKey: string): number {
  const to = getSbstStepP(toKey)
  if (!to.length) return 0

  const from = getSbstStepP(fromKey)
  if (from.length < 2) return to[0]

  const fraction = stepIndex(fromKey, fromValue) / (from.length - 1)
  return to[Math.round(fraction * (to.length - 1))]
}

function matchStats(query: string, options: string[]): string[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return options

  return options.filter((key) => {
    const label = fmtStatKey(key).toLowerCase()
    return label.startsWith(needle)
      || label.split(/\s+/).some((word) => word.startsWith(needle))
      || (STAT_ALIASES[key] ?? []).some((alias) => alias.startsWith(needle))
  })
}

interface StatFieldP {
  statKey: string
  options: string[]
  usedKeys?: Set<string>
  placeholder?: string
  ariaLabel: string
  onPick: (key: string) => void
}

// Resolve typed labels and aliases to an available stat; Enter or Tab commits it.
function StatField({ statKey, options, usedKeys, placeholder, ariaLabel, onPick }: StatFieldP) {
  const label = statKey ? fmtStatKey(statKey) : ''
  const [draft, setDraft] = useState<string | null>(null)
  const [typed, setTyped] = useState(false)
  const [highlight, setHighlight] = useState(0)

  const query = typed ? draft ?? '' : ''
  const matches = useMemo(() => {
    const taken = (key: string) => (usedKeys?.has(key) ?? false) && key !== statKey
    return matchStats(query, options)
      .map((key) => ({ key, taken: taken(key) }))
      .sort((a, b) => Number(a.taken) - Number(b.taken))
  }, [query, options, usedKeys, statKey])

  const open = draft !== null
  const current = matches[highlight]
  const completion = !typed || !current || current.taken
    ? ''
    : fmtStatKey(current.key).toLowerCase().startsWith(query.toLowerCase())
      ? fmtStatKey(current.key).slice(query.length)
      : ''

  const close = useCallback(() => {
    setDraft(null)
    setTyped(false)
    setHighlight(0)
  }, [])

  const commit = (key: string) => {
    close()
    onPick(key)
  }

  const onKeyDown = (event: ReactKeyEvt<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!matches.length) return
      const step = event.key === 'ArrowDown' ? 1 : -1
      for (let hop = 1; hop <= matches.length; hop += 1) {
        const next = (highlight + step * hop + matches.length) % matches.length
        if (!matches[next].taken) {
          setHighlight(next)
          break
        }
      }
      return
    }

    if (event.key === 'Enter' || (event.key === 'Tab' && !event.shiftKey && typed)) {
      if (!current || current.taken) return
      event.preventDefault()
      commit(current.key)
      return
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      close()
      event.currentTarget.blur()
    }
  }

  return (
    <span className="eec-field">
      <input
        className="eec-field-input"
        type="text"
        value={draft ?? label}
        placeholder={placeholder}
        aria-label={ariaLabel}
        autoComplete="off"
        spellCheck={false}
        onFocus={(event) => {
          setDraft(label)
          setTyped(false)
          setHighlight(Math.max(0, options.indexOf(statKey)))
          event.currentTarget.select()
        }}
        onChange={(event) => {
          setDraft(event.target.value)
          setTyped(true)
          setHighlight(0)
        }}
        onKeyDown={onKeyDown}
        onBlur={close}
      />
      <span className="eec-ghost" aria-hidden="true">
        {completion ? <><i>{draft}</i>{completion}</> : null}
      </span>

      {open && matches.length > 0 ? (
        <span className="eec-sugg" role="listbox" aria-label={ariaLabel}>
          {matches.map((match, index) => (
            <button
              key={match.key}
              type="button" tabIndex={-1} role="option"
              className={`eec-sugg-opt${index === highlight ? ' is-hi' : ''}`}
              aria-selected={index === highlight}
              disabled={match.taken}
              onMouseDown={(event) => {
                event.preventDefault()
                if (!match.taken) commit(match.key)
              }}
            >
              <StatGlyph statKey={match.key} size={0.85} />
              <span>{fmtStatKey(match.key)}</span>
              <em>{match.taken ? 'in use' : STAT_ALIASES[match.key]?.[0] ?? ''}</em>
            </button>
          ))}
        </span>
      ) : null}
    </span>
  )
}

interface RollReelP {
  statKey: string
  value: number
  onChange: (next: number) => void
  innerRef?: (node: HTMLDivElement | null) => void
}

// Wheel, drag, keyboard, and slider input all resolve to a legal roll index.
function RollReel({ statKey, value, onChange, innerRef }: RollReelP) {
  const steps = useMemo(() => getSbstStepP(statKey), [statKey])
  const index = stepIndex(statKey, value)
  const reelRef = useRef<HTMLDivElement | null>(null)
  const [live, setLive] = useState(false)

  const apply = useCallback((next: number) => {
    if (!steps.length) return
    const clamped = Math.max(0, Math.min(steps.length - 1, next))
    if (steps[clamped] !== value) onChange(steps[clamped])
  }, [steps, value, onChange])

  const shift = useCallback((delta: number) => {
    apply(stepIndex(statKey, value) + delta)
  }, [apply, statKey, value])

  // the wheel has to be a non-passive listener to keep the page from scrolling
  useEffect(() => {
    const node = reelRef.current
    if (!node) return

    let travel = 0
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      travel += event.deltaY
      if (Math.abs(travel) < 28) return
      const direction = Math.sign(travel)
      travel = 0
      shift(direction)
    }

    node.addEventListener('wheel', onWheel, { passive: false })
    return () => node.removeEventListener('wheel', onWheel)
  }, [shift])

  const track = (
    node: HTMLElement,
    pointerId: number,
    read: (clientY: number) => void,
  ) => {
    node.setPointerCapture(pointerId)
    setLive(true)

    const move = (event: PointerEvent) => read(event.clientY)
    const stop = () => {
      setLive(false)
      node.removeEventListener('pointermove', move)
      node.removeEventListener('pointerup', stop)
      node.removeEventListener('pointercancel', stop)
    }

    node.addEventListener('pointermove', move)
    node.addEventListener('pointerup', stop)
    node.addEventListener('pointercancel', stop)
  }

  const onReelDown = (event: ReactPtrEvt<HTMLDivElement>) => {
    const node = event.currentTarget
    const startY = event.clientY
    const startIndex = index
    node.focus()
    track(node, event.pointerId, (clientY) => apply(startIndex + Math.round((startY - clientY) / 16)))
  }

  const onRailDown = (event: ReactPtrEvt<HTMLSpanElement>) => {
    const node = event.currentTarget
    const rect = node.getBoundingClientRect()
    const read = (clientY: number) => {
      const fraction = 1 - (clientY - rect.top) / rect.height
      apply(Math.round(fraction * (steps.length - 1)))
    }
    reelRef.current?.focus()
    read(event.clientY)
    track(node, event.pointerId, read)
  }

  const onKeyDown = (event: ReactKeyEvt<HTMLDivElement>) => {
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      shift(1)
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      shift(-1)
    } else if (event.key === 'Home') {
      event.preventDefault()
      apply(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      apply(steps.length - 1)
    }
  }

  const last = steps.length - 1

  return (
    <div className={`eec-stage${live ? ' is-live' : ''}`}>
      <div
        className="eec-reel"
        ref={(node) => {
          reelRef.current = node
          innerRef?.(node)
        }}
        tabIndex={0}
        role="spinbutton"
        aria-label={`${fmtStatKey(statKey)} roll`}
        aria-valuenow={value}
        aria-valuemin={steps[0]}
        aria-valuemax={steps[last]}
        aria-valuetext={fmtStatValue(statKey, value)}
        onPointerDown={onReelDown}
        onKeyDown={onKeyDown}
      >
        <div className="eec-window">
          <div className="eec-strip" style={{ '--i': index } as CssProps}>
            {steps.map((step, position) => (
              <div
                key={step}
                className={`eec-line${position === index ? ' is-cur' : ''}${position === last ? ' is-top' : ''}`}
              >
                {fmtStatValue(statKey, step)}
              </div>
            ))}
          </div>
        </div>
      </div>

      <span className="eec-rail" aria-hidden="true" onPointerDown={onRailDown}>
        <span className="eec-dot" style={{ '--p': last > 0 ? index / last : 0 } as CssProps} />
      </span>
    </div>
  )
}

interface EchoEditMdlP {
  visible: boolean
  open: boolean
  closing: boolean
  portalTarget: HTMLElement | null
  echo: EchoInstance
  slotIndex: number
// Catalog and cost-budget props enable slot replacement; saved-Echo edits omit them.
  echoes?: EchoDef[]
  maxCost?: number
  onClear?: () => void
  onSave: (updated: EchoInstance) => void
  onClose: () => void
}

export function Edit({
  visible,
  open,
  closing,
  portalTarget,
  echo,
  slotIndex,
  echoes = [],
  maxCost = 12,
  onSave,
  onClear,
  onClose,
}: EchoEditMdlP) {
  // Catalog replacement stays local until the caller receives the saved draft.
  const [echoId, setEchoId] = useState(echo.id)
  const [mainStatKey, setMainStatK] = useState(echo.mainStats.primary.key)
  const [selectedSet, setSelSet] = useState(echo.set)
  const [lclSbst, setLclSbst] = useState<Array<[string, number]>>(
    Object.entries(echo.substats),
  )

  const picker = useAppModal()
  const reelRefs = useRef<Array<HTMLDivElement | null>>([])

  // Reset local state when echo changes
  useEffect(() => {
    setEchoId(echo.id)
    setMainStatK(echo.mainStats.primary.key)
    setSelSet(echo.set)
    setLclSbst(Object.entries(echo.substats))
  }, [echo])

  const definition = getEchoById(echoId)
  const canRecast = echoes.length > 0
  const cost = definition?.cost ?? 0
  const primaryOptions = useMemo(() => ECHO_MAIN_STATS[cost] ?? {}, [cost])
  const primaryKeys = useMemo(() => Object.keys(primaryOptions), [primaryOptions])
  const secondaryStat = ECHO_SIDE_STATS[cost]
  const setOptions = definition?.sets ?? []
  const usedKeys = useMemo(() => new Set(lclSbst.map(([key]) => key)), [lclSbst])

// Retain only stats legal for the replacement piece, matching slot initialization.
  const onEchoSel = useCallback((nextId: string) => {
    const nextDef = getEchoById(nextId)
    if (!nextDef) return

    const nextPrimary = ECHO_MAIN_STATS[nextDef.cost] ?? {}
    const nextKeys = Object.keys(nextPrimary)

    setEchoId(nextId)
    setSelSet((prev) => (nextDef.sets.includes(prev) ? prev : nextDef.sets[0] ?? 0))
    setMainStatK((prev) => (nextKeys.includes(prev) ? prev : nextKeys[0] ?? ''))
    picker.hide()
  }, [picker])

  const setSubValue = useCallback((index: number, next: number) => {
    setLclSbst((prev) => prev.map((entry, position) => (
      position === index ? [entry[0], next] as [string, number] : entry
    )))
  }, [])

// Empty slots append a stat; occupied slots replace it while retaining roll quality.
  const pickSubstat = useCallback((index: number, key: string) => {
    setLclSbst((prev) => {
      if (prev.some(([used], position) => used === key && position !== index)) return prev

      const steps = getSbstStepP(key)
      if (index >= prev.length) {
        return prev.length >= MAX_SUBSTATS ? prev : [...prev, [key, steps[0] ?? 0]]
      }

      const [fromKey, fromValue] = prev[index]
      return prev.map((entry, position) => (
        position === index ? [key, carryTier(fromKey, fromValue, key)] as [string, number] : entry
      ))
    })

    window.requestAnimationFrame(() => reelRefs.current[index]?.focus())
  }, [])

  const removeSubstat = useCallback((index: number) => {
    setLclSbst((prev) => prev.filter((_, position) => position !== index))
  }, [])

  if (!visible || !portalTarget || !definition) return null

  const handleSave = () => {
    if (!mainStatKey) return

    const primaryValue = primaryOptions[mainStatKey] ?? 0

    const vldtSbst = lclSbst.map(([key, value]) => {
      return [key, snapToNrstSb(key, value)] as [string, number]
    })

    onSave({
      ...echo,
      uid: makeEchoUid(),
      id: definition.id,
      set: selectedSet,
      mainStats: {
        primary: { key: mainStatKey, value: primaryValue },
        secondary: secondaryStat
          ? { key: secondaryStat.key, value: secondaryStat.value }
          : echo.mainStats.secondary,
      },
      substats: Object.fromEntries(vldtSbst),
    })
  }

  const critValue = lclSbst.reduce((total, [key, value]) => {
    if (key === 'critRate') return total + value * 2
    if (key === 'critDmg') return total + value
    return total
  }, 0)

  const topRolls = lclSbst.filter(([key, value]) => {
    const steps = getSbstStepP(key)
    return steps.length > 0 && value === steps[steps.length - 1]
  }).length

  return (
    <>
      <AppModal
        state={{ visible, open, closing: closing ?? false }}
        variant="echo-edit"
        ariaLabel={`${definition.name} echo editor`}
        onClose={onClose}
      >
        <div className="amdl echo-edit-panel__body" onClick={(e) => e.stopPropagation()}>
          <header className="amdl__head eec-head">
            <button
              type="button" className="eec-id"
              onClick={() => picker.show()}
              aria-label={`Change echo, currently ${definition.name}`}
              disabled={!canRecast}
            >
              <span className="eec-lead">
                <img src={definition.icon} alt="" loading="lazy" onError={withDefEchoMg} />
                {canRecast ? <em>Change</em> : null}
              </span>
              <span className="eec-plate">
                <span className="amdl__over">Echo</span>
                <strong className="eec-name">{definition.name}</strong>
                <span className="eec-set"
                  style={{ '--set-clr': getSntSetClr(selectedSet) ?? 'var(--amdl-accent)' } as CssProps}
                >
                  {getSntSetIco(selectedSet) ? (
                    <img
                      src={getSntSetIco(selectedSet) ?? undefined}
                      alt=""
                      loading="lazy"
                      onError={withDefIconM}
                    />
                  ) : null}
                  {getSntSetNam(selectedSet)}
                </span>
              </span>
            </button>

            <span className="amdl__fill" />

            <span className="amdl__gauge">
              <span className="amdl__tag">{cost}C</span>
              {echo.mainEcho ? <span className="amdl__tag is-accent">Main</span> : null}
            </span>

            <button type="button" className="amdl__close" aria-label="Close" onClick={onClose}>
              <X size="0.95rem" />
            </button>
          </header>

          <div className="eec-band">
            {mainStatKey ? <StatGlyph statKey={mainStatKey} size={1.1} /> : null}
            <StatField
              statKey={mainStatKey}
              options={primaryKeys}
              ariaLabel="Main stat"
              onPick={(key) => setMainStatK(key)}
            />
            <strong className="eec-main-val">
              {fmtStatValue(mainStatKey, primaryOptions[mainStatKey] ?? 0)}
            </strong>

            {setOptions.length > 1 ? (
              <div className="eec-sets" role="group" aria-label="Sonata set">
                {setOptions.map((setId) => (
                  <button
                    key={setId}
                    type="button" className="eec-set-mark"
                    aria-pressed={selectedSet === setId}
                    aria-label={getSntSetNam(setId)}
                    title={getSntSetNam(setId)}
                    style={{ '--set-clr': getSntSetClr(setId) ?? 'var(--amdl-accent)' } as CssProps}
                    onClick={() => setSelSet(setId)}
                  >
                    {getSntSetIco(setId) ? (
                      <img src={getSntSetIco(setId) ?? undefined} alt="" loading="lazy" onError={withDefIconM} />
                    ) : null}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="eec-bank" role="group" aria-label="Substats">
            {Array.from({ length: MAX_SUBSTATS }, (_, index) => {
              const entry = lclSbst[index]

              if (!entry) {
                const isNext = index === lclSbst.length
                return (
                  <div key={index} className="eec-col is-open">
                    <span className="eec-col-head"><span>{index + 1}</span></span>
                    <span className="eec-col-ghost" aria-hidden="true" />
                    <div className="eec-col-name">
                      {isNext ? (
                        <StatField
                          statKey=""
                          options={SUBSTAT_KEYS}
                          usedKeys={usedKeys}
                          placeholder="Type a stat"
                          ariaLabel="Add a substat"
                          onPick={(key) => pickSubstat(index, key)}
                        />
                      ) : (
                        <span className="eec-col-idle">Open</span>
                      )}
                    </div>
                  </div>
                )
              }

              const [key, value] = entry
              const steps = getSbstStepP(key)
              const roll = stepIndex(key, value)

              return (
                <div key={index} className="eec-col">
                  <span className="eec-col-head">
                    <span>{index + 1}</span>
                    <span className={`eec-tier${roll === steps.length - 1 ? ' is-top' : ''}`}>
                      {roll + 1}/{steps.length}
                    </span>
                  </span>

                  <button
                    type="button" className="eec-col-drop"
                    onClick={() => removeSubstat(index)}
                    aria-label={`Remove ${fmtStatKey(key)}`}
                  >
                    <X size="0.72rem" />
                  </button>

                  <RollReel
                    statKey={key}
                    value={value}
                    onChange={(next) => setSubValue(index, next)}
                    innerRef={(node) => { reelRefs.current[index] = node }}
                  />

                  <div className="eec-col-name">
                    <StatGlyph statKey={key} size={0.95} />
                    <StatField
                      statKey={key}
                      options={SUBSTAT_KEYS}
                      usedKeys={usedKeys}
                      ariaLabel={`Substat ${index + 1}`}
                      onPick={(next) => pickSubstat(index, next)}
                    />
                  </div>
                </div>
              )
            })}
          </div>

          <footer className="amdl__foot">
            <span className="eec-tally">
              <span>CV <b>{critValue.toFixed(1)}</b></span>
              <span>{topRolls} top {topRolls === 1 ? 'roll' : 'rolls'}</span>
              <span>{lclSbst.length} of {MAX_SUBSTATS} substats</span>
            </span>
            <span className="amdl__fill" />
            <button type="button" className="amdl__act" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button" className="amdl__act is-go"
              onClick={handleSave}
              disabled={!mainStatKey}
            >
              Save changes
            </button>
          </footer>
        </div>
      </AppModal>

      {canRecast && picker.visible ? (
        <EchoPicker
          visible={picker.visible}
          open={picker.open}
          closing={picker.closing}
          portalTarget={portalTarget}
          echoes={echoes}
          selEchoId={echoId}
          slotIndex={slotIndex}
          maxCost={maxCost}
          onSelect={onEchoSel}
          onClear={() => {
            picker.hide()
            onClear?.()
          }}
          onClose={() => picker.hide()}
        />
      ) : null}
    </>
  )
}
