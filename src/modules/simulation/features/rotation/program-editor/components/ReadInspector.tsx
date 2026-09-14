/*
  Author: Runor Ewhro
  Description: Owns read inspector behavior and state transitions for the components module.
*/

import type { CSSProperties } from 'react'
import { ArrowRight, BarChart3, MessageSquareText, Repeat, Swords } from 'lucide-react'
import { RichDscr } from '@/shared/ui/RichDescription.tsx'
import { withDefEchoMg, withDefIconM, withDefResMg } from '@/shared/lib/imageFallback.ts'
import { getEchoById } from '@/domain/services/echoCatalogService.ts'
import { getAttributeIconSrc } from '@/domain/gameData/attributeDisplay.ts'
import {
  formatDamage,
  fmtStat,
  fmtStatHeading,
  factorAt,
  GROUP_NAMES,
  isTextStatKey,
  STAT_NAMES,
  statGroup,
  type PercentDisplay,
  type RegisterGroup,
  type StatKey,
} from '@/modules/simulation/features/rotation/program-editor/presentation/registerRows.ts'
import { ROTATION_EDITOR_REGISTER_GROUPS } from '@/domain/entities/rotationEditorPreferences.ts'
import { formatExecutionRun } from '@/modules/simulation/features/rotation/program-editor/model/executionScope.ts'
import type { ReadNode } from '@/modules/simulation/features/rotation/program-editor/presentation/readNode.ts'
import {
  BuffRows,
  InspectorSection,
} from '@/modules/simulation/features/rotation/program-editor/components/InspectorPrimitives.tsx'

const STAT_ORDER = Object.keys(STAT_NAMES) as StatKey[]

function StatBands({
  node,
  decimals,
  percentDisplay,
}: {
  node: ReadNode
  decimals: number
  percentDisplay: PercentDisplay
}) {
  const step = node.step
  if (!step) {
    return null
  }

  const bands = ROTATION_EDITOR_REGISTER_GROUPS.map((group: RegisterGroup) => ({
    group,
    keys: STAT_ORDER.filter((key) => statGroup(key) === group),
  })).filter((band) => band.keys.length > 0)

  return (
    <>
      {bands.map((band) => (
        <div key={band.group} className="rte-reg">
          <span className="rte-reg__lbl">{GROUP_NAMES[band.group]}</span>
          <div className="rte-reg__grid">
            {band.keys.map((key) => {
              const value = factorAt(step, node.run, key)
              return (
                <div
                  key={key}
                  className={[
                    'rte-reg__cell',
                    isTextStatKey(key) ? 'rte-reg__cell--wide' : '',
                    value == null ? 'is-void' : '',
                  ].filter(Boolean).join(' ')}
                  title={STAT_NAMES[key]}
                >
                  <span className="rte-reg__k">{fmtStatHeading(key, percentDisplay)}</span>
                  <b className="rte-reg__v">
                    {fmtStat(value, key, decimals, percentDisplay)}
                  </b>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </>
  )
}

function ReadRefs({ rows }: { rows: Array<{ key: string; label: string; run: string; here: boolean }> }) {
  return (
    <ol className="rte-refs">
      {rows.map((row) => (
        <li key={row.key} className={`rte-refs__row${row.here ? ' is-here' : ''}`}>
          <span className="rte-refs__jump is-static">
            <i className="rte-refs__tick is-node" aria-hidden="true" />
            <span className="rte-refs__by">{row.label}</span>
            <em className="rte-refs__run">{row.run}</em>
          </span>
        </li>
      ))}
    </ol>
  )
}

/**
 * The read panel's body: head, figure, and the sections the node actually
 * carries. Used for a compared node, where the panel is one of several being
 * read rather than the one being worked on.
 */
export function ReadInspector({
  node,
  decimals,
  percentDisplay,
}: {
  node: ReadNode
  decimals: number
  percentDisplay: PercentDisplay
}) {
  const { step, condition, block, handoff, note } = node
  const echo = step?.owner.kind === 'echo' ? getEchoById(step.owner.echoId) : null
  const echoId = step?.owner.kind === 'echo' ? step.owner.echoId : null
  const elementIcon = step ? getAttributeIconSrc(node.element) : null
  const wrote = node.write

  return (
    <>
      <div className="rte-inspector__head">
        {/* the slot the Totals / Node strip held: what is being read, and where
            in the rotation it stands */}
        <div className="rte-readline">
          <i className="rte-readline__dot" aria-hidden="true" />
          <span>Read . {node.kindLabel}</span>
          {node.address ? <span className="rte-readline__at">{node.address}</span> : null}
        </div>

        {handoff ? (
          <div className="rte-inspector__top rte-hoff__top">
            <img className="rte-hoff__top-out"
              src={node.handoffFrom?.profile ?? ''}
              alt=""
              title={node.handoffFrom?.name}
              onError={withDefResMg}
              loading="lazy"
            />
            <ArrowRight className="rte-hoff__top-arw" size="0.85rem" aria-hidden="true" />
            <img className="rte-hoff__top-in"
              src={node.handoffTo?.profile ?? ''}
              alt=""
              title={node.handoffTo?.name}
              onError={withDefResMg}
              loading="lazy"
            />
            <span className="rte-inspector__titles">
              <b>{node.handoffTo?.name ?? handoff.to}</b>
              <em className="rte-hoff__top-from">from {node.handoffFrom?.name ?? handoff.from}</em>
            </span>
          </div>
        ) : (
          <div className="rte-inspector__top">
            {note ? (
              <span className="rte-inspector__avatar is-block" aria-hidden="true">
                <MessageSquareText size="1rem" />
              </span>
            ) : block ? (
              <span className="rte-inspector__avatar is-block" aria-hidden="true">
                {block.type === 'loop' ? <Repeat size="1rem" /> : <BarChart3 size="1rem" />}
              </span>
            ) : echoId ? (
              <span className="rte-inspector__mark">
                <img className="rte-inspector__avatar"
                  src={echo?.icon ?? `/assets/game/echoes/icons/${echoId}.webp`}
                  alt=""
                  title={echo?.name ?? 'Echo'}
                  onError={withDefEchoMg}
                  loading="lazy"
                />
                <img className="rte-inspector__caster"
                  src={node.owner?.profile ?? ''}
                  alt=""
                  title={node.owner ? `Cast by ${node.owner.name}` : undefined}
                  onError={withDefResMg}
                  loading="lazy"
                />
              </span>
            ) : node.modifier ? (
              <span className="rte-inspector__avatar is-block" aria-hidden="true">
                <Swords size="1rem" />
              </span>
            ) : (
              <img
                className={`rte-inspector__avatar${condition ? ' is-source' : ''}`}
                src={node.headIcon}
                alt=""
                title={node.headAlt}
                onError={condition ? withDefIconM : withDefResMg}
                loading="lazy"
              />
            )}
            <span className="rte-inspector__titles">
              <b>{node.label}</b>
            </span>
            {elementIcon ? (
              <img className="rte-inspector__element"
                src={elementIcon}
                alt={node.element ?? ''}
                onError={withDefIconM}
                loading="lazy"
              />
            ) : null}
          </div>
        )}

        {/* a handoff deals nothing, so it prints no figure rather than a zero */}
        {note ? (
          <div className="rte-figure rte-figure--state">
            <b>{node.words}</b>
            <span className="rte-figure__unit">{node.words === 1 ? 'word' : 'words'}</span>
            <span className="rte-figure__share">display only</span>
          </div>
        ) : condition && wrote ? (
          <div className="rte-figure rte-figure--state">
            <b>{wrote.to || '-'}</b>
            <span className="rte-figure__unit">now</span>
            {wrote.from !== undefined ? (
              <span className="rte-figure__share">was {wrote.from || '-'}</span>
            ) : null}
          </div>
        ) : block ? (
          <div className="rte-figure">
            <b>{formatDamage(node.figure, decimals)}</b>
            <span className="rte-figure__unit">avg</span>
            <span className="rte-figure__share">
              {block.type === 'loop' && block.runs > 1
                ? `per run . ${node.blockSteps} ${node.blockSteps === 1 ? 'step' : 'steps'}`
                : `${node.blockSteps} ${node.blockSteps === 1 ? 'step' : 'steps'}`}
            </span>
          </div>
        ) : step ? (
          <div className="rte-figure">
            <b>{formatDamage(node.figure, decimals)}</b>
            <span className="rte-figure__unit">avg</span>
            <span className="rte-figure__share">{node.share.toFixed(1)}%</span>
          </div>
        ) : null}
      </div>

      <div className="rte-inspector__mid rte-scroll">
        {step ? (
          <InspectorSection label={<>Stats . {STAT_ORDER.length}</>} defaultOpen={false}>
            <StatBands node={node} decimals={decimals} percentDisplay={percentDisplay} />
          </InspectorSection>
        ) : null}

        {condition ? (
          <InspectorSection label="State" defaultOpen={true}>
            {wrote ? (
              <div className="rte-cval">
                {wrote.from !== undefined ? (
                  <>
                    <s className="rte-cval__was">{wrote.from || '-'}</s>
                    <i className="rte-cval__arw" aria-hidden="true">&rarr;</i>
                  </>
                ) : null}
                <b className={`rte-cval__now${
                  wrote.from !== undefined ? wrote.rising ? ' is-up' : ' is-down' : ''
                }`}>
                  {wrote.to || '-'}
                </b>
              </div>
            ) : null}
            {condition.description ? (
              <RichDscr className="rte-cdesc"
                description={condition.description}
                params={condition.descriptionParams}
              />
            ) : null}
            <div className="rte-kv">
              <span>Source</span>
              <b>{condition.effectName ?? condition.sourceName ?? 'Unknown'}</b>
            </div>
            {condition.extra ? (
              <div className="rte-kv">
                <span>Also writes</span>
                <b>{condition.extra} more</b>
              </div>
            ) : null}
          </InspectorSection>
        ) : null}

        {handoff ? (
          <InspectorSection label="State" defaultOpen={true}>
            <div className="rte-kv">
              <span>Off</span>
              <b>{node.handoffFrom?.name ?? handoff.from}</b>
            </div>
            <div className="rte-kv">
              <span>On</span>
              <b>{node.handoffTo?.name ?? handoff.to}</b>
            </div>
            {node.scopeLabel ? (
              <div className="rte-kv">
                <span>Run</span>
                <b>{node.scopeLabel}</b>
              </div>
            ) : null}
          </InspectorSection>
        ) : null}

        {block && node.runTotals.length > 1 ? (
          <InspectorSection label={<>Runs . {node.runTotals.length}</>} defaultOpen={true}>
            <ol className="rte-runlist">
              {node.runTotals.map((amount, index) => {
                const which = index + 1
                const peak = Math.max(1, ...node.runTotals)
                return (
                  <li key={which}>
                    <div className={`rte-runlist__row${which === node.run ? ' is-on' : ''}`}>
                      <span className="rte-runlist__no">{which}</span>
                      <span className="rte-runlist__bar" aria-hidden="true">
                        <i style={{ '--w': `${(amount / peak) * 100}%` } as CSSProperties} />
                      </span>
                      <b className="rte-runlist__amt">{formatDamage(amount, decimals)}</b>
                    </div>
                  </li>
                )
              })}
            </ol>
          </InspectorSection>
        ) : null}

        {block ? (
          <InspectorSection label={<>Items . {node.items.length}</>}>
            <div className="rte-items">
              {node.items.length > 0 ? (
                node.items.map((item) => (
                  <div key={item.id} className={`rte-item rte-item--${item.type} is-static`}>
                    <i className="rte-item__mark" aria-hidden="true" />
                    <span className="rte-item__name">{item.label}</span>
                    {item.note ? <em className="rte-item__note">{item.note}</em> : null}
                  </div>
                ))
              ) : (
                <p className="rte-palette__empty">Nothing inside this block.</p>
              )}
            </div>
          </InspectorSection>
        ) : null}

        {step && node.buffs.length > 0 ? (
          <InspectorSection label={<>Buffs applied . {node.buffs.length}</>} defaultOpen={true}>
            <BuffRows buffs={node.buffs} />
          </InspectorSection>
        ) : null}

        {node.occurrences.length > 0 ? (
          <InspectorSection label={<>Occurrences . {node.occurrences.length}</>}>
            <ReadRefs
              rows={node.occurrences.map((occurrence, index) => ({
                key: `${occurrence.nodeId}:${index}`,
                label: occurrence.label,
                run: occurrence.scopeLabel ?? formatExecutionRun(occurrence.scope),
                here: occurrence.nodeId === node.id,
              }))}
            />
          </InspectorSection>
        ) : null}

        {node.history.length > 0 ? (
          <InspectorSection
            label={<>History . {node.history.length} {node.historyWord}</>}
          >
            <ReadRefs
              rows={node.history.map((entry, index) => ({
                key: `${entry.nodeId}:${index}`,
                label: entry.by,
                run: `${entry.from !== undefined ? `${entry.from || '-'} → ` : ''}${entry.to || '-'}`,
                here: entry.nodeId === node.id,
              }))}
            />
          </InspectorSection>
        ) : null}

        {note || node.attachedNote ? (
          <InspectorSection label="Note" defaultOpen={true}>
            <span
              className={`rte-noteline__said${(note ?? node.attachedNote)?.text ? '' : ' is-empty'}`}
            >
              {(note ?? node.attachedNote)?.text || 'This note has no text yet.'}
            </span>
          </InspectorSection>
        ) : null}
      </div>
    </>
  )
}
