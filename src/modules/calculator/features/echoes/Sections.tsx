/*
  Author: Runor Ewhro
  Description: renders the echo equipment surface, including equipped echoes,
               aggregated stats, set sections, and per-echo runtime controls.
*/

import { useMemo, type HTMLAttributes as HtmlAttrs } from 'react'
import { ChevronDown } from 'lucide-react'
import type { EchoInstance, ResRuntime } from '@/domain/entities/runtime.ts'
import { getEchoById } from '@/domain/services/echoCatalogService.ts'
import { listStatesFor } from '@/domain/services/gameDataService.ts'
import { getSntSetNam, getSntSetIco } from '@/data/gameData/catalog/sonataSets.ts'
import { getEchoSetDe, getEchoSetCn } from '@/data/gameData/echoSets/effects.ts'
import type { SetDef } from '@/data/gameData/echoSets/effects.ts'
import { Expandable } from '@/shared/ui/Expandable.tsx'
import { StepScrubber } from '@/shared/ui/StepScrubber.tsx'
import { RichDscr } from '@/shared/ui/RichDescription.tsx'
import { formatTruncCompact } from '@/shared/lib/number.ts'
import { cmptEchoCrit, getCvBdgClss, getScrBdgCls } from '@/modules/calculator/features/echoes/lib/metric.ts'
import {
  formatBuildBenchmarkScore as fmtBenchScore,
  getBuildBenchmarkBadgeClass as getBenchBadgeCls,
  getBuildBenchmarkBadgeStyle as getBenchBadgeStyle,
} from '@/modules/calculator/model/buildBenchmarkDisplay.ts'
import {
  cmptSetCnts,
  fmtEchoStatL,
  fmtEchoStatV,
  getEchoStatI,
} from '@/modules/calculator/features/echoes/lib/echoPane.ts'
import {
  ggrgEchoStts,
} from '@/data/scoring/echoScoring.ts'
import type { RtUpdHnd } from '@/modules/calculator/features/controls/lib/runtimeStateUtils.ts'
import { SourceStateCtrl } from '@/modules/calculator/features/controls/SourceStateControl.tsx'
import {
  getStateTeamTag,
  getTeamTgtPt,
} from '@/modules/calculator/features/controls/lib/runtimeStateUtils.ts'
import { hideBrknMg, withDefIconM } from '@/shared/lib/imageFallback.ts'
import { fmtDscr } from '@/shared/lib/formatDescription.ts'
import { IoArchive } from 'react-icons/io5'
import { RiDeleteBin2Fill as DeleteBinIcon } from 'react-icons/ri'

const TTLS_GRPS: { label: string; keys: string[] }[] = [
  { label: 'Offense', keys: ['atkFlat', 'atkPercent', 'critRate', 'critDmg'] },
  { label: 'Defense', keys: ['hpFlat', 'hpPercent', 'defFlat', 'defPercent'] },
  { label: 'Utility', keys: ['energyRegen', 'healingBonus'] },
  { label: 'Attribute', keys: ['aero', 'glacio', 'electro', 'fusion', 'havoc', 'spectro'] },
  { label: 'Skill', keys: ['basicAtk', 'heavyAtk', 'resonanceSkill', 'resonanceLiberation'] },
]

function StatIcon({ statKey }: { statKey: string }) {
  const iconUrl = getEchoStatI(statKey)
  if (!iconUrl) return null
  return (
    <span
      className="echo-stat-icon-mask"
      style={{
        WebkitMaskImage: `url(${iconUrl})`,
        maskImage: `url(${iconUrl})`,
      }}
    />
  )
}

export function EchoSlot({
  echo,
  index,
  score,
  canSave,
  selected = false,
  selMode: selectMode = false,
  showMainChvr: showMainChvr = false,
  mainEchoExp: mainEchoXpnd = false,
  onTgglMainjt: onTgglMainEc,
  onOpenPicker,
  onOpenEdit,
  onRemove,
  onSave,
  ...articleProps
}: {
  echo: EchoInstance | null
  index: number
  score: number | null
  canSave: boolean
  selected?: boolean
  selMode?: boolean
  showMainChvr?: boolean
  mainEchoExp?: boolean
  onTgglMainjt?: () => void
  onOpenPicker: () => void
  onOpenEdit: () => void
  onRemove: () => void
  onSave: () => void
} & HtmlAttrs<HTMLElement>) {
  const definition = echo ? getEchoById(echo.id) : null
  const cost = definition?.cost ?? 0

  if (!echo || !definition) {
    return (
      <article
        {...articleProps}
        className={`echo-slot echo-slot--empty${selectMode ? ' selection-mode' : ''}${selected ? ' focus-selected' : ''}`}
        onClick={onOpenPicker}
      >
        <div className="echo-slot-icon echo-slot-icon--empty">
          <span className="echo-slot-icon-plus">+</span>
        </div>
        <div className="echo-slot-info">
          <span className="echo-slot-label">Slot {index + 1}</span>
          <span className="echo-slot-hint">Tap to select</span>
        </div>
      </article>
    )
  }

  const setIcon = getSntSetIco(echo.set)
  const sbstEnts = Object.entries(echo.substats)
  const cv = cmptEchoCrit(echo.substats)

  return (
    <article
      {...articleProps}
      className={`echo-slot${selected ? ' focus-selected' : ''}${selectMode ? ' selection-mode' : ''}`}
      data-selection-focus-item="true"
      aria-selected={selected ? 'true' : 'false'}
    >
      <div className="echo-slot-content">
        <div className="echo-slot-card">
          <div className="echo-slot-left">
            <button type="button" className="echo-slot-icon" onClick={onOpenPicker}>
              <img
                src={definition.icon}
                alt={definition.name}
                className="echo-slot-icon-img"
                loading="lazy"
                decoding="async"
                onError={hideBrknMg}
              />
            </button>

            <div className="echo-slot-identity">
              <div className="echo-slot-name-row">
                <span className="echo-slot-name">{definition.name}</span>
              </div>
              <div className="echo-slot-meta">
                {setIcon ? (
                  <img src={setIcon} alt={getSntSetNam(echo.set)} className="echo-slot-set-icon" loading="lazy" onError={withDefIconM} />
                ) : null}
                <span className="echo-slot-cost echo-score-badge">{cost}C</span>
                {echo.mainEcho ? <span className="echo-slot-badge echo-slot-badge--main">Main</span> : null}
                {score !== null ? (
                  <span className={getScrBdgCls(score)}>
                    {formatTruncCompact(score, 1)}%
                  </span>
                ) : null}
              </div>
            </div>

            <div className="echo-slot-actions">
              {showMainChvr ? (
                <button
                  type="button"
                  className={`echo-slot-action echo-slot-main-chevron${mainEchoXpnd ? ' echo-slot-main-chevron--open' : ''}`}
                  onClick={(e) => { e.stopPropagation(); onTgglMainEc?.() }}
                  title="Toggle main echo details"
                >
                  <ChevronDown size={14} />
                </button>
              ) : null}
              <button
                type="button"
                className="echo-slot-action"
                title={canSave ? 'Save echo to bag' : 'This echo is already saved'}
                onClick={onSave}
                disabled={!canSave}
              >
                <IoArchive size={14} />
              </button>
              <button
                type="button"
                className="echo-slot-remove"
                title="Remove echo"
                onClick={onRemove}
              >
                <DeleteBinIcon />
              </button>
            </div>
          </div>

          <div
            className="echo-stat-card"
            onClick={onOpenEdit}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onOpenEdit()
              }
            }}
          >
            <div className="echo-stat-card-accent" />
            <div className="echo-stat-card-section echo-stat-card-section--main">
              <div className="echo-stat-primary">
                <StatIcon statKey={echo.mainStats.primary.key} />
                <span className="echo-stat-primary-label">{fmtEchoStatL(echo.mainStats.primary.key)}</span>
                <span className="echo-stat-primary-value">{fmtEchoStatV(echo.mainStats.primary.key, echo.mainStats.primary.value)}</span>
              </div>
              <div className="echo-stat-secondary">
                <StatIcon statKey={echo.mainStats.secondary.key} />
                <span className="echo-stat-secondary-label">{fmtEchoStatL(echo.mainStats.secondary.key)}</span>
                <span className="echo-stat-secondary-value">{fmtEchoStatV(echo.mainStats.secondary.key, echo.mainStats.secondary.value)}</span>
                <span className="echo-stat-secondary-tag">Fixed</span>
              </div>
            </div>

            {sbstEnts.length > 0 ? (
              <div className="echo-stat-card-section echo-stat-card-section--subs">
                <div className="echo-stat-subs-header">
                  <span className="echo-stat-subs-title">Substats</span>
                  {cv > 0 ? (
                    <span className={getCvBdgClss(cv)}>
                      CV {formatTruncCompact(cv, 1)}
                    </span>
                  ) : null}
                </div>
                <div className="echo-stat-subs-list">
                  {sbstEnts.map(([key, val]) => (
                    <div key={key} className="echo-stat-sub">
                      <StatIcon statKey={key} />
                      <span className="echo-stat-sub-label">{fmtEchoStatL(key)}</span>
                      <span className="echo-stat-sub-value">{fmtEchoStatV(key, val)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="echo-stat-card-section echo-stat-card-section--subs echo-stat-card-section--empty">
                <span className="echo-stat-empty-hint">Tap to edit stats</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </article>
  )
}

function EchoSetSttPa({
  setDef,
  stateKey,
  desc,
  trigger,
  runtime,
  onRtPdt: onRtPdt,
  selectedTargets,
  setTargetRes: setResTrgtSl,
}: {
  setDef: SetDef
  stateKey: string
  desc: string
  trigger: string
  runtime: ResRuntime
  onRtPdt: RtUpdHnd
  selectedTargets: Record<string, string | null>
  setTargetRes: (resonatorId: string, ownerKey: string, tgtResId: string | null) => void
}) {
  const stateEntry = setDef.states[stateKey]
  if (!stateEntry) return null
  const sourceState = listStatesFor('echoSet', String(setDef.id)).find((state) => state.id === stateKey) ?? null

  // echo-set condition controls share source-state definitions with the engine,
  // so the row key must stay aligned with runtime control storage.
  const ck = getEchoSetCn(setDef.id, stateKey)
  const currentValue = (runtime.state?.controls as Record<string, unknown> | undefined)?.[ck]
  const targetMode = sourceState ? getStateTeamTag(sourceState) : null
  const targetOptions = sourceState && targetMode
    ? getTeamTgtPt(runtime, runtime.id, targetMode)
    : []
  const curTgt = sourceState
    ? selectedTargets[sourceState.ownerKey] ?? null
    : null
  const fllbTgt = targetOptions[0]?.value ?? null
  const selTgt = (
    typeof curTgt === 'string'
      && targetOptions.some((option) => option.value === curTgt)
  )
    ? curTgt
    : fllbTgt

  const perStep = stateEntry.perStep ?? []
  const perStack = stateEntry.perStack ?? []
  const stckLikeEnts = perStep.length > 0 ? perStep : (perStack.length > 0 ? perStack : stateEntry.max)
  const isToggle = stckLikeEnts.every((ps, i) => ps.value === stateEntry.max[i].value)

  const updCntr = (value: boolean | number) => {
    onRtPdt((prev) => ({
      ...prev,
      state: {
        ...prev.state,
        controls: {
          ...(prev.state?.controls ?? {}),
          [ck]: value,
        },
      },
    }))
  }

  const updSelTgt = (tgtResId: string | null) => {
    if (!sourceState) {
      return
    }
    setResTrgtSl(runtime.id, sourceState.ownerKey, tgtResId)
  }

  const targetPills = targetOptions.length > 0 ? (
    <div className="echo-set-state-targets">
      <span className="echo-set-state-targets-label">Target</span>
      <div className="echo-set-state-targets-pills">
        {targetOptions.map((option) => (
          <button
            key={option.value}
            type="button"
            className={`echo-set-state-target-pill${option.value === selTgt ? ' echo-set-state-target-pill--active' : ''}`}
            onClick={() => updSelTgt(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  ) : null

  if (isToggle) {
    const checked = Boolean(currentValue)
    return (
      <div className={`echo-set-state${checked ? ' echo-set-state--active' : ''}`}>
        <label className="echo-set-state-toggle">
          <input
            type="checkbox"
            checked={checked}
            onChange={() => updCntr(!checked)}
          />
          <span className="echo-set-state-switch" />
          <span
            className="echo-set-state-label"
            dangerouslySetInnerHTML={{ __html: fmtDscr(desc) }}
          />
        </label>
        {trigger ? (
          <span
            className="echo-set-state-trigger"
            dangerouslySetInnerHTML={{ __html: fmtDscr(trigger) }}
          />
        ) : null}
        {targetPills}
      </div>
    )
  }

  if (perStep.length > 0) {
    const maxSteps = Math.round(
      Math.max(...perStep.map((ps, i) => stateEntry.max[i].value / ps.value)),
    )
    const stepValue = typeof currentValue === 'number' ? currentValue : 0

    return (
      <div className={`echo-set-state${stepValue > 0 ? ' echo-set-state--active' : ''}`}>
        <div className="echo-set-state-step">
          <div className="echo-set-state-step-header">
            <span
              className="echo-set-state-label"
              dangerouslySetInnerHTML={{ __html: fmtDscr(desc) }}
            />
            <div className="echo-set-state-step-count">
              <input
                type="number"
                className="echo-set-state-step-count-input"
                value={stepValue}
                min={0}
                max={maxSteps}
                onChange={(e) => {
                  const parsed = parseInt(e.target.value, 10)
                  if (!isNaN(parsed)) {
                    updCntr(Math.min(maxSteps, Math.max(0, parsed)))
                  }
                }}
              />
              <span className="echo-set-state-step-max">/{maxSteps}</span>
            </div>
          </div>
          <StepScrubber
            min={0}
            max={maxSteps}
            value={stepValue}
            onChange={updCntr}
          />
        </div>
        {trigger ? (
          <span
            className="echo-set-state-trigger"
            dangerouslySetInnerHTML={{ __html: fmtDscr(trigger) }}
          />
        ) : null}
        {targetPills}
      </div>
    )
  }

  const maxStacks = Math.round(
    Math.max(...stckLikeEnts.map((ps, i) => stateEntry.max[i].value / ps.value)),
  )
  const stackValue = typeof currentValue === 'number' ? currentValue : 0

  return (
    <div className={`echo-set-state${stackValue > 0 ? ' echo-set-state--active' : ''}`}>
      <div className="echo-set-state-stack">
        <span
          className="echo-set-state-label"
          dangerouslySetInnerHTML={{ __html: fmtDscr(desc) }}
        />
        <div className="echo-set-state-stack-control">
          {Array.from({ length: maxStacks + 1 }, (_, i) => (
            <button
              key={i}
              type="button"
              className={`echo-set-stack-btn${i === stackValue ? ' echo-set-stack-btn--active' : ''}`}
              onClick={() => updCntr(i)}
            >
              {i}
            </button>
          ))}
        </div>
      </div>
      {trigger ? (
        <span
          className="echo-set-state-trigger"
          dangerouslySetInnerHTML={{ __html: fmtDscr(trigger) }}
        />
      ) : null}
      {targetPills}
    </div>
  )
}

export function EchoSetBonus({
  setId,
  count,
  runtime,
  onRtPdt: onRtPdt,
  selectedTargets,
  setTargetRes: setResTrgtSl,
}: {
  setId: number
  count: number
  runtime: ResRuntime
  onRtPdt: RtUpdHnd
  selectedTargets: Record<string, string | null>
  setTargetRes: (resonatorId: string, ownerKey: string, tgtResId: string | null) => void
}) {
  const def = getEchoSetDe(setId)
  if (!def) return null

  const minReq = def.setMax === 1 ? 1 : def.setMax === 3 ? 3 : 2
  if (count < minReq) return null

  const icon = getSntSetIco(setId)
  const pieceReq = def.setMax === 1 ? 1 : def.setMax === 3 ? 3 : 5
  const hasPieceReq = count >= pieceReq

  const passiveParts = def.parts.filter((part) => {
    const isPassive = part.key === 'onePiece' || part.key === 'twoPiece' || part.key === 'fivePiece' || part.key === 'threePiece'
    if (!isPassive) return false
    if (part.key === 'onePiece') return count >= 1
    if (part.key === 'twoPiece') return count >= 2
    return count >= pieceReq
  })

  const stateParts = def.parts.filter((part) => {
    const isPassive = part.key === 'onePiece' || part.key === 'twoPiece' || part.key === 'fivePiece' || part.key === 'threePiece'
    return !isPassive && hasPieceReq
  })

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
            {Array.from({ length: pieceReq }, (_, i) => (
              <span
                key={i}
                className={`echo-set-pip${i < count ? ' echo-set-pip--filled' : ''}`}
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

      {stateParts.length > 0 ? (
        <div className="echo-set-bonus-controls">
          {stateParts.map((part) => (
            <EchoSetSttPa
              key={part.key}
              setDef={def}
              stateKey={part.key}
              desc={part.description ?? part.label}
              trigger={part.trigger}
              runtime={runtime}
              onRtPdt={onRtPdt}
              selectedTargets={selectedTargets}
              setTargetRes={setResTrgtSl}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

export function EchoTotals({
  echoes,
  buildScore,
}: {
  echoes: Array<EchoInstance | null>
  buildScore: number | null
}) {
  const totals = useMemo(() => ggrgEchoStts(echoes), [echoes])
  const totalCV = (totals.critRate ?? 0) * 2 + (totals.critDmg ?? 0)
  const qppdCnt = echoes.filter(Boolean).length

  // i discovered a lineup such as 44111 can have a max cv of 298%, i'd prefer to not have that skew a normal 43311 setup
  // so we'd have the effective max cv be dependent on the number of 4 cost echoes in the lineup
  // any setup not utilizing the full 5 slots is not an efficient/good build so a triple 4 cost build is only using 3 slots
  // which is generally discouraged so the cv grading should still reflect that it's a bad build
  const cv4Cost = Math.min(echoes.filter((e) => getEchoById(e?.id ?? '')?.cost === 4).length, 2)

  const groups = useMemo(() => {
    // totals are grouped only after zero-value keys are removed, keeping empty
    // categories from rendering while preserving the configured group order.
    return TTLS_GRPS
      .map((group) => ({
        ...group,
        entries: group.keys
          .filter((key) => totals[key] != null && totals[key] !== 0)
          .map((key) => ({ key, value: totals[key] })),
      }))
      .filter((g) => g.entries.length > 0)
  }, [totals])

  if (groups.length === 0) return null

  return (
    <Expandable
      className="echo-totals"
      header={
        <div className="echo-totals-header">
          <span className="echo-totals-title">Echo Stats</span>
          <div className="echo-totals-badges">
            <span className="echo-totals-count">{qppdCnt}/5 equipped</span>
            {totalCV > 0 ? (
              <span className={getCvBdgClss((totalCV - (44 * cv4Cost)) / 5)}>
                CV {formatTruncCompact(totalCV, 1)}
              </span>
            ) : null}
            {buildScore !== null ? (
              <span
                className={getBenchBadgeCls(buildScore)}
                style={getBenchBadgeStyle(buildScore)}
              >
                {fmtBenchScore(buildScore)}
              </span>
            ) : null}
          </div>
        </div>
      }
    >
      <div className="echo-totals-body">
        {groups.map((group) => (
          <div key={group.label} className="echo-totals-group">
            <span className="echo-totals-group-label">{group.label}</span>
            <div className="echo-totals-group-rows">
              {group.entries.map(({ key, value }) => (
                <div key={key} className="echo-totals-row">
                  <span className="echo-totals-stat-name">
                    <StatIcon statKey={key} />
                    {fmtEchoStatL(key)}
                  </span>
                  <span className="echo-totals-stat-value">{fmtEchoStatV(key, value)}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Expandable>
  )
}

// keep the main echo detail renderer close to the echo-specific ui pieces.
export function mkMainEchoPn(
  runtime: ResRuntime,
  mainEchoDef: ReturnType<typeof getEchoById>,
  mainEchoStats: ReturnType<typeof listStatesFor>,
  onRtUpd: RtUpdHnd,
) {
  if (!mainEchoDef || (!mainEchoDef.skillDesc && mainEchoStats.length === 0)) {
    return null
  }

  return (
    <>
      <div className="echo-slot-feature-head">
        <div className="panel-overline">
          <span className="echo-feature-diamond" aria-hidden="true" />
          Main Echo
        </div>
        <h4 className="panel-title">{mainEchoDef.name}</h4>
      </div>
      {mainEchoDef.skillDesc ? (
        <div className="stack">
          <RichDscr description={mainEchoDef.skillDesc} />
        </div>
      ) : null}
      {mainEchoStats.length > 0 ? (
        <>
          {mainEchoStats.map((state) => (
            <SourceStateCtrl
              key={state.controlKey}
              srcRt={runtime}
              tgtRt={runtime}
              state={state}
              onRtPdt={onRtUpd}
              hideDscr
            />
          ))}
        </>
      ) : null}
    </>
  )
}

export function getActEchoSe(echoes: Array<EchoInstance | null>) {
  const setCounts = cmptSetCnts(echoes)

  return Object.entries(setCounts)
    .map(([setId, count]) => ({ setId: Number(setId), count }))
    .filter(({ setId, count }) => {
      const def = getEchoSetDe(setId)
      if (!def) return false
      const minReq = def.setMax === 1 ? 1 : def.setMax === 3 ? 3 : 2
      return count >= minReq
    })
    .reverse()
}
