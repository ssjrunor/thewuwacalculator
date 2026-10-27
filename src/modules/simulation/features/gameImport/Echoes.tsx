/*
  Author: Runor Ewhro
  description: groups imported Echoes by level for selection.
*/

import { memo } from 'react'
import type { CSSProperties, MouseEvent } from 'react'
import { getEchoById } from '@/data/catalog/echoCatalogService'
import { getSntSetClr, getSntSetIco, getSntSetNam } from '@/data/gameData/catalog/sonataSets'
import { cmptEchoCrit } from '@/modules/simulation/features/echoes/lib/metric'
import { EchoCardBand, EchoCardList, echoCardVars, type EchoCardStat } from '@/modules/simulation/features/echoes/ui/EchoCard'
import { formatTruncCompact } from '@/shared/lib/number'
import { echoLocked, type ReviewEcho, type ReviewEchoGroup, type ReviewPicks } from './lib/model'

type Lock = Pick<ReviewPicks, 'skip' | 'slots'>

export type EchoTab = 'all' | 'sel' | 'off'

const fmt = (n: number) => n.toLocaleString('en-US')

function TickGlyph() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
}

function subsOf(entry: ReviewEcho): EchoCardStat[] {
  return Object.entries(entry.echo.substats)
    .filter(([, value]) => Number.isFinite(value) && value !== 0)
    .map(([key, value]) => ({ key, value }))
}

const EchoTile = memo(function EchoTile({ entry, on, locked, ownerImage, ownerName, done, onPick }: {
  entry: ReviewEcho
  on: boolean
  locked: boolean
  ownerImage: string | null
  ownerName: string | null
  done: boolean
  onPick: (uid: string, event: MouseEvent) => void
}) {
  const def = getEchoById(entry.echo.id)
  if (!def) return null
  const color = getSntSetClr(entry.echo.set)
  const cv = cmptEchoCrit(entry.echo.substats)
  const vars = echoCardVars({ setColor: color ? `color-mix(in srgb, ${color} 68%, var(--text))` : null, cv })
  return (
    <button
      type="button"
      className={`ecr-card gdi-ec${on ? ' is-on' : ''}${locked ? ' is-lock' : ''}`}
      style={vars}
      aria-pressed={locked ? undefined : on}
      aria-disabled={locked || done || undefined}
      title={locked && ownerName
        ? `${def.name}, worn by ${ownerName}`
        : entry.sourceIndex != null && ownerName && entry.slotIndex != null
          ? `${def.name}, one of two in ${ownerName}'s slot ${entry.slotIndex + 1}`
          : def.name}
      onClick={(event) => { if (!locked && !done) onPick(entry.echo.uid, event) }}
    >
      <EchoCardBand
        icon={def.icon}
        name={def.name}
        setIcon={getSntSetIco(entry.echo.set)}
        setName={getSntSetNam(entry.echo.set)}
        mainEcho={false}
        primary={entry.echo.mainStats.primary}
        secondary={entry.echo.mainStats.secondary}
        overlay={ownerImage ? <img className="gdi-ec-owner" alt="" src={ownerImage} /> : null}
      />
      <span className="gdi-ec-nl">
        <span>{def.name}</span>
        {cv > 0 ? <i>{formatTruncCompact(cv, 1)}</i> : null}
      </span>
      <EchoCardList subs={subsOf(entry)} />
      <span className="gdi-ec-foot">
        <span>{def.cost}c</span>
        <span>Lv {entry.level}</span>
        {locked && entry.slotIndex != null
          ? <span className="gdi-ec-slot">S{entry.slotIndex + 1}</span>
          : <span className={`gdi-tick${on ? ' is-on' : ''}`}><TickGlyph /></span>}
      </span>
    </button>
  )
})

export function groupState(group: ReviewEchoGroup, lock: Lock, sel: ReadonlySet<string>): '' | 'is-on' | 'is-mix' {
  const free = group.items.filter((entry) => !echoLocked(entry, lock))
  if (!free.length) return 'is-on'
  const n = free.filter((entry) => sel.has(entry.echo.uid)).length
  return n === 0 ? '' : n === free.length ? 'is-on' : 'is-mix'
}

interface EchoesProps {
  groups: ReviewEchoGroup[]
  unlevelled: number
  total: number
  count: number
  tab: EchoTab
  lock: Lock
  sel: ReadonlySet<string>
  done: boolean
  owners: Record<string, { profile: string; name: string }>
  onTab: (tab: EchoTab) => void
  onPick: (uid: string, event: MouseEvent) => void
  onGroup: (groupId: string) => void
  onJump: (groupId: string) => void
}

export function Echoes({
  groups, unlevelled, total, count, tab, lock, sel, done, owners, onTab, onPick, onGroup, onJump,
}: EchoesProps) {
  const isOn = (entry: ReviewEcho) => echoLocked(entry, lock) || sel.has(entry.echo.uid)
  const visible = (entry: ReviewEcho) => (tab === 'sel' ? isOn(entry) : tab === 'off' ? !isOn(entry) : true)
  const listed = groups.reduce((sum, group) => sum + group.items.length, 0)

  return (
    <>
      <div className="gdi-ex-bar">
        <h3>Echoes</h3>
        <div className="gdi-ex-n"><b>{fmt(count)}</b><span>/ {fmt(total)}</span></div>
        <div className="gdi-rib">
          {groups.map((group) => {
            const share = group.items.length / Math.max(1, listed + unlevelled)
            const fill = group.items.filter(isOn).length / group.items.length
            return (
              <button
                key={group.id}
                type="button"
                className={group.id === 'eq' ? 'is-eq' : ''}
                style={{ flexGrow: Math.max(share, 0.008), '--f': `${(fill * 100).toFixed(1)}%` } as CSSProperties}
                title={`${group.label}: ${group.items.filter(isOn).length} / ${group.items.length}`}
                onClick={() => onJump(group.id)}
              >
                <i />
                <span>{group.id === 'eq' ? 'Eq.' : group.level}</span>
              </button>
            )
          })}
          {unlevelled ? <span className="gdi-rib-z" style={{ flexGrow: Math.max(unlevelled / Math.max(1, listed + unlevelled), 0.08) }} title={`Lv 0: ${fmt(unlevelled)}`}><span>0</span></span> : null}
        </div>
        <div className="gdi-tabs" role="tablist">
          {([['all', 'All'], ['sel', 'Selected'], ['off', 'Not selected']] as const).map(([key, label]) => (
            <button key={key} type="button" role="tab" aria-selected={tab === key} className={tab === key ? 'is-on' : ''} onClick={() => onTab(key)}>{label}</button>
          ))}
        </div>
      </div>
      {groups.map((group) => {
        const items = group.items.filter(visible)
        if (!items.length) return null
        const allLocked = group.items.every((entry) => echoLocked(entry, lock))
        return (
          <section className="gdi-grp" id={`gdi-g-${group.id}`} key={group.id}>
            <div className="gdi-gh">
              {allLocked || done ? null : (
                <button type="button" className={`gdi-tick ${groupState(group, lock, sel)}`} aria-label={`Select ${group.label}`} onClick={() => onGroup(group.id)}>
                  <TickGlyph />
                </button>
              )}
              <b>{group.label}</b>
              <span className="c">{group.items.filter(isOn).length} / {group.items.length}</span>
              <i className="rule" />
            </div>
            <div className="gdi-grid">
              {items.map((entry) => {
                const locked = echoLocked(entry, lock)
                const owner = (locked || (entry.sourceIndex != null && !lock.skip.has(entry.ownerId!))) && entry.ownerId
                  ? owners[entry.ownerId] : null
                return (
                  <EchoTile
                    key={entry.echo.uid}
                    entry={entry}
                    on={isOn(entry)}
                    locked={locked}
                    ownerImage={owner?.profile ?? null}
                    ownerName={owner?.name ?? null}
                    done={done}
                    onPick={onPick}
                  />
                )
              })}
            </div>
          </section>
        )
      })}
      {tab !== 'sel' && unlevelled ? (
        <section className="gdi-grp">
          <div className="gdi-gh"><b>Lv 0</b><span className="c">{fmt(unlevelled)}</span><i className="rule" /></div>
          <div className="gdi-zero"><b>{fmt(unlevelled)}</b>Skipped</div>
        </section>
      ) : null}
      <div className="gdi-tail" />
    </>
  )
}
