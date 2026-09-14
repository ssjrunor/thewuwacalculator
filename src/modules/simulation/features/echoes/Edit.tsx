/*
  Author: Runor Ewhro
  Description: The echo editor. Two columns: what the echo is (the piece, its
               sonata set and its main stat) on the left, the five substat rolls
               on the right, so the whole edit stands without scrolling.

               The moves are the ones the panel has always had: a chip picks a
               substat's stat, the value is typed and snaps to a legal roll when
               it loses focus, the set and main stat are chosen, then save. The
               head is the one addition: it is the echo, and it opens the picker,
               so a slot can be re-cast without leaving the editor.
*/

import { useCallback, useEffect, useState } from 'react'
import type { CSSProperties as CssProps } from 'react'
import { Minus, X } from 'lucide-react'
import type { EchoDef } from '@/domain/entities/catalog.ts'
import type { EchoInstance } from '@/domain/entities/runtime.ts'
import { makeEchoUid } from '@/domain/entities/runtime.ts'
import { getEchoById } from '@/domain/services/echoCatalogService.ts'
import {
  ECHO_MAIN_STATS,
  ECHO_SIDE_STATS,
  SUBSTAT_KEYS,
  getSbstStepP,
  getSbstStep,
  snapToNrstSb,
} from '@/data/gameData/catalog/echoStats.ts'
import { getSntSetNam, getSntSetIco, getSntSetClr } from '@/data/gameData/catalog/sonataSets.ts'
import { LiquidSelect } from '@/shared/ui/LiquidSelect.tsx'
import { withDefEchoMg, withDefIconM } from '@/shared/lib/imageFallback'
import { AppModal } from '@/shared/ui/AppModal'
import { useAppModal } from '@/shared/ui/useAppModal.ts'
import { EchoPicker } from '@/modules/simulation/features/echoes/Picker.tsx'
import { StatGlyph } from '@/modules/simulation/workspace/ui.tsx'
import { truncTo } from '@/shared/lib/number.ts'
import { formatStatKeyLabel } from '@/modules/simulation/model/statsView.ts'

const MAX_SUBSTATS = 5

/* the chip grid is seven across, so the four longest names are trimmed there and
   only there; the full name stays on the chip's title and its label */
const CHIP_LABELS: Record<string, string> = {
  energyRegen: 'Energy',
  basicAtk: 'Basic',
  heavyAtk: 'Heavy',
  resonanceSkill: 'Skill',
  resonanceLiberation: 'Liberation',
}

function fmtStatKey(key: string): string {
  return formatStatKeyLabel(key)
}

function chipLabel(key: string): string {
  return CHIP_LABELS[key] ?? formatStatKeyLabel(key)
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

// lets the user fine-tune an echo's rolls before saving.
interface EchoEditMdlP {
  visible: boolean
  open: boolean
  closing: boolean
  portalTarget: HTMLElement | null
  echo: EchoInstance
  slotIndex: number
  /* a caller editing a build slot passes the catalog and the slot's cost budget,
     which is what turns the head into the picker handoff; a caller editing a
     stored echo passes neither, and the head is identity only */
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
  // the piece itself is editable now, so it is state rather than a read of the
  // prop: nothing lands on the build until save.
  const [echoId, setEchoId] = useState(echo.id)
  const [mainStatKey, setMainStatK] = useState(echo.mainStats.primary.key)
  const [selectedSet, setSelSet] = useState(echo.set)
  const [lclSbst, setLclSbst] = useState<Array<[string, number]>>(
    Object.entries(echo.substats),
  )

  const picker = useAppModal()

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
  const primaryOptions = ECHO_MAIN_STATS[cost] ?? {}
  const secondaryStat = ECHO_SIDE_STATS[cost]
  const setOptions = definition?.sets ?? []

  /* recasting the slot keeps whatever is still legal on the new piece, the same
     rule `mkDefEchoNst` applies when a slot is filled from the pane */
  const onEchoSel = useCallback((nextId: string) => {
    const nextDef = getEchoById(nextId)
    if (!nextDef) return

    const nextPrimary = ECHO_MAIN_STATS[nextDef.cost] ?? {}
    const primaryKeys = Object.keys(nextPrimary)

    setEchoId(nextId)
    setSelSet((prev) => (nextDef.sets.includes(prev) ? prev : nextDef.sets[0] ?? 0))
    setMainStatK((prev) => (primaryKeys.includes(prev) ? prev : primaryKeys[0] ?? ''))
    picker.hide()
  }, [picker])

  if (!visible || !portalTarget || !definition) return null

  const onTypeChng = (index: number, newType: string) => {
    const isDuplicate = lclSbst.some(
      ([key], i) => key === newType && i !== index,
    )
    if (isDuplicate) return

    const updated = lclSbst.map((entry, i) => {
      if (i !== index) return entry
      const options = getSbstStepP(newType)
      const defaultVal = options.length > 0 ? options[0] : 0
      return [newType, defaultVal] as [string, number]
    })
    setLclSbst(updated)
  }

  const onVlChng = (index: number, rawValue: string) => {
    const [key] = lclSbst[index]
    const parsed = parseFloat(rawValue)
    if (isNaN(parsed)) return

    const options = getSbstStepP(key)
    if (!options.length) return

    const min = Math.min(...options)
    const max = Math.max(...options)
    const clamped = Math.max(min, Math.min(max, parsed))
    const snapped = snapToNrstSb(key, clamped)

    const updated = [...lclSbst]
    updated[index] = [key, snapped]
    setLclSbst(updated)
  }

  const onVlNpt = (index: number, rawValue: string) => {
    const parsed = parseFloat(rawValue)
    if (isNaN(parsed)) return
    const updated = [...lclSbst]
    updated[index] = [updated[index][0], parsed]
    setLclSbst(updated)
  }

  const onAddSbst = () => {
    if (lclSbst.length >= MAX_SUBSTATS) return
    // Find first unused substat key
    const usedKeys = new Set(lclSbst.map(([k]) => k))
    const defaultKey = SUBSTAT_KEYS.find((k) => !usedKeys.has(k)) ?? 'atkPercent'
    const options = getSbstStepP(defaultKey)
    const defaultValue = options.length > 0 ? options[0] : 0
    setLclSbst([...lclSbst, [defaultKey, defaultValue]])
  }

  const onRmSbst = (index: number) => {
    setLclSbst(lclSbst.filter((_, i) => i !== index))
  }

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

  return (
    <>
      <AppModal
        state={{ visible, open, closing: closing ?? false }}
        variant="echo-edit"
        ariaLabel={`${definition.name} echo editor`}
        onClose={onClose}
      >
        <div className="amdl echo-edit-panel__body" onClick={(e) => e.stopPropagation()}>
          {/* the head is the echo, and the way to re-cast the slot */}
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

          <div className="eec-split">
            <div className="eec-left">
              <section className="eec-block">
                <span className="eec-cap">Sonata</span>
                {/* the glyph is what names a sonata, so the options are a row of
                    marks and the one you are on is read out underneath. a single
                    set stands in the same place, just not as a control. */}
                <div className="eec-sets"
                  role={setOptions.length > 1 ? 'group' : undefined}
                  aria-label={setOptions.length > 1 ? 'Sonata set' : undefined}
                >
                  {setOptions.map((setId) => {
                    const icon = getSntSetIco(setId)
                    const name = getSntSetNam(setId)
                    const only = setOptions.length === 1
                    const mark = icon ? (
                      <img src={icon} alt="" loading="lazy" onError={withDefIconM} />
                    ) : null
                    const style = { '--set-clr': getSntSetClr(setId) ?? 'var(--amdl-accent)' } as CssProps

                    return only ? (
                      <span className="eec-set-mark is-only" key={setId} style={style}>
                        {mark}
                      </span>
                    ) : (
                      <button
                        key={setId}
                        type="button" className="eec-set-mark"
                        aria-pressed={selectedSet === setId}
                        aria-label={name}
                        title={name}
                        style={style}
                        onClick={() => setSelSet(setId)}
                      >
                        {mark}
                      </button>
                    )
                  })}
                </div>
                <span className="eec-set-name">{getSntSetNam(selectedSet)}</span>
              </section>

              <section className="eec-block">
                <span className="eec-cap">Main stat</span>
                <LiquidSelect className="eec-main"
                  triggerClass="eec-main-trigger"
                  value={mainStatKey}
                  options={Object.entries(primaryOptions).map(([key, value]) => ({
                    value: key,
                    label: `${fmtStatKey(key)} · ${fmtStatValue(key, value)}`,
                  }))}
                  onChange={(key) => setMainStatK(key)}
                  ariaLabel="Primary main stat"
                />
                {secondaryStat ? (
                  <span className="eec-fixed">
                    <StatGlyph statKey={secondaryStat.key} size={0.9} />
                    {fmtStatKey(secondaryStat.key)} {fmtStatValue(secondaryStat.key, secondaryStat.value)}
                    <em>fixed</em>
                  </span>
                ) : null}
              </section>
            </div>

            <div className="eec-right">
              <span className="eec-cap">
                Substats
                <b>{lclSbst.length}/{MAX_SUBSTATS}</b>
              </span>

              <div className="eec-subs">
                {lclSbst.map(([type, value], index) => {
                  const stepOptions = getSbstStepP(type)
                  const step = getSbstStep(type)
                  const min = stepOptions.length > 0 ? Math.min(...stepOptions) : 0
                  const max = stepOptions.length > 0 ? Math.max(...stepOptions) : 100

                  return (
                    <div key={index} className="eec-sub">
                      <button
                        type="button" className="eec-sub-drop"
                        onClick={() => onRmSbst(index)}
                        aria-label={`Remove ${fmtStatKey(type)}`}
                      >
                        <Minus size="0.8rem" />
                      </button>

                      <div className="eec-chips" role="group" aria-label={`${fmtStatKey(type)} stat`}>
                        {SUBSTAT_KEYS.map((statKey) => {
                          const isSelected = statKey === type
                          const isUsedLswh = lclSbst.some(
                            ([k], i) => k === statKey && i !== index,
                          )
                          return (
                            <button
                              key={statKey}
                              type="button" className="eec-chip"
                              aria-pressed={isSelected}
                              title={isUsedLswh ? `${fmtStatKey(statKey)} is already used` : fmtStatKey(statKey)}
                              aria-label={fmtStatKey(statKey)}
                              onClick={() => !isUsedLswh && onTypeChng(index, statKey)}
                              disabled={isUsedLswh}
                            >
                              {chipLabel(statKey)}
                            </button>
                          )
                        })}
                      </div>

                      <span className="eec-val">
                        <input
                          type="number"
                          step={step}
                          min={min}
                          max={max}
                          value={value}
                          aria-label={`${fmtStatKey(type)} value`}
                          onChange={(e) => onVlNpt(index, e.target.value)}
                          onBlur={(e) => onVlChng(index, e.target.value)}
                        />
                        {type.endsWith('Flat') ? null : <em>%</em>}
                      </span>
                    </div>
                  )
                })}
              </div>

              <button
                type="button" className="eec-add"
                onClick={onAddSbst}
                disabled={lclSbst.length >= MAX_SUBSTATS}
              >
                Add substat
              </button>
            </div>
          </div>

          <footer className="amdl__foot">
            <span className="eec-note">
              {lclSbst.length < MAX_SUBSTATS
                ? `${MAX_SUBSTATS - lclSbst.length} substat slots open`
                : 'All five substats set'}
            </span>
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
