/*
  Author: Runor Ewhro
  Description: Renders the pane surface for the calculator teams flow.
*/

import { useCallback, useMemo, useState } from 'react'
import { Wrench, X } from 'lucide-react'
import { isNoWeaponId, type ResRuntime } from '@/domain/entities/runtime.ts'
import { getResSeedBy } from '@/domain/services/resonatorSeedService.ts'
import { listStatesFor } from '@/domain/services/gameDataService.ts'
import { makeSourceCat } from '@/domain/services/runtimeSourceService.ts'
import { findCombatPart, makeCombatGraph } from '@/domain/state/combatGraph.ts'
import { selActTgtSlc, selEnemyProf } from '@/domain/state/selectors.ts'
import { useAppStore } from '@/domain/state/store.ts'
import { makeCombatEnv } from '@/engine/pipeline/buildCombatContext.ts'
import { ResPckr } from '@/modules/calculator/features/resonator/Picker.tsx'
import { SourceStateCtrl } from '@/modules/calculator/features/controls/SourceStateControl.tsx'
import { ConfigModal } from '@/modules/calculator/features/teams/ConfigModal.tsx'
import {
  fltrSrcSttsW,
  getStateTeamTag,
  getTeamTgtPt,
  isSourceVisible,
  sttHasTeamFc,
  withDefResMg,
} from '@/modules/calculator/features/controls/lib/runtimeStateUtils.ts'
import type { RtUpdHnd } from '@/modules/calculator/features/controls/lib/runtimeStateUtils.ts'
import { mkVrvwSttsVi } from '@/modules/calculator/features/overview/lib/stats.ts'
import { RES_MENU, getResonator } from '@/modules/calculator/features/resonator/lib/resonator.ts'
import { mkSelTrgtByR } from '@/modules/calculator/model/teamTargets.ts'
import { getWeapon, resPssvPrms, withDefWpnMg } from '@/modules/calculator/features/weapons/lib/weapon.ts'
import { useAppModal } from '@/shared/ui/useAppModal.ts'
import { mainPortal } from '@/shared/lib/portalTarget.ts'
import { Expandable } from '@/shared/ui/Expandable.tsx'
import { LiquidSelect } from '@/shared/ui/LiquidSelect.tsx'

// manages the team-building pane and surfaces the helper modals for slots and controls.
interface CalcTmsPaneP {
  runtime: ResRuntime
  prtcRntmById: Record<string, ResRuntime>
  onRtPdt: RtUpdHnd
}

// manages the team-building pane and surfaces the helper modals for slots and controls.
export function Teams({
  runtime,
  prtcRntmById: partRntmById,
  onRtPdt: onRtPdt,
}: CalcTmsPaneP) {
  const enemyProfile = useAppStore(selEnemyProf)
  const selTrgtByOwn = useAppStore(selActTgtSlc)
  const invBlds = useAppStore((state) => state.calculator.inventoryBuilds)
  const ensTeamMemRt = useAppStore((state) => state.ensTeamRt)
  const updResRt = useAppStore((state) => state.updResRt)
  const profilesById = useAppStore((state) => state.calculator.profiles)
  const setTargetRes = useAppStore((state) => state.setResTgt)
  const bumpPickerFreq = useAppStore((state) => state.bumpPickFr)

  const [teamPickerSlot, setTeamPckrS] = useState<number | null>(null)
  const [cnfgResId, setCnfgResId] = useState<string | null>(null)
  const teamPicker = useAppModal()
  const configModal = useAppModal()
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

  const openCnfgMdl = useCallback((resonatorId: string) => {
    setCnfgResId(resonatorId)
    showCnfgMdl()
  }, [showCnfgMdl])

  const selTeamMem = useCallback((slotIndex: number, nextMemberId: string | null) => {
    if (nextMemberId) {
      const fullSeed = getResSeedBy(nextMemberId)
      if (fullSeed) {
        // teammate runtimes are created before slot assignment so downstream
        // target and source-state selectors can resolve the new member at once.
        ensTeamMemRt(fullSeed)
      }
    }

    onRtPdt((prev) => {
      const nextTeam = [...prev.build.team] as ResRuntime['build']['team']
      nextTeam[slotIndex] = nextMemberId
      return {
        ...prev,
        build: {
          ...prev.build,
          team: nextTeam,
        },
      }
    })
    if (nextMemberId && slotIndex > 0) {
      bumpPickerFreq({
        bucket: 'teamResonator',
        slot: slotIndex === 1 ? 'teammate1' : 'teammate2',
        ids: [nextMemberId],
      })
    }
  }, [bumpPickerFreq, ensTeamMemRt, onRtPdt])

  const lgblTeamPckr = useMemo(() => {
    if (teamPickerSlot === null || teamPickerSlot === 0) {
      return []
    }

    // a resonator can only occupy one teammate slot, but the currently edited
    // slot remains eligible so re-opening the picker can keep its value.
    const blockedIds = new Set(
      runtime.build.team.filter(
        (memberId, memberIndex): memberId is string => Boolean(memberId) && memberIndex !== teamPickerSlot,
      ),
    )

    return RES_MENU.filter((entry) => !blockedIds.has(entry.id))
  }, [runtime.build.team, teamPickerSlot])

  const actSlotLbl = teamPickerSlot === null ? 'Teammate' : `Teammate ${teamPickerSlot}`

  const configMember = cnfgResId ? getResonator(cnfgResId) : null
  const cnfgRt = cnfgResId ? partRntmById[cnfgResId] ?? null : null
  const cnfgVsblStts = useMemo(() => {
    if (!cnfgRt) {
      return []
    }

    // teammate configuration is evaluated against the full active runtime so
    // team-dependent state visibility follows the current composition.
    return makeSourceCat(cnfgRt).states.filter((state) =>
      isSourceVisible(cnfgRt, cnfgRt, state, runtime),
    )
  }, [cnfgRt, runtime])
  const configStates = useMemo(
    () => cnfgVsblStts.filter(
      (state) =>
        state.source.type !== 'echo'
        && !sttHasTeamFc(state, { ncldTeamWide: true }),
    ),
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

    return mkVrvwSttsVi(cnfgRt, context.finalStats)
  }, [
    cnfgRt,
    enemyProfile,
    partRntmById,
    runtime,
    selTrgtByOwn,
  ])

  const teamSttCrds = runtime.build.team.flatMap((memberId, index) => {
    const isLead = index === 0
    const resolveMemberId = index === 0 ? runtime.id : memberId
    if (!resolveMemberId) {
      return []
    }

    const member = getResonator(resolveMemberId)
    const memRt = resolveMemberId === runtime.id ? runtime : partRntmById[resolveMemberId] ?? null
    if (!member || !memRt) {
      return []
    }

    const weaponId = memRt.build.weapon.id
    const weaponDef = !isNoWeaponId(weaponId) ? getWeapon(weaponId) : null
    const weaponParams = weaponDef ? resPssvPrms(weaponDef.passive.params, memRt.build.weapon.rank) : []
    const ncldTeamWide = resolveMemberId !== runtime.id
    const resStts = fltrSrcSttsW(
      listStatesFor('resonator', resolveMemberId),
      (state) =>
        sttHasTeamFc(state, {
          ncldTeamWide: ncldTeamWide,
        }),
      (state) => isSourceVisible(memRt, runtime, state),
    )
    const weaponStates = !isNoWeaponId(weaponId)
      ? fltrSrcSttsW(
          listStatesFor('weapon', weaponId),
          (state) =>
            sttHasTeamFc(state, {
              ncldTeamWide: ncldTeamWide,
            }),
          (state) => isSourceVisible(memRt, runtime, state),
        )
      : []
    const wpnSttKeys = new Set(weaponStates.map((s) => s.controlKey))
    const sttDefs = [...resStts, ...weaponStates]

    return [
      (
        <Expandable
          key={`team-state-${resolveMemberId}-${index}`}
          as="article"
          className="team-state-card ui-surface-card ui-surface-card--section"
          triggerClass="team-state-expandable-trigger"
          contentClass="team-state-expandable"
          innerClass="team-state-controls"
          chevronClass="team-state-chevron"
          chevronSize={16}
          defaultOpen={false}
          header={
            <div className="team-state-card-head">
              <div className="team-state-source">
                <span className="team-state-source-frame">
                  <img
                    src={member.profile}
                    alt={member.name}
                    className="team-state-source-image"
                    loading="lazy"
                    decoding="async"
                    onError={withDefResMg}
                  />
                </span>
                <div className="team-state-source-copy">
                  <span>{index === 0 ? 'Active Resonator' : `Teammate ${index}`}</span>
                  <strong>{member.name}</strong>
                </div>
              </div>
              <div className="team-state-head-controls">
                {!isLead ? (
                  <span
                    role="button"
                    tabIndex={0}
                    className="team-state-badge config"
                    onClick={(event) => {
                      event.stopPropagation()
                      openCnfgMdl(resolveMemberId)
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        event.stopPropagation()
                        openCnfgMdl(resolveMemberId)
                      }
                    }}
                    aria-label={`Configure ${member.name}`}
                  >
                    <Wrench size={15} />
                  </span>
                ) : null}
                <span className="team-state-badge">
                  {sttDefs.length} {sttDefs.length === 1 ? 'state' : 'states'}
                </span>
              </div>
            </div>
          }
        >
          {sttDefs.length === 0 ? (
            <p className="team-state-empty">No Teammate Buffs</p>
          ) : sttDefs.map((state) => {
            const targetMode = getStateTeamTag(state)
            const teamTgtSel = targetMode ? (() => {
              const options = getTeamTgtPt(runtime, resolveMemberId, targetMode)
              const currentValue = profilesById[runtime.id]?.runtime.routing.selectedTargetsByOwnerKey[state.ownerKey] ?? null
              const fllbVl = options[0]?.value ?? ''
              const selVl = typeof currentValue === 'string' && options.some((option) => option.value === currentValue)
                ? currentValue
                : fllbVl

              return (
                <label className="team-state-target">
                  Active Resonator
                  <LiquidSelect
                    value={selVl}
                    options={options}
                    disabled={options.length <= 1}
                    onChange={(nextValue) =>
                      setTargetRes(
                        resolveMemberId,
                        state.ownerKey,
                        nextValue || null,
                      )
                    }
                  />
                </label>
              )
            })() : undefined

                  const isWpnStt = wpnSttKeys.has(state.controlKey)

                  return (
                    <div key={state.controlKey} className="team-state-control">
                      {isWpnStt && weaponDef ? (
                        <div className="team-state-weapon-header">
                          <img
                            src={weaponDef.icon}
                            alt={weaponDef.name}
                            className="team-state-weapon-icon"
                            loading="lazy"
                            decoding="async"
                            onError={withDefWpnMg}
                          />
                          <span className="team-state-weapon-name">{weaponDef.passive.name || 'Passive'}</span>
                        </div>
                      ) : null}
                      <SourceStateCtrl
                        srcRt={memRt}
                        tgtRt={memRt}
                        state={state}
                        onRtPdt={
                          isLead
                            ? onRtPdt
                            : (updater) => updResRt(resolveMemberId, updater)
                        }
                        teamTgtSlct={teamTgtSel}
                        dscrPrms={isWpnStt ? weaponParams : undefined}
                      />
                    </div>
                  )
                })}
        </Expandable>
      ),
    ]
  })

  return (
    <section className="calc-pane teams-pane">
      <div>
        <div className="panel-overline">Simulation</div>
        <h3>Team Setup</h3>
      </div>
      <div className="teams pane-section">
        <h4>Team Slots</h4>
        <div className="team-slot-deck">
          {runtime.build.team.map((memberId, index) => {
            const isLead = index === 0
            const resolveMemberId = isLead ? runtime.id : memberId
            const member = resolveMemberId ? getResonator(resolveMemberId) : null
            const slotRarity = member?.rarity ?? 1
            const slotLabel = isLead ? 'Active Resonator' : `Teammate ${index}`
            const slotStatus = isLead ? 'Locked' : member ? 'Tap to replace' : 'Tap to assign'

            return (
              <article
                key={`team-slot-${index}`}
                className={`team-slot-card ui-surface-card ui-surface-card--section rarity-${slotRarity} ${isLead ? 'is-lead' : ''} ${member ? 'is-filled' : 'is-empty'}`}
              >
                {isLead ? (
                  <div className={`team-slot-trigger team-slot-trigger--static picker-modal__media-frame rarity-${slotRarity}`} aria-hidden="true">
                    <img
                      src={member?.profile ?? '/assets/default.webp'}
                      alt=""
                      className="picker-modal__media-image"
                      onError={withDefResMg}
                    />
                  </div>
                ) : (
                  <button
                    type="button"
                    className={`team-slot-trigger picker-modal__media-frame rarity-${slotRarity}`}
                    onClick={() => openTeamPckr(index)}
                  >
                    {member ? (
                      <img
                        src={member.profile}
                        alt={member.name}
                        className="picker-modal__media-image"
                        onError={withDefResMg}
                      />
                    ) : (
                      <span className="team-slot-placeholder">+</span>
                    )}
                  </button>
                )}
                {!isLead && member ? (
                  <button
                    type="button"
                    className="team-slot-remove"
                    aria-label={`Remove ${member.name}`}
                    onClick={(event) => {
                      event.stopPropagation()
                      selTeamMem(index, null)
                    }}
                  >
                    <X size={14} />
                  </button>
                ) : null}

                <div className="team-slot-copy">
                  <div className="team-slot-label-row">
                    <span className="team-slot-label">{slotLabel}</span>
                  </div>
                  <strong className="team-slot-name">{member?.name ?? 'Empty Slot'}</strong>
                  <span className="team-slot-status">{slotStatus}</span>
                </div>
              </article>
            )
          })}
        </div>
      </div>

      <div className="pane-section">
        <h4>Team States</h4>
        <div className="team-state-grid">
          {teamSttCrds.length > 0 ? (
            teamSttCrds
          ) : (
            <article className="team-state-card team-state-card--empty soft-empty">
              No team-facing states available.
            </article>
          )}
        </div>
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
          description="Occupied team members are hidden so every slot stays unique."
          resonators={lgblTeamPckr}
          selResId={teamPickerSlot === null ? null : runtime.build.team[teamPickerSlot] ?? null}
          selLbl="Selected"
          smmrPrmr={{
            label: 'Slot',
            value: actSlotLbl,
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
    </section>
  )
}
