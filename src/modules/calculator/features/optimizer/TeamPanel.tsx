/*
  Author: Runor Ewhro
  Description: Renders the team panel surface for the calculator optimizer flow.
*/

import { useCallback, useMemo } from 'react'
import { isNoWeaponId, type ResRuntime, type TeamMemRt } from '@/domain/entities/runtime'
import { MAX_RES_LVL, makeTeamMember } from '@/domain/state/defaults'
import { matTeamMemFr } from '@/domain/state/runtimeMaterialization'
import type { EchoDef } from '@/domain/entities/catalog'
import { getSntSetIco } from '@/data/gameData/catalog/sonataSets'
import { getEchoSetCn, getEchoSetDe, type SetDef } from '@/data/gameData/echoSets/effects'
import { LiquidSelect } from '@/shared/ui/LiquidSelect'
import { StepScrubber } from '@/shared/ui/StepScrubber'
import { NumberInput } from '@/modules/calculator/features/controls/NumberInput'
import type { SrcOwnScp, SourceState } from '@/domain/gameData/contracts'
import { getResSeedBy } from '@/domain/services/resonatorSeedService'
import { listStatesFor, getOwnForKey } from '@/domain/services/gameDataService'
import { getMainEchoS } from '@/domain/services/runtimeSourceService'
import type { RtUpdHnd } from '@/modules/calculator/features/controls/lib/runtimeStateUtils.ts'
import {
  fltrSrcSttsW,
  getSttFfctTg,
  isSrcSttOn,
  setSourceState,
} from '@/modules/calculator/features/controls/lib/runtimeStateUtils.ts'
import { countEchoSets } from '@/engine/pipeline/buildCombatContext'
import { getEchoById } from '@/domain/services/echoCatalogService'
import { evalSourceState } from '@/modules/calculator/model/sourceEval.ts'
import { getStateText } from '@/modules/calculator/model/sourceStateDisplay'
import { getResonator } from '@/modules/calculator/features/resonator/lib/resonator.ts'
import { getWeapon, withDefWpnMg, weaponStatsAt } from '@/modules/calculator/features/weapons/lib/weapon.ts'
import { RichDscr } from '@/shared/ui/RichDescription'
import { withDefEchoMg, withDefIconM, withDefResMg } from '@/shared/lib/imageFallback.ts'
import type { OptSetChoice } from '@/domain/entities/optimizer'
import type { RandGnrtSetP } from '@/domain/entities/suggestions'
import { getRandSetCn } from '@/modules/calculator/features/suggesstions/lib/suggestions.ts'
import { mkMateCntr, teamRuntime } from './lib/teamRuntime.ts'
import { viewRtStt } from './renderRuntimeState'
import { AllowedSets } from './AllowedSets.tsx'

const SCOPE_LABELS: Record<SrcOwnScp, string> = {
  resonator: 'State',
  weapon: 'Weapon',
  echo: 'Echo',
  team: 'Team',
  sequence: 'Sequence',
  inherent: 'Inherent',
}

interface StateGroup {
  scopeKey: string
  label: string
  states: ReturnType<typeof listStatesFor>
}

interface OptTeamPnlPr {
  rarity: number
  displayName: string
  optRt: ResRuntime | null
  invalidMainIds: [string | null, string | null]
  mateSetPrefs: [RandGnrtSetP[], RandGnrtSetP[]]
  onRtPdt: RtUpdHnd
  onOpenMate: (slotIndex: 0 | 1) => void
  onOpenWeapon: (slot: 'active' | 0 | 1) => void
  onOpenMateMenu: (slotIndex: 0 | 1) => void
  onAddMateSet: (slotIndex: 0 | 1, setId: number) => void
  onRemoveMateSet: (slotIndex: 0 | 1, setId: number) => void
  onSetMateCount: (slotIndex: 0 | 1, setId: number, count: number) => void
  onRemoveMate: (slotIndex: 0 | 1) => void
  onClearMainEcho: (slotIndex: 0 | 1) => void
}

interface OptCardProps {
  slotLabel: string
  rarity: number
  displayName: string
  profileSrc?: string
  runtime: ResRuntime
  actRt: ResRuntime
  onRtPdt: RtUpdHnd
  editableLevel: boolean
  onPortraitClick?: (() => void) | undefined
  onRemoveChar?: (() => void) | undefined
  onWpnClck: (() => void) | undefined
  invalidMainEcho?: EchoDef | null
  onMainEchoClick?: (() => void) | undefined
  onClearMainEcho?: (() => void) | undefined
  setPrefs?: RandGnrtSetP[] | undefined
  setPrefSlot?: (0 | 1) | undefined
  onAddSetPref?: ((slotIndex: 0 | 1, setId: number) => void) | undefined
  onRmvSetPref?: ((slotIndex: 0 | 1, setId: number) => void) | undefined
  onSetPrefCnt?: ((slotIndex: 0 | 1, setId: number, count: number) => void) | undefined
}

interface MateCardProps {
  slotIndex: 0 | 1
  memberId: string
  invalidMainId: string | null
  setPrefs: RandGnrtSetP[]
  actRt: ResRuntime
  onRtPdt: RtUpdHnd
  onOpenMate: (slotIndex: 0 | 1) => void
  onOpenWeapon: (slot: 'active' | 0 | 1) => void
  onOpenMainEcho: (slotIndex: 0 | 1) => void
  onAddSetPref: (slotIndex: 0 | 1, setId: number) => void
  onRmvSetPref: (slotIndex: 0 | 1, setId: number) => void
  onSetPrefCnt: (slotIndex: 0 | 1, setId: number, count: number) => void
  onRemoveMate: (slotIndex: 0 | 1) => void
  onClearMainEcho: (slotIndex: 0 | 1) => void
}

type PnlTgtScp = 'self' | 'active' | 'activeOther' | 'teamWide' | 'otherTeammates'

const ACTCARDTGTSC: readonly PnlTgtScp[] = ['self', 'active', 'teamWide']
const MATECARDTGTS: readonly PnlTgtScp[] = [
  'active',
  'activeOther',
  'teamWide',
  'otherTeammates',
]

interface CardSttGrps {
  resonator: StateGroup[]
  weapon: StateGroup[]
}

function groupStates(states: SourceState[], fllbScp: 'resonator' | 'weapon'): StateGroup[] {
  const byScope = new Map<string, SourceState[]>()

  // source state ownership can point at resonator, weapon, echo, team, or sequence scopes; grouping here keeps
  // the card renderer from needing to know which catalog produced a control.
  for (const state of states) {
    const scope = getOwnForKey(state.ownerKey)?.scope ?? fllbScp
    const bucket = byScope.get(scope) ?? []
    bucket.push(state)
    byScope.set(scope, bucket)
  }

  return Array.from(byScope.entries()).map(([scope, states]) => ({
    scopeKey: scope,
    label: SCOPE_LABELS[scope as SrcOwnScp] ?? scope,
    states,
  }))
}

function fltrSttsForC(
  states: SourceState[],
  runtime: ResRuntime,
  actRt: ResRuntime,
  allowedScopes: readonly PnlTgtScp[],
): SourceState[] {
  // optimizer cards only expose states that can affect the member represented by that card; visibility is still
  // evaluated against the live active runtime so team buffs can hide controls when their prerequisites are missing.
  return fltrSrcSttsW(
    states,
    (state) => getSttFfctTg(state).some((scope) => allowedScopes.includes(scope)),
    (state) => evalSourceState(runtime, runtime, state, actRt),
  )
}

function mkCardSttGrp(
  runtime: ResRuntime,
  actRt: ResRuntime,
  allowedScopes: readonly PnlTgtScp[],
): CardSttGrps {
  // resonator and weapon controls come from different registries, then pass
  // through the same target-scope and dependency filters.
  const allResStts = listStatesFor('resonator', runtime.id)
  const resStts = fltrSttsForC(allResStts, runtime, actRt, allowedScopes)
  const weaponId = runtime.build.weapon.id
  const allWpnStts = weaponId && !isNoWeaponId(weaponId)
    ? listStatesFor('weapon', weaponId)
    : []
  const weaponStates = fltrSttsForC(allWpnStts, runtime, actRt, allowedScopes)

  return {
    resonator: groupStates(
      resStts,
      'resonator',
    ),
    weapon: groupStates(
      weaponStates,
      'weapon',
    ),
  }
}

function OptMainEchoC({
  runtime,
  actRt: actRt,
  allowedScopes: allowedScopes,
  onRtPdt: onRtPdt,
  invalidMainEcho: invalidMainEcho = null,
  onMainEchoClick: onMainEchoCl,
  onClearMainEcho: onClearMainEcho,
  showEmptyState: showEmptyState = false,
}: {
  runtime: ResRuntime
  actRt: ResRuntime
  allowedScopes: readonly PnlTgtScp[]
  onRtPdt: RtUpdHnd
  invalidMainEcho?: EchoDef | null
  onMainEchoClick?: (() => void) | undefined
  onClearMainEcho?: (() => void) | undefined
  showEmptyState?: boolean
}) {
  const mainEcho = runtime.build.echoes[0]
  const rtMainEchoDe = useMemo(
    () => (mainEcho ? getEchoById(mainEcho.id) : null),
    [mainEcho],
  )
  // an invalid echo definition means the saved teammate plan references an echo that no longer satisfies the current
  // optimizer constraints; keep showing it so the user understands what must be fixed.
  const mainEchoDef = invalidMainEcho ?? rtMainEchoDe
  const hasNvldMainE = invalidMainEcho != null
  const mainEchoSrc = useMemo(() => getMainEchoS(runtime), [runtime])
  const mainEchoStats = useMemo(() => {
    if (!mainEchoSrc) {
      return []
    }

    return fltrSttsForC(
      listStatesFor(mainEchoSrc.type, mainEchoSrc.id),
      runtime,
      actRt,
      allowedScopes,
    )
  }, [actRt, allowedScopes, mainEchoSrc, runtime])

  if (!mainEchoDef) {
    if (!showEmptyState) {
      return null
    }

    return (
      <div className="opt-team__echo-block">
        <button
          type="button"
          className="opt-team__set-card opt-team__set-card--empty opt-team__set-card--button"
          onClick={onMainEchoCl}
          aria-label="Select teammate main echo"
        >
          <div className="opt-team__set-head">
            <div className="opt-team__set-icon-wrap opt-team__set-icon-wrap--empty">
              <span className="opt-team__set-empty-plus">+</span>
            </div>
            <div className="opt-team__set-copy">
              <strong className="co-weapon-card__name">Main Echo</strong>
              <span className="opt-team__set-count">No Main Echo</span>
            </div>
          </div>
        </button>
      </div>
    )
  }

  return (
    <div className="opt-team__echo-block">
      <div className={`opt-team__set-card${hasNvldMainE ? ' opt-team__set-card--invalid' : ''}`}>
        <div className="opt-team__set-head">
          {onMainEchoCl ? (
            <button
              type="button"
              className={`opt-team__set-icon-wrap opt-team__set-icon-wrap--button${hasNvldMainE ? ' opt-team__set-icon-wrap--invalid' : ''}`}
              onClick={onMainEchoCl}
              aria-label={`Select ${runtime.id} main echo`}
            >
              <img
                src={mainEchoDef.icon ?? '/assets/echo-icons/default.webp'}
                alt={mainEchoDef.name}
                className={`opt-team__set-icon${hasNvldMainE ? ' opt-team__set-icon--invalid' : ''}`}
                loading="lazy"
                onError={withDefEchoMg}
              />
            </button>
          ) : (
            <div className="opt-team__set-icon-wrap">
              <img
                src={mainEchoDef.icon ?? '/assets/echo-icons/default.webp'}
                alt={mainEchoDef.name}
                className="opt-team__set-icon"
                loading="lazy"
                onError={withDefEchoMg}
              />
            </div>
          )}
          <div className="opt-team__set-copy">
            <strong className="co-weapon-card__name">{mainEchoDef.name}</strong>
            <span className="opt-team__set-count">
              {hasNvldMainE ? 'Invalid' : mainEchoStats.length > 0 ? 'Main Echo' : 'Active'}
            </span>
          </div>
          {onClearMainEcho ? (
            <button
              type="button"
              className="opt-team__remove-btn"
              onClick={onClearMainEcho}
              aria-label="Remove main echo"
            >
              ×
            </button>
          ) : null}
        </div>

        {hasNvldMainE ? (
          <span className="opt-team__set-warning">Does not match the current set plan.</span>
        ) : null}

        {!hasNvldMainE && mainEchoStats.length > 0 ? (
          <div className="co-runtime-states">
            {mainEchoStats.map((state) =>
              viewRtStt(runtime, state, onRtPdt, {
                srcRt: runtime,
                tgtRt: runtime,
                actRt: actRt,
              }),
            )}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function mkSetSelForC(setId: number): OptSetChoice {
  // one-piece sets are authored in the 1pc bucket; three-piece sets use 3pc;
  // all normal two/five-piece sets use the 5pc selector.
  const setMax = getEchoSetDe(setId)?.setMax
  if (setMax === 1) {
    return { 1: [setId], 3: [], 5: [] }
  }
  if (setMax === 3) {
    return { 1: [], 3: [setId], 5: [] }
  }

  return { 1: [], 3: [], 5: [setId] }
}

function mkSetSelForP(
  preferences: RandGnrtSetP[],
): OptSetChoice {
  return {
    1: preferences
      .filter((entry) => getEchoSetDe(entry.setId)?.setMax === 1)
      .map((entry) => entry.setId),
    3: preferences
      .filter((entry) => getEchoSetDe(entry.setId)?.setMax === 3)
      .map((entry) => entry.setId),
    5: preferences
      .filter((entry) => {
        const setMax = getEchoSetDe(entry.setId)?.setMax
        return setMax !== 1 && setMax !== 3
      })
      .map((entry) => entry.setId),
  }
}

function OptEchoSetCard({
  runtime,
  actRt: actRt,
  allowedScopes: allowedScopes,
  onRtPdt: onRtPdt,
  configurable = false,
  setPrefs: setPrefsList,
  setPrefSlot: setPrefSlot,
  onAddSetPref: onAddSetPref,
  onRmvSetPref: onRmvSetPref,
  onSetPrefCnt: onSetPrefCnt,
  showEmptyState: showEmptyState = false,
}: {
  runtime: ResRuntime
  actRt: ResRuntime
  allowedScopes: readonly PnlTgtScp[]
  onRtPdt: RtUpdHnd
  configurable?: boolean
  setPrefs?: RandGnrtSetP[] | undefined
  setPrefSlot?: (0 | 1) | undefined
  onAddSetPref?: ((slotIndex: 0 | 1, setId: number) => void) | undefined
  onRmvSetPref?: ((slotIndex: 0 | 1, setId: number) => void) | undefined
  onSetPrefCnt?: ((slotIndex: 0 | 1, setId: number, count: number) => void) | undefined
  showEmptyState?: boolean
}) {
  const resolvedSets = useMemo(
    () => setPrefsList ?? [],
    [setPrefsList],
  )

  // configurable teammate cards show the desired set plan rather than the actual equipped counts, while the active
  // card derives set effects from the current echo loadout.
  const activeSets = useMemo(() => {
    if (configurable) {
      return resolvedSets.map((entry) => ({
        setId: entry.setId,
        count: entry.count,
      }))
    }

    return Object.entries(countEchoSets(runtime.build.echoes))
      .map(([setId, count]) => ({ setId: Number(setId), count }))
      .filter(({ setId, count }) => {
        const def = getEchoSetDe(setId)
        if (!def) {
          return false
        }

        const minReq = def.setMax === 1 ? 1 : def.setMax === 3 ? 3 : 2
        return count >= minReq
      })
      .reverse()
  }, [configurable, resolvedSets, runtime.build.echoes])

  const ttlSelPcs = resolvedSets.reduce((sum, entry) => sum + entry.count, 0)
  // teammate set preferences represent the four non-main echo slots, so adding
  // is capped by available piece count and the two preference slots.
  const canAddSetPre = Boolean(
    configurable
    && setPrefSlot !== undefined
    && onAddSetPref
    && ttlSelPcs < 4
    && resolvedSets.length < 2
  )
  const selIdsByPc = useMemo(
    () => mkSetSelForP(resolvedSets),
    [resolvedSets],
  )

  if (activeSets.length === 0) {
    if (!showEmptyState) {
      return null
    }

    return (
      <div className="opt-team__set-grid">
        <AllowedSets
          selIdsByPc={selIdsByPc}
          onChange={(nextSelIdsBy) => {
            if (
              !configurable ||
              setPrefSlot === undefined ||
              !onAddSetPref ||
              !onRmvSetPref
            ) {
              return
            }

            const nextSetIds = new Set([
              ...nextSelIdsBy[3],
              ...nextSelIdsBy[5],
            ])
            for (const entry of resolvedSets) {
              if (!nextSetIds.has(entry.setId)) {
                onRmvSetPref(setPrefSlot, entry.setId)
              }
            }
            for (const setId of nextSetIds) {
              if (!resolvedSets.some((entry) => entry.setId === setId)) {
                onAddSetPref(setPrefSlot, setId)
              }
            }
          }}
          resetLabel="Any Set"
          resetMeta="No active set focus"
          triggerClass="co-set-dropdown__trigger--card"
          viewTrggCntn={() => (
            <div className="opt-team__set-card opt-team__set-card--empty">
              <div className="opt-team__set-head">
                <div className="opt-team__set-icon-wrap opt-team__set-icon-wrap--empty">
                  <span className="opt-team__set-empty-plus">+</span>
                </div>
                <div className="opt-team__set-copy">
                  <strong className="co-weapon-card__name">Set Effects</strong>
                  <span className="opt-team__set-count">No Active Set</span>
                </div>
              </div>
            </div>
          )}
        />
      </div>
    )
  }

  return (
    <div className="opt-team__set-grid">
      {activeSets.map(({ setId, count }) => {
        const def = getEchoSetDe(setId)
        if (!def) {
          return null
        }

        const icon = getSntSetIco(setId)
        const setStates = fltrSttsForC(
          listStatesFor('echoSet', String(setId)),
          runtime,
          actRt,
          allowedScopes,
        )
        // passive text is shown as soon as its piece threshold is met; interactive set states are only shown when the
        // full set requirement is satisfied and the game-data state exists.
        const pieceReq = def.setMax === 1 ? 1 : def.setMax === 3 ? 3 : 5
        const hasPieceReq = count >= pieceReq
        const passiveParts = def.parts.filter((part) => {
          const isPassive = part.key === 'onePiece' || part.key === 'twoPiece' || part.key === 'fivePiece' || part.key === 'threePiece'
          if (!isPassive) {
            return false
          }
          if (part.key === 'onePiece') {
            return count >= 1
          }
          if (part.key === 'twoPiece') {
            return count >= 2
          }
          return count >= pieceReq
        })
        const stateEntries = def.parts
          .filter((part) => {
            const isPassive = part.key === 'onePiece' || part.key === 'twoPiece' || part.key === 'fivePiece' || part.key === 'threePiece'
            return !isPassive && hasPieceReq
          })
          .map((part) => setStates.find((state) => state.id === part.key))
          .filter((state): state is SourceState => Boolean(state))

        return (
          <div key={`set-${setId}`} className="opt-team__set-card">
            <div className="opt-team__set-head">
              {configurable ? (
                <AllowedSets
                  selIdsByPc={mkSetSelForC(setId)}
                  onChange={(nextSelIdsBy) => {
                    if (
                      !configurable ||
                      setPrefSlot === undefined ||
                      !onAddSetPref ||
                      !onRmvSetPref
                    ) {
                      return
                    }

                    const nextSetIds = new Set([
                      ...nextSelIdsBy[3],
                      ...nextSelIdsBy[5],
                    ])
                    const stllSel = nextSetIds.has(setId)
                    if (!stllSel) {
                      onRmvSetPref(setPrefSlot, setId)
                      return
                    }

                    const rplcSetId = [...nextSetIds].find((id) => id !== setId) ?? setId
                    if (rplcSetId !== setId) {
                      onRmvSetPref(setPrefSlot, setId)
                      onAddSetPref(setPrefSlot, rplcSetId)
                    }
                  }}
                  resetLabel="Any Set"
                  resetMeta="No active set focus"
                  triggerClass="co-set-dropdown__trigger--icon"
                  viewTrggCntn={() => (
                    <div className="opt-team__set-icon-wrap">
                      {icon ? <img src={icon} alt={def.name} className="opt-team__set-icon" loading="lazy" onError={withDefIconM} /> : null}
                    </div>
                  )}
                />
              ) : (
                <div className="opt-team__set-icon-wrap">
                  {icon ? <img src={icon} alt={def.name} className="opt-team__set-icon" loading="lazy" onError={withDefIconM} /> : null}
                </div>
              )}
              <div className="opt-team__set-copy">
                <strong className="co-weapon-card__name">{def.name}</strong>
                <span className="opt-team__set-count">{count}/{pieceReq}</span>
              </div>
              <div className="opt-team__set-header-right">
                {configurable ? (
                  <div className="opt-team__set-piece-pills">
                    {getRandSetCn(setId).map((option) => (
                      <button
                        key={option}
                        type="button"
                        className={`opt-team__set-piece-pill${count === option ? ' is-active' : ''}`}
                        onClick={() => {
                          if (setPrefSlot === undefined || !onSetPrefCnt) {
                            return
                          }
                          onSetPrefCnt(setPrefSlot, setId, option)
                        }}
                      >
                        {option}pc
                      </button>
                    ))}
                  </div>
                ) : null}
                {configurable && onRmvSetPref && setPrefSlot !== undefined ? (
                  <button
                    type="button"
                    className="opt-team__remove-btn"
                    onClick={() => onRmvSetPref(setPrefSlot, setId)}
                    aria-label={`Remove ${def.name} set preference`}
                  >
                    ×
                  </button>
                ) : null}
              </div>
            </div>

            {passiveParts.length > 0 ? (
              <div className="opt-team__set-passives">
                {passiveParts.map((part) => (
                  <div key={part.key} className="opt-team__set-passive">
                    <span className="opt-team__set-passive-tag">
                      {part.key === 'onePiece' ? '1pc' : part.key === 'twoPiece' ? '2pc' : part.key === 'threePiece' ? '3pc' : '5pc'}
                    </span>
                    <RichDscr description={part.description ?? part.label} unstyled />
                  </div>
                ))}
              </div>
            ) : null}

            {stateEntries.length > 0 ? (
              <div className="co-runtime-states">
                {stateEntries.map((state) => (
                  <OptEchoSetSt
                    key={state.controlKey}
                    runtime={runtime}
                    actRt={actRt}
                    setDef={def}
                    sourceState={state}
                    onRtPdt={onRtPdt}
                  />
                ))}
              </div>
            ) : null}
          </div>
        )
      })}

      {canAddSetPre ? (
        <AllowedSets
          selIdsByPc={selIdsByPc}
          onChange={(nextSelIdsBy) => {
            if (
              setPrefSlot === undefined ||
              !configurable ||
              !onAddSetPref ||
              !onRmvSetPref
            ) {
              return
            }

            const nextSetIds = new Set([
              ...nextSelIdsBy[3],
              ...nextSelIdsBy[5],
            ])
            for (const entry of resolvedSets) {
              if (!nextSetIds.has(entry.setId)) {
                onRmvSetPref(setPrefSlot, entry.setId)
              }
            }
            for (const setId of nextSetIds) {
              if (!resolvedSets.some((entry) => entry.setId === setId)) {
                onAddSetPref(setPrefSlot, setId)
              }
            }
          }}
          resetLabel="Any Set"
          resetMeta="No active set focus"
          triggerClass="co-set-dropdown__trigger--card"
          viewTrggCntn={() => (
            <div className="opt-team__set-card opt-team__set-card--empty">
              <div className="opt-team__set-head">
                <div className="opt-team__set-icon-wrap opt-team__set-icon-wrap--empty">
                  <span className="opt-team__set-empty-plus">+</span>
                </div>
                <div className="opt-team__set-copy">
                  <strong className="co-weapon-card__name">Set Effects</strong>
                  <span className="opt-team__set-count">Add Set</span>
                </div>
              </div>
            </div>
          )}
        />
      ) : null}
    </div>
  )
}

function OptEchoSetSt({
  runtime,
  actRt: actRt,
  setDef,
  sourceState,
  onRtPdt: onRtPdt,
}: {
  runtime: ResRuntime
  actRt: ResRuntime
  setDef: SetDef
  sourceState: SourceState
  onRtPdt: RtUpdHnd
}) {
  const stateEntry = setDef.states[sourceState.id]
  if (!stateEntry) {
    return null
  }

  const currentValue = runtime.state?.controls?.[getEchoSetCn(setDef.id, sourceState.id)]
  const isEnabled = isSrcSttOn(runtime, runtime, sourceState, actRt)
  const display = getStateText(sourceState)
  const perStep = stateEntry.perStep ?? []
  const perStack = stateEntry.perStack ?? []
  const stckLikeEnts = perStep.length > 0 ? perStep : (perStack.length > 0 ? perStack : stateEntry.max)
  // some set states are encoded with a stack shape even though every stack has the same value; render those as a
  // boolean toggle so the optimizer surface matches the real amount of user choice.
  const isToggle = stckLikeEnts.every((entry, index) => entry.value === stateEntry.max[index].value)

  if (isToggle) {
    const checked = typeof currentValue === 'boolean' ? currentValue : Boolean(currentValue)

    return (
      <div
        className={`co-runtime-state${checked ? ' is-active' : ''}${!isEnabled ? ' is-disabled' : ''}`}
      >
        <span className="co-runtime-state__label">{display.label}</span>
        <label className="co-runtime-state__toggle">
          <input
            type="checkbox"
            checked={checked}
            disabled={!isEnabled}
            onChange={(event) => {
              setSourceState(onRtPdt, runtime, runtime, sourceState, event.target.checked, actRt)
            }}
          />
          <span className="co-runtime-state__switch" />
        </label>
      </div>
    )
  }

  if (perStep.length > 0) {
    const min = Math.max(0, Math.floor(sourceState.min ?? 0))
    const max = Math.round(
      Math.max(...perStep.map((entry, index) => stateEntry.max[index].value / entry.value)),
    )
    const stepValue = typeof currentValue === 'number' && Number.isFinite(currentValue)
      ? currentValue
      : min

    return (
      <div
        className={`co-runtime-state co-runtime-state--step${stepValue > min ? ' is-active' : ''}${!isEnabled ? ' is-disabled' : ''}`}
      >
        <div className="co-runtime-state__step-header">
          <span className="co-runtime-state__label">{display.label}</span>
          <div className="co-runtime-state__step-count">
            <input
              type="number"
              className="co-runtime-state__step-count-input"
              value={stepValue}
              min={min}
              max={max}
              disabled={!isEnabled}
              onChange={(e) => {
                const parsed = parseInt(e.target.value, 10)
                if (!isNaN(parsed)) {
                  setSourceState(onRtPdt, runtime, runtime, sourceState, Math.min(max, Math.max(min, parsed)), actRt)
                }
              }}
            />
            <span className="co-runtime-state__step-max">/{max}</span>
          </div>
        </div>
        <StepScrubber
          min={min}
          max={max}
          value={stepValue}
          disabled={!isEnabled}
          onChange={(v) =>
            setSourceState(onRtPdt, runtime, runtime, sourceState, v, actRt)
          }
        />
      </div>
    )
  }

  const min = Math.max(0, Math.floor(sourceState.min ?? 0))
  const max = Math.round(
    Math.max(...stckLikeEnts.map((entry, index) => stateEntry.max[index].value / entry.value)),
  )
  const stackValue = typeof currentValue === 'number' && Number.isFinite(currentValue)
    ? currentValue
    : min

  return (
    <div
      className={`co-runtime-state${stackValue > min ? ' is-active' : ''}${!isEnabled ? ' is-disabled' : ''}`}
    >
      <span className="co-runtime-state__label">{display.label}</span>
      <div className="co-runtime-state__stack">
        {Array.from({ length: max - min + 1 }, (_, offset) => {
          const value = min + offset
          return (
            <button
              key={value}
              type="button"
              className={`co-runtime-state__stack-btn${value === stackValue ? ' is-active' : ''}`}
              disabled={!isEnabled}
              onClick={() => {
                setSourceState(onRtPdt, runtime, runtime, sourceState, value, actRt)
              }}
            >
              {value}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function OptRtCard({
  slotLabel,
  rarity,
  displayName,
  profileSrc,
  runtime,
  actRt: actRt,
  onRtPdt: onRtPdt,
  editableLevel: editableLevel,
  onPortraitClick: onPortraitClick,
  onRemoveChar: onRemoveChar,
  onWpnClck: onWpnClck,
  invalidMainEcho: invalidMainEcho,
  onMainEchoClick: onMainEchoCl,
  onClearMainEcho: onClearMainEcho,
  setPrefs: setPrefsList,
  setPrefSlot: setPrefSlot,
  onAddSetPref: onAddSetPref,
  onRmvSetPref: onRmvSetPref,
  onSetPrefCnt: onSetPrefCnt,
}: OptCardProps) {
  const allowedScopes = editableLevel ? ACTCARDTGTSC : MATECARDTGTS
  const level = editableLevel ? runtime.base.level : MAX_RES_LVL
  const sequence = runtime.base.sequence ?? 0
  const weaponId = runtime.build.weapon.id ?? null
  const sqncPtns = useMemo(
    () => Array.from({ length: 7 }, (_, i) => ({ value: i, label: `S${i}` })),
    [],
  )
  const rankOptions = useMemo(
    () => Array.from({ length: 5 }, (_, i) => ({ value: i + 1, label: `R${i + 1}` })),
    [],
  )
  const weaponLevel = runtime.build.weapon.level
  const weaponRank = runtime.build.weapon.rank
  const weaponDef = useMemo(
    () => (weaponId && !isNoWeaponId(weaponId) ? getWeapon(weaponId) : null),
    [weaponId],
  )

  const stateGroups = useMemo(
    () => mkCardSttGrp(runtime, actRt, allowedScopes),
    [actRt, allowedScopes, runtime],
  )
  const resSttGrps = stateGroups.resonator
  const wpnSttGrps = stateGroups.weapon

  return (
    <article className={`opt-team__card${editableLevel ? ' opt-team__card--active' : ''}`}>
      <div className="opt-team__portrait-row">
        {onPortraitClick ? (
          <button
            type="button"
            className={`opt-team__thumb-ring opt-team__thumb-ring--button rarity-${rarity}`}
            onClick={onPortraitClick}
            aria-label={`Change ${slotLabel.toLowerCase()}`}
          >
            <img src={profileSrc} alt={displayName} className="opt-team__thumb" loading="eager" onError={withDefResMg} />
          </button>
        ) : (
          <div className={`opt-team__thumb-ring rarity-${rarity}`}>
            <img src={profileSrc} alt={displayName} className="opt-team__thumb" loading="eager" onError={withDefResMg} />
          </div>
        )}
        <div className="opt-team__identity">
          <div className="opt-team__identity-header">
            <span className="opt-team__slot-label">{slotLabel}</span>
            {onRemoveChar ? (
              <button
                type="button"
                className="opt-team__remove-btn"
                onClick={onRemoveChar}
                aria-label={`Remove ${displayName} from team`}
              >
                ×
              </button>
            ) : null}
          </div>
          <span className="opt-team__name">{displayName}</span>
          <div className="opt-team__inline-fields">
            <div className="co-topbar-field">
              <span className="co-topbar-field__label">Lv</span>
              {editableLevel ? (
                <div className="co-topbar-input">
                  <NumberInput
                    value={level}
                    min={1}
                    max={90}
                    step={1}
                    onChange={(value) => {
                      onRtPdt((prev) => ({
                        ...prev,
                        base: {
                          ...prev.base,
                          level: Math.max(1, Math.min(90, Math.round(value))),
                        },
                      }))
                    }}
                  />
                </div>
              ) : (
                <span className="co-badge">{MAX_RES_LVL}</span>
              )}
            </div>
            <span className="co-bar__sep" />
            <div className="co-topbar-field">
              <span className="co-topbar-field__label">Sequence</span>
              <LiquidSelect
                value={sequence}
                options={sqncPtns}
                onChange={(value) => {
                  onRtPdt((prev) => ({
                    ...prev,
                    base: { ...prev.base, sequence: value },
                  }))
                }}
                baseClass="co-topbar-select"
                ariaLabel={`${displayName} sequence`}
                prfrPlcm="down"
              />
            </div>
          </div>
        </div>
      </div>

      {resSttGrps.length > 0 && (
        <div className="opt-team__state-groups">
          {resSttGrps.map((group) => (
            <div key={group.scopeKey} className="opt-team__state-group">
              <span className="opt-team__group-label">{group.label}</span>
              <div className="co-runtime-states">
                {group.states.map((state) =>
                  viewRtStt(runtime, state, onRtPdt, {
                    srcRt: runtime,
                    tgtRt: runtime,
                    actRt: actRt,
                  }),
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="opt-team__weapon">
        <span className="opt-team__group-label">Weapon</span>
        <div className="co-weapon-card">
          <button
            type="button"
            className="co-weapon-card__icon-wrap co-weapon-card__icon-wrap--button"
            onClick={onWpnClck}
            aria-label={`Change ${displayName} weapon`}
          >
            <img
              src={weaponDef?.icon ?? '/assets/weapon-icons/default.webp'}
              alt={weaponDef?.name ?? 'Weapon'}
              className="co-weapon-card__icon"
              loading="lazy"
              onError={withDefWpnMg}
            />
          </button>
          <div className="co-weapon-card__copy">
            <strong className="co-weapon-card__name">{weaponDef?.name ?? 'No Weapon'}</strong>
            <div className="opt-team__inline-fields">
              {editableLevel && (
                <>
                  <div className="co-topbar-field">
                    <span className="co-topbar-field__label">Lv</span>
                    <div className="co-topbar-input">
                      <NumberInput
                        value={weaponLevel}
                        min={1}
                        max={90}
                        step={1}
                        onChange={(value) => {
                          const nextLevel = Math.max(1, Math.min(90, Math.round(value)))
                          onRtPdt((prev) => {
                            const stats = weaponDef
                                ? weaponStatsAt(weaponDef, nextLevel)
                                : null
                            return {
                              ...prev,
                              build: {
                                ...prev.build,
                                weapon: {
                                  ...prev.build.weapon,
                                  level: nextLevel,
                                  ...(stats ? { baseAtk: stats.atk } : {}),
                                },
                              },
                            }
                          })
                        }}
                      />
                    </div>
                  </div>
                  <span className="co-bar__sep" />
                </>
              )}
              <div className="co-topbar-field">
                <span className="co-topbar-field__label">Rank</span>
                <LiquidSelect
                  value={weaponRank}
                  options={rankOptions}
                  onChange={(value) => {
                    onRtPdt((prev) => ({
                      ...prev,
                      build: {
                        ...prev.build,
                        weapon: { ...prev.build.weapon, rank: value },
                      },
                    }))
                  }}
                  baseClass="co-topbar-select"
                  ariaLabel={`${displayName} weapon rank`}
                  prfrPlcm="down"
                />
              </div>
            </div>
          </div>
        </div>

        {wpnSttGrps.length > 0 && (
          <div className="opt-team__state-groups">
            {wpnSttGrps.map((group) => (
              <div key={group.scopeKey} className="opt-team__state-group">
                <div className="co-runtime-states">
                  {group.states.map((state) =>
                    viewRtStt(runtime, state, onRtPdt, {
                      srcRt: runtime,
                      tgtRt: runtime,
                      actRt: actRt,
                    }),
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="opt-team__weapon">
        <span className="opt-team__group-label">{"Echoes"}</span>
        <OptMainEchoC
          runtime={runtime}
          actRt={actRt}
          allowedScopes={allowedScopes}
          onRtPdt={onRtPdt}
          invalidMainEcho={invalidMainEcho}
          onMainEchoClick={onMainEchoCl}
          onClearMainEcho={onClearMainEcho}
          showEmptyState={!editableLevel}
        />

        <OptEchoSetCard
          runtime={runtime}
          actRt={actRt}
          allowedScopes={allowedScopes}
          onRtPdt={onRtPdt}
          configurable={!editableLevel}
          setPrefs={setPrefsList}
          setPrefSlot={setPrefSlot}
          onAddSetPref={onAddSetPref}
          onRmvSetPref={onRmvSetPref}
          onSetPrefCnt={onSetPrefCnt}
          showEmptyState={!editableLevel}
        />
      </div>
    </article>
  )
}

function OptMateCard({
  slotIndex,
  memberId,
  invalidMainId: invalidMainId,
  setPrefs: setPrefsList,
  actRt: actRt,
  onRtPdt: onRtPdt,
  onOpenMate: onOpenMate,
  onOpenWeapon: onOpenWeapon,
  onOpenMainEcho: onOpenMainEcho,
  onAddSetPref: onAddSetPref,
  onRmvSetPref: onRmvSetPref,
  onSetPrefCnt: onSetPrefCnt,
  onRemoveMate: onRemoveMate,
  onClearMainEcho: onClearMainEcho,
}: MateCardProps) {
  const member = useMemo(() => getResonator(memberId), [memberId])
  const seed = useMemo(() => getResSeedBy(memberId), [memberId])
  const invalidMainEcho = useMemo(
    () => (invalidMainId ? getEchoById(invalidMainId) : null),
    [invalidMainId],
  )

  const mateRt = useMemo(() => {
    if (!seed) {
      return null
    }

    const compactRuntime = actRt.teamRuntimes[slotIndex]
    const resolvedRuntime = compactRuntime?.id === memberId
      ? compactRuntime
      : makeTeamMember(seed)

    return matTeamMemFr(
      seed,
      resolvedRuntime,
      actRt.state.controls,
      actRt.state.combat,
      actRt.build.team,
    )
  }, [actRt, memberId, seed, slotIndex])

  const updMateRt = useCallback<RtUpdHnd>((updater) => {
    onRtPdt((prev) => {
      const nextMemberId = prev.build.team[slotIndex + 1]
      if (!nextMemberId) {
        return prev
      }

      const nextSeed = getResSeedBy(nextMemberId)
      if (!nextSeed) {
        return prev
      }

      const currentRuntime = prev.teamRuntimes[slotIndex]
      const resolvedRuntime = currentRuntime?.id === nextMemberId
        ? currentRuntime
        : makeTeamMember(nextSeed)

      const materialRuntime = matTeamMemFr(
        nextSeed,
        resolvedRuntime,
        prev.state.controls,
        prev.state.combat,
        prev.build.team,
      )
      const nextRuntime = updater(materialRuntime)
      const nextTeamRuns = [...prev.teamRuntimes] as [TeamMemRt | null, TeamMemRt | null]
      nextTeamRuns[slotIndex] = teamRuntime(nextRuntime)

      const memberIdsClear = Array.from(
        new Set([currentRuntime?.id, nextMemberId].filter((value): value is string => Boolean(value))),
      )

      return {
        ...prev,
        state: {
          ...prev.state,
          controls: mkMateCntr(prev.state.controls, memberIdsClear, nextMemberId, nextRuntime),
        },
        teamRuntimes: nextTeamRuns,
      }
    })
  }, [onRtPdt, slotIndex])

  if (!member || !mateRt) {
    return (
      <article className="opt-team__card opt-team__card--empty">
        <span className="opt-team__slot-label">Teammate {slotIndex + 1}</span>
      </article>
    )
  }

  return (
    <OptRtCard
      slotLabel={`Teammate ${slotIndex + 1}`}
      rarity={member.rarity ?? 4}
      displayName={member.name}
      profileSrc={member.profile || `/assets/resonators/profiles/${memberId}.webp`}
      runtime={mateRt}
      actRt={actRt}
      onRtPdt={updMateRt}
      editableLevel={false}
      onPortraitClick={() => onOpenMate(slotIndex)}
      onRemoveChar={() => onRemoveMate(slotIndex)}
      onWpnClck={() => onOpenWeapon(slotIndex)}
      invalidMainEcho={invalidMainEcho}
      onMainEchoClick={() => onOpenMainEcho(slotIndex)}
      onClearMainEcho={() => onClearMainEcho(slotIndex)}
      setPrefs={setPrefsList}
      setPrefSlot={slotIndex}
      onAddSetPref={onAddSetPref}
      onRmvSetPref={onRmvSetPref}
      onSetPrefCnt={onSetPrefCnt}
    />
  )
}

export function TeamPanel({
  rarity,
  displayName,
  optRt: optRuntime,
  invalidMainIds: invalidMainEcho,
  mateSetPrefs: mateSetPrefs,
  onRtPdt: onRtPdt,
  onOpenMate: onOpenMate,
  onOpenWeapon: onOpenWeapon,
  onOpenMateMenu: onOpenTmmtMa,
  onAddMateSet: onAddTmmtSet,
  onRemoveMateSet: onRmvTmmtSet,
  onSetMateCount: onSetTmmtSet,
  onRemoveMate: onRemoveMate,
  onClearMainEcho: onRmvTmmtMai,
}: OptTeamPnlPr) {
  const profileSrc = optRuntime
    ? `/assets/resonators/profiles/${optRuntime.id}.webp`
    : undefined

  if (!optRuntime) {
    return null
  }

  return (
    <div className="opt-team">
      <div className="opt-team__grid">
        <OptRtCard
          slotLabel="Active Resonator"
          rarity={rarity}
          displayName={displayName}
          profileSrc={profileSrc}
          runtime={optRuntime}
          actRt={optRuntime}
          onRtPdt={onRtPdt}
          editableLevel
          onWpnClck={() => onOpenWeapon('active')}
        />

        {([0, 1] as const).map((slotIndex) => {
          const memberId = optRuntime.build.team[slotIndex + 1]

          if (!memberId) {
            return (
              <button
                key={slotIndex}
                type="button"
                className="opt-team__card opt-team__card--empty opt-team__card--empty-button"
                onClick={() => onOpenMate(slotIndex)}
                aria-label={`Select teammate ${slotIndex + 1}`}
              >
                <span className="opt-team__slot-label">Teammate {slotIndex + 1}</span>
                <span className="opt-team__empty-add">Add Teammate</span>
              </button>
            )
          }

          return (
            <OptMateCard
              key={`${slotIndex}-${memberId}`}
              slotIndex={slotIndex}
              memberId={memberId}
              invalidMainId={invalidMainEcho[slotIndex]}
              setPrefs={mateSetPrefs[slotIndex]}
              actRt={optRuntime}
              onRtPdt={onRtPdt}
              onOpenMate={onOpenMate}
              onOpenWeapon={onOpenWeapon}
              onOpenMainEcho={onOpenTmmtMa}
              onAddSetPref={onAddTmmtSet}
              onRmvSetPref={onRmvTmmtSet}
              onSetPrefCnt={onSetTmmtSet}
              onRemoveMate={onRemoveMate}
              onClearMainEcho={onRmvTmmtMai}
            />
          )
        })}
      </div>
    </div>
  )
}
