/*
  Author: Runor Ewhro
  Description: Renders the edit surface for the calculator echoes flow.
*/

import { useEffect, useState } from 'react'
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
import { getSntSetNam, getSntSetIco } from '@/data/gameData/catalog/sonataSets.ts'
import { LiquidSelect } from '@/shared/ui/LiquidSelect.tsx'
import { MdlClsBttn } from '@/shared/ui/ModalCloseButton.tsx'
import { withDefEchoMg, withDefIconM } from '@/shared/lib/imageFallback'
import { AppModal } from '@/shared/ui/AppModal'

const STAT_LABELS: Record<string, string> = {
  hpPercent: 'HP%',
  atkPercent: 'ATK%',
  defPercent: 'DEF%',
  critRate: 'Crit Rate',
  critDmg: 'Crit DMG',
  healingBonus: 'Healing',
  energyRegen: 'Energy Regen',
  tuneBreakBoost: 'Tune Break Boost',
  hpFlat: 'HP',
  atkFlat: 'ATK',
  defFlat: 'DEF',
  aero: 'Aero DMG',
  glacio: 'Glacio DMG',
  electro: 'Electro DMG',
  fusion: 'Fusion DMG',
  havoc: 'Havoc DMG',
  spectro: 'Spectro DMG',
  basicAtk: 'Basic ATK',
  heavyAtk: 'Heavy ATK',
  resonanceSkill: 'Res. Skill',
  resonanceLiberation: 'Res. Liberation',
}

function fmtStatKey(key: string): string {
  return STAT_LABELS[key] ?? key
}

function fmtStatValue(key: string, value: number): string {
  if (key.endsWith('Flat')) {
    return String(Math.round(value))
  }

  if (key === 'tuneBreakBoost') {
    return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, '')
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
  onSave: (updated: EchoInstance) => void
  onClose: () => void
}

export function Edit({
  visible,
  open,
  closing,
  portalTarget,
  echo,
  onSave,
  onClose,
}: EchoEditMdlP) {
  const definition = getEchoById(echo.id)
  const cost = definition?.cost ?? 0
  const primaryOptions = ECHO_MAIN_STATS[cost] ?? {}
  const secondaryStat = ECHO_SIDE_STATS[cost]
  const setOptions = definition?.sets ?? []

  const [mainStatKey, setMainStatK] = useState(echo.mainStats.primary.key)
  const [selectedSet, setSelSet] = useState(echo.set)
  const [lclSbst, setLclSbst] = useState<Array<[string, number]>>(
    Object.entries(echo.substats),
  )

  // Reset local state when echo changes
  useEffect(() => {
    setMainStatK(echo.mainStats.primary.key)
    setSelSet(echo.set)
    setLclSbst(Object.entries(echo.substats))
  }, [echo])

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
    if (lclSbst.length >= 5) return
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
    <AppModal
      state={{ visible, open, closing: closing ?? false }}
      variant="echo-edit"
      ariaLabel={`${definition.name} echo editor`}
      onClose={onClose}
    >
      <div className="echo-edit-panel__body" onClick={(e) => e.stopPropagation()}>
        <div className="echo-edit-header">
          <div className="echo-edit-header-left">
            <img
              src={definition.icon}
              alt={definition.name}
              className="echo-edit-icon"
              loading="lazy"
              onError={withDefEchoMg}
            />
            <div className="echo-edit-identity">
              <span className="echo-edit-name">{definition.name}</span>
              <div className="echo-edit-meta">
                <span className="echo-edit-cost">{cost}C</span>
                {echo.mainEcho ? <span className="echo-edit-main-badge">Main</span> : null}
              </div>
            </div>
          </div>

          <MdlClsBttn onClick={onClose} />
        </div>

        <section className="echo-edit-section__row">
          {setOptions.length > 1 ? (
              <div className="echo-edit-section echo-set-tier">
                <span className="echo-edit-section-label">Sonata Set</span>
                <div className="echo-edit-set-group">
                  {setOptions.map((setId) => {
                    const icon = getSntSetIco(setId)
                    const isActive = selectedSet === setId
                    return (
                        <button
                            key={setId}
                            type="button"
                            className={`echo-edit-set-btn${isActive ? ' echo-edit-set-btn--active' : ''}`}
                            onClick={() => setSelSet(setId)}
                            title={getSntSetNam(setId)}
                        >
                          {icon ? (
                              <img src={icon} alt={getSntSetNam(setId)} className="echo-edit-set-img" loading="lazy" onError={withDefIconM} />
                          ) : null}
                          <span className="echo-edit-set-name">{getSntSetNam(setId)}</span>
                        </button>
                    )
                  })}
                </div>
              </div>
          ) : null}

          <div className="echo-edit-section echo-set-tier">
            <span className="echo-edit-section-label">
              Main Stat {secondaryStat ? (
                <div className="echo-edit-secondary-stat">
                  {fmtStatKey(secondaryStat.key)} {fmtStatValue(secondaryStat.key, secondaryStat.value)}
                  <span className="echo-edit-secondary-tag">Fixed</span>
                </div>
            ) : null}</span>
            <div className="echo-edit-main-stat-row">
              <LiquidSelect
                  value={mainStatKey}
                  options={Object.entries(primaryOptions).map(([key, value]) => ({
                    value: key,
                    label: `${fmtStatKey(key)} — ${fmtStatValue(key, value)}`,
                  }))}
                  onChange={(key) => setMainStatK(key)}
                  ariaLabel="Primary main stat"
              />
            </div>
          </div>
        </section>

        <div className="echo-edit-section echo-edit-substats-section echo-set-tier">
          <span className="echo-edit-section-label">
            Substats
            <span className="echo-edit-section-count">{lclSbst.length}/5</span>
          </span>

          <div className="echo-edit-substats">
            {lclSbst.map(([type, value], index) => {
              const stepOptions = getSbstStepP(type)
              const step = getSbstStep(type)
              const min = stepOptions.length > 0 ? Math.min(...stepOptions) : 0
              const max = stepOptions.length > 0 ? Math.max(...stepOptions) : 100

              return (
                <div key={index} className="echo-edit-substat-row">
                  <button
                    type="button"
                    className="echo-edit-substat-remove"
                    onClick={() => onRmSbst(index)}
                    title="Remove substat"
                  >
                    −
                  </button>

                  <div className="echo-edit-substat-toggles">
                    {SUBSTAT_KEYS.map((statKey) => {
                      const isSelected = statKey === type
                      const isUsedLswh = lclSbst.some(
                        ([k], i) => k === statKey && i !== index,
                      )
                      return (
                        <button
                          key={statKey}
                          type="button"
                          className={`echo-edit-stat-tag${isSelected ? ' echo-edit-stat-tag--active' : ''}${isUsedLswh ? ' echo-edit-stat-tag--disabled' : ''}`}
                          onClick={() => !isUsedLswh && onTypeChng(index, statKey)}
                          disabled={isUsedLswh}
                        >
                          {fmtStatKey(statKey)}
                        </button>
                      )
                    })}
                  </div>

                  <input
                    className="echo-edit-substat-input"
                    type="number"
                    step={step}
                    min={min}
                    max={max}
                    value={value}
                    onChange={(e) => onVlNpt(index, e.target.value)}
                    onBlur={(e) => onVlChng(index, e.target.value)}
                  />
                </div>
              )
            })}

            {lclSbst.length < 5 ? (
              <button
                type="button"
                className="echo-edit-add-substat"
                onClick={onAddSbst}
              >
                + Add Substat
              </button>
            ) : null}
          </div>
        </div>

        <div className="echo-edit-footer">
          <button
            type="button"
            className="echo-edit-btn echo-edit-btn--cancel"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="echo-edit-btn echo-edit-btn--save"
            onClick={handleSave}
            disabled={!mainStatKey}
          >
            Save
          </button>
        </div>
      </div>
    </AppModal>
  )
}
