/*
  Author: Runor Ewhro
  Description: Provides quick echo-build generation controls, validating cost,
               Sonata, and main-stat constraints before applying generated echoes.
*/

import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import type { EchoInstance } from '@/domain/entities/runtime.ts'
import { getEchoById, listEchoes } from '@/data/catalog/echoCatalogService.ts'
import { ECHO_MAIN_STATS, SUBSTAT_KEYS, getSbstStepP } from '@/data/gameData/catalog/echoStats.ts'
import { ECHO_SET_DEFS } from '@/data/gameData/echoSets/effects.ts'
import { getSntSetClr, getSntSetIco, getSntSetNam } from '@/data/gameData/catalog/sonataSets.ts'
import { fmtEchoStatV } from '@/modules/simulation/features/echoes/lib/echoPane.ts'
import {
  QUICK_COSTS,
  QUICK_SLOT_COUNT,
  canMainEchoFitSetPlan,
  fitQuickConfig,
  generateQuickBuild,
  makeQuickConfig,
  maxSubCount,
  normSetPlan,
  quickCostOptions,
  quickMainStatKeys,
  setCountOptions,
  setSubCount,
  type QuickSetupConfig,
} from '@/modules/simulation/features/echoes/lib/quickSetup.ts'
import { EchoPicker } from '@/modules/simulation/features/echoes/Picker.tsx'
import { RollReel, StatField, carryTier } from '@/modules/simulation/features/echoes/Edit.tsx'
import { StatGlyph } from '@/modules/simulation/workspace/ui.tsx'
import { AppModal } from '@/shared/ui/AppModal.tsx'
import { LiquidSelect, type SelectOption } from '@/application/ui/LiquidSelect.tsx'
import { useAppModal } from '@/shared/ui/useAppModal.ts'
import { withDefEchoMg, withDefIconM } from '@/shared/lib/imageFallback'
import { Hammer, Minus, Plus, RotateCcw, TriangleAlert, X } from 'lucide-react'

const MAX_COST = 12
const MAX_SUBSTATS = 5

function setOptions(config: QuickSetupConfig): SelectOption[] {
  const remaining = config.echoCount - config.setPreferences.reduce((sum, pref) => sum + pref.count, 0)
  return ECHO_SET_DEFS
    .filter((set) => (
      !config.setPreferences.some((pref) => pref.setId === set.id) &&
      setCountOptions(set.id, remaining).length > 0
    ))
    .map((set) => ({
      value: String(set.id),
      label: set.name,
      icon: getSntSetIco(set.id) ?? undefined,
    }))
}

function stepOf(key: string, value: number): number {
  const steps = getSbstStepP(key)
  let best = 0
  steps.forEach((step, index) => {
    if (Math.abs(step - value) < Math.abs(steps[best] - value)) best = index
  })
  return best
}

interface QuickSetupProps {
  visible: boolean
  open: boolean
  closing?: boolean
  portalTarget: HTMLElement | null
  currentEchoes: Array<EchoInstance | null>
  onClose: () => void
  onGenerate: (echoes: Array<EchoInstance | null>) => void
}

export function QuickSetup({
  visible,
  open,
  closing = false,
  portalTarget,
  currentEchoes,
  onClose,
  onGenerate,
}: QuickSetupProps) {
  const [config, setConfig] = useState<QuickSetupConfig>(() => makeQuickConfig(currentEchoes))
  const [tplPick, setTplPick] = useState(0)
  const echoPicker = useAppModal()

  useEffect(() => {
    if (visible) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setConfig(makeQuickConfig(currentEchoes))
    }
  }, [currentEchoes, visible])

  const allEchoes = useMemo(() => listEchoes(), [])
  const selMainEcho = config.mainEchoId ? getEchoById(config.mainEchoId) : null
  const totalSetPc = useMemo(
    () => config.setPreferences.reduce((sum, pref) => sum + pref.count, 0),
    [config.setPreferences],
  )
  const totalSubPc = useMemo(
    () => config.substatGroups.reduce((sum, group) => sum + group.count, 0),
    [config.substatGroups],
  )
  const activeSlots = config.slots.slice(0, config.echoCount)
  const totalCost = activeSlots.reduce((sum, slot) => sum + slot.cost, 0)
  const mainEchoInvalid = Boolean(
    config.mainEchoId &&
    !canMainEchoFitSetPlan(
      config.mainEchoId,
      config.setPreferences,
      activeSlots.map((slot) => slot.cost),
    ),
  )
  const canAddSet = config.echoCount > 0 && config.setPreferences.length < 3 && totalSetPc < config.echoCount
  const vlblSets = useMemo(() => setOptions(config), [config])

  const setEchoCount = (count: number) =>
    setConfig((prev) => fitQuickConfig({ ...prev, echoCount: count }))

  const addSet = (value: string) => {
    const setId = Number(value)
    const count = setCountOptions(setId, config.echoCount)[0]
    if (!Number.isFinite(setId) || !count) {
      return
    }

    setConfig((prev) => ({
      ...prev,
      setPreferences: normSetPlan([...prev.setPreferences, { setId, count }], prev.echoCount),
    }))
  }

  const setSetCount = (setId: number, count: number) =>
    setConfig((prev) => ({
      ...prev,
      setPreferences: normSetPlan(
        prev.setPreferences.map((pref) => (pref.setId === setId ? { ...pref, count } : pref)),
        prev.echoCount,
      ),
    }))

  const removeSet = (setId: number) =>
    setConfig((prev) => ({
      ...prev,
      setPreferences: prev.setPreferences.filter((pref) => pref.setId !== setId),
    }))

  const setSlotCost = (index: number, cost: number) =>
    setConfig((prev) => {
      const slots = prev.slots.map((slot, slotIndex) => (
        slotIndex === index ? { ...slot, cost } : slot
      ))
      const mainEcho = prev.mainEchoId ? getEchoById(prev.mainEchoId) : null
      const mainEchoId = index === 0 && mainEcho?.cost !== cost ? null : prev.mainEchoId
      return fitQuickConfig({ ...prev, mainEchoId, slots })
    })

  const setMainStat = (index: number, value: string) =>
    setConfig((prev) => {
      const slots = prev.slots.map((slot, slotIndex) => (
        slotIndex === index ? { ...slot, mainStat: value || null } : slot
      ))
      return fitQuickConfig({ ...prev, slots })
    })

  const setMainEcho = (echoId: string | null) =>
    setConfig((prev) => {
      const echo = echoId ? getEchoById(echoId) : null
      const slots = [...prev.slots]
      if (echo) {
        slots[0] = { ...slots[0], cost: echo.cost }
      }

      return fitQuickConfig({
        ...prev,
        echoCount: echo ? Math.max(prev.echoCount, 1) : prev.echoCount,
        mainEchoId: echoId,
        slots,
      })
    })

  const addSubGroup = () => {
    const nextKey = SUBSTAT_KEYS[0]
    if (!nextKey) {
      return
    }

    setConfig((prev) => {
      if (prev.substatGroups.length >= prev.echoCount) {
        return prev
      }

      const substatGroups = prev.substatGroups.map((group) => ({ ...group }))
      const previous = prev.substatGroups[prev.substatGroups.length - 1]
      const total = substatGroups.reduce((sum, group) => sum + group.count, 0)
      if (total >= prev.echoCount) {
        const largestIndex = substatGroups.reduce((best, group, index) => (
          group.count > substatGroups[best].count ? index : best
        ), 0)
        if (substatGroups[largestIndex].count <= 1) {
          return prev
        }
        substatGroups[largestIndex] = {
          ...substatGroups[largestIndex],
          count: substatGroups[largestIndex].count - 1,
        }
      }

      const steps = getSbstStepP(nextKey)
      const substats = previous
        ? previous.substats.map((entry) => ({ ...entry }))
        : [{ key: nextKey, value: steps[steps.length - 1] ?? 0 }]

      return fitQuickConfig({
        ...prev,
        substatGroups: [
          ...substatGroups,
          {
            count: 1,
            substats,
          },
        ],
      })
    })
  }

  const setSubGroupCount = (groupIndex: number, count: number) =>
    setConfig((prev) => setSubCount(prev, groupIndex, count))

  const editSubstats = (
    groupIndex: number,
    edit: (substats: QuickSetupConfig['substatGroups'][number]['substats']) => QuickSetupConfig['substatGroups'][number]['substats'],
  ) =>
    setConfig((prev) => fitQuickConfig({
      ...prev,
      substatGroups: prev.substatGroups.map((group, index) => (
        index === groupIndex ? { ...group, substats: edit(group.substats) } : group
      )),
    }))

  const pickSubstat = (groupIndex: number, subIndex: number, key: string) =>
    editSubstats(groupIndex, (substats) => {
      if (substats.some((entry, index) => entry.key === key && index !== subIndex)) {
        return substats
      }

      const steps = getSbstStepP(key)
      if (subIndex >= substats.length) {
        return substats.length >= MAX_SUBSTATS
          ? substats
          : [...substats, { key, value: steps[steps.length - 1] ?? 0 }]
      }

      return substats.map((entry, index) => (
        index === subIndex ? { key, value: carryTier(entry.key, entry.value, key) } : entry
      ))
    })

  const setSubValue = (groupIndex: number, subIndex: number, value: number) =>
    editSubstats(groupIndex, (substats) => substats.map((entry, index) => (
      index === subIndex ? { ...entry, value } : entry
    )))

  const removeSubstat = (groupIndex: number, subIndex: number) =>
    editSubstats(groupIndex, (substats) => substats.filter((_, index) => index !== subIndex))

  const removeSubGroup = (groupIndex: number) =>
    setConfig((prev) => fitQuickConfig({
      ...prev,
      substatGroups: prev.substatGroups.filter((_, index) => index !== groupIndex),
    }))

  const cycleSet = (setId: number, current: number) => {
    const counts = setCountOptions(setId, config.echoCount - totalSetPc + current)
    if (counts.length < 2) {
      return
    }
    setSetCount(setId, counts[(counts.indexOf(current) + 1) % counts.length])
  }

  const generate = () => onGenerate(generateQuickBuild(config))

  if (!visible) {
    return null
  }

  const groups = config.substatGroups
  const tplIndex = Math.max(0, Math.min(tplPick, groups.length - 1))
  const group = groups[tplIndex]
  const usedKeys = new Set(group?.substats.map((entry) => entry.key) ?? [])
  const tplMax = group ? maxSubCount(config, tplIndex) : 1
  const critValue = group?.substats.reduce((total, entry) => {
    if (entry.key === 'critRate') return total + entry.value * 2
    if (entry.key === 'critDmg') return total + entry.value
    return total
  }, 0) ?? 0

  return (
    <AppModal
      state={{ visible, open, closing }}
      variant="echo-quick-setup"
      ariaLabel="Echo forge"
      onClose={onClose}
    >
      <div className="amdl eqs">
        <header className="amdl__head eqs-head">
          <button
            type="button"
            className={`eqs-id${mainEchoInvalid ? ' is-invalid' : ''}`}
            onClick={echoPicker.show}
            aria-label={mainEchoInvalid
              ? `Change lead echo. ${selMainEcho?.name ?? 'This echo'} cannot fit this Sonata plan.`
              : `Change lead echo, currently ${selMainEcho?.name ?? 'any echo'}`}
            aria-invalid={mainEchoInvalid || undefined}
            title={mainEchoInvalid ? 'This echo cannot be generated with the selected Sonata plan.' : undefined}
          >
            <span className="eqs-lead">
              {selMainEcho?.icon ? (
                <img src={selMainEcho.icon} alt="" loading="lazy" onError={withDefEchoMg} />
              ) : (
                <Plus size="0.9rem" aria-hidden />
              )}
              <em>{selMainEcho ? 'Change' : 'Pick'}</em>
              {mainEchoInvalid ? (
                <span className="eqs-lead__warn" aria-hidden>
                  <TriangleAlert size="0.62rem" strokeWidth={2.6} />
                </span>
              ) : null}
            </span>
            <span className="eqs-plate">
              <span className="amdl__over">Echo Forge</span>
              <strong className="eqs-name">{selMainEcho?.name ?? 'Any lead echo'}</strong>
            </span>
          </button>

          <span className="eqs-sets" role="group" aria-label="Sonata plan">
            {config.setPreferences.map((pref) => {
              const name = getSntSetNam(pref.setId)
              return (
                <span
                  key={pref.setId}
                  className="eqs-set"
                  style={{ '--set-clr': getSntSetClr(pref.setId) ?? 'var(--amdl-accent)' } as CSSProperties}
                >
                  <button
                    type="button"
                    className="eqs-set__mark"
                    title={name}
                    aria-label={`${name}, ${pref.count} piece. Change piece count`}
                    onClick={() => cycleSet(pref.setId, pref.count)}
                  >
                    <img src={getSntSetIco(pref.setId) ?? '/assets/game/default.webp'} alt="" loading="lazy" onError={withDefIconM} />
                    <i>{pref.count}</i>
                  </button>
                  <button
                    type="button" className="eqs-set__drop"
                    aria-label={`Remove ${name}`}
                    onClick={() => removeSet(pref.setId)}
                  >
                    <X size="0.5rem" strokeWidth={3} />
                  </button>
                </span>
              )
            })}
            {canAddSet && vlblSets.length > 0 ? (
              <LiquidSelect
                value=""
                options={vlblSets}
                placeholder="Add sonata"
                ariaLabel="Add sonata set"
                className="eqs-addset"
                triggerClass="eqs-addset__trigger"
                renderTrigger={() => <Plus size="0.75rem" aria-hidden />}
                onChange={addSet}
              />
            ) : null}
          </span>

          <span className="amdl__fill" />

          <span className="eqs-count">
            <span className="eqs-k">Echoes</span>
            <span className="eqs-ul" role="group" aria-label="Number of echoes">
              {Array.from({ length: QUICK_SLOT_COUNT }, (_, index) => (
                <button
                  key={index}
                  type="button"
                  aria-pressed={config.echoCount === index + 1}
                  onClick={() => setEchoCount(index + 1)}
                >
                  {index + 1}
                </button>
              ))}
            </span>
          </span>

          <span className={`amdl__pill${totalCost > MAX_COST ? ' eqs-pill--over' : totalCost === MAX_COST ? ' is-accent' : ''}`}>
            <span className="amdl__pill-label">Cost</span>
            <span className="amdl__pill-value">{totalCost}/{MAX_COST}</span>
          </span>

          <button type="button" className="amdl__close" aria-label="Close" onClick={onClose}>
            <X size="0.95rem" />
          </button>
        </header>

        <div className="eqs-band" role="group" aria-label="Main stats">
          {config.slots.map((slot, index) => {
            const active = index < config.echoCount
            const keys = quickMainStatKeys(config, index)
            const allowedCosts = quickCostOptions(config, index)
            const mainValue = slot.mainStat ? ECHO_MAIN_STATS[slot.cost]?.[slot.mainStat] : undefined
            return (
              <div key={index} className={`eqs-slot${active ? '' : ' is-off'}`} aria-hidden={!active || undefined}>
                <div className="eqs-slot__top">
                  <span className={`eqs-pos${index === 0 ? ' is-lead' : ''}`}>{index === 0 ? 'Lead' : index + 1}</span>
                  {mainValue != null && slot.mainStat ? (
                    <b className="eqs-slot__val">{fmtEchoStatV(slot.mainStat, mainValue)}</b>
                  ) : null}
                  <span className="eqs-ul eqs-ul--cost" role="group" aria-label={`Echo ${index + 1} cost`}>
                    {QUICK_COSTS.map((cost) => (
                      <button
                        key={cost}
                        type="button"
                        aria-pressed={slot.cost === cost}
                        disabled={!active || !allowedCosts.includes(cost)}
                        onClick={() => setSlotCost(index, cost)}
                      >
                        {cost}
                      </button>
                    ))}
                  </span>
                </div>
                <div className="eqs-slot__main">
                  {slot.mainStat ? <StatGlyph statKey={slot.mainStat} size={0.9} /> : null}
                  {active ? (
                    <StatField
                      statKey={slot.mainStat ?? ''}
                      options={keys}
                      placeholder="Any"
                      ariaLabel={`Echo ${index + 1} main stat`}
                      onPick={(key) => setMainStat(index, key)}
                    />
                  ) : (
                    <span className="eqs-slot__idle">Unused</span>
                  )}
                  {active && slot.mainStat ? (
                    <button
                      type="button" className="eqs-slot__clear"
                      aria-label={`Any main stat for echo ${index + 1}`}
                      onClick={() => setMainStat(index, '')}
                    >
                      <X size="0.62rem" />
                    </button>
                  ) : null}
                </div>
              </div>
            )
          })}
        </div>

        <div className="eqs-tabs">
          <span className="eqs-ul eqs-ul--tabs" role="tablist" aria-label="Substat templates">
            {groups.map((entry, index) => (
              <button
                key={index}
                type="button"
                role="tab"
                aria-selected={index === tplIndex}
                aria-pressed={index === tplIndex}
                onClick={() => setTplPick(index)}
              >
                Template {index + 1}<b>×{entry.count}</b>
              </button>
            ))}
            <button
              type="button"
              disabled={groups.length >= config.echoCount}
              onClick={() => {
                addSubGroup()
                setTplPick(groups.length)
              }}
            >
              + New
            </button>
          </span>
          {group ? (
            <span className="eqs-apply">
              <span className="eqs-k">Applies to</span>
              <span className="eqs-mult">
                <button
                  type="button"
                  aria-label="Fewer echoes"
                  disabled={group.count <= 1}
                  onClick={() => setSubGroupCount(tplIndex, group.count - 1)}
                >
                  <Minus size="0.6rem" strokeWidth={2.6} />
                </button>
                ×{group.count}
                <button
                  type="button"
                  aria-label="More echoes"
                  disabled={group.count >= tplMax}
                  onClick={() => setSubGroupCount(tplIndex, group.count + 1)}
                >
                  <Plus size="0.6rem" strokeWidth={2.6} />
                </button>
              </span>
              <button
                type="button" className="eqs-tpl-drop"
                aria-label={`Remove template ${tplIndex + 1}`}
                onClick={() => removeSubGroup(tplIndex)}
              >
                <X size="0.72rem" />
              </button>
            </span>
          ) : null}
        </div>

        {group ? (
          <div className="eec-bank eqs-bank" role="group" aria-label={`Template ${tplIndex + 1} substats`}>
            {Array.from({ length: MAX_SUBSTATS }, (_, subIndex) => {
              const entry = group.substats[subIndex]

              if (!entry) {
                const isNext = subIndex === group.substats.length
                return (
                  <div key={subIndex} className="eec-col is-open">
                    <span className="eec-col-head"><span>{subIndex + 1}</span></span>
                    <span className="eec-col-ghost" aria-hidden="true" />
                    <div className="eec-col-name">
                      {isNext ? (
                        <StatField
                          statKey=""
                          options={SUBSTAT_KEYS}
                          usedKeys={usedKeys}
                          placeholder="Type a stat"
                          ariaLabel="Add a substat"
                          onPick={(key) => pickSubstat(tplIndex, subIndex, key)}
                        />
                      ) : (
                        <span className="eec-col-idle">Open</span>
                      )}
                    </div>
                  </div>
                )
              }

              const steps = getSbstStepP(entry.key)
              const roll = stepOf(entry.key, entry.value)
              return (
                <div key={subIndex} className="eec-col">
                  <span className="eec-col-head">
                    <span>{subIndex + 1}</span>
                    <span className={`eec-tier${roll === steps.length - 1 ? ' is-top' : ''}`}>
                      {roll + 1}/{steps.length}
                    </span>
                  </span>

                  <button
                    type="button" className="eec-col-drop"
                    aria-label={`Remove substat ${subIndex + 1}`}
                    onClick={() => removeSubstat(tplIndex, subIndex)}
                  >
                    <X size="0.72rem" />
                  </button>

                  <RollReel
                    statKey={entry.key}
                    value={entry.value}
                    onChange={(next) => setSubValue(tplIndex, subIndex, next)}
                  />

                  <div className="eec-col-name">
                    <StatGlyph statKey={entry.key} size={0.95} />
                    <StatField
                      statKey={entry.key}
                      options={SUBSTAT_KEYS}
                      usedKeys={usedKeys}
                      ariaLabel={`Substat ${subIndex + 1}`}
                      onPick={(key) => pickSubstat(tplIndex, subIndex, key)}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="eqs-empty">
            <span>No substat template. Forged echoes keep empty substats.</span>
            <button type="button" className="amdl__act" onClick={addSubGroup} disabled={config.echoCount === 0}>
              <Plus size="0.8rem" aria-hidden />
              Add a template
            </button>
          </div>
        )}

        <footer className="amdl__foot">
          <span className="eec-tally">
            <span><b>{config.echoCount}</b> {config.echoCount === 1 ? 'echo' : 'echoes'}</span>
            <span className={totalCost > MAX_COST ? 'is-over' : undefined}><b>{totalCost}/{MAX_COST}</b> cost</span>
            <span><b>{totalSubPc}/{config.echoCount}</b> with substats</span>
            {group ? <span>CV <b>{critValue.toFixed(1)}</b></span> : null}
          </span>
          <button
            type="button" className="amdl__act"
            onClick={() => setConfig(makeQuickConfig(currentEchoes))}
          >
            <RotateCcw size="0.8rem" aria-hidden="true" />
            Reset
          </button>
          <button
            type="button" className="amdl__act"
            onClick={() => setConfig(makeQuickConfig())}
          >
            Clear all
          </button>
          <button type="button" className="amdl__act is-go" onClick={generate}>
            <Hammer size="0.8rem" aria-hidden="true" />
            Forge build
          </button>
        </footer>
      </div>

      {echoPicker.visible ? (
        <EchoPicker
          visible={echoPicker.visible}
          open={echoPicker.open}
          closing={echoPicker.closing}
          portalTarget={portalTarget}
          echoes={allEchoes}
          selEchoId={config.mainEchoId}
          slotIndex={0}
          onSelect={(echoId) => {
            setMainEcho(echoId)
            echoPicker.hide()
          }}
          onClear={() => setMainEcho(null)}
          onClose={echoPicker.hide}
        />
      ) : null}
    </AppModal>
  )
}
