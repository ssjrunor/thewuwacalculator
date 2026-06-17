import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import type { EchoInstance } from '@/domain/entities/runtime.ts'
import { getEchoById, listEchoes } from '@/domain/services/echoCatalogService.ts'
import { SUBSTAT_KEYS, getSbstStepP, snapToNrstSb } from '@/data/gameData/catalog/echoStats.ts'
import { ECHO_SET_DEFS } from '@/data/gameData/echoSets/effects.ts'
import { getSntSetIco, getSntSetNam } from '@/data/gameData/catalog/sonataSets.ts'
import { fmtEchoStatL, fmtEchoStatV } from '@/modules/calculator/features/echoes/lib/echoPane.ts'
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
} from '@/modules/calculator/features/echoes/lib/quickSetup.ts'
import { EchoPicker } from '@/modules/calculator/features/echoes/Picker.tsx'
import { AppModal } from '@/shared/ui/AppModal.tsx'
import { MdlClsBttn } from '@/shared/ui/ModalCloseButton.tsx'
import { LiquidSelect, type SelectOption } from '@/shared/ui/LiquidSelect.tsx'
import { useAppModal } from '@/shared/ui/useAppModal.ts'
import { withDefEchoMg, withDefIconM } from '@/shared/lib/imageFallback'
import { Dices, Minus, Plus, RotateCcw, TriangleAlert, X } from 'lucide-react'

const MAX_COST = 12

const STAT_ABBR: Record<string, string> = {
  critRate: 'CR',
  critDmg: 'CD',
  atkPercent: 'ATK%',
  atkFlat: 'ATK',
  hpPercent: 'HP%',
  hpFlat: 'HP',
  defPercent: 'DEF%',
  defFlat: 'DEF',
  energyRegen: 'ER',
  resonanceLiberation: 'Res. L.',
  resonanceSkill: 'Res. S.',
  basicAtk: 'Basic',
  heavyAtk: 'Heavy',
}

function abbr(key: string): string {
  return STAT_ABBR[key] ?? fmtEchoStatL(key)
}

function mainStatOptions(keys: string[]): SelectOption[] {
  return [
    { value: '', label: 'Any' },
    ...keys.map((key) => ({ value: key, label: fmtEchoStatL(key) })),
  ]
}

function multiOptions(max: number): SelectOption<number>[] {
  return Array.from({ length: Math.max(0, max) }, (_, index) => {
    const value = index + 1
    return { value, label: `×${value}` }
  })
}

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
  const costPct = Math.min(100, (totalCost / MAX_COST) * 100)
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

  const addSubstat = (groupIndex: number) =>
    setConfig((prev) => {
      const group = prev.substatGroups[groupIndex]
      const used = new Set(group?.substats.map((entry) => entry.key) ?? [])
      const nextKey = SUBSTAT_KEYS.find((key) => !used.has(key))
      if (!group || !nextKey) {
        return prev
      }

      const steps = getSbstStepP(nextKey)
      const substatGroups = prev.substatGroups.map((entry, index) => (
        index === groupIndex
          ? {
              ...entry,
              substats: [...entry.substats, { key: nextKey, value: steps[steps.length - 1] ?? 0 }],
            }
          : entry
      ))
      return fitQuickConfig({ ...prev, substatGroups })
    })

  const cycleSubKey = (groupIndex: number, subIndex: number) =>
    setConfig((prev) => {
      const group = prev.substatGroups[groupIndex]
      if (!group) {
        return prev
      }

      const used = new Set(group.substats.map((entry) => entry.key))
      const current = group.substats[subIndex].key
      const pool = SUBSTAT_KEYS.filter((key) => key === current || !used.has(key))
      const nextKey = pool[(pool.indexOf(current) + 1) % pool.length]
      const steps = getSbstStepP(nextKey)
      const substatGroups = prev.substatGroups.map((entry, index) => {
        if (index !== groupIndex) {
          return entry
        }

        const substats = [...entry.substats]
        substats[subIndex] = { key: nextKey, value: steps[steps.length - 1] ?? 0 }
        return { ...entry, substats }
      })
      return fitQuickConfig({ ...prev, substatGroups })
    })

  const stepSubValue = (groupIndex: number, subIndex: number, dir: 1 | -1) =>
    setConfig((prev) => {
      const entry = prev.substatGroups[groupIndex]?.substats[subIndex]
      if (!entry) {
        return prev
      }

      const steps = getSbstStepP(entry.key)
      if (steps.length === 0) {
        return prev
      }

      let pos = steps.indexOf(snapToNrstSb(entry.key, entry.value))
      if (pos < 0) {
        pos = steps.length - 1
      }

      pos = Math.max(0, Math.min(steps.length - 1, pos + dir))
      const substatGroups = prev.substatGroups.map((group, index) => {
        if (index !== groupIndex) {
          return group
        }

        const substats = [...group.substats]
        substats[subIndex] = { ...entry, value: steps[pos] }
        return { ...group, substats }
      })
      return fitQuickConfig({ ...prev, substatGroups })
    })

  const removeSubstat = (groupIndex: number, subIndex: number) =>
    setConfig((prev) => fitQuickConfig({
      ...prev,
      substatGroups: prev.substatGroups.map((group, index) => (
        index === groupIndex
          ? { ...group, substats: group.substats.filter((_, i) => i !== subIndex) }
          : group
      )),
    }))

  const removeSubGroup = (groupIndex: number) =>
    setConfig((prev) => fitQuickConfig({
      ...prev,
      substatGroups: prev.substatGroups.filter((_, index) => index !== groupIndex),
    }))

  const generate = () => onGenerate(generateQuickBuild(config))

  if (!visible) {
    return null
  }

  return (
    <AppModal
      state={{ visible, open, closing }}
      variant="echo-quick-setup"
      ariaLabel="Quick setup build plan"
      onClose={onClose}
    >
      <div className="eqs bp-modal" style={{ '--bp-echo-count': config.echoCount } as CSSProperties}>
        <header className="bp-header">
          <div className="bp-header__main">
            <span className="bp-eyebrow">
              <span className="bp-eyebrow__dot" aria-hidden="true" />
              Echo Forge
            </span>
            <h2 className="bp-title">Quick Setup</h2>
          </div>

          <div className="bp-meters" aria-label="Build plan summary">
            <div className="bp-meter">
              <span className="bp-meter__value">{config.echoCount}</span>
              <span className="bp-meter__label">Echoes</span>
            </div>
            <div className={`bp-meter${totalCost > MAX_COST ? ' eqs-meter--over' : ''}`}>
              <span className="bp-meter__value">{totalCost}/{MAX_COST}</span>
              <span className="bp-meter__label">Cost</span>
            </div>
            <div className="bp-meter bp-meter--accent">
              <span className="bp-meter__value">{totalSetPc}/5</span>
              <span className="bp-meter__label">Sonata</span>
            </div>
          </div>

          <MdlClsBttn label="Close" onClick={onClose} />
        </header>

        <div className="eqs__body">
          <section className="eqs-card eqs-build">
            <div className="eqs-controls">
              <div className="eqs-ctl eqs-ctl--lead">
                <button
                  type="button"
                  className={`eqs-lead__pick${mainEchoInvalid ? ' is-invalid' : ''}`}
                  onClick={echoPicker.show}
                  aria-label={mainEchoInvalid ? 'Choose lead echo. Current echo cannot fit this Sonata plan.' : 'Choose lead echo'}
                  aria-invalid={mainEchoInvalid || undefined}
                  title={mainEchoInvalid ? 'This echo cannot be generated with the selected Sonata plan.' : undefined}
                >
                  {selMainEcho?.icon ? (
                    <img
                      src={selMainEcho.icon}
                      alt=""
                      className="eqs-lead__img"
                      loading="lazy"
                      onError={withDefEchoMg}
                    />
                  ) : (
                    <span className="eqs-lead__ph" aria-hidden>+</span>
                  )}
                  {mainEchoInvalid ? (
                    <span className="eqs-lead__invalid" aria-hidden>
                      <TriangleAlert size={12} strokeWidth={2.6} />
                    </span>
                  ) : null}
                </button>
                <div className="eqs-lead__body">
                  <span className="eqs-sublabel">Lead echo</span>
                  <span className="eqs-lead__name">{selMainEcho?.name ?? 'Any echo'}</span>
                  <div className="eqs-lead__actions">
                    <button type="button" className="eqs-link" onClick={echoPicker.show}>
                      {selMainEcho ? 'Change' : 'Choose'}
                    </button>
                    {config.mainEchoId ? (
                      <button type="button" className="eqs-link eqs-link--danger" onClick={() => setMainEcho(null)}>
                        Clear
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="eqs-ctl">
                <span className="eqs-sublabel">
                  Echoes
                  <span className="eqs-sublabel__meta">{config.echoCount}/{QUICK_SLOT_COUNT}</span>
                </span>
                <div className="eqs-seg eqs-seg--fill" role="group" aria-label="Number of echoes">
                  {Array.from({ length: QUICK_SLOT_COUNT }, (_, index) => {
                    const count = index + 1
                    return (
                    <button
                      key={count}
                      type="button"
                      className={`eqs-seg__btn${config.echoCount === count ? ' is-active' : ''}`}
                      onClick={() => setEchoCount(count)}
                    >
                      {count}
                    </button>
                    )
                  })}
                </div>
              </div>

              <div className="eqs-ctl eqs-ctl--sonata">
                <span className="eqs-sublabel">
                  Sonata
                  <span className="eqs-sublabel__meta">{totalSetPc}/{config.echoCount}</span>
                </span>
                <div className="eqs-chips">
                  {config.setPreferences.map((pref) => (
                    <div key={pref.setId} className="eqs-set">
                      <img
                        src={getSntSetIco(pref.setId) ?? '/assets/default.webp'}
                        alt=""
                        className="eqs-set__icon"
                        loading="lazy"
                        onError={withDefIconM}
                      />
                      <span className="eqs-set__name">{getSntSetNam(pref.setId)}</span>
                      <div className="eqs-set__counts">
                        {setCountOptions(pref.setId, config.echoCount).map((count) => (
                          <button
                            key={count}
                            type="button"
                            className={`eqs-pc${pref.count === count ? ' is-active' : ''}`}
                            onClick={() => setSetCount(pref.setId, count)}
                          >
                            {count}
                          </button>
                        ))}
                      </div>
                      <button
                        type="button"
                        className="eqs-icon-btn eqs-icon-btn--danger"
                        aria-label={`Remove ${getSntSetNam(pref.setId)}`}
                        onClick={() => removeSet(pref.setId)}
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                  {canAddSet && vlblSets.length > 0 ? (
                    <LiquidSelect
                      value=""
                      options={vlblSets}
                      placeholder="+ Set"
                      ariaLabel="Add sonata set"
                      className="eqs-addset"
                      onChange={addSet}
                    />
                  ) : null}
                  {config.setPreferences.length === 0 && !canAddSet ? (
                    <span className="eqs-bar__hint">Any set</span>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="eqs-slots__head">
              <span className="eqs-sublabel">Main stats</span>
              <span className={`eqs-meter${totalCost > MAX_COST ? ' is-over' : ''}`}>
                <span className="eqs-meter__track" aria-hidden>
                  <span className="eqs-meter__fill" style={{ width: `${costPct}%` }} />
                </span>
                <span className="eqs-meter__read">{totalCost}/{MAX_COST} cost</span>
              </span>
            </div>

            <div className="eqs-slots">
              {activeSlots.map((slot, index) => {
                  const value = slot.mainStat ?? ''
                  const keys = quickMainStatKeys(config, index)
                  const allowedCosts = quickCostOptions(config, index)
                  return (
                    <div key={index} className={`eqs-slot${index === 0 ? ' is-lead' : ''}`}>
                      <div className="eqs-slot__top">
                        <span className="eqs-slot__badge">{index === 0 ? 'Lead' : `Slot ${index + 1}`}</span>
                        <div className="eqs-costseg" role="group" aria-label={`Slot ${index + 1} cost`}>
                          {QUICK_COSTS.map((cost) => (
                            <button
                              key={cost}
                              type="button"
                              className={`eqs-costseg__btn${slot.cost === cost ? ' is-active' : ''}`}
                              disabled={!allowedCosts.includes(cost)}
                              onClick={() => setSlotCost(index, cost)}
                            >
                              {cost}
                            </button>
                          ))}
                        </div>
                      </div>
                      <LiquidSelect
                        value={value}
                        options={mainStatOptions(keys)}
                        ariaLabel={`Slot ${index + 1} main stat`}
                        className="eqs-slot__stat"
                        onChange={(next) => setMainStat(index, String(next))}
                      />
                    </div>
                  )
              })}
            </div>
          </section>

          <section className="eqs-card eqs-subs">
            <div className="eqs-card__head">
              <span className="eqs-card__cap">Substat Templates</span>
              <span className="eqs-card__meta">×{totalSubPc}/{config.echoCount} echoes</span>
            </div>
            <div className="eqs-subgrid">
              {config.substatGroups.map((group, groupIndex) => {
                const maxCount = maxSubCount(config, groupIndex)
                return (
                  <div key={groupIndex} className="eqs-tmpl">
                    <div className="eqs-tmpl__head">
                      <span className="eqs-tmpl__name">Template {groupIndex + 1}</span>
                      <LiquidSelect
                        value={group.count}
                        options={multiOptions(maxCount)}
                        ariaLabel={`Template ${groupIndex + 1} echoes`}
                        className="eqs-tmpl__multi"
                        onChange={(next) => setSubGroupCount(groupIndex, Number(next))}
                      />
                      <button
                        type="button"
                        className="eqs-icon-btn eqs-icon-btn--danger"
                        aria-label="Remove template"
                        onClick={() => removeSubGroup(groupIndex)}
                      >
                        <X size={13} />
                      </button>
                    </div>
                    <div className="eqs-tmpl__body">
                      {group.substats.map((entry, subIndex) => {
                        const steps = getSbstStepP(entry.key)
                        const atMin = entry.value <= (steps[0] ?? entry.value)
                        const atMax = entry.value >= (steps[steps.length - 1] ?? entry.value)
                        return (
                          <div key={`${entry.key}-${subIndex}`} className="eqs-sub">
                            <button
                              type="button"
                              className="eqs-sub__key"
                              onClick={() => cycleSubKey(groupIndex, subIndex)}
                              title="Cycle substat"
                            >
                              {abbr(entry.key)}
                            </button>
                            <div className="eqs-step">
                              <button
                                type="button"
                                className="eqs-step__btn"
                                disabled={atMin}
                                aria-label="Lower value"
                                onClick={() => stepSubValue(groupIndex, subIndex, -1)}
                              >
                                <Minus size={12} />
                              </button>
                              <span className="eqs-step__val">{fmtEchoStatV(entry.key, entry.value)}</span>
                              <button
                                type="button"
                                className="eqs-step__btn"
                                disabled={atMax}
                                aria-label="Higher value"
                                onClick={() => stepSubValue(groupIndex, subIndex, 1)}
                              >
                                <Plus size={12} />
                              </button>
                            </div>
                            <button
                              type="button"
                              className="eqs-icon-btn eqs-icon-btn--danger"
                              aria-label="Remove substat"
                              onClick={() => removeSubstat(groupIndex, subIndex)}
                            >
                              <X size={12} />
                            </button>
                          </div>
                        )
                      })}
                      {group.substats.length < 5 && group.substats.length < SUBSTAT_KEYS.length ? (
                        <button
                          type="button"
                          className="eqs-subadd"
                          onClick={() => addSubstat(groupIndex)}
                        >
                          <Plus size={13} aria-hidden />
                          Substat
                        </button>
                      ) : null}
                    </div>
                  </div>
                )
              })}
              {config.substatGroups.length < config.echoCount ? (
                <button type="button" className="eqs-tmpl eqs-tmpl--add" onClick={addSubGroup}>
                  <Plus size={18} aria-hidden />
                  <span>New template</span>
                </button>
              ) : null}
            </div>
          </section>
        </div>

        <footer className="bp-footer">
          <div className="bp-footer__summary">
            <span className="bp-footer__count">{config.echoCount}</span>
            <div className="bp-footer__copy">
              <strong>{config.echoCount === 1 ? 'echo planned' : 'echoes planned'}</strong>
              <span>{totalCost}/{MAX_COST} cost · ×{totalSubPc} substat rolls</span>
            </div>
          </div>
          <div className="bp-footer__actions">
            <button
              type="button"
              className="bp-btn bp-btn--ghost"
              onClick={() => setConfig(makeQuickConfig(currentEchoes))}
            >
              <RotateCcw size={15} aria-hidden="true" />
              Reset
            </button>
            <button
              type="button"
              className="bp-btn bp-btn--ghost"
              onClick={() => setConfig(makeQuickConfig())}
            >
              <X size={15} aria-hidden="true" />
              Clear All
            </button>
            <button type="button" className="bp-btn bp-btn--primary" onClick={generate}>
              <Dices size={16} aria-hidden="true" />
              Generate Build
            </button>
          </div>
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
