/*
  Author: Runor Ewhro
  Description: Renders the runtime panels surface for the calculator echoes flow.
*/

import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { getSntSetIco } from '@/data/gameData/catalog/sonataSets.ts'
import { getEchoSetDe } from '@/data/gameData/echoSets/effects.ts'
import type { ResRuntime } from '@/domain/entities/runtime.ts'
import { countEchoSets } from '@/engine/pipeline/buildCombatContext.ts'
import { getEchoById } from '@/domain/services/echoCatalogService.ts'
import { listStatesFor } from '@/domain/services/gameDataService.ts'
import { getMainEchoS } from '@/domain/services/runtimeSourceService.ts'
import { SourceStateCtrl } from '@/modules/calculator/features/controls/SourceStateControl.tsx'
import {
  getStateTeamTag,
  getTeamTgtPt,
} from '@/modules/calculator/features/controls/lib/runtimeStateUtils.ts'
import type { RtUpdHnd } from '@/modules/calculator/features/controls/lib/runtimeStateUtils.ts'
import { evalSourceState } from '@/modules/calculator/model/sourceEval.ts'
import { LiquidSelect } from '@/shared/ui/LiquidSelect.tsx'
import { withDefIconM } from '@/shared/lib/imageFallback'
import { RichDscr } from '@/shared/ui/RichDescription'

// groups the echo runtime panels and wires their source-state controls to the shared helpers.
function mkTeamTgtSel(props: {
  sttOwnKey: string
  srcRt: ResRuntime
  actRt: ResRuntime
  mode: 'active' | 'activeOther'
  getSelTgt?: (ownerKey: string) => string | null
  setSelTgt?: (ownerKey: string, tgtResId: string | null) => void
}): ReactNode {
  const {
    sttOwnKey: sttWnrKey,
    srcRt: srcRt,
    actRt: actRt,
    mode,
    getSelTgt: getSelTrgt,
    setSelTgt: setSelTrgt,
  } = props

  if (!getSelTrgt || !setSelTrgt) {
    return undefined
  }

  const options = getTeamTgtPt(actRt, srcRt.id, mode)
  const currentValue = getSelTrgt(sttWnrKey)
  const fllbVl = options[0]?.value ?? ''
  const selVl =
    typeof currentValue === 'string' && options.some((option) => option.value === currentValue)
      ? currentValue
      : fllbVl

  return (
    <label className="team-state-target">
      Active Resonator
      <LiquidSelect
        value={selVl}
        options={options}
        disabled={options.length <= 1}
        onChange={(nextValue) => setSelTrgt(sttWnrKey, nextValue || null)}
      />
    </label>
  )
}

function EchoSetBnsCa({
  setId,
  count,
  runtime,
  actRt: actRt,
  onRtPdt: onRtPdt,
  getSelTgt: getSelTrgt,
  setSelTgt: setSelTrgt,
}: {
  setId: number
  count: number
  runtime: ResRuntime
  actRt: ResRuntime
  onRtPdt: RtUpdHnd
  getSelTgt?: (ownerKey: string) => string | null
  setSelTgt?: (ownerKey: string, tgtResId: string | null) => void
}) {
  const def = getEchoSetDe(setId)
  const icon = getSntSetIco(setId)

  const vsblStts = useMemo(() => {
    return listStatesFor('echoSet', String(setId)).filter((state) =>
      evalSourceState(runtime, runtime, state, actRt),
    )
  }, [actRt, runtime, setId])

  if (!def) {
    return null
  }

  const pieceReq = def.setMax === 1 ? 1 : def.setMax === 3 ? 3 : 5
  const hasPieceReq = count >= pieceReq
  const passiveParts = def.parts.filter((part) => {
    const isPassive = part.key === 'onePiece' || part.key === 'twoPiece' || part.key === 'fivePiece' || part.key === 'threePiece'
    if (!isPassive) return false
    if (part.key === 'onePiece') return count >= 1
    if (part.key === 'twoPiece') return count >= 2
    return count >= pieceReq
  })

  const stateEntries = def.parts
    .filter((part) => {
      const isPassive = part.key === 'onePiece' || part.key === 'twoPiece' || part.key === 'fivePiece' || part.key === 'threePiece'
      return !isPassive && hasPieceReq
    })
    .map((part) => ({
      part,
      state: vsblStts.find((state) => state.id === part.key),
    }))
    .filter((entry): entry is { part: typeof def.parts[number]; state: typeof vsblStts[number] } => Boolean(entry.state))

  const tierLabel = (key: string) => {
    if (key === 'onePiece') return '1pc'
    if (key === 'twoPiece') return '2pc'
    if (key === 'threePiece') return '3pc'
    if (key === 'fivePiece') return '5pc'
    return ''
  }

  return (
    <div className="echo-set-bonus">
      <div className="echo-set-bonus-header">
        <div className="echo-set-bonus-icon-wrap">
          {icon ? (
            <img src={icon} alt={def.name} className="echo-set-bonus-icon" loading="lazy" onError={withDefIconM} />
          ) : (
            <span className="echo-set-bonus-icon-fallback" />
          )}
        </div>
        <div className="echo-set-bonus-info">
          <span className="echo-set-bonus-name">{def.name}</span>
          <div className="echo-set-bonus-pips">
            {Array.from({ length: pieceReq }, (_, index) => (
              <span
                key={`${setId}-pip-${index}`}
                className={`echo-set-pip${index < count ? ' echo-set-pip--filled' : ''}`}
              />
            ))}
            <span className="echo-set-bonus-count">{count}/{pieceReq}</span>
          </div>
        </div>
      </div>

      {passiveParts.length > 0 ? (
        <div className="echo-set-bonus-tiers">
          {passiveParts.map((part) => (
            <div key={part.key} className="echo-set-tier">
              <span className="echo-set-tier-tag">{tierLabel(part.key)}</span>
              <RichDscr description={part.description ?? part.label} className="echo-set-tier-desc" unstyled />
            </div>
          ))}
        </div>
      ) : null}

      {stateEntries.length > 0 ? (
        <div className="echo-set-bonus-controls">
          {stateEntries.map(({ state }) => {
            const targetMode = getStateTeamTag(state)
            const teamTgtSel = targetMode
              ? mkTeamTgtSel({
                  sttOwnKey: state.ownerKey,
                  srcRt: runtime,
                  actRt: actRt,
                  mode: targetMode,
                  getSelTgt: getSelTrgt,
                  setSelTgt: setSelTrgt,
                })
              : undefined

            return (
              <div key={state.controlKey} className="team-member-config-modal__state-row team-state-control team-member-config-modal__state-row--mini">
                <SourceStateCtrl
                  srcRt={runtime}
                  tgtRt={runtime}
                  actRt={actRt}
                  state={state}
                  onRtPdt={onRtPdt}
                  teamTgtSlct={teamTgtSel}
                />
              </div>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

export function RtEchoSetBns({
  runtime,
  actRt: actRt,
  onRtPdt: onRtPdt,
  getSelTgt: getSelTrgt,
  setSelTgt: setSelTrgt,
}: {
  runtime: ResRuntime
  actRt: ResRuntime
  onRtPdt: RtUpdHnd
  getSelTgt?: (ownerKey: string) => string | null
  setSelTgt?: (ownerKey: string, tgtResId: string | null) => void
}) {
  const activeSets = useMemo(() => {
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
  }, [runtime.build.echoes])

  if (activeSets.length === 0) {
    return (
      <div className="soft-empty team-member-config-modal__empty">
        No active set effects from the equipped echoes.
      </div>
    )
  }

  return (
    <div className="echo-set-bonuses">
      {activeSets.map(({ setId, count }) => (
        <EchoSetBnsCa
          key={`echo-set-${setId}`}
          setId={setId}
          count={count}
          runtime={runtime}
          actRt={actRt}
          onRtPdt={onRtPdt}
          getSelTgt={getSelTrgt}
          setSelTgt={setSelTrgt}
        />
      ))}
    </div>
  )
}

export function RtMainEchoPn({
  runtime,
  actRt: actRt,
  onRtPdt: onRtPdt,
  getSelTgt: getSelTrgt,
  setSelTgt: setSelTrgt,
  team
}: {
  runtime: ResRuntime
  actRt: ResRuntime
  onRtPdt: RtUpdHnd
  team: true | false
  getSelTgt?: (ownerKey: string) => string | null
  setSelTgt?: (ownerKey: string, tgtResId: string | null) => void
}) {
  const mainEcho = runtime.build.echoes[0]
  const mainEchoDef = mainEcho ? getEchoById(mainEcho.id) : null
  const mainEchoSrc = useMemo(() => getMainEchoS(runtime), [runtime])
  const mainEchoStats = useMemo(() => {
    if (!mainEchoSrc) {
      return []
    }

    return listStatesFor(mainEchoSrc.type, mainEchoSrc.id).filter((state) =>
      evalSourceState(runtime, runtime, state, actRt),
    )
  }, [actRt, mainEchoSrc, runtime])

  if (!mainEchoDef) {
    return (
      <div className="soft-empty team-member-config-modal__empty">
        No main echo is equipped in slot 1.
      </div>
    )
  }

  return (
    <div className="echo-slot-feature">
      <div className="echo-slot-feature-head">
        <h4 className="panel-title">{mainEchoDef.name}</h4>
      </div>

      {mainEchoDef.skillDesc ? (
        <div className="stack">
          <RichDscr description={mainEchoDef.skillDesc} />
        </div>
      ) : null}

      {mainEchoStats.length > 0 ? (
        <div className={team ? "team-member-config-modal__state-row team-state-control team-member-config-modal__state-row--mini" : "stack"}>
          {mainEchoStats.map((state) => {
            const targetMode = getStateTeamTag(state)
            const teamTgtSel = targetMode
              ? mkTeamTgtSel({
                  sttOwnKey: state.ownerKey,
                  srcRt: runtime,
                  actRt: actRt,
                  mode: targetMode,
                  getSelTgt: getSelTrgt,
                  setSelTgt: setSelTrgt,
                })
              : undefined

            return (
                <SourceStateCtrl
                    srcRt={runtime}
                    tgtRt={runtime}
                    actRt={actRt}
                    state={state}
                    onRtPdt={onRtPdt}
                    teamTgtSlct={teamTgtSel}
                    hideDscr
                />
            )
          })}
        </div>
      ) : !mainEchoDef.skillDesc ? (
        <div className="soft-empty team-member-config-modal__empty">
          No stateful main echo behavior is available for this echo.
        </div>
      ) : null}
    </div>
  )
}
