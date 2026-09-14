/*
  Author: Runor Ewhro
  Description: Owns pane behavior and state transitions for the resonator module.
*/

import type {CSSProperties as CssProps} from 'react'
import {useEffect, useMemo, useState} from 'react'
import {Star, UserPlus, Zap} from 'lucide-react'
import type {ResRuntime} from '@/domain/entities/runtime'
import {useAppStore} from '@/domain/state/store'
import {setResLvl, setSkllLvl, tglTrcNd} from '@/modules/simulation/features/resonator/lib/buildEdits'
import {RichDscr} from '@/shared/ui/RichDescription'
import {Tooltip} from '@/shared/ui/Tooltip'
import {LiquidSelect} from '@/shared/ui/LiquidSelect'
import {getResNumMax, normResCntrOpt, normResRtCnt} from '@/domain/gameData/controlOptions'
import {isResRtMaxed, maxResRt, setResRtSequence} from '@/domain/gameData/resonatorMax'
import {
  getResChainControls,
  getResInherentControls,
  getLooseResCtrls,
  getResModeGroups,
  getResOutroControls,
  getResOutroSectionControls,
  getResPanelControls,
  getResStateControls,
  getResStateGroups,
} from '@/domain/gameData/resonatorStateGraph'
import {ResPckr} from '@/modules/simulation/features/resonator/Picker.tsx'
import {IdentTagsTooltip} from '@/modules/simulation/features/resonator/IdentTagsTooltip.tsx'
import {StackGauge} from '@/modules/simulation/features/controls/StackGauge.tsx'
import {
  getResonator,
  getResDtls,
  visibleTabs,
  ATTR_FILTERS,
  WEAPON_FILTERS,
  RES_MENU,
  type ResSldrSkllT,
  type ResonatorStateControl as ResStateControl,
  TRCNODEICONM,
  WPNTYPETOKEY,
} from '@/modules/simulation/features/resonator/lib/resonator.ts'
import {
  fmtSkllKey,
  getCntrPtns,
  getScldVl,
  isCntrVsblAc,
  mrgDscrKywr,
  preloadImage,
  skllLblMap,
  toStrdCntrVl,
} from '@/modules/simulation/features/resonator/lib/panel.ts'
import { ATTR_COLORS, rarityVars } from '@/modules/simulation/model/display.ts'
import {
  ctrlEnabled,
  ctrlVisible,
  resVisible,
} from '@/modules/simulation/features/resonator/lib/ctrlEval.ts'
import {getResCntrDs} from '@/modules/simulation/model/stateDisabledReason'
import {getCntrNctvV} from '@/modules/simulation/features/controls/lib/runtimeStateUtils.ts'
import {useAppModal} from '@/shared/ui/useAppModal.ts'
import { useCtxBuilder } from '@/shared/context-menu/useCtxBuilder.ts'
import {withDefIconM, withDefWpnMg} from '@/shared/lib/imageFallback'
import { ModeGlyph } from '@/modules/simulation/features/controls/ModeGlyph.tsx'
import {glyphVars, resInherentIcon, resNodeIcon, resSeqIcon} from '@/shared/lib/gameAssets'
import {clampNumber} from '@/shared/lib/number'
import {mainPortal} from '@/shared/lib/portalTarget'
import {getWeapon} from '@/modules/simulation/features/weapons/lib/weapon.ts'
import {FaBookBookmark} from "react-icons/fa6";

// surfaces the resonator selector and slider controls that drive the runtime.
interface ResPanePrps {
  runtime: ResRuntime
  actResId: string | null
  onRtPdt: (updater: (runtime: ResRuntime) => ResRuntime) => void
  isDarkMode: boolean
}

function NumberInput({
  value,
  onChange,
  min,
  max,
  step,
  disabled,
}: {
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number
  disabled?: boolean
}) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      onChange={(event) => onChange(Number(event.target.value) || 0)}
    />
  )
}

function CardBadge({icon, label}: {icon: string | null; label: string}) {
  if (!icon) {
    return <span className="sequence-card-badge">{label}</span>
  }

  return (
    <span className="sequence-card-glyph"
      style={glyphVars(icon)}
      role="img"
      aria-label={label}
      title={label}
    />
  )
}

export function Resonator({
  runtime,
  actResId: actResId,
  onRtPdt: onRtPdt,
  isDarkMode,
}: ResPanePrps) {
  const swtcToRes = useAppStore((s) => s.swRes)
  const openLeftView = useAppStore((s) => s.openLeftView)
  const [menuPrld, setMenuPrld] = useState(false)
  const menuModal = useAppModal()
  const ctxMenu = useCtxBuilder()

  const resonator = getResonator(runtime.id)
  const details = getResDtls(runtime.id)
  const sldrSkllTabs = visibleTabs(details)
  const displayName = resonator?.name ?? runtime.id
  const menu = resonator ? { displayName: resonator.name, profile: resonator.profile, rarity: resonator.rarity, attribute: resonator.attribute, weaponType: resonator.weaponType } : null
  const curWpnType = resonator?.weaponType ?? 4
  const curWpnKey = WPNTYPETOKEY[curWpnType as keyof typeof WPNTYPETOKEY] ?? 'gauntlets'
  const curTtrb = resonator?.attribute ?? 'physical'
  const curSldrClr = ATTR_COLORS[curTtrb] ?? '#888'
  const activeSprite = resonator?.sprite ?? '/assets/game/default.webp'
  const resTags = resonator?.tags ?? []
  const vlblCntr = details ? getResStateControls(details) : []
  const viewRuntime = useMemo(() => ({
    ...runtime,
    state: {
      ...runtime.state,
      controls: normResRtCnt(runtime),
    },
  }), [runtime])
  const exclusiveCntrKeys = new Set(details ? getResStateGroups(details).flatMap((group) => group.members ?? []) : [])

  const cntrByKey = Object.fromEntries(vlblCntr.map((control) => [control.key, control]))

  useEffect(() => {
    if (!menuModal.visible) return
    let cancelled = false

    async function prldMenuMgs() {

      const sources: string[] = []

      for (const entry of RES_MENU) {
        const weaponKey = WPNTYPETOKEY[entry.weaponType]
        sources.push(entry.profile)
        sources.push(`/assets/game/weapons/types/${weaponKey}.webp`)
        sources.push(`/assets/game/attributes/icons/${entry.attribute}.webp`)
        for (const tag of entry.tags ?? []) {
          sources.push(`/assets/game/resonators/tags/${tag.id}.webp`)
        }
      }

      for (const weapon of WEAPON_FILTERS) {
        sources.push(`/assets/game/weapons/types/${weapon.key}.webp`)
      }

      for (const attribute of ATTR_FILTERS) {
        sources.push(`/assets/game/attributes/icons/${attribute}.webp`)
      }

      await Promise.all(sources.map((source) => preloadImage(source)))

      if (!cancelled) {
        setMenuPrld(true)
      }
    }

    void prldMenuMgs()

    return () => {
      cancelled = true
    }
  }, [menuModal.visible])

  const openMenu = () => {
    setMenuPrld(false)
    menuModal.show()
  }

  const closeMenu = () => {
    menuModal.hide()
  }

  /* one skill-data modal for the whole simulation: the shared one carries the
     roster switch, so the pane opens that rather than a second copy without it */
  const openSkllMdl = () => {
    ctxMenu.simulation.actions.openSkillData({
      resonatorId: runtime.id,
      tab: (details?.skillTabs ?? [])[0] ?? 'normalAttack',
    })
  }

  const updateLevel = (level: number) => {
    onRtPdt((prev) => setResLvl(prev, level))
  }

  const updSqnc = (sequence: number) => {
    onRtPdt((prev) => setResRtSequence(prev, details, sequence))
  }

  const updSkllLvl = (key: ResSldrSkllT, value: number) => {
    onRtPdt((prev) => setSkllLvl(prev, key, value))
  }

  const updCntrVl = (control: ResStateControl, rawValue: boolean | number | string) => {
    const dynamicMax = control.kind === 'number' ? getResNumMax(runtime, control) : control.max

    onRtPdt((prev) => {
      const nextControls = {
        ...prev.state.controls,
      }

      if (control.kind === 'toggle') {
        nextControls[control.key] = Boolean(rawValue)
      } else if (control.kind === 'select') {
        const option = getCntrPtns(control, {
          ...prev,
          state: {
            ...prev.state,
            controls: nextControls,
          },
        }).find((candidate) => String(normResCntrOpt(candidate).value) === String(rawValue))

        nextControls[control.key] = option ? normResCntrOpt(option).value : rawValue
      } else {
        const numericRaw = typeof rawValue === 'number' ? rawValue : Number(rawValue)
        const min = control.min ?? 0
        const max = dynamicMax ?? 99
        nextControls[control.key] = clampNumber(Math.round(numericRaw), min, max)
      }

      if (control.kind === 'toggle' && Boolean(rawValue) && control.resets?.length) {
        // mutually exclusive toggles reset their sibling controls to each sibling's inactive value instead of a generic
        // false so stacks/selects stay valid.
        for (const key of control.resets) {
          const target = cntrByKey[key]
          nextControls[key] = target?.kind === 'toggle' && exclusiveCntrKeys.has(key) ? false : target ? getCntrNctvV(target, {
            ...prev,
            state: {
              ...prev.state,
              controls: nextControls,
            },
          }) : false
        }
      }

      for (const candidate of vlblCntr) {
        if (!candidate.disabledWhen) {
          continue
        }

        if (nextControls[candidate.disabledWhen.key] === candidate.disabledWhen.equals) {
          nextControls[candidate.key] = getCntrNctvV(candidate, {
            ...prev,
            state: {
              ...prev.state,
              controls: nextControls,
            },
          })
        }
      }

      const nextRuntime = {
        ...prev,
        state: {
          ...prev.state,
          controls: nextControls,
        },
      }

      return {
        ...nextRuntime,
        state: {
          ...nextRuntime.state,
          controls: normResRtCnt(nextRuntime, nextControls),
        },
      }
    })
  }

  const getCntrVl = (control: ResStateControl): boolean | number | string | undefined =>
    viewRuntime.state.controls[control.key]

  const getCntrDsbl = (control: ResStateControl): boolean =>
    Boolean(
      (control.disabledWhen
        ? viewRuntime.state.controls[control.disabledWhen.key] === control.disabledWhen.equals
        : false)
      || !ctrlEnabled(viewRuntime, control),
    )

  const getCntrVsbl = (control: ResStateControl): boolean =>
    ctrlVisible(viewRuntime, control)

  const getSqncCntrS = (control: ResStateControl) => {
    const controlValue = getCntrVl(control)

    if (control.kind === 'toggle') {
      return {
        label: control.label,
        active: Boolean(controlValue),
      }
    }

    if (control.kind === 'select') {
      const option = getCntrPtns(control, viewRuntime)
        .map((entry) => normResCntrOpt(entry))
        .find((entry) => String(entry.value) === String(controlValue))

      return {
        label: `${control.label}: ${option?.label ?? String(controlValue ?? getCntrNctvV(control, viewRuntime))}`,
        active: isCntrVsblAc(control, controlValue),
      }
    }

    const stored = Number(controlValue ?? control.min ?? 0)
    const displayValue = getScldVl(control, stored)

    return {
      label: `${control.label}: ${displayValue}`,
      active: isCntrVsblAc(control, controlValue),
    }
  }

  const viewCntrFld = (
    control: ResStateControl,
    options?: {
      disabled?: boolean
      dsblRsn?: string
      className?: string
    },
  ) => {
    if (!getCntrVsbl(control)) {
      return null
    }

    const controlValue = getCntrVl(control)
    const isDisabled = options?.disabled ?? getCntrDsbl(control)
    const dsblRsn = isDisabled
      ? (options?.dsblRsn ?? getResCntrDs(control, cntrByKey))
      : null

    if (control.kind === 'toggle') {
      const checked = Boolean(controlValue)
      return (
        <div key={control.key} className={['state-control-field', isDisabled ? 'is-disabled' : '', options?.className].filter(Boolean).join(' ')}>
          <label className={['toggle-row', options?.className, checked ? 'is-active' : '', isDisabled ? 'is-disabled' : ''].filter(Boolean).join(' ')}>
            <span>{control.label}</span>
            <input
              type="checkbox"
              checked={checked}
              onChange={(event) => updCntrVl(control, event.target.checked)}
              disabled={isDisabled}
            />
          </label>
          {dsblRsn ? <div className="state-control-reason">{dsblRsn}</div> : null}
        </div>
      )
    }

    if (control.kind === 'select') {
      const optionsList = getCntrPtns(control, viewRuntime).map((option) => normResCntrOpt(option))
      const firstOption = optionsList[0]
      const rawSelectValue = controlValue ?? control.defaultValue ?? control.min ?? firstOption?.value ?? 0
      const selectValue = typeof rawSelectValue === 'boolean' ? String(rawSelectValue) : rawSelectValue
      const isActive = String(selectValue) !== String(control.min ?? 0)
      return (
        <div key={control.key} className={['state-control-field', isDisabled ? 'is-disabled' : ''].filter(Boolean).join(' ')}>
          <label className={['state-control-desc toggle-row', options?.className, isActive ? 'is-active' : '', isDisabled ? 'is-disabled' : ''].filter(Boolean).join(' ')}>
            {control.label}
            <LiquidSelect
              value={selectValue}
              disabled={isDisabled}
              options={optionsList.map((option) => ({
                value: option.value,
                label: option.label,
              }))}
              onChange={(nextValue) => updCntrVl(control, nextValue)}
            />
          </label>
          {dsblRsn ? <div className="state-control-reason">{dsblRsn}</div> : null}
        </div>
      )
    }

    const dynamicMax = getResNumMax(runtime, control)

    const stored = Number(controlValue ?? control.min ?? 0)
    const scaledValue = getScldVl(control, stored)
    const scaledMin = control.min === undefined ? undefined : getScldVl(control, control.min)
    const scaledMax = control.inputMax ?? (dynamicMax === undefined ? undefined : getScldVl(control, dynamicMax))
    const scaledStep = control.step === undefined
      ? control.displayMultiplier ?? 1
      : getScldVl(control, control.step)
    const isActive = stored > (control.min ?? 0)

    return (
      <div key={control.key} className={['state-control-field', isDisabled ? 'is-disabled' : ''].filter(Boolean).join(' ')}>
        <label className={['state-control-desc', options?.className, isActive ? 'is-active' : '', isDisabled ? 'is-disabled' : ''].filter(Boolean).join(' ')}>
          {control.label}
          <NumberInput
            value={scaledValue}
            min={scaledMin}
            max={scaledMax}
            step={scaledStep}
            disabled={isDisabled}
            onChange={(value) => updCntrVl(control, toStrdCntrVl(control, value))}
          />
        </label>
        {dsblRsn ? <div className="state-control-reason">{dsblRsn}</div> : null}
      </div>
    )
  }

  const updModeVl = (controlKey: string, value: string) => {
    onRtPdt((prev) => {
      const nextControls = {
        ...prev.state.controls,
        [controlKey]: value,
      }
      const nextRuntime = {
        ...prev,
        state: {
          ...prev.state,
          controls: nextControls,
        },
      }

      return {
        ...nextRuntime,
        state: {
          ...nextRuntime.state,
          controls: normResRtCnt(nextRuntime, nextControls),
        },
      }
    })
  }

  const tglTrcNode = (nodeId: string) => {
    onRtPdt((prev) => tglTrcNd(prev, nodeId, details))
  }

  const handleMax = () => {
    onRtPdt((prev) => maxResRt(prev, details, { targetSequence: prev.base.sequence }))
  }

  const looseCtrls = details
    ? getLooseResCtrls(details).filter((control) => getCntrVsbl(control))
    : []

  const maxedSkills = isResRtMaxed(runtime, details)

  const mdlPrtlTgt = mainPortal()

  const resMenuPrtl =
    menuModal.visible && menuPrld
      ? (
          <ResPckr
            visible={menuModal.visible}
            open={menuModal.open}
            closing={menuModal.closing}
            portalTarget={mdlPrtlTgt}
            eyebrow="Roster"
            title="Select Resonator"
            resonators={RES_MENU}
            selResId={actResId ?? runtime.id}
            selLbl="Active"
            smmrPrmr={{
              label: 'Current',
              value: menu?.displayName ?? displayName,
            }}
            emptyState={<p>I hope Solon Lee releases the character you're searching for.</p>}
            closeLabel="Close"
            panelWidth="regular"
            onClose={closeMenu}
            onSelect={(resonatorId) => {
              swtcToRes(resonatorId)
              closeMenu()
            }}
          />
        )
      : null

  const weaponDef = getWeapon(runtime.build.weapon.id)
  const weaponIcon = weaponDef?.icon ?? '/assets/game/default.webp'
  const weaponRarity = weaponDef?.rarity ?? 4
  // the two teammate slots (the team's non-active positions) are always
  // rendered; an unfilled slot resolves to null and renders as an empty slot.
  const teamSlots = useMemo(() => {
    const slots = runtime.build.team
      .filter((memberId) => memberId !== runtime.id)
      .slice(0, 2)
      .map((memberId) => {
        if (!memberId) return null
        const member = getResonator(memberId)
        if (!member) return null
        // each teammate carries its own build in teamRuntimes, so pull the
        // equipped weapon so the card can show it instead of repeating element.
        const memberRt = runtime.teamRuntimes.find((entry) => entry?.id === memberId)
        const mateWeapon = memberRt?.build.weapon.id ? getWeapon(memberRt.build.weapon.id) : null
        return {
          id: memberId,
          name: member.name,
          profile: member.profile,
          attribute: member.attribute,
          rarity: member.rarity ?? 5,
          ring: ATTR_COLORS[member.attribute] ?? 'var(--resonator-accent)',
          weaponName: mateWeapon?.name ?? null,
          weaponIcon: mateWeapon?.icon ?? null,
          weaponRank: memberRt?.build.weapon.id ? memberRt.build.weapon.rank : null,
        }
      })
    while (slots.length < 2) slots.push(null)
    return slots
  }, [runtime.build.team, runtime.id, runtime.teamRuntimes])

  return (
    <section className="calc-pane resonator-pane resonator-pane-v2"
      style={{ '--slider-color': curSldrClr } as CssProps}
    >
      <div className="res-card">
        <button
          type="button" className="resonator-avatar-button res-slab__portrait"
          style={{
            ...rarityVars(menu?.rarity ?? 5, false, '--avatar-rarity-color'),
            '--rstars': menu?.rarity ?? 5,
          } as CssProps}
          aria-label="Open resonator selector"
          onClick={() => {
            if (menuModal.open) {
              closeMenu()
              return
            }
            openMenu()
          }}
        >
          <span className="resonator-avatar-button__frame" aria-hidden="true" />
          <span className="resonator-avatar-button__media">
            <img
              src={activeSprite}
              alt={menu?.displayName ?? displayName} className="resonator-avatar resonator-avatar--sprite"
              onError={withDefIconM}
            />
          </span>
          <span className="res-portrait-scrim" aria-hidden="true" />
          <span className="res-portrait-rarity" aria-label={`${menu?.rarity ?? 5} star`}>
            {Array.from({ length: menu?.rarity ?? 5 }).map((_, index) => (
              <Star key={index} size="0.5625rem" strokeWidth={0} className="res-portrait-rstar" aria-hidden="true" />
            ))}
          </span>
        </button>

        <div className="res-card__identity">
          <h3 className="res-card__name">{menu?.displayName ?? displayName}
            <img
              src={`/assets/game/attributes/icons/${curTtrb}.webp`}
              alt="" className="res-card__ident-ico"
              style={curTtrb === 'physical' ? { filter: 'grayscale(1) brightness(0.7)' } : undefined}
              onError={withDefIconM}
            /></h3>
          <div className="res-card__ident">
            <span className="res-card__ident-lv">Lv.{runtime.base.level}</span>
            {resTags.length > 0 ? (
              <IdentTagsTooltip tags={resTags} onIconError={withDefIconM} />
            ) : null}
          </div>
        </div>

        <div className="res-card__loadout">
          <section className="res-load res-load--wpn">
            <span className="res-load__cap">
              <img
                src={`/assets/game/weapons/types/${curWpnKey}.webp`}
                alt="" className="res-load__cap-ico"
                onError={withDefIconM}
              />
              Loadout
            </span>
            <button
              type="button" className="res-load__body res-load__open"
              onClick={() => openLeftView('weapon')}
              aria-label="Open weapon pane"
            >
              <span className="res-wpn-thumb"
                style={rarityVars(weaponRarity, false, '--picker-rarity-color') as CssProps}
              >
                <img src={weaponIcon} alt="" onError={withDefWpnMg} />
              </span>
              <span className="res-wpn-text">
                <span className="res-wpn-name" title={weaponDef?.name ?? 'No Weapon'}>
                  {weaponDef?.name ?? 'No Weapon'}
                </span>
                <span className="res-card__refine">
                  <span className="res-card__stars" aria-label={`${weaponRarity} star`}>
                    {Array.from({ length: weaponRarity }).map((_, index) => (
                      <Star key={index} size="0.5rem" strokeWidth={0} className="res-card__star" />
                    ))}
                  </span>
                  <span className="res-card__rank">R{runtime.build.weapon.rank}</span>
                </span>
              </span>
            </button>
          </section>

          <section className="res-load res-load--squad">
            <span className="res-load__cap">Team</span>
            <button
              type="button" className="res-load__body res-load__open"
              onClick={() => openLeftView('teams')}
              aria-label="Open team pane"
            >
              <span className="res-squad">
                {teamSlots.map((mate, index) => (
                  mate ? (
                    <span
                      key={mate.id} className="res-mate"
                      title={`${mate.name} · ${mate.rarity}★${mate.weaponName ? ` · ${mate.weaponName}${mate.weaponRank ? ` R${mate.weaponRank}` : ''}` : ''}`}
                      style={{
                        ...rarityVars(mate.rarity, false, '--avatar-rarity-color'),
                        '--ring': mate.ring,
                        '--rstars': mate.rarity,
                      } as CssProps}
                    >
                      <span className="res-mate__crown" aria-label={`${mate.rarity} star`}>
                        {Array.from({ length: mate.rarity }).map((_, starIndex) => (
                          <Star key={starIndex} size="1em" strokeWidth={0} className="res-mate__star" aria-hidden="true" />
                        ))}
                      </span>
                      <span className="res-mate__pic">
                        <img className="res-mate__portrait" src={mate.profile} alt="" onError={withDefIconM} />
                        <img className="res-mate__badge"
                          src={`/assets/game/attributes/icons/${mate.attribute}.webp`}
                          alt=""
                          style={mate.attribute === 'physical' ? { filter: 'grayscale(1) brightness(0.7)' } : undefined}
                          onError={withDefIconM}
                        />
                      </span>
                      <span className="res-mate__text">
                        <span className="res-mate__top">
                          <span className="res-mate__name">{mate.name}</span>
                        </span>
                        {mate.weaponName ? (
                          <span className="res-mate__wpn">
                            <img className="res-mate__wpn-ico" src={mate.weaponIcon ?? ''} alt="" onError={withDefWpnMg} />
                            <span className="res-mate__wpn-name">{mate.weaponName}</span>
                            {mate.weaponRank ? <span className="res-mate__wpn-rank">R{mate.weaponRank}</span> : null}
                          </span>
                        ) : (
                          <span className="res-mate__wpn res-mate__wpn--empty">No weapon</span>
                        )}
                      </span>
                    </span>
                  ) : (
                    <span key={`empty-${index}`} className="res-mate res-mate--empty">
                      <span className="res-mate__pic res-mate__pic--empty">
                        <UserPlus size="1em" aria-hidden="true" />
                      </span>
                      <span className="res-mate__text">
                        <span className="res-mate__name res-mate__name--empty">Empty Slot</span>
                        <span className="res-mate__wpn res-mate__wpn--empty">Add teammate</span>
                      </span>
                    </span>
                  )
                ))}
              </span>
            </button>
          </section>
        </div>
      </div>

      {resMenuPrtl}

      <div className="resonator-strip">
        <div className="resonator-strip__head">
          <span className="weapon-effect__sigil" aria-hidden="true" />
          <span className="panel-overline">Progression</span>
        </div>
        <div className="res-progression pane-section">
          <div className="res-level">
            <div className="res-level__head">
              <span className="res-prog-label">Level</span>
              <span className="res-level__value">
                <NumberInput
                  value={runtime.base.level}
                  min={1}
                  max={90}
                  onChange={updateLevel}
                />
                <span className="res-level__cap">/ 90</span>
              </span>
              <button
                type="button"
                className={maxedSkills ? 'res-card__max is-maxed' : 'res-card__max'}
                disabled={maxedSkills}
                onClick={handleMax}
              >
                <Zap size="0.75rem" />
                {maxedSkills ? 'Maxed' : 'Max'}
              </button>
            </div>
            <div className="res-level__slider"
              style={{
                '--slider-fill': `${((runtime.base.level - 1) / 89) * 100}%`,
                '--rl-fill-frac': `${(runtime.base.level - 1) / 89}`,
              } as CssProps}
            >
              <input
                type="range" className="res-level__track"
                min={1}
                max={90}
                value={runtime.base.level}
                onChange={(event) => updateLevel(Number(event.target.value))}
                aria-label="Resonator level"
              />
              <div className="res-level__marks" aria-hidden="true">
                {[20, 40, 50, 60, 70, 80, 90].map((lvl) => {
                  const reached = runtime.base.level >= lvl
                  const isMax = lvl === 90
                  return (
                    <span
                      key={lvl}
                      className={[
                        'res-level__mark',
                        reached ? 'is-reached' : '',
                        runtime.base.level === lvl ? 'is-current' : '',
                        isMax ? 'is-max' : '',
                      ].filter(Boolean).join(' ')}
                      style={{ '--mark-pct': `${((lvl - 1) / 89) * 100}%` } as CssProps}
                    >
                      <span className="res-level__mark-tick" />
                      <button
                        type="button" className="res-level__mark-label"
                        tabIndex={-1}
                        onClick={() => updateLevel(lvl)}
                      >
                        {isMax ? 'MAX' : lvl}
                      </button>
                    </span>
                  )
                })}
              </div>
            </div>
          </div>

          <div className="res-sequence">
            <div className="res-seq-track" role="radiogroup" aria-label="Resonance chain sequence">
              {[1, 2, 3, 4, 5, 6].map((tier) => (
                <button
                  key={tier}
                  type="button"
                  role="radio"
                  aria-checked={runtime.base.sequence === tier}
                  aria-label={`Sequence ${tier}`}
                  className={tier <= runtime.base.sequence ? 'res-seq-node is-filled' : 'res-seq-node'}
                  onClick={() => updSqnc(runtime.base.sequence === tier ? tier - 1 : tier)}
                >
                    <span className="res-seq-node__dot" aria-hidden="true">
                      <span className="res-seq-node__core" />
                    </span>
                  <span className="res-seq-node__label" aria-hidden="true">S{tier}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="resonator-strip">
        <div className="res-skill-list pane-section">
          {sldrSkllTabs.map((key) => {
            const skillLabel = skllLblMap[key] ?? fmtSkllKey(key)
            const skillLevel = runtime.base.skillLevels[key]
            return (
              <StackGauge
                key={key}
                desc={skillLabel}
                value={skillLevel}
                min={1}
                max={10}
                onChange={(value) => updSkllLvl(key, value)}
              />
            )
          })}
          <button
            type="button" className="res-skill-data-bar res-card__max"
            onClick={openSkllMdl}
          >
            <FaBookBookmark size="0.75rem" />
            Info
          </button>
        </div>
      </div>


      <div className="inherent-skills-box">
        {getResModeGroups(details).map((group) => {
          const modeValue = String(viewRuntime.state.controls[group.controlKey] ?? group.defaultValue)
          const hasNone = group.modes.some((mode) => mode.id === 'none')
          const modeItems = group.modes.filter((mode) => mode.id !== 'none')
          const noMode = hasNone && modeValue === 'none'
          return (
            <div key={group.id} className={['pane-section res-mode-panel', noMode ? 'is-empty' : ''].filter(Boolean).join(' ')}>
              <div className="res-mode-top">
                <h4>{group.label}</h4>
                {hasNone ? (
                  <button
                    type="button"
                    className={['res-mode-clear', noMode ? 'is-active' : ''].filter(Boolean).join(' ')}
                    aria-pressed={noMode}
                    onClick={() => updModeVl(group.controlKey, 'none')}
                  >
                    {noMode ? 'No mode' : 'Clear'}
                  </button>
                ) : null}
              </div>
              <div className="res-mode-list" role="radiogroup" aria-label={group.label}>
                {noMode ? <p className="res-mode-empty">No resonance mode selected.</p> : null}
                {modeItems.map((mode) => {
                  const active = mode.id === modeValue

                  return (
                    <div
                      key={`${group.id}-${mode.id}`}
                      className={[
                        'res-mode-entry',
                        mode.icon ? 'has-icon' : 'no-icon',
                        active ? 'is-active' : 'is-compact',
                      ].filter(Boolean).join(' ')}
                      role="radio"
                      aria-checked={active}
                      tabIndex={0}
                      onClick={() => updModeVl(group.controlKey, mode.id)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          updModeVl(group.controlKey, mode.id)
                        }
                      }}
                    >
                      <ModeGlyph icon={mode.icon} label={mode.label} />
                      <div className="res-mode-copy">
                        <div className="res-mode-name">
                          <span>{mode.label}</span>
                          {active ? <span className="res-mode-now">Active</span> : null}
                        </div>
                        {active && mode.body ? (
                          <RichDscr
                            description={mode.body}
                            accentColor={curSldrClr} className="res-mode-body"
                            xtrKywr={mrgDscrKywr(details?.descriptionKeywords, mode.keywords)}
                          />
                        ) : null}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}

        <div className="resonator-strip__head">
          <span className="weapon-effect__sigil" aria-hidden="true" />
          <span className="panel-overline">Inherent Skills</span>
        </div>

        <div className="inherent-skills">
          {details?.inherentSkills.map((inherent, order) => {
            const locked = runtime.base.level < inherent.unlockLevel
            const controls = getResInherentControls(details, inherent)
            const vsblCntr = controls.filter((control) => getCntrVsbl(control))
            const footerCtrls = locked ? controls : vsblCntr
            const statusLabel = locked ? 'Locked' : vsblCntr.length > 0 ? 'Configurable' : 'Passive'

            return (
              <article
                key={inherent.ownerKey ?? `inherent-${inherent.unlockLevel}-${inherent.name}`}
                className={
                  locked
                    ? 'pane-section inherent-skill locked'
                    : 'pane-section inherent-skill'
                }
              >
                <div className="sequence-card-head inherent-skill-head">
                  <div className="sequence-card-title-row">
                    <CardBadge
                      icon={resInherentIcon(runtime.id, order)}
                      label={`Lv ${inherent.unlockLevel}`}
                    />
                    <h4 className="highlight">{inherent.name}</h4>
                  </div>
                  <span className={locked ? 'sequence-card-status' : 'sequence-card-status active'}>{statusLabel}</span>
                </div>

                <div className="sequence-card-body inherent-skill-body">
                  <RichDscr
                    description={inherent.desc}
                    params={inherent.param}
                    accentColor={curSldrClr}
                    xtrKywr={mrgDscrKywr(details?.descriptionKeywords, inherent.keywords)}
                  />
                </div>

                {(footerCtrls.length > 0 || locked) && (
                  <div className="sequence-card-footer inherent-skill-footer">
                    {footerCtrls.map((control) =>
                      viewCntrFld(control, { disabled: locked, className: 'inherent-skill-control' }))}
                    {locked ? <span className="inherent-lock">Unlocks at Lv. {inherent.unlockLevel}</span> : null}
                  </div>
                )}
              </article>
            )
          })}
        </div>

        {!details && <p className="pane-hint">No resonator-specific inherent data yet.</p>}

        {details && (
          <div className="trace-icons">
            {details.traceNodes.map((node) => {
              const iconKey = TRCNODEICONM[node.name]
              const iconPath = iconKey
                ? `/assets/game/skills/icons/${isDarkMode ? 'dark' : 'light'}/${iconKey}.webp`
                : null
              const active = runtime.base.traceNodes.activeNodes[node.id] ?? false
              const value = node.param?.[0]

              return (
                <div key={node.id} className={active ? 'trace-node is-active' : 'trace-node'}>
                  <Tooltip
                    placement="top"
                    content={
                      <div className="trace-node-tooltip">
                        <div className="tooltip-header">
                          <div className="tooltip-title">{node.name}</div>
                        </div>
                        <div className="tooltip-section">
                          <RichDscr
                            description={node.desc}
                            params={node.param}
                            accentColor={curSldrClr}
                          />
                        </div>
                      </div>
                    }
                  >
                    <button
                      type="button"
                      className={active ? 'trace-icon active' : 'trace-icon'}
                      onClick={() => tglTrcNode(node.id)}
                    >
                      {iconPath ? <img src={iconPath} alt={node.name} onError={withDefIconM} /> : <span>{node.name}</span>}
                    </button>
                  </Tooltip>
                  {value ? <span className="trace-node__val">{value}</span> : null}
                </div>
              )
            })}
          </div>
        )}

        {details && details.outroSkills.length > 0 ? (
          <>
            <div className="resonator-strip__head">
              <span className="weapon-effect__sigil" aria-hidden="true" />
              <span className="panel-overline">Outro Skill</span>
            </div>

            <div className="inherent-skills">
              {details.outroSkills.map((outro) => {
                const controls = getResOutroControls(details, outro)
                const vsblCntr = controls.filter((control) => getCntrVsbl(control))
                const sections = (outro.sections ?? [])
                  .map((section) => ({
                    section,
                    controls: getResOutroSectionControls(details, section).filter((control) => getCntrVsbl(control)),
                  }))
                  .filter(({ section, controls: sectionControls }) => sectionControls.length > 0 || !(section.stateKeys?.length))

                if (sections.length > 0) {
                  return sections.map(({ section, controls: sectionControls }) => (
                    <article
                      key={`${outro.ownerKey ?? `outro-${outro.name}`}:${section.id ?? section.title}`} className="pane-section inherent-skill"
                    >
                      <div className="sequence-card-head inherent-skill-head">
                        <div className="sequence-card-title-row">
                          <CardBadge icon={resNodeIcon(runtime.id, 'outroSkill')} label="Outro" />
                          <h4 className="highlight">{section.title}</h4>
                        </div>
                      </div>

                      <div className="sequence-card-body inherent-skill-body">
                        <RichDscr
                          description={section.body}
                          params={section.param}
                          accentColor={curSldrClr}
                          xtrKywr={mrgDscrKywr(details?.descriptionKeywords, section.keywords)}
                        />
                      </div>

                      {sectionControls.length > 0 ? (
                        <div className="sequence-card-footer inherent-skill-footer">
                          {sectionControls.map((control) => viewCntrFld(control, { className: 'inherent-skill-control' }))}
                        </div>
                      ) : null}
                    </article>
                  ))
                }

                return (
                  <article
                    key={outro.ownerKey ?? `outro-${outro.name}`} className="pane-section inherent-skill"
                  >
                    <div className="sequence-card-head inherent-skill-head">
                      <div className="sequence-card-title-row">
                        <CardBadge icon={resNodeIcon(runtime.id, 'outroSkill')} label="Outro" />
                        <h4 className="highlight">{outro.name}</h4>
                      </div>
                    </div>

                    <div className="sequence-card-body inherent-skill-body">
                      <RichDscr
                        description={outro.desc}
                        params={outro.param}
                        accentColor={curSldrClr}
                        xtrKywr={mrgDscrKywr(details?.descriptionKeywords, outro.keywords)}
                      />
                    </div>

                    {vsblCntr.length > 0 ? (
                      <div className="sequence-card-footer inherent-skill-footer">
                        {vsblCntr.map((control) => viewCntrFld(control, { className: 'inherent-skill-control' }))}
                      </div>
                    ) : null}
                  </article>
                )
              })}
            </div>
          </>
        ) : null}

        {details?.statePanels.map((panel) => {
          if (!resVisible(viewRuntime, panel.unlockWhen)) {
            return null
          }

          const vsblCntr = getResPanelControls(details, panel).filter((control) => getCntrVsbl(control))
          if (vsblCntr.length === 0) {
            return null
          }

          return (
            <div key={panel.id ?? `${panel.title}-${panel.stateKeys.join(':')}`} className="pane-section">
              <h4>{panel.title}</h4>
              <RichDscr
                description={panel.body}
                params={panel.param}
                accentColor={curSldrClr}
                xtrKywr={mrgDscrKywr(details?.descriptionKeywords, panel.keywords)}
              />
              <div className="sequence-card-footer inherent-skill-footer">
                <div className="stack">{vsblCntr.map((control) => viewCntrFld(control))}</div>
              </div>
            </div>
          )
        })}

        {looseCtrls.length > 0 ? (
          <div className="pane-section">
            <h4>Additional States</h4>
            <div className="stack">
              {looseCtrls.map((control) => (
                <div key={control.key}>
                  <div className="sequence-card-footer inherent-skill-footer">
                    {viewCntrFld(control)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      {details && runtime.base.sequence > 0 && (
        <div className="inherent-skills-box">
          <div className="resonator-strip__head">
            <span className="weapon-effect__sigil" aria-hidden="true" />
            <span className="panel-overline">Resonance Chain</span>
          </div>

          <div className="sequence-chain-list">
            {details.resonanceChains
              .filter((entry) => entry.index <= runtime.base.sequence)
              .map((entry) => {
                const sqncCntr = getResChainControls(details, entry)
                const vsblSqncCntr = sqncCntr.filter((control) => getCntrVsbl(control))
                const sqncCntrStts = vsblSqncCntr
                  .map((control) => ({
                    control,
                    status: getSqncCntrS(control),
                  }))

                return (
                  <article key={`chain-${entry.index}`} className="pane-section">
                    <div className="sequence-card-head">
                      <div className="sequence-card-title-row">
                        <CardBadge icon={resSeqIcon(runtime.id, entry.index)} label={`S${entry.index}`} />
                        <h4 className="highlight">{entry.name}</h4>
                      </div>
                      {sqncCntrStts.length > 0 ? (
                        <div className="sequence-card-status-list">
                          {sqncCntrStts.map(({ control, status }) => (
                            <span
                              key={control.key}
                              className={status.active ? 'sequence-card-status active' : 'sequence-card-status'}
                            >
                              {status.label}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>

                    <div className="sequence-card-body">
                      <RichDscr
                        description={entry.desc}
                        params={entry.param}
                        accentColor={curSldrClr}
                        xtrKywr={mrgDscrKywr(details?.descriptionKeywords, entry.keywords)}
                      />
                    </div>

                    {vsblSqncCntr.length > 0 && (
                      <div className="sequence-card-footer">
                        {vsblSqncCntr.map((control) => viewCntrFld(control, {
                            disabled: runtime.base.sequence < entry.index,
                            className: 'sequence-toggle-row',
                          }))}
                      </div>
                    )}
                  </article>
                )
              })}
          </div>
        </div>
      )}
    </section>
  )
}
