import { useEffect, useState } from 'react'
import type { EchoInstance } from '@/domain/entities/runtime'
import { createEchoUid } from '@/domain/entities/runtime'
import { getEchoById } from '@/domain/services/echoCatalogService'
import {
  ECHO_PRIMARY_STATS,
  ECHO_SECONDARY_STATS,
  ECHO_SUBSTAT_KEYS,
  getSubstatStepOptions,
  getSubstatStep,
  snapToNearestSubstatValue,
} from '@/data/gameData/catalog/echoStats'
import { getSonataSetName, getSonataSetIcon } from '@/data/gameData/catalog/sonataSets'
import { LiquidSelect } from '@/shared/ui/LiquidSelect'
import { ModalCloseButton } from '@/shared/ui/ModalCloseButton'
import { AppDialog } from '@/shared/ui/AppDialog'

const STAT_LABELS: Record<string, string> = {
  hpPercent: 'HP%',
  atkPercent: 'ATK%',
  defPercent: 'DEF%',
  critRate: 'Crit Rate',
  critDmg: 'Crit DMG',
  healingBonus: 'Healing',
  energyRegen: 'Energy Regen',
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

function formatStatKey(key: string): string {
  return STAT_LABELS[key] ?? key
}

// lets the user fine-tune an echo's rolls before saving.
interface EchoEditModalProps {
  visible: boolean
  open: boolean
  closing: boolean
  portalTarget: HTMLElement | null
  echo: EchoInstance
  slotIndex: number
  onSave: (updated: EchoInstance) => void
  onClose: () => void
}

export function EchoEditModal({
  visible,
  open,
  closing,
  portalTarget,
  echo,
  onSave,
  onClose,
}: EchoEditModalProps) {
  const definition = getEchoById(echo.id)
  const cost = definition?.cost ?? 0
  const primaryStatOptions = ECHO_PRIMARY_STATS[cost] ?? {}
  const secondaryStat = ECHO_SECONDARY_STATS[cost]
  const setOptions = definition?.sets ?? []

  const [mainStatKey, setMainStatKey] = useState(echo.mainStats.primary.key)
  const [selectedSet, setSelectedSet] = useState(echo.set)
  const [localSubstats, setLocalSubstats] = useState<Array<[string, number]>>(
    Object.entries(echo.substats),
  )

  // Reset local state when echo changes
  useEffect(() => {
    setMainStatKey(echo.mainStats.primary.key)
    setSelectedSet(echo.set)
    setLocalSubstats(Object.entries(echo.substats))
  }, [echo])

  if (!visible || !portalTarget || !definition) return null

  const handleTypeChange = (index: number, newType: string) => {
    const isDuplicate = localSubstats.some(
      ([key], i) => key === newType && i !== index,
    )
    if (isDuplicate) return

    const updated = localSubstats.map((entry, i) => {
      if (i !== index) return entry
      const options = getSubstatStepOptions(newType)
      const defaultVal = options.length > 0 ? options[0] : 0
      return [newType, defaultVal] as [string, number]
    })
    setLocalSubstats(updated)
  }

  const handleValueChange = (index: number, rawValue: string) => {
    const [key] = localSubstats[index]
    const parsed = parseFloat(rawValue)
    if (isNaN(parsed)) return

    const options = getSubstatStepOptions(key)
    if (!options.length) return

    const min = Math.min(...options)
    const max = Math.max(...options)
    const clamped = Math.max(min, Math.min(max, parsed))
    const snapped = snapToNearestSubstatValue(key, clamped)

    const updated = [...localSubstats]
    updated[index] = [key, snapped]
    setLocalSubstats(updated)
  }

  const handleValueInput = (index: number, rawValue: string) => {
    const parsed = parseFloat(rawValue)
    if (isNaN(parsed)) return
    const updated = [...localSubstats]
    updated[index] = [updated[index][0], parsed]
    setLocalSubstats(updated)
  }

  const handleAddSubstat = () => {
    if (localSubstats.length >= 5) return
    // Find first unused substat key
    const usedKeys = new Set(localSubstats.map(([k]) => k))
    const defaultKey = ECHO_SUBSTAT_KEYS.find((k) => !usedKeys.has(k)) ?? 'atkPercent'
    const options = getSubstatStepOptions(defaultKey)
    const defaultValue = options.length > 0 ? options[0] : 0
    setLocalSubstats([...localSubstats, [defaultKey, defaultValue]])
  }

  const handleRemoveSubstat = (index: number) => {
    setLocalSubstats(localSubstats.filter((_, i) => i !== index))
  }

  const handleSave = () => {
    if (!mainStatKey) return

    const primaryValue = primaryStatOptions[mainStatKey] ?? 0

    const validatedSubstats = localSubstats.map(([key, value]) => {
      return [key, snapToNearestSubstatValue(key, value)] as [string, number]
    })

    onSave({
      ...echo,
      uid: createEchoUid(),
      set: selectedSet,
      mainStats: {
        primary: { key: mainStatKey, value: primaryValue },
        secondary: secondaryStat
          ? { key: secondaryStat.key, value: secondaryStat.value }
          : echo.mainStats.secondary,
      },
      substats: Object.fromEntries(validatedSubstats),
    })
  }

  return (
    <AppDialog
      visible={visible}
      open={open}
      closing={closing}
      portalTarget={portalTarget}
      overlayClassName="echo-edit-overlay"
      contentClassName="echo-edit-panel"
      ariaLabel={`${definition.name} echo editor`}
      onClose={onClose}
    >
      <div className="echo-edit-panel__body" onClick={(e) => e.stopPropagation()}>
        {/* ── Header ── */}
        <div className="echo-edit-header">
          <div className="echo-edit-header-left">
            <img
              src={definition.icon}
              alt={definition.name}
              className="echo-edit-icon"
              loading="lazy"
            />
            <div className="echo-edit-identity">
              <span className="echo-edit-name">{definition.name}</span>
              <div className="echo-edit-meta">
                <span className="echo-edit-cost">{cost}C</span>
                {echo.mainEcho ? <span className="echo-edit-main-badge">Main</span> : null}
              </div>
            </div>
          </div>

          <ModalCloseButton onClick={onClose} />
        </div>

        <section className="echo-edit-section__row">
          {/* ── Set selection ── */}
          {setOptions.length > 1 ? (
              <div className="echo-edit-section echo-set-tier">
                <span className="echo-edit-section-label">Sonata Set</span>
                <div className="echo-edit-set-group">
                  {setOptions.map((setId) => {
                    const icon = getSonataSetIcon(setId)
                    const isActive = selectedSet === setId
                    return (
                        <button
                            key={setId}
                            type="button"
                            className={`echo-edit-set-btn${isActive ? ' echo-edit-set-btn--active' : ''}`}
                            onClick={() => setSelectedSet(setId)}
                            title={getSonataSetName(setId)}
                        >
                          {icon ? (
                              <img src={icon} alt={getSonataSetName(setId)} className="echo-edit-set-img" loading="lazy" />
                          ) : null}
                          <span className="echo-edit-set-name">{getSonataSetName(setId)}</span>
                        </button>
                    )
                  })}
                </div>
              </div>
          ) : null}

          {/* ── Main stat ── */}
          <div className="echo-edit-section echo-set-tier">
            <span className="echo-edit-section-label">
              Main Stat {secondaryStat ? (
                <div className="echo-edit-secondary-stat">
                  {formatStatKey(secondaryStat.key)} {secondaryStat.key.endsWith('Flat') ? Math.round(secondaryStat.value) : `${secondaryStat.value}%`}
                  <span className="echo-edit-secondary-tag">Fixed</span>
                </div>
            ) : null}</span>
            <div className="echo-edit-main-stat-row">
              <LiquidSelect
                  value={mainStatKey}
                  options={Object.entries(primaryStatOptions).map(([key, value]) => ({
                    value: key,
                    label: `${formatStatKey(key)} — ${key.endsWith('Flat') ? Math.round(value) : `${value}%`}`,
                  }))}
                  onChange={(key) => setMainStatKey(key)}
                  ariaLabel="Primary main stat"
              />
            </div>
          </div>
        </section>

        {/* ── Substats ── */}
        <div className="echo-edit-section echo-edit-substats-section echo-set-tier">
          <span className="echo-edit-section-label">
            Substats
            <span className="echo-edit-section-count">{localSubstats.length}/5</span>
          </span>

          <div className="echo-edit-substats">
            {localSubstats.map(([type, value], index) => {
              const stepOptions = getSubstatStepOptions(type)
              const step = getSubstatStep(type)
              const min = stepOptions.length > 0 ? Math.min(...stepOptions) : 0
              const max = stepOptions.length > 0 ? Math.max(...stepOptions) : 100

              return (
                <div key={index} className="echo-edit-substat-row">
                  <button
                    type="button"
                    className="echo-edit-substat-remove"
                    onClick={() => handleRemoveSubstat(index)}
                    title="Remove substat"
                  >
                    −
                  </button>

                  <div className="echo-edit-substat-toggles">
                    {ECHO_SUBSTAT_KEYS.map((statKey) => {
                      const isSelected = statKey === type
                      const isUsedElsewhere = localSubstats.some(
                        ([k], i) => k === statKey && i !== index,
                      )
                      return (
                        <button
                          key={statKey}
                          type="button"
                          className={`echo-edit-stat-tag${isSelected ? ' echo-edit-stat-tag--active' : ''}${isUsedElsewhere ? ' echo-edit-stat-tag--disabled' : ''}`}
                          onClick={() => !isUsedElsewhere && handleTypeChange(index, statKey)}
                          disabled={isUsedElsewhere}
                        >
                          {formatStatKey(statKey)}
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
                    onChange={(e) => handleValueInput(index, e.target.value)}
                    onBlur={(e) => handleValueChange(index, e.target.value)}
                  />
                </div>
              )
            })}

            {localSubstats.length < 5 ? (
              <button
                type="button"
                className="echo-edit-add-substat"
                onClick={handleAddSubstat}
              >
                + Add Substat
              </button>
            ) : null}
          </div>
        </div>

        {/* ── Footer ── */}
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
    </AppDialog>
  )
}
