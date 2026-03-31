import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { getSonataSetIcon } from '@/data/gameData/catalog/sonataSets'
import { getEchoSetDef } from '@/data/gameData/echoSets/effects'
import type { ResonatorRuntimeState } from '@/domain/entities/runtime'
import { computeEchoSetCounts } from '@/engine/pipeline/buildCombatContext'
import { getEchoById } from '@/domain/services/echoCatalogService'
import { listStatesForSource } from '@/domain/services/gameDataService'
import { getMainEchoSourceRef } from '@/domain/services/runtimeSourceService'
import { SourceStateControl } from '@/modules/calculator/components/workspace/panes/left/controls/SourceStateControl'
import {
  getStateTeamTargetMode,
  getTeamTargetOptions,
} from '@/modules/calculator/components/workspace/panes/left/helpers/runtimeStateUtils'
import type { RuntimeUpdateHandler } from '@/modules/calculator/components/workspace/panes/left/helpers/runtimeStateUtils'
import { evaluateSourceStateVisibility } from '@/modules/calculator/model/sourceStateEvaluation'
import { LiquidSelect } from '@/shared/ui/LiquidSelect'
import { RichDescription } from '@/shared/ui/RichDescription'

// groups the echo runtime panels and wires their source-state controls to the shared helpers.
function buildTeamTargetSelect(props: {
  stateOwnerKey: string
  sourceRuntime: ResonatorRuntimeState
  activeRuntime: ResonatorRuntimeState
  mode: 'active' | 'activeOther'
  getSelectedTarget?: (ownerKey: string) => string | null
  setSelectedTarget?: (ownerKey: string, targetResonatorId: string | null) => void
}): ReactNode {
  const {
    stateOwnerKey,
    sourceRuntime,
    activeRuntime,
    mode,
    getSelectedTarget,
    setSelectedTarget,
  } = props

  if (!getSelectedTarget || !setSelectedTarget) {
    return undefined
  }

  const options = getTeamTargetOptions(activeRuntime, sourceRuntime.id, mode)
  const currentValue = getSelectedTarget(stateOwnerKey)
  const fallbackValue = options[0]?.value ?? ''
  const selectedValue =
    typeof currentValue === 'string' && options.some((option) => option.value === currentValue)
      ? currentValue
      : fallbackValue

  return (
    <label className="team-state-target">
      Active Resonator
      <LiquidSelect
        value={selectedValue}
        options={options}
        disabled={options.length <= 1}
        onChange={(nextValue) => setSelectedTarget(stateOwnerKey, nextValue || null)}
      />
    </label>
  )
}

function EchoSetBonusCard({
  setId,
  count,
  runtime,
  activeRuntime,
  onRuntimeUpdate,
  getSelectedTarget,
  setSelectedTarget,
}: {
  setId: number
  count: number
  runtime: ResonatorRuntimeState
  activeRuntime: ResonatorRuntimeState
  onRuntimeUpdate: RuntimeUpdateHandler
  getSelectedTarget?: (ownerKey: string) => string | null
  setSelectedTarget?: (ownerKey: string, targetResonatorId: string | null) => void
}) {
  const def = getEchoSetDef(setId)
  const icon = getSonataSetIcon(setId)

  const visibleStates = useMemo(() => {
    return listStatesForSource('echoSet', String(setId)).filter((state) =>
      evaluateSourceStateVisibility(runtime, runtime, state, activeRuntime),
    )
  }, [activeRuntime, runtime, setId])

  if (!def) {
    return null
  }

  const pieceReq = def.setMax === 3 ? 3 : 5
  const hasPieceReq = count >= pieceReq
  const passiveParts = def.parts.filter((part) => {
    const isPassive = part.key === 'twoPiece' || part.key === 'fivePiece' || part.key === 'threePiece'
    if (!isPassive) return false
    if (part.key === 'twoPiece') return count >= 2
    return count >= pieceReq
  })

  const stateEntries = def.parts
    .filter((part) => {
      const isPassive = part.key === 'twoPiece' || part.key === 'fivePiece' || part.key === 'threePiece'
      return !isPassive && hasPieceReq
    })
    .map((part) => ({
      part,
      state: visibleStates.find((state) => state.id === part.key),
    }))
    .filter((entry): entry is { part: typeof def.parts[number]; state: typeof visibleStates[number] } => Boolean(entry.state))

  const tierLabel = (key: string) => {
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
            <img src={icon} alt={def.name} className="echo-set-bonus-icon" loading="lazy" />
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
              <span className="echo-set-tier-desc">{part.label}</span>
            </div>
          ))}
        </div>
      ) : null}

      {stateEntries.length > 0 ? (
        <div className="echo-set-bonus-controls">
          {stateEntries.map(({ state }) => {
            const targetMode = getStateTeamTargetMode(state)
            const teamTargetSelect = targetMode
              ? buildTeamTargetSelect({
                  stateOwnerKey: state.ownerKey,
                  sourceRuntime: runtime,
                  activeRuntime,
                  mode: targetMode,
                  getSelectedTarget,
                  setSelectedTarget,
                })
              : undefined

            return (
              <div key={state.controlKey} className="team-member-config-modal__state-row team-state-control team-member-config-modal__state-row--mini">
                <SourceStateControl
                  sourceRuntime={runtime}
                  targetRuntime={runtime}
                  activeRuntime={activeRuntime}
                  state={state}
                  onRuntimeUpdate={onRuntimeUpdate}
                  teamTargetSelect={teamTargetSelect}
                />
              </div>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

export function RuntimeEchoSetBonuses({
  runtime,
  activeRuntime,
  onRuntimeUpdate,
  getSelectedTarget,
  setSelectedTarget,
}: {
  runtime: ResonatorRuntimeState
  activeRuntime: ResonatorRuntimeState
  onRuntimeUpdate: RuntimeUpdateHandler
  getSelectedTarget?: (ownerKey: string) => string | null
  setSelectedTarget?: (ownerKey: string, targetResonatorId: string | null) => void
}) {
  const activeSets = useMemo(() => {
    return Object.entries(computeEchoSetCounts(runtime.build.echoes))
      .map(([setId, count]) => ({ setId: Number(setId), count }))
      .filter(({ setId, count }) => {
        const def = getEchoSetDef(setId)
        if (!def) {
          return false
        }

        const minReq = def.setMax === 3 ? 3 : 2
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
        <EchoSetBonusCard
          key={`echo-set-${setId}`}
          setId={setId}
          count={count}
          runtime={runtime}
          activeRuntime={activeRuntime}
          onRuntimeUpdate={onRuntimeUpdate}
          getSelectedTarget={getSelectedTarget}
          setSelectedTarget={setSelectedTarget}
        />
      ))}
    </div>
  )
}

export function RuntimeMainEchoPanel({
  runtime,
  activeRuntime,
  onRuntimeUpdate,
  getSelectedTarget,
  setSelectedTarget,
}: {
  runtime: ResonatorRuntimeState
  activeRuntime: ResonatorRuntimeState
  onRuntimeUpdate: RuntimeUpdateHandler
  getSelectedTarget?: (ownerKey: string) => string | null
  setSelectedTarget?: (ownerKey: string, targetResonatorId: string | null) => void
}) {
  const mainEcho = runtime.build.echoes[0]
  const mainEchoDefinition = useMemo(
    () => (mainEcho ? getEchoById(mainEcho.id) : null),
    [mainEcho],
  )
  const mainEchoSource = useMemo(() => getMainEchoSourceRef(runtime), [runtime])
  const mainEchoStates = useMemo(() => {
    if (!mainEchoSource) {
      return []
    }

    return listStatesForSource(mainEchoSource.type, mainEchoSource.id).filter((state) =>
      evaluateSourceStateVisibility(runtime, runtime, state, activeRuntime),
    )
  }, [activeRuntime, mainEchoSource, runtime])

  if (!mainEchoDefinition) {
    return (
      <div className="soft-empty team-member-config-modal__empty">
        No main echo is equipped in slot 1.
      </div>
    )
  }

  return (
    <div className="echo-slot-feature">
      <div className="echo-slot-feature-head">
        <h4 className="panel-title">{mainEchoDefinition.name}</h4>
      </div>

      {mainEchoDefinition.skillDesc ? (
        <div className="stack">
          <RichDescription description={mainEchoDefinition.skillDesc} />
        </div>
      ) : null}

      {mainEchoStates.length > 0 ? (
        <div className="stack">
          {mainEchoStates.map((state) => {
            const targetMode = getStateTeamTargetMode(state)
            const teamTargetSelect = targetMode
              ? buildTeamTargetSelect({
                  stateOwnerKey: state.ownerKey,
                  sourceRuntime: runtime,
                  activeRuntime,
                  mode: targetMode,
                  getSelectedTarget,
                  setSelectedTarget,
                })
              : undefined

            return (
                <SourceStateControl
                    sourceRuntime={runtime}
                    targetRuntime={runtime}
                    activeRuntime={activeRuntime}
                    state={state}
                    onRuntimeUpdate={onRuntimeUpdate}
                    teamTargetSelect={teamTargetSelect}
                />
            )
          })}
        </div>
      ) : !mainEchoDefinition.skillDesc ? (
        <div className="soft-empty team-member-config-modal__empty">
          No stateful main echo behavior is available for this echo.
        </div>
      ) : null}
    </div>
  )
}
