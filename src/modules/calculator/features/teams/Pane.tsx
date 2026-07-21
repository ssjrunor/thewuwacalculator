/*
  Author: Runor Ewhro
  Description: Manages active team slots, compact teammate runtimes, local
               weapon edits, state controls, and teammate config entry points.
*/

import { Fragment, type CSSProperties as CssProps, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Plus, RefreshCw, Wrench, X } from 'lucide-react'
import { isNoWeaponId, type ResRuntime } from '@/domain/entities/runtime.ts'
import { getResSeedBy } from '@/domain/services/resonatorSeedService.ts'
import { listStatesFor } from '@/domain/services/gameDataService.ts'
import { makeSourceCat } from '@/domain/services/runtimeSourceService.ts'
import { makeTeamMember, maxRtInit } from '@/domain/state/defaults.ts'
import { initWpnStts } from '@/domain/state/sourceStateInit.ts'
import { matTeamMemFr } from '@/domain/state/runtimeMaterialization.ts'
import { findCombatPart, makeCombatGraph } from '@/domain/state/combatGraph.ts'
import { selActTgtSlc, selEnemyProf } from '@/domain/state/selectors.ts'
import { useAppStore } from '@/domain/state/store.ts'
import { makeCombatEnv } from '@/engine/pipeline/buildCombatContext.ts'
import { ResPckr } from '@/modules/calculator/features/resonator/Picker.tsx'
import { IdentTagsTooltip } from '@/modules/calculator/features/resonator/IdentTagsTooltip.tsx'
import { WeaponPicker } from '@/modules/calculator/features/weapons/Picker.tsx'
import { listWpnsByTy } from '@/domain/services/weaponCatalogService.ts'
import { SourceStateCtrl } from '@/modules/calculator/features/controls/SourceStateControl.tsx'
import { ConfigModal, type ChannelId } from '@/modules/calculator/features/teams/ConfigModal.tsx'
import {
  fltrSrcSttsW,
  getStateTeamTag,
  getTeamTgtPt,
  isSourceVisible,
  isSrcSttOn,
  setSourceState,
  setRtPath,
  sttHasTeamFc,
  withDefResMg,
} from '@/modules/calculator/features/controls/lib/runtimeStateUtils.ts'
import type { RtUpdHnd } from '@/modules/calculator/features/controls/lib/runtimeStateUtils.ts'
import { readRtPath } from '@/domain/gameData/runtimePath.ts'
import { getStateText } from '@/modules/calculator/model/sourceStateDisplay.ts'
import { srcSttOpts } from '@/modules/calculator/model/sourceEval.ts'
import { getSrcSttDsb } from '@/modules/calculator/model/stateDisabledReason.ts'
import { getSrcSttNct } from '@/domain/gameData/controlOptions.ts'
import { srcSttNumMax } from '@/domain/state/sourceStateInit.ts'
import { NumberInput } from '@/modules/calculator/features/controls/NumberInput.tsx'
import { RichDscr } from '@/shared/ui/RichDescription.tsx'
import { makeStatsView } from '@/modules/calculator/model/statsView.ts'
import { RES_MENU, WPNTYPETOKEY, getResonator } from '@/modules/calculator/features/resonator/lib/resonator.ts'
import { ATTR_COLORS, getWpnTypeLb, rarityVars } from '@/modules/calculator/model/display.ts'
import { getAttributeIconSrc } from '@/domain/gameData/attributeDisplay.ts'
import { mkSelTrgtByR } from '@/modules/calculator/model/teamTargets.ts'
import {
  getWeapon,
  resPssvPrms,
  weaponStatsAt,
  fmtWpnStatDs,
  WPNSTATLBLS,
  WPN_STAT_CNS,
  withDefWpnMg,
} from '@/modules/calculator/features/weapons/lib/weapon.ts'
import { getMainEchoS } from '@/domain/services/runtimeSourceService.ts'
import { getEchoById } from '@/domain/services/echoCatalogService.ts'
import { buildSonataPlan } from '@/modules/calculator/features/benchmark/ui.tsx'
import { isMaxSetPlan } from '@/domain/gameData/sonataPlan.ts'
import { getSntSetNam } from '@/data/gameData/catalog/sonataSets.ts'
import { getEchoSetDe } from '@/data/gameData/echoSets/effects.ts'
import { useAppModal } from '@/shared/ui/useAppModal.ts'
import { mainPortal } from '@/shared/lib/portalTarget.ts'
import { Expandable } from '@/shared/ui/Expandable.tsx'
import { LiquidSelect } from '@/shared/ui/LiquidSelect.tsx'
import { teamRuntime, mkMateCntr } from '@/domain/state/teamRuntime.ts'
import { withDefIconM } from '@/shared/lib/imageFallback.ts'

function stToBool(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') return value === 'true'
  if (typeof value === 'number') return value > 0
  return false
}

function stToNum(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

interface CalcTmsPaneP {
  runtime: ResRuntime
  prtcRntmById: Record<string, ResRuntime>
  onRtPdt: RtUpdHnd
}

export function Teams({
  runtime,
  prtcRntmById: partRntmById,
  onRtPdt: onRtPdt,
}: CalcTmsPaneP) {
  const enemyProfile = useAppStore(selEnemyProf)
  const maxResOnInit = useAppStore((state) => state.ui.preferences.maxResOnInit)
  const selTrgtByOwn = useAppStore(selActTgtSlc)
  const invBlds = useAppStore((state) => state.calculator.inventoryBuilds)
  const ensTeamMemRt = useAppStore((state) => state.ensTeamRt)
  const updResRt = useAppStore((state) => state.updResRt)
  const profilesById = useAppStore((state) => state.calculator.profiles)
  const setTargetRes = useAppStore((state) => state.setResTgt)
  const bumpPickerFreq = useAppStore((state) => state.bumpPickFr)

  const [teamPickerSlot, setTeamPckrS] = useState<number | null>(null)
  const [cnfgResId, setCnfgResId] = useState<string | null>(null)
  const [cnfgChannel, setCnfgChannel] = useState<ChannelId>('loadout')
  const [wpnResId, setWpnResId] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const lineRef = useRef<HTMLSpanElement>(null)
  const pulseRef = useRef<HTMLSpanElement>(null)
  // Effect and gear disclosure is keyed by resonator id so cards can reorder
  // without carrying another slot's expanded state.
  const [shownEffects, setShownEffects] = useState<Set<string>>(() => new Set())
  const toggleEffect = useCallback((memberId: string) => {
    setShownEffects((prev) => {
      const next = new Set(prev)
      if (next.has(memberId)) {
        next.delete(memberId)
      } else {
        next.add(memberId)
      }
      return next
    })
  }, [])
  // the echo and sonata seals each own an independent bay below the meta row;
  // opening one never closes the other, so both can sit open at once.
  const [gearBays, setGearBays] = useState<Record<string, { echo: boolean; sonata: boolean }>>({})
  const toggleGear = useCallback((memberId: string, mode: 'echo' | 'sonata') => {
    setGearBays((prev) => {
      const current = prev[memberId] ?? { echo: false, sonata: false }
      return { ...prev, [memberId]: { ...current, [mode]: !current[mode] } }
    })
  }, [])
  const teamPicker = useAppModal()
  const configModal = useAppModal()
  const wpnPicker = useAppModal()
  const {
    closing: teamPckrClsn,
    hide: hideTeamPckr,
    open: teamPckrOpen,
    show: showTeamPckr,
    visible: teamPckrVsbl,
  } = teamPicker
  const {
    closing: cnfgMdlClsn,
    hide: hideCnfgMdl,
    open: cnfgMdlOpen,
    show: showCnfgMdl,
    visible: cnfgMdlVsbl,
  } = configModal
  const {
    closing: wpnPckrClsn,
    hide: hideWpnPckr,
    open: wpnPckrOpen,
    show: showWpnPckr,
    visible: wpnPckrVsbl,
  } = wpnPicker
  const mdlPrtlTgt = mainPortal()

  const clsTeamPckr = useCallback(() => {
    hideTeamPckr(() => {
      setTeamPckrS(null)
    })
  }, [hideTeamPckr])

  const openTeamPckr = useCallback((slotIndex: number) => {
    if (slotIndex === 0) {
      return
    }

    setTeamPckrS(slotIndex)
    showTeamPckr()
  }, [showTeamPckr])

  const clsCnfgMdl = useCallback(() => {
    hideCnfgMdl(() => {
      setCnfgResId(null)
    })
  }, [hideCnfgMdl])

  const openCnfgMdl = useCallback((resonatorId: string, channel: ChannelId = 'loadout') => {
    setCnfgChannel(channel)
    setCnfgResId(resonatorId)
    showCnfgMdl()
  }, [showCnfgMdl])

  const clsWpnPckr = useCallback(() => {
    hideWpnPckr(() => {
      setWpnResId(null)
    })
  }, [hideWpnPckr])

  const openWpnPckr = useCallback((resonatorId: string) => {
    setWpnResId(resonatorId)
    showWpnPckr()
  }, [showWpnPckr])

  const selTeamMem = useCallback((slotIndex: number, nextMemberId: string | null) => {
    if (nextMemberId) {
      const fullSeed = getResSeedBy(nextMemberId)
      if (fullSeed) {
        // create the compact teammate runtime before slot assignment so target
        // and source-state selectors can resolve the member in the same update.
        ensTeamMemRt(fullSeed)
      }
    }

    onRtPdt((prev) => {
      const nextTeam = [...prev.build.team] as ResRuntime['build']['team']
      nextTeam[slotIndex] = nextMemberId
      const nextTeamRuns = [...prev.teamRuntimes] as ResRuntime['teamRuntimes']

      if (!nextMemberId || slotIndex === 0) {
        if (slotIndex > 0) {
          nextTeamRuns[slotIndex - 1] = null
        }

        return {
          ...prev,
          build: {
            ...prev.build,
            team: nextTeam,
          },
          teamRuntimes: nextTeamRuns,
        }
      }

      const seed = getResSeedBy(nextMemberId)
      if (!seed) {
        return prev
      }

      const currentRuntime = prev.teamRuntimes[slotIndex - 1]
      const materialRuntime = matTeamMemFr(
        seed,
        currentRuntime?.id === nextMemberId ? currentRuntime : makeTeamMember(seed),
        prev.state.controls,
        prev.state.combat,
        nextTeam,
      )
      const shouldInitMember = currentRuntime?.id !== nextMemberId
      const nextRuntime = maxResOnInit && shouldInitMember
        ? maxRtInit(materialRuntime)
        : shouldInitMember
          ? initWpnStts(materialRuntime, { maxed: false })
          : materialRuntime
      const memberIdsClear = Array.from(
        new Set([
          currentRuntime?.id,
          prev.build.team[slotIndex],
          nextMemberId,
        ].filter((value): value is string => Boolean(value))),
      )

      nextTeamRuns[slotIndex - 1] = teamRuntime(nextRuntime)

      return {
        ...prev,
        build: {
          ...prev.build,
          team: nextTeam,
        },
        state: {
          ...prev.state,
          controls: mkMateCntr(prev.state.controls, memberIdsClear, nextMemberId, nextRuntime),
        },
        teamRuntimes: nextTeamRuns,
      }
    })
    if (nextMemberId && slotIndex > 0) {
      bumpPickerFreq({
        bucket: 'teamResonator',
        slot: slotIndex === 1 ? 'teammate1' : 'teammate2',
        ids: [nextMemberId],
      })
    }
  }, [bumpPickerFreq, ensTeamMemRt, maxResOnInit, onRtPdt])

  const lgblTeamPckr = useMemo(() => {
    if (teamPickerSlot === null || teamPickerSlot === 0) {
      return []
    }

    // slot eligibility is unique across teammates, while the edited slot keeps
    // its current member so reopening the picker preserves the selection.
    const blockedIds = new Set(
      runtime.build.team.filter(
        (memberId, memberIndex): memberId is string => Boolean(memberId) && memberIndex !== teamPickerSlot,
      ),
    )

    return RES_MENU.filter((entry) => !blockedIds.has(entry.id))
  }, [runtime.build.team, teamPickerSlot])

  const configMember = cnfgResId ? getResonator(cnfgResId) : null
  const cnfgRt = cnfgResId ? partRntmById[cnfgResId] ?? null : null
  const cnfgVsblStts = useMemo(() => {
    if (!cnfgRt) {
      return []
    }

    // teammate state visibility is evaluated against the active runtime because
    // team-targeted effects depend on the current composition.
    return makeSourceCat(cnfgRt).states.filter((state) =>
      isSourceVisible(cnfgRt, cnfgRt, state, runtime),
    )
  }, [cnfgRt, runtime])
  const configStates = useMemo(
    () => cnfgVsblStts.filter((state) => state.source.type !== 'echo'),
    [cnfgVsblStts],
  )
  const cnfgCmbtStts = useMemo(() => {
    if (!cnfgRt) {
      return null
    }

    const activeSeed = getResSeedBy(runtime.id)
    if (!activeSeed) {
      return null
    }

    const graph = makeCombatGraph({
      actRt: runtime,
      activeSeed,
      partRts: {
        ...partRntmById,
        [cnfgRt.id]: cnfgRt,
      },
      targetsByRes: mkSelTrgtByR(
        runtime.build.team,
        selTrgtByOwn,
      ),
    })

    const targetSlotId = findCombatPart(graph, cnfgRt.id)
    if (!targetSlotId) {
      return null
    }

    const context = makeCombatEnv({
      graph,
      targetSlotId,
      enemy: enemyProfile,
    })

    return makeStatsView(cnfgRt, context.finalStats)
  }, [
    cnfgRt,
    enemyProfile,
    partRntmById,
    runtime,
    selTrgtByOwn,
  ])

  interface MemberView {
    isLead: boolean
    id: string
    member: NonNullable<ReturnType<typeof getResonator>>
    memRt: ResRuntime
    weaponDef: ReturnType<typeof getWeapon> | null
    weaponParams: ReturnType<typeof resPssvPrms>
    resStates: ReturnType<typeof fltrSrcSttsW>
    weaponStates: ReturnType<typeof fltrSrcSttsW>
    mainEchoDef: ReturnType<typeof getEchoById>
    sonataPlan: ReturnType<typeof buildSonataPlan>
    echoStates: ReturnType<typeof fltrSrcSttsW>
    sonataGroups: Array<{
      setId: number
      name: string
      icon: string | null
      count: number
      pieceReq: number
      states: ReturnType<typeof fltrSrcSttsW>
    }>
  }

  const readMember = useCallback((index: number): MemberView | null => {
    const isLead = index === 0
    const resolveMemberId = isLead ? runtime.id : runtime.build.team[index]
    if (!resolveMemberId) {
      return null
    }

    const member = getResonator(resolveMemberId)
    const memRt = resolveMemberId === runtime.id ? runtime : partRntmById[resolveMemberId] ?? null
    if (!member || !memRt) {
      return null
    }

    const weaponId = memRt.build.weapon.id
    const weaponDef = !isNoWeaponId(weaponId) ? getWeapon(weaponId) : null
    const weaponParams = weaponDef ? resPssvPrms(weaponDef.passive.params, memRt.build.weapon.rank) : []
    const ncldTeamWide = resolveMemberId !== runtime.id
    const resStts = fltrSrcSttsW(
      listStatesFor('resonator', resolveMemberId),
      (state) => sttHasTeamFc(state, { ncldTeamWide }),
      (state) => isSourceVisible(memRt, runtime, state),
    )
    const weaponStates = !isNoWeaponId(weaponId)
      ? fltrSrcSttsW(
          listStatesFor('weapon', weaponId),
          (state) => sttHasTeamFc(state, { ncldTeamWide }),
          (state) => isSourceVisible(memRt, runtime, state),
        )
      : []

    // the lead's echo gear is display-only, so its team-facing states are
    // never collected; teammates gate seal clicks on these lists.
    const mainEchoSrc = getMainEchoS(memRt)
    const mainEchoDef = mainEchoSrc ? getEchoById(mainEchoSrc.id) : null
    const sonataPlan = buildSonataPlan(memRt.build.echoes)
    const echoStates = !isLead && mainEchoSrc
      ? fltrSrcSttsW(
          listStatesFor('echo', mainEchoSrc.id),
          (state) => sttHasTeamFc(state, { ncldTeamWide }),
          (state) => isSourceVisible(memRt, runtime, state),
        )
      : []
    const sonataGroups = !isLead
      ? sonataPlan.flatMap((entry) => {
          if (!isMaxSetPlan(entry.id, entry.count)) {
            return []
          }
          const states = fltrSrcSttsW(
            listStatesFor('echoSet', String(entry.id)),
            (state) => sttHasTeamFc(state, { ncldTeamWide }),
            (state) => isSourceVisible(memRt, runtime, state),
          )
          if (states.length === 0) {
            return []
          }
          const setDef = getEchoSetDe(entry.id)
          const pieceReq = setDef ? (setDef.setMax === 1 ? 1 : setDef.setMax === 3 ? 3 : 5) : entry.count
          return [{
            setId: entry.id,
            name: getSntSetNam(entry.id),
            icon: entry.icon,
            count: entry.count,
            pieceReq,
            states,
          }]
        })
      : []

    return {
      isLead,
      id: resolveMemberId,
      member,
      memRt,
      weaponDef,
      weaponParams,
      resStates: resStts,
      weaponStates,
      mainEchoDef,
      sonataPlan,
      echoStates,
      sonataGroups,
    }
  }, [partRntmById, runtime])

  const renderSeal = (
    view: MemberView,
    mode: 'echo' | 'sonata',
    title: string,
    hasStates: boolean,
    coins: ReactNode,
  ): ReactNode => {
    const isOpen = Boolean(gearBays[view.id]?.[mode])
    const className = `tlu-seal tlu-seal--${mode}${isOpen ? ' is-open' : ''}`
    if (view.isLead) {
      return (
        <span className={className} title={title}>
          {coins}
        </span>
      )
    }

    return (
      <button
        type="button"
        className={className}
        title={title}
        aria-label={hasStates ? `${title}: team actions` : `Open ${view.member.name}'s echoes`}
        aria-expanded={hasStates ? isOpen : undefined}
        onClick={() => (hasStates ? toggleGear(view.id, mode) : openCnfgMdl(view.id, 'echoes'))}
      >
        {coins}
      </button>
    )
  }

  const renderMeta = (view: MemberView): ReactNode => {
    const attrIcon = getAttributeIconSrc(view.member.attribute)
    const echoSeal = view.mainEchoDef
      ? renderSeal(
          view,
          'echo',
          `${view.mainEchoDef.name} (main echo)`,
          view.echoStates.length > 0,
          <span className="tlu-seal-coin">
            <img src={view.mainEchoDef.icon} alt="" loading="lazy" onError={withDefIconM} />
          </span>,
        )
      : null
    const sonataSeal = view.sonataPlan.length > 0
      ? renderSeal(
          view,
          'sonata',
          view.sonataPlan.map((entry) => `${getSntSetNam(entry.id)} x${entry.count}`).join(' + '),
          view.sonataGroups.length > 0,
          <>
            {view.sonataPlan.map((entry) => (
              <span key={entry.id} className="tlu-seal-coin">
                {entry.icon ? <img src={entry.icon} alt="" loading="lazy" onError={withDefIconM} /> : null}
              </span>
            ))}
          </>,
        )
      : null

    return (
      <div className="tlu-meta">
        {attrIcon ? (
          <span className="tlu-meta-attr" title={view.member.attribute}>
            <img src={attrIcon} alt="" onError={withDefIconM} />
          </span>
        ) : null}
        <span className="tlu-meta-chip">Lv<b>{view.memRt.base.level}</b></span>
        <span className="tlu-meta-chip tlu-meta-seq">S{view.memRt.base.sequence}</span>
        {view.member.tags && view.member.tags.length > 0 ? (
          <IdentTagsTooltip
            tags={view.member.tags}
            label={`${view.member.name} roles`}
            className="tlu-meta-tags"
            onIconError={withDefIconM}
          />
        ) : null}
        {echoSeal || sonataSeal ? (
          <span className="tlu-gear">
            {echoSeal}
            {sonataSeal}
          </span>
        ) : null}
      </div>
    )
  }

  const renderWeapon = (view: MemberView): ReactNode => {
    const { member, memRt, weaponDef, weaponStates } = view
    const wpnKey = WPNTYPETOKEY[member.weaponType]
    const typeIcon = wpnKey ? `/assets/weapons/${wpnKey}.webp` : null
    // teammate weapon changes are local to the compact teammate runtime; the
    // active resonator still owns its weapon pane.
    const canSwapWpn = !view.isLead
    const effectShown = shownEffects.has(view.id)
    const renderIdRow = (children: ReactNode): ReactNode =>
      canSwapWpn ? (
        <button
          type="button"
          className="tlu-console-hd tlu-console-hd--btn"
          title={`Change ${member.name}'s weapon`}
          aria-label={`Change ${member.name}'s weapon`}
          onClick={() => openWpnPckr(view.id)}
        >
          {children}
        </button>
      ) : (
        <div className="tlu-console-hd">{children}</div>
      )
    if (!weaponDef) {
      return (
        <section className="tlu-weapon is-empty">
          <span className="tlu-sec-label">
            {typeIcon ? <img className="tlu-sec-type" src={typeIcon} alt="" onError={withDefIconM} /> : null}
            {getWpnTypeLb(member.weaponType)}
          </span>
          <div className="tlu-console">
            {renderIdRow(
              <>
                {typeIcon ? (
                  <span className="tlu-weapon-icon">
                    <img src={typeIcon} alt="" onError={withDefIconM} />
                  </span>
                ) : null}
                <span className="tlu-id-plate">
                  <span className="tlu-weapon-name">{canSwapWpn ? 'Add a weapon' : 'No weapon equipped'}</span>
                </span>
              </>,
            )}
          </div>
        </section>
      )
    }

    const stats = weaponStatsAt(weaponDef, memRt.build.weapon.level)
    const statKey = weaponDef.statKey
    const wpnAccent = rarityVars(weaponDef.rarity, false, '--wpn-accent') as CssProps
    const stateParts = canSwapWpn
      ? weaponStates.map((state) => ({
          key: state.controlKey,
          ...buildStateParts(view, state, { showDesc: effectShown, descParams: view.weaponParams }),
        }))
      : []

    return (
      <section className="tlu-weapon" style={wpnAccent}>
        {weaponStates.length > 0 ? (
          <div className={`tlu-weapon-effect${effectShown ? ' is-open' : ''}`}>
            <button
              type="button"
              className="tlu-weapon-effect-head"
              aria-pressed={effectShown}
              onClick={() => toggleEffect(view.id)}
            >
              <span className="tlu-sec-label">
                {typeIcon ? <img className="tlu-sec-type" src={typeIcon} alt="" onError={withDefIconM} /> : null}
                {getWpnTypeLb(member.weaponType)}
                <i className="tlu-sec-sep" aria-hidden="true" />
                <span className="tlu-sec-passive">{weaponDef.passive.name || 'Weapon effect'}</span>
              </span>
              <span className="tlu-weapon-effect-toggle">
                {effectShown ? 'Hide' : 'Detail'}
                <ChevronDown size={13} aria-hidden="true" />
              </span>
            </button>
          </div>
        ) : (
          <span className="tlu-sec-label">
            {typeIcon ? <img className="tlu-sec-type" src={typeIcon} alt="" onError={withDefIconM} /> : null}
            {getWpnTypeLb(member.weaponType)}
            <i className="tlu-sec-sep" aria-hidden="true" />
            <span className="tlu-sec-passive">{weaponDef.passive.name || 'Weapon effect'}</span>
          </span>
        )}

        <div className="tlu-console">
          {renderIdRow(
            <>
              <span className="tlu-weapon-icon">
                <img src={weaponDef.icon} alt="" loading="lazy" onError={withDefWpnMg} />
                <i className="tlu-weapon-rank">R{memRt.build.weapon.rank}</i>
              </span>
              <span className="tlu-id-plate">
                <span className="tlu-weapon-name" title={weaponDef.name}>{weaponDef.name}</span>
                <span className="tlu-statline">
                  <span className="tlu-stat" title={`Base ATK at Lv ${memRt.build.weapon.level}`}>
                    <span
                      className="tlu-wstat-glyph"
                      aria-hidden="true"
                      style={{ WebkitMaskImage: `url(${WPN_STAT_CNS.atk})`, maskImage: `url(${WPN_STAT_CNS.atk})` } as CssProps}
                    />
                    {stats.atk}
                  </span>
                  <span className="tlu-stat" title={WPNSTATLBLS[statKey] ?? statKey}>
                    {WPN_STAT_CNS[statKey] ? (
                      <span
                        className="tlu-wstat-glyph"
                        aria-hidden="true"
                        style={{ WebkitMaskImage: `url(${WPN_STAT_CNS[statKey]})`, maskImage: `url(${WPN_STAT_CNS[statKey]})` } as CssProps}
                      />
                    ) : null}
                    {fmtWpnStatDs(statKey, stats.scndStatVl)}
                  </span>
                </span>
              </span>
            </>,
          )}
          {stateParts.length > 0 ? (
            <div className="tlu-lamps">
              {stateParts.map((part) => (
                <Fragment key={part.key}>{part.cell}</Fragment>
              ))}
            </div>
          ) : null}
          {stateParts.some((part) => part.note) ? (
            <div className="tlu-rnotes">
              {stateParts.map((part) => (
                <Fragment key={part.key}>{part.note}</Fragment>
              ))}
            </div>
          ) : null}
        </div>
      </section>
    )
  }

  // team-target selectors use the same owner-key routing for resonator and
  // weapon source states.
  const buildTargetSel = (view: MemberView, state: MemberView['resStates'][number]): ReactNode => {
    const targetMode = getStateTeamTag(state)
    if (!targetMode) {
      return undefined
    }
    const options = getTeamTgtPt(runtime, view.id, targetMode)
    const currentValue = profilesById[runtime.id]?.runtime.routing.selectedTargetsByOwnerKey[state.ownerKey] ?? null
    const selVl =
      typeof currentValue === 'string' && options.some((option) => option.value === currentValue)
        ? currentValue
        : options[0]?.value ?? ''

    return (
      <label className="team-state-target">
        Active Resonator
        <LiquidSelect
          value={selVl}
          options={options}
          disabled={options.length <= 1}
          onChange={(nextValue) => setTargetRes(view.id, state.ownerKey, nextValue || null)}
        />
      </label>
    )
  }

  const renderStateCtrl = (view: MemberView, state: MemberView['resStates'][number]): ReactNode => (
    <SourceStateCtrl
      srcRt={view.memRt}
      tgtRt={view.memRt}
      state={state}
      onRtPdt={view.isLead ? onRtPdt : (updater) => updResRt(view.id, updater)}
      teamTgtSlct={buildTargetSel(view, state)}
    />
  )

  const buildRouteSwitch = (view: MemberView, state: MemberView['weaponStates'][number]): ReactNode => {
    const targetMode = getStateTeamTag(state)
    if (!targetMode) {
      return null
    }
    const options = getTeamTgtPt(runtime, view.id, targetMode)
    if (options.length === 0) {
      return null
    }
    const currentValue = profilesById[runtime.id]?.runtime.routing.selectedTargetsByOwnerKey[state.ownerKey] ?? null
    const selVl =
      typeof currentValue === 'string' && options.some((option) => option.value === currentValue)
        ? currentValue
        : options[0]?.value ?? ''
    const selResName = getResonator(selVl)?.name ?? ''
    const locked = options.length <= 1

    return (
      <span className="tlu-route" role="radiogroup" aria-label={`Buff applies to ${selResName}`}>
        <span className="tlu-route-eyebrow">Applies to</span>
        <span className="tlu-route-seg">
          {options.map((option) => {
            const target = getResonator(option.value)
            const isSel = option.value === selVl
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={isSel}
                className={`tlu-route-opt${isSel ? ' is-sel' : ''}`}
                title={option.label}
                disabled={locked}
                onClick={() => setTargetRes(view.id, state.ownerKey, option.value)}
              >
                {target?.profile ? (
                  <img src={target.profile} alt={option.label} onError={withDefResMg} />
                ) : (
                  <span className="tlu-route-mono">{option.label.slice(0, 2)}</span>
                )}
              </button>
            )
          })}
        </span>
      </span>
    )
  }

  const buildStateParts = (
    view: MemberView,
    state: MemberView['weaponStates'][number],
    opts: { showDesc?: boolean; hideDesc?: boolean; noteLabel?: boolean; descParams?: Array<string | number> } = {},
  ): { cell: ReactNode; note: ReactNode } => {
    const { showDesc = false, hideDesc = false, noteLabel = true, descParams } = opts
    const { memRt } = view
    const applyUpdate: RtUpdHnd = view.isLead ? onRtPdt : (updater) => updResRt(view.id, updater)
    const current = readRtPath(memRt, state.path)
    const enabled = isSrcSttOn(memRt, memRt, state, memRt)
    const reason = !enabled ? getSrcSttDsb(state) : null
    const display = getStateText(state)
    const resolved = current ?? getSrcSttNct(memRt, memRt, state, memRt)
    const route = buildRouteSwitch(view, state)

    let control: ReactNode
    let active = false

    if (state.kind === 'toggle') {
      const checked = stToBool(resolved)
      active = checked
      control = (
        <label
          className={`tlu-lamp tlu-lamp--act${checked ? ' is-on' : ''}${!enabled ? ' is-disabled' : ''}`}
          title={reason ?? undefined}
        >
          <i className="tlu-lamp-dot" aria-hidden="true" />
          <span className="tlu-lamp-label">{display.label}</span>
          <input
            type="checkbox"
            checked={checked}
            disabled={!enabled}
            onChange={() => setSourceState(applyUpdate, memRt, memRt, state, !checked, memRt)}
          />
        </label>
      )
    } else if (state.kind === 'select') {
      const options = srcSttOpts(memRt, memRt, state, memRt)
      if (options.length > 0) {
        active = stToNum(resolved) > 0
        control = (
          <label className={`tlu-lamp tlu-lamp--field${active ? ' is-on' : ''}${!enabled ? ' is-disabled' : ''}`}>
            <i className="tlu-lamp-dot" aria-hidden="true" />
            <span className="tlu-lamp-label">{display.label}</span>
            <LiquidSelect
              value={String(resolved)}
              options={options.map((option) => ({ value: option.id, label: option.label }))}
              disabled={!enabled}
              onChange={(nextValue) => setSourceState(applyUpdate, memRt, memRt, state, nextValue, memRt)}
            />
          </label>
        )
      }
    }

    if (!control) {
      const min = state.min ?? 0
      const numeric = stToNum(resolved)
      const max = srcSttNumMax(memRt, memRt, state, memRt)
      active = numeric > min
      control = (
        <label className={`tlu-lamp tlu-lamp--field${active ? ' is-on' : ''}${!enabled ? ' is-disabled' : ''}`}>
          <i className="tlu-lamp-dot" aria-hidden="true" />
          <span className="tlu-lamp-label">{display.label}</span>
          <span className="tlu-lamp-value">
            <NumberInput
              value={numeric}
              min={min}
              max={max}
              step={state.kind === 'stack' ? 1 : 0.1}
              disabled={!enabled}
              onChange={(value) => setRtPath(applyUpdate, state.path, value)}
            />
            {state.kind === 'stack' && typeof max === 'number' && Number.isFinite(max) ? (
              <em className="tlu-lamp-max">/ {max}</em>
            ) : null}
          </span>
        </label>
      )
    }

    const cell = route ? (
      <>
        {route}
        <div className="tlu-lamps">
          {control}
        </div>
      </>
    ) : (
      <div className="tlu-lamps">
        {control}
      </div>
    )

    const note = (!hideDesc && display.description) || reason ? (
      <div className="tlu-rnote-slot">
        {!hideDesc && display.description ? (
          <div className={`tlu-wstate-desc-wrap${showDesc ? ' is-open' : ''}`}>
            <div className="tlu-wstate-desc-inner">
              <div className="tlu-rnote">
                {noteLabel ? <span className="tlu-rnote-label">{display.label}</span> : null}
                <RichDscr description={display.description} params={descParams} className="tlu-wstate-desc" />
              </div>
            </div>
          </div>
        ) : null}
        {reason ? <p className="tlu-wstate-reason">{reason}</p> : null}
      </div>
    ) : null

    return { cell, note }
  }

  const buildToggleSwitch = (
    view: MemberView,
    state: MemberView['echoStates'][number],
  ): { control: ReactNode; reason: string | null } => {
    const { memRt } = view
    const applyUpdate: RtUpdHnd = view.isLead ? onRtPdt : (updater) => updResRt(view.id, updater)
    const current = readRtPath(memRt, state.path)
    const enabled = isSrcSttOn(memRt, memRt, state, memRt)
    const reason = !enabled ? getSrcSttDsb(state) : null
    const resolved = current ?? getSrcSttNct(memRt, memRt, state, memRt)
    const checked = stToBool(resolved)

    return {
      control: (
        <label className={`tlu-switch${!enabled ? ' is-disabled' : ''}`} title={reason ?? undefined}>
          <input
            type="checkbox"
            checked={checked}
            disabled={!enabled}
            onChange={() => setSourceState(applyUpdate, memRt, memRt, state, !checked, memRt)}
          />
        </label>
      ),
      reason,
    }
  }

  const renderEchoBay = (view: MemberView): ReactNode => {
    const def = view.mainEchoDef
    if (!def) {
      return null
    }

    const [primary, ...rest] = view.echoStates
    const headToggle = primary?.kind === 'toggle' ? buildToggleSwitch(view, primary) : null
    const route = headToggle && primary ? buildRouteSwitch(view, primary) : null
    const inlineStates = headToggle ? rest : view.echoStates

    return (
      <div className="tlu-echo-brief">
        <div className="tlu-echo-brief-head">
          <span className="tlu-echo-icon">
            <img src={def.icon} alt="" loading="lazy" onError={withDefIconM} />
          </span>
          <span className="tlu-echo-brief-id">
            <span className="tlu-echo-brief-name">{def.name}</span>
            <span className="tlu-echo-brief-cost">{def.cost}C</span>
          </span>
          {headToggle ? headToggle.control : null}
        </div>
        {headToggle?.reason ? <p className="tlu-wstate-reason">{headToggle.reason}</p> : null}
        {def.skillDesc ? (
          <RichDscr description={def.skillDesc} className="tlu-echo-brief-desc" />
        ) : (
          <p className="tlu-echo-brief-empty">This echo has no active skill.</p>
        )}
        {route}
        {inlineStates.map((state) => {
          const parts = buildStateParts(view, state, { showDesc: true })
          return (
            <div key={state.controlKey} className="tlu-gear-state">
              <div className="tlu-gear-ctl">{parts.cell}</div>
              {parts.note}
            </div>
          )
        })}
      </div>
    )
  }

  const renderSonataBay = (view: MemberView): ReactNode => (
    <div className="tlu-sonata-list">
      {view.sonataGroups.map((group) => (
        <section key={group.setId} className="tlu-sonata-entry">
          <header className="tlu-sonata-head">
            <span className="tlu-sonata-icon">
              {group.icon ? <img src={group.icon} alt="" loading="lazy" onError={withDefIconM} /> : null}
            </span>
            <span className="tlu-sonata-name">{group.name}</span>
            <span className="tlu-sonata-pips" aria-hidden="true">
              {Array.from({ length: group.pieceReq }, (_, index) => (
                <span key={index} className={`tlu-sonata-pip${index < group.count ? ' filled' : ''}`} />
              ))}
            </span>
          </header>
          <div className="tlu-gear-states">
            {group.states.map((state) => {
              const parts = buildStateParts(view, state, { showDesc: true, noteLabel: false })
              return (
                <div key={state.controlKey} className="tlu-gear-state">
                  <div className="tlu-gear-ctl">{parts.cell}</div>
                  {parts.note}
                </div>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )

  const renderGearbay = (view: MemberView): ReactNode => {
    const hasEcho = view.echoStates.length > 0 && Boolean(view.mainEchoDef)
    const hasSonata = view.sonataGroups.length > 0
    if (!hasEcho && !hasSonata) {
      return null
    }

    const bay = gearBays[view.id]
    const echoOpen = Boolean(bay?.echo) && hasEcho
    const sonataOpen = Boolean(bay?.sonata) && hasSonata

    return (
      <>
        {hasEcho ? (
          <div className={`tlu-gearbay${echoOpen ? ' is-open' : ''}`}>
            <div className="tlu-gearbay-inner" inert={!echoOpen}>
              {renderEchoBay(view)}
            </div>
          </div>
        ) : null}
        {hasSonata ? (
          <div className={`tlu-gearbay${sonataOpen ? ' is-open' : ''}`}>
            <div className="tlu-gearbay-inner" inert={!sonataOpen}>
              {renderSonataBay(view)}
            </div>
          </div>
        ) : null}
      </>
    )
  }

  const renderBuffs = (view: MemberView): ReactNode => {
    if (view.resStates.length === 0) {
      return (
        <p className="tlu-buffs-empty">
          {view.member.name} brings no team-facing buffs with this build.
        </p>
      )
    }

    return view.resStates.map((state) => (
      <div key={state.controlKey} className="team-state-control">
        {renderStateCtrl(view, state)}
      </div>
    ))
  }

  const activeView = readMember(0)
  const supportViews = [readMember(1), readMember(2)]
  const orderedViews = [activeView, ...supportViews]
  const teamCount = runtime.build.team.filter((memberId, index) => (index === 0 ? Boolean(runtime.id) : Boolean(memberId))).length

  // weapon picker inputs are scoped to the teammate runtime being edited.
  const wpnPckrView = wpnResId ? orderedViews.find((view) => view?.id === wpnResId) ?? null : null
  const wpnPckrList = wpnPckrView ? listWpnsByTy(wpnPckrView.member.weaponType) : []
  const onWpnPckrSelect = (weaponId: string) => {
    if (!wpnPckrView) {
      return
    }
    const selected = wpnPckrList.find((entry) => entry.id === weaponId)
    if (selected) {
      const stats = weaponStatsAt(selected, 90)
      const applyUpdate: RtUpdHnd = wpnPckrView.isLead
        ? onRtPdt
        : (updater) => updResRt(wpnPckrView.id, updater)
      applyUpdate((prev) => {
        const nextRuntime = {
          ...prev,
          build: {
            ...prev.build,
            weapon: { id: selected.id, level: 90, rank: 1, baseAtk: stats.atk },
          },
        }
        return initWpnStts(nextRuntime, {
          weaponId: selected.id,
          prevWpnId: prev.build.weapon.id,
          maxed: maxResOnInit,
        })
      })
    }
    clsWpnPckr()
  }

  // opened effect groups are shared by the composition badges and their detail
  // panels so one toggle controls both surfaces.
  const [openBuffs, setOpenBuffs] = useState<Set<string>>(() => new Set())
  const isBuffsOpen = (id: string) => openBuffs.has(id)
  const setBuffsOpen = (id: string, open: boolean) => {
    setOpenBuffs((prev) => {
      const next = new Set(prev)
      if (open) {
        next.add(id)
      } else {
        next.delete(id)
      }
      return next
    })
  }

  // portrait offsets are measured after layout because expanded effect groups
  // change row heights and therefore the segment positions along the line.
  const membersKey = orderedViews.map((view) => view?.id ?? '_').join('|')
  const expandKey = orderedViews
    .map((view) => {
      if (!view) {
        return '0'
      }
      const bay = gearBays[view.id]
      const open = isBuffsOpen(view.id) || shownEffects.has(view.id) || Boolean(bay?.echo) || Boolean(bay?.sonata)
      return open ? '1' : '0'
    })
    .join('')

  useEffect(() => {
    const list = listRef.current
    const line = lineRef.current
    const pulse = pulseRef.current
    if (!list || !line || !pulse || typeof pulse.animate !== 'function') {
      return
    }
    // motion preferences gate the measured line animation as well as CSS motion.
    if (list.closest('.reduce-animation, .no-entrance-anim')) {
      return
    }

    const DURATION = 5200
    const glow = (color: string) => `0 0 9px 2px ${color}`
    let travel: Animation | null = null
    let tint: Animation | null = null
    let frame = 0

    const build = () => {
      const lineRect = line.getBoundingClientRect()
      if (lineRect.height <= 0) {
        return
      }
      const neutral = getComputedStyle(list).getPropertyValue('--muted').trim() || '#8a97a4'
      // Map each visible member node onto the vertical line as an animation
      // stop, then interpolate the pulse through those measured fractions.
      const stops = Array.from(list.querySelectorAll<HTMLElement>('.tlu-member .tlu-node'))
        .map((node) => {
          const rect = node.getBoundingClientRect()
          const center = rect.top + rect.height / 2 - lineRect.top
          return {
            frac: Math.min(0.999, Math.max(0.001, center / lineRect.height)),
            color: node.dataset.accent || neutral,
          }
        })
        .sort((a, b) => a.frac - b.frac)

      // the line segment before the first portrait remains neutral; each later
      // stop uses the resonator attribute color measured at that portrait.
      const colorFrames: Keyframe[] = [
        { offset: 0, backgroundColor: neutral, boxShadow: glow(neutral), easing: 'step-end' },
      ]
      let prev = 0
      let last = neutral
      for (const stop of stops) {
        const offset = Math.min(0.999, Math.max(prev + 0.001, stop.frac))
        colorFrames.push({ offset, backgroundColor: stop.color, boxShadow: glow(stop.color), easing: 'step-end' })
        prev = offset
        last = stop.color
      }
      colorFrames.push({ offset: 1, backgroundColor: last, boxShadow: glow(last) })

      const travelFrames: Keyframe[] = [
        { offset: 0, transform: 'translateY(0)', opacity: 0 },
        { offset: 0.1, opacity: 1 },
        { offset: 0.9, opacity: 1 },
        { offset: 1, transform: `translateY(${lineRect.height}px)`, opacity: 0 },
      ]

      travel?.cancel()
      tint?.cancel()
      travel = pulse.animate(travelFrames, { duration: DURATION, iterations: Infinity, easing: 'linear' })
      tint = pulse.animate(colorFrames, { duration: DURATION, iterations: Infinity })
    }

    const schedule = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(build)
    }

    schedule()
    const observer = new ResizeObserver(schedule)
    observer.observe(list)
    list.querySelectorAll('.tlu-row').forEach((row) => observer.observe(row))

    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      travel?.cancel()
      tint?.cancel()
    }
  }, [membersKey, expandKey])

  return (
    <section className="calc-pane tlu-pane">
      <header className="tlu-head weapon-effect__bar">
        <span className="weapon-effect__sigil" aria-hidden="true" />
        <span className="weapon-effect__titles">
          <span className="weapon-effect__tag">Simulation</span>
          <span className="weapon-effect__name">Team Setup</span>
        </span>
        <div className="tlu-fill" aria-label={`${teamCount} of 3 resonators`}>
          {[0, 1, 2].map((slot) => (
            <span
              key={slot}
              className={`tlu-fill-dot${slot < teamCount ? ' on' : ''}`}
              aria-hidden="true"
              style={{
                '--accent': orderedViews[slot] ? ATTR_COLORS[orderedViews[slot].member.attribute] : null,
              } as CssProps}

            />
          ))}
          <span className="tlu-fill-count">{teamCount}<i>/3</i></span>
        </div>
      </header>

      <div className="tlu-list" ref={listRef}>
        <span className="tlu-line" aria-hidden="true" ref={lineRef}><span className="tlu-pulse" ref={pulseRef} /></span>
        {orderedViews.map((view, index) => {
          if (!view) {
            if (index === 0) {
              return null
            }
            return (
              <button
                key={`open-${index}`}
                type="button"
                className="tlu-row tlu-add"
                onClick={() => openTeamPckr(index)}
              >
                <span className="tlu-node tlu-node--add" aria-hidden="true">
                  <Plus size={16} strokeWidth={2.4} />
                </span>
                <span className="tlu-add-copy">
                  <b>Add a resonator</b>
                  Bring another to the team
                </span>
              </button>
            )
          }

          const isLead = index === 0

          return (
            <article
              key={view.id}
              className={`tlu-row tlu-member${isLead ? ' is-active' : ''}`}
              style={{
                '--tlu-accent': ATTR_COLORS[view.member.attribute],
                '--resonator-accent': ATTR_COLORS[view.member.attribute],
              } as CssProps}
            >
              <button
                className="tlu-node"
                title={`Swap ${view.member.name}`}
                aria-label={`Swap ${view.member.name}`}
                onClick={() => openTeamPckr(index)}
                data-accent={ATTR_COLORS[view.member.attribute]}
              >
                <img src={view.member.profile} alt="" onError={withDefResMg} />
              </button>
              <div className="tlu-content pane-section">
                {!isLead ? (
                  <div className="tlu-tools">
                    <button
                      type="button"
                      className="tlu-tool"
                      title={`Swap ${view.member.name}`}
                      aria-label={`Swap ${view.member.name}`}
                      onClick={() => openTeamPckr(index)}
                    >
                      <RefreshCw size={13} />
                    </button>
                    <button
                      type="button"
                      className="tlu-tool"
                      title={`Configure ${view.member.name}`}
                      aria-label={`Configure ${view.member.name}`}
                      onClick={() => openCnfgMdl(view.id)}
                    >
                      <Wrench size={13} />
                    </button>
                    <button
                      type="button"
                      className="tlu-tool tlu-tool--remove"
                      title={`Remove ${view.member.name}`}
                      aria-label={`Remove ${view.member.name}`}
                      onClick={() => selTeamMem(index, null)}
                    >
                      <X size={14} strokeWidth={2.6} />
                    </button>
                  </div>
                ) : null}
                <div className="tlu-heading">
                  <span className={`tlu-role${isLead ? ' tlu-role--active' : ''}`}>
                    {isLead ? 'Active' : 'Support'}
                  </span>
                  <span className="tlu-name">{view.member.name}</span>
                </div>
                {renderMeta(view)}
                {renderGearbay(view)}
                {renderWeapon(view)}
                <Expandable
                  as="div"
                  className="tlu-buffs"
                  triggerClass="tlu-buffs-trigger"
                  contentClass="tlu-buffs-content"
                  innerClass="tlu-buffs-inner"
                  chevronClass="tlu-buffs-chevron"
                  chevronSize={15}
                  open={isBuffsOpen(view.id)}
                  onOpenChange={(open) => setBuffsOpen(view.id, open)}
                  header={
                    <span className="tlu-buffs-head">
                      <span className="tlu-buffs-count">{view.resStates.length}</span>
                      <span className="tlu-buffs-label">Effect{view.resStates.length > 1 ? 's' : ''}</span>
                    </span>
                  }
                >
                  {renderBuffs(view)}
                </Expandable>
              </div>
            </article>
          )
        })}
      </div>

      {cnfgMdlVsbl && configMember && cnfgRt ? (
        <ConfigModal
          visible={cnfgMdlVsbl}
          open={cnfgMdlOpen}
          closing={cnfgMdlClsn}
          portalTarget={mdlPrtlTgt}
          member={configMember}
          runtime={cnfgRt}
          actRt={runtime}
          invBlds={invBlds}
          sttDefs={configStates}
          cmbtSttsView={cnfgCmbtStts}
          initChannel={cnfgChannel}
          onSqncChng={(value) =>
            updResRt(configMember.id, (prev) => ({
              ...prev,
              base: {
                ...prev.base,
                sequence: Math.max(0, Math.min(6, value)),
              },
            }))
          }
          onRtPdt={(updater) => updResRt(configMember.id, updater)}
          getSelTgt={(ownerKey) => profilesById[runtime.id]?.runtime.routing.selectedTargetsByOwnerKey[ownerKey] ?? null}
          setSelTgt={(ownerKey, tgtResId) =>
            setTargetRes(configMember.id, ownerKey, tgtResId)
          }
          onClose={clsCnfgMdl}
        />
      ) : null}

      {teamPckrVsbl ? (
        <ResPckr
          visible={teamPckrVsbl}
          open={teamPckrOpen}
          closing={teamPckrClsn}
          portalTarget={mdlPrtlTgt}
          eyebrow="Team Slots"
          title="Select Teammate"
          resonators={lgblTeamPckr}
          selResId={teamPickerSlot === null ? null : runtime.build.team[teamPickerSlot] ?? null}
          selLbl="Selected"
          smmrPrmr={{
            label: 'Slot',
            value: (teamPickerSlot ?? 0) + 1
          }}
          emptyState={<p>No eligible resonators remain for this slot.</p>}
          panelWidth="regular"
          onClose={clsTeamPckr}
          onSelect={(resonatorId) => {
            if (teamPickerSlot === null) {
              return
            }

            selTeamMem(teamPickerSlot, resonatorId)
            clsTeamPckr()
          }}
        />
      ) : null}

      {wpnPckrVsbl && wpnPckrView ? (
        <WeaponPicker
          visible={wpnPckrVsbl}
          open={wpnPckrOpen}
          closing={wpnPckrClsn}
          portalTarget={mdlPrtlTgt}
          weapons={wpnPckrList}
          selWpnId={wpnPckrView.weaponDef?.id ?? null}
          recommendedWeaponIds={wpnPckrView.member.recommendedWeaponIds ?? []}
          onSelect={onWpnPckrSelect}
          onClose={clsWpnPckr}
        />
      ) : null}
    </section>
  )
}
