/*
  Author: Runor Ewhro
  Description: Renders the resonator options panel surface for the calculator optimizer flow.
*/

import { useMemo } from 'react'
import { ChevronDown, Crosshair, Cpu, Image, Info, Lock, Sword, X } from 'lucide-react'
import type { OptSetChoice, OptStatCstr } from '@/domain/entities/optimizer'
import type { ResRuntime } from '@/domain/entities/runtime'
import type { SelectOption, SelectGroup } from '@/shared/ui/LiquidSelect'
import { LiquidSelect } from '@/shared/ui/LiquidSelect'
import {
  type RtUpdHnd,
} from '@/modules/calculator/features/controls/lib/runtimeStateUtils.ts'
import { useAppModal } from '@/shared/ui/useAppModal'
import { mainPortal } from '@/shared/lib/portalTarget'
import { ManualBuffs } from './ManualBuffs.tsx'
import { AllowedSets } from './AllowedSets.tsx'
import { STAT_LIST } from './lib/mockData.ts'
import { SiBattledotnet as SiBttl } from "react-icons/si";
import { withDefEchoMg, withDefResMg } from '@/shared/lib/imageFallback.ts'

const BNSSHRTLBLS: Record<string, string> = {
  glacio: 'Glacio',
  fusion: 'Fusion',
  electro: 'Electro',
  aero: 'Aero',
  spectro: 'Spectro',
  havoc: 'Havoc',
}

// surfaces the optimizer resonator options panel, mirroring the live control inputs.
interface ResPtnsPnl {
  displayName: string
  level: number
  sequence: number
  rarity: number
  imageSrc: string
  targetMode: 'skill' | 'combo'
  tgtSkllId: string | null
  tgtCmbId: string | null
  skillOptions: SelectOption[]
  skillGroups?: SelectGroup[]
  comboOptions: SelectOption[]
  enableGpu: boolean
  // combo (rotation) target mode requires a rotation with feature nodes; when
  // unavailable the skill/combo switch is hidden and only skill mode applies.
  comboAvailable: boolean
  useSplash: boolean
  mainEcho: { id: string; name: string; icon: string } | null
  allowedSets: OptSetChoice
  mainStatFilter: string[]
  mainStatRdly: boolean
  // theory mode: main-stat filters do not apply, so that slot becomes the
  // weapon-search toggle instead.
  isTheory: boolean
  excludeEquipped: boolean
  includeWeapons: boolean
  selBonus: string | null
  statCstrs: Record<string, OptStatCstr>
  optRt: ResRuntime | null
  onTgtModeClw: (value: 'skill' | 'combo') => void
  onTgtSkllCdf: (value: string) => void
  onTgtCmbChng: (value: string) => void
  onNblGpuChng: (enabled: boolean) => void
  onOptRtPdt: RtUpdHnd
  onOpenResPick: () => void
  onSyncLive: () => void
  onOpenMainEcho: () => void
  onOpenSetCond: () => void
  onOpenWpnCond: () => void
  onClrMainEyq: () => void
  onLlwdSetsxi: (value: OptSetChoice) => void
  onToggleMain: (value: string) => void
  onToggleExcludeEquipped: (value: boolean) => void
  onToggleWeapons: (value: boolean) => void
  onPickBonus: (value: string) => void
  onClrAllFltr: () => void
  onStatLmtCdd: (statKey: string, field: 'minTotal' | 'maxTotal', value: string) => void
  setIsSprite?: (value: boolean) => void
}

export function CharPtnsPnl({
  displayName,
  level,
  sequence,
  rarity,
  imageSrc,
  targetMode,
  tgtSkllId: trgtSkllId,
  tgtCmbId: trgtCmbId,
  skillOptions,
  skillGroups,
  comboOptions,
  enableGpu,
  comboAvailable,
  useSplash,
  mainEcho,
  allowedSets,
  mainStatFilter: mainStatFilter,
  mainStatRdly,
  isTheory,
  excludeEquipped,
  includeWeapons,
  selBonus: selectedBonus,
  statCstrs: statCnst,
  optRt: optRuntime,
  onTgtModeClw: onTrgtModeCh,
  onTgtSkllCdf: onTrgtSkllCh,
  onTgtCmbChng: onTrgtCmbChn,
  onNblGpuChng: onNblGpuChng,
  onOptRtPdt: onPtmzRtPdt,
  onOpenResPick: onOpenResPck,
  onSyncLive,
  onOpenMainEcho: onOpenMainEcho,
  onOpenSetCond: onOpenSetCon,
  onOpenWpnCond,
  onClrMainEyq: onClrMainEch,
  onLlwdSetsxi: onLlwdSetsCh,
  onToggleMain: onTgglMainSt,
  onToggleExcludeEquipped,
  onToggleWeapons,
  onPickBonus,
  onClrAllFltr: onClrAllFltr,
  onStatLmtCdd: onStatLmtChn,
  setIsSprite,
}: ResPtnsPnl) {
  const bonusOptions = [
    { value: 'glacio', label: 'Glacio DMG' },
    { value: 'fusion', label: 'Fusion DMG' },
    { value: 'electro', label: 'Electro DMG' },
    { value: 'aero', label: 'Aero DMG' },
    { value: 'spectro', label: 'Spectro DMG' },
    { value: 'havoc', label: 'Havoc DMG' },
  ] satisfies SelectOption[]

  const mainStatPtns = useMemo(
    () => [
      { value: 'atk%', label: 'ATK%', short: 'ATK%' },
      { value: 'hp%', label: 'HP%', short: 'HP%' },
      { value: 'def%', label: 'DEF%', short: 'DEF%' },
      { value: 'er', label: 'Energy Regen', short: 'ER' },
      { value: 'cr', label: 'Crit. Rate', short: 'CR' },
      { value: 'cd', label: 'Crit. DMG', short: 'CD' },
      {
        value: 'bonus',
        label: 'Ele. DMG Bonus',
        short: selectedBonus ? BNSSHRTLBLS[selectedBonus] : 'DMG%',
      },
      { value: 'healing', label: 'Healing Bonus', short: 'Heal' },
    ],
    [selectedBonus],
  )

  const targetOptions = targetMode === 'combo' ? comboOptions : skillOptions
  const targetGroups = targetMode === 'combo' ? undefined : skillGroups
  const targetValue = targetMode === 'combo' ? (trgtCmbId ?? '') : (trgtSkllId ?? '')
  const targetLabel = targetMode === 'combo' ? 'Target Combo' : 'Target Skill'
  const tgtPlch = targetMode === 'combo' ? 'Select combo' : 'Select skill'

  const advBffsMdl = useAppModal()
  const portalTarget = mainPortal()

  const updQckBaseSt = (stat: 'atk' | 'hp' | 'def', field: 'flat' | 'percent', raw: number) => {
    const max = field === 'flat' ? 9999 : 999
    const val = Math.max(0, Math.min(max, raw))
    onPtmzRtPdt((prev) => ({
      ...prev,
      state: {
        ...prev.state,
        manualBuffs: {
          ...prev.state.manualBuffs,
          quick: {
            ...prev.state.manualBuffs.quick,
            [stat]: { ...prev.state.manualBuffs.quick[stat], [field]: val },
          },
        },
      },
    }))
  }

  const updQckSclr = (key: 'critRate' | 'critDmg' | 'energyRegen' | 'healingBonus', raw: number) => {
    const val = Math.max(0, Math.min(999, raw))
    onPtmzRtPdt((prev) => ({
      ...prev,
      state: {
        ...prev.state,
        manualBuffs: {
          ...prev.state.manualBuffs,
          quick: { ...prev.state.manualBuffs.quick, [key]: val },
        },
      },
    }))
  }

  return (
    <div className="co">
      <div className="co-split">
        <div className="co-portrait">
          <button
            type="button"
            className={`co-portrait__ring co-portrait__ring-button rarity-${rarity}`}
            onClick={onOpenResPck}
            aria-label="Open resonator picker"
          >
            <img
              src={imageSrc}
              alt={displayName}
              className="co-portrait__img"
              loading="eager"
              onError={withDefResMg}
            />
          </button>
          <div className="co-portrait__caption">
            <h2 className="co-portrait__name">{displayName}</h2>
            <div className="co-portrait__meta">
              <span className="co-badge">Lvl {level}</span>
              <span className="co-badge co-badge--lit">S{sequence}</span>
            </div>
            <button type="button" className="co-portrait__sync" onClick={onSyncLive}>
              Sync Live
            </button>
          </div>
        </div>

        <div className="co-config">
          <div className="co-skill-bar">
            <LiquidSelect
              value={targetValue}
              options={targetOptions}
              groups={targetGroups}
              onChange={targetMode === 'combo' ? onTrgtCmbChn : onTrgtSkllCh}
              placeholder={tgtPlch}
              baseClass="co-skill-select"
              ariaLabel={targetLabel}
              disabled={targetOptions.length === 0}
              prfrPlcm="down"
              triggerClass="co-skill-bar__main"
              viewTrggCntn={(selPtn, placeholder) => (
                <>
                  <Crosshair size={15} className="co-skill-bar__icon" />
                  <div className="co-skill-bar__text">
                    <span className="co-skill-bar__label">{targetLabel}</span>
                    <span
                      className={
                        selPtn
                          ? 'co-skill-bar__value'
                          : 'co-skill-bar__value co-skill-bar__value--placeholder'
                      }
                    >
                      {selPtn?.label ?? placeholder}
                    </span>
                  </div>
                  <ChevronDown size={16} className="co-skill-bar__chevron" />
                </>
              )}
            />
            <span className="co-bar__sep" />
            <div className="co-switches">
              {comboAvailable ? (
                <div className="co-switch">
                  <button
                      type="button"
                      className={`co-switch__opt${targetMode === 'skill' ? ' on' : ''}`}
                      onClick={() => onTrgtModeCh('skill')}
                  >
                    <SiBttl size={13}/>
                    Skill
                  </button>
                  <button
                      type="button"
                      className={`co-switch__opt${targetMode === 'combo' ? ' on' : ''}`}
                      onClick={() => onTrgtModeCh('combo')}
                  >
                    <SiBttl size={13}/>
                    Combo
                  </button>
                </div>
              ) : null}
              <div className="co-switch">
                <button
                  type="button"
                  className={`co-switch__opt${enableGpu ? ' on' : ''}`}
                  onClick={() => onNblGpuChng(true)}
                >
                  <Cpu size={13} />
                  GPU
                </button>
                <button
                  type="button"
                  className={`co-switch__opt${!enableGpu ? ' on' : ''}`}
                  onClick={() => onNblGpuChng(false)}
                >
                  <Cpu size={13} />
                  CPU
                </button>
              </div>
              <div className="co-switch">
                <button
                  type="button"
                  className={`co-switch__opt${useSplash ? ' on' : ''}`}
                  onClick={() => setIsSprite?.(true)}
                >
                  <Image size={13} />
                  Sprite
                </button>
                <button
                  type="button"
                  className={`co-switch__opt${!useSplash ? ' on' : ''}`}
                  onClick={() => setIsSprite?.(false)}
                >
                  <Image size={13} />
                  Profile
                </button>
              </div>
            </div>
          </div>

          <div className="co-mosaic">
            <section className="co-tile co-tile--filters">
              <div className="co-tile__head">
                <h3 className="co-tile__title">Filters</h3>
                <Info size={13} className="co-tile__info" />
              </div>

              <div className="co-field">
                <span className="co-field__label">
                  Main Echo
                  {mainEcho ? (
                    <span className="co-field__lock-pill" aria-label="locked">
                      <Lock size={9} strokeWidth={3} />
                      Locked
                    </span>
                  ) : null}
                </span>
                <button
                  type="button"
                  className={`co-chip${mainEcho ? ' co-chip--locked' : ''}`}
                  // wrap so the React click event isn't forwarded as the
                  // OpEchoTarget arg to openMainEcho; that was making
                  // mainEchoPckr.value the synthetic event, defeating the
                  // 'filter' default and routing the picker into the
                  // teammate-plan branch instead of setting the lock.
                  onClick={() => onOpenMainEcho()}
                  aria-pressed={Boolean(mainEcho)}
                  title={mainEcho ? `Optimizer is locked to ${mainEcho.name} as the main echo. Click to change.` : 'Lock the optimizer to a specific main echo'}
                >
                  {mainEcho ? (
                    <>
                      <Lock size={10} strokeWidth={3} className="co-chip__lock-glyph" aria-hidden="true" />
                      <img src={mainEcho.icon} alt="" className="co-trigger__ico" loading="lazy" onError={withDefEchoMg} />
                      <span className="co-chip__label">{mainEcho.name}</span>
                      <span
                        className="co-trigger__x"
                        role="button"
                        tabIndex={0}
                        title="Clear main-echo lock"
                        aria-label="Clear main-echo lock"
                        onClick={(event) => {
                          event.stopPropagation()
                          onClrMainEch()
                        }}
                      >
                        <X size={11} strokeWidth={3} />
                      </span>
                    </>
                  ) : (
                    <>Select echo</>
                  )}
                </button>
              </div>

              <div className="co-field">
                {!isTheory ? (
                    <>
                      <span className="co-field__label">Sonata Sets</span>
                      <div className="co-conds-split">
                        <div className="co-conds-half">
                          <AllowedSets
                            selIdsByPc={allowedSets}
                            onChange={onLlwdSetsCh}
                          />
                        </div>
                        <div className="co-conds-half">
                          <button type="button" className="co-chip" onClick={onOpenSetCon}>
                            Conditionals
                            <ChevronDown size={12} />
                          </button>
                        </div>
                      </div>
                    </>
                ) : (
                  <>
                    <span className="co-field__label">Allowed Sets</span>
                    <AllowedSets
                      selIdsByPc={allowedSets}
                      onChange={onLlwdSetsCh}
                    />
                  </>
                )}
              </div>

              {isTheory && includeWeapons && (
                <div className="co-field">
                  <span className="co-field__label">Conditionals</span>
                  <div className="co-conds-split">
                    <div className="co-conds-half">
                      <button type="button" className="co-chip" onClick={onOpenSetCon}>
                        Sonata Sets
                        <ChevronDown size={12} />
                      </button>
                    </div>
                    <div className="co-conds-half">
                      <button type="button" className="co-chip" onClick={onOpenWpnCond}>
                        Weapons
                        <ChevronDown size={12} />
                      </button>
                    </div>
                  </div>
                </div>
              )}

              <div className={`co-field${mainStatRdly ? ' is-disabled' : ''}`}>
                <div className="co-tile__head">
                  <span className="co-field__label">Main Stat Filters</span>
                  {mainStatFilter.length > 0 && !mainStatRdly ? (
                    <button className="co-clear" onClick={onClrAllFltr} disabled={mainStatRdly}>
                      Clear
                    </button>
                  ) : null}
                </div>
                <div className="co-tags">
                  {mainStatPtns.map((option) => {
                    if (option.value === 'bonus') {
                      const isActive = mainStatFilter.includes('bonus')
                      return (
                        <LiquidSelect
                          key={option.value}
                          value={selectedBonus ?? ''}
                          options={bonusOptions}
                          onChange={onPickBonus}
                          placeholder={option.short}
                          baseClass="co-tag-select"
                          className={isActive ? 'on' : ''}
                          disabled={mainStatRdly}
                          prfrPlcm="down"
                        />
                      )
                    }

                    return (
                      <button
                        key={option.value}
                        type="button"
                        className={`co-tag${mainStatFilter.includes(option.value) ? ' on' : ''}`}
                        disabled={mainStatRdly}
                        onClick={() => onTgglMainSt(option.value)}
                        title={option.label}
                      >
                        {option.short}
                      </button>
                    )
                  })}
                </div>
              </div>

              {isTheory ? (
                <div className="co-field co-field--weapon">
                  <span className="co-field__label">Weapon Search</span>
                  <button
                    type="button"
                    className={`co-wpn-toggle${includeWeapons ? ' is-on' : ''}`}
                    role="switch"
                    aria-checked={includeWeapons}
                    onClick={() => onToggleWeapons(!includeWeapons)}
                  >
                    <span className="co-wpn-toggle__body">
                      <Sword size={14} className="co-wpn-toggle__glyph" />
                      <span className="co-wpn-toggle__text">
                        <span className="co-wpn-toggle__title">Include weapons</span>
                        <span className="co-wpn-toggle__hint">
                          {includeWeapons ? 'Finding the best weapon per build' : 'Uses the equipped weapon'}
                        </span>
                      </span>
                    </span>
                    <span className="co-wpn-toggle__track" aria-hidden="true">
                      <span className="co-wpn-toggle__thumb" />
                    </span>
                  </button>
                </div>
              ) : (
                <>
                  <div className="co-field co-field--weapon">
                    <span className="co-field__label">Inventory Search</span>
                    <button
                      type="button"
                      className={`co-wpn-toggle${excludeEquipped ? ' is-on' : ''}`}
                      role="switch"
                      aria-checked={excludeEquipped}
                      onClick={() => onToggleExcludeEquipped(!excludeEquipped)}
                    >
                      <span className="co-wpn-toggle__body">
                        <Lock size={14} className="co-wpn-toggle__glyph" />
                        <span className="co-wpn-toggle__text">
                          <span className="co-wpn-toggle__title">Exclude equipped</span>
                          <span className="co-wpn-toggle__hint">
                            {excludeEquipped ? 'Skips echoes used by other resonators' : 'Uses every inventory echo'}
                          </span>
                        </span>
                      </span>
                      <span className="co-wpn-toggle__track" aria-hidden="true">
                        <span className="co-wpn-toggle__thumb" />
                      </span>
                    </button>
                  </div>
                </>
              )}
            </section>

            <section className="co-tile co-tile--stats">
              <div className="co-tile__head">
                <h3 className="co-tile__title">Range Limits</h3>
              </div>

              <div className="co-limits">
                {STAT_LIST.map(({ key: statKey, label }) => {
                  const current = statCnst[statKey] ?? {}
                  return (
                    <div className="co-limit" key={statKey}>
                      <span className="co-limit__name">{label}</span>
                      <div className="co-limit__range">
                        <input
                          className="co-limit__in"
                          placeholder="min"
                          type="number"
                          value={current.minTotal ?? ''}
                          onChange={(event) => onStatLmtChn(statKey, 'minTotal', event.target.value)}
                        />
                        <span className="co-limit__dash" />
                        <input
                          className="co-limit__in"
                          placeholder="max"
                          type="number"
                          value={current.maxTotal ?? ''}
                          onChange={(event) => onStatLmtChn(statKey, 'maxTotal', event.target.value)}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>
            <section className="co-tile co-tile--resonator">
              <div className="co-tile__head">
                <h3 className="co-tile__title">Manual Buffs</h3>
              </div>

              {optRuntime ? (
                <div className="co-qbuff">
                  <div className="co-qbuff-duals">
                    {(
                      [
                        { label: 'ATK', stat: 'atk' as const },
                        { label: 'HP',  stat: 'hp'  as const },
                        { label: 'DEF', stat: 'def' as const },
                      ]
                    ).map(({ label, stat }) => (
                      <div key={stat} className="co-qbuff-row">
                        <span className="co-qbuff-label">{label}</span>
                        <div className="co-qbuff-inputs">
                          <input
                            type="number"
                            className="co-qbuff-in"
                            min={0}
                            max={9999}
                            value={optRuntime.state.manualBuffs.quick[stat].flat}
                            onChange={(e) => updQckBaseSt(stat, 'flat', Number(e.target.value) || 0)}
                          />
                          <div className="co-qbuff-in-pct">
                            <input
                              type="number"
                              className="co-qbuff-in"
                              min={0}
                              max={999}
                              value={optRuntime.state.manualBuffs.quick[stat].percent}
                              onChange={(e) => updQckBaseSt(stat, 'percent', Number(e.target.value) || 0)}
                            />
                            <span className="co-qbuff-suffix">%</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="co-qbuff-scalars">
                    {(
                      [
                        { label: 'CR%',  key: 'critRate'     as const },
                        { label: 'CD%',  key: 'critDmg'      as const },
                        { label: 'ER%',  key: 'energyRegen'  as const },
                        { label: 'HB%',  key: 'healingBonus' as const },
                      ]
                    ).map(({ label, key }) => (
                      <div key={key} className="co-qbuff-scalar">
                        <span className="co-qbuff-label co-qbuff-label--sm">{label}</span>
                        <div className="co-qbuff-in-pct">
                          <input
                            type="number"
                            className="co-qbuff-in"
                            min={0}
                            max={999}
                            value={optRuntime.state.manualBuffs.quick[key]}
                            onChange={(e) => updQckSclr(key, Number(e.target.value) || 0)}
                          />
                          <span className="co-qbuff-suffix">%</span>
                        </div>
                      </div>
                    ))}
                  </div>

                  <button
                    type="button"
                    className="co-qbuff-adv-btn"
                    onClick={advBffsMdl.show}
                  >
                    <span className="co-qbuff-adv-label">Advanced Modifiers</span>
                    {optRuntime.state.manualBuffs.modifiers.length > 0 && (
                      <span className="co-qbuff-adv-count">
                        {optRuntime.state.manualBuffs.modifiers.length}
                      </span>
                    )}
                  </button>
                </div>
              ) : null}
            </section>
          </div>
        </div>
      </div>

      {optRuntime && advBffsMdl.visible && (
        <ManualBuffs
          visible={advBffsMdl.visible}
          open={advBffsMdl.open}
          closing={advBffsMdl.closing}
          portalTarget={portalTarget}
          onClose={advBffsMdl.hide}
          runtime={optRuntime}
          onRtPdt={onPtmzRtPdt}
        />
      )}
    </div>
  )
}
