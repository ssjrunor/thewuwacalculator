/*
  Author: Runor Ewhro
  description: displays one resonator build and its equipment choices.
*/

import { memo } from 'react'
import type { CSSProperties } from 'react'
import { getEchoById } from '@/data/catalog/echoCatalogService'
import { getSntSetClr } from '@/data/gameData/catalog/sonataSets'
import { getEchoSignature } from '@/domain/entities/inventoryStorage'
import { getWpnById } from '@/data/catalog/weaponCatalogService'
import type { WeaponState } from '@/domain/entities/runtime'
import { ATTR_COLORS } from '@/domain/gameData/attributeDisplay'
import { echoStatIconSrc } from '@/modules/simulation/features/echoes/lib/statGlyph'
import { resNodeIcon } from '@/shared/lib/gameAssets'
import { REVIEW_SKILLS, attrIcon, type BuildDetails, type ReviewRow } from './lib/model'

const CARD_PATH = 'M92 103.5A95.5 95.5 0 0 1 283 103.5V399.5A95.5 95.5 0 0 1 92 399.5Z'
const HOVER_PATH = 'M60 101.0A108.0 108.0 0 0 1 276 101.0V398.0A108.0 108.0 0 0 1 60 398.0Z'

export function TeamDefs() {
  return (
    <svg className="gdi-defs" aria-hidden="true" focusable="false">
      <defs>
        <clipPath id="gdi-tmc"><rect x="-20" y="-20" width="340" height="520" /></clipPath>
        <linearGradient id="gdi-tmv" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0.1" stopColor="#fff" />
          <stop offset="0.3" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.62" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.8" stopColor="#fff" />
        </linearGradient>
        <mask id="gdi-tmm" maskUnits="userSpaceOnUse" x="-20" y="-20" width="340" height="540">
          <rect x="-20" y="-20" width="340" height="540" fill="url(#gdi-tmv)" />
          <rect x="-20" y="380" width="200" height="140" fill="#fff" />
        </mask>
        <clipPath id="gdi-tmh"><path d={HOVER_PATH} /></clipPath>
        <linearGradient id="gdi-tmw" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0.55" stopColor="#e6e8cc" stopOpacity="0" />
          <stop offset="1" stopColor="#e6e8cc" stopOpacity="0.2" />
        </linearGradient>
      </defs>
    </svg>
  )
}

function CardBackground() {
  return (
    <svg className="gdi-tm-back" viewBox="0 0 300 572" aria-hidden="true">
      <path className="cap" d={CARD_PATH} />
      <g className="hover-outline" clipPath="url(#gdi-tmc)" mask="url(#gdi-tmm)">
        <path className="fill" d={HOVER_PATH} fill="url(#gdi-tmw)" />
        <g clipPath="url(#gdi-tmh)">
          <path className="wv" pathLength={1} d="M62 452C110 436 168 478 274 446M66 468C122 452 180 494 276 462M74 484C130 470 196 506 276 478M92 498C150 486 214 516 272 494" />
        </g>
        <path className="ln main" pathLength={1} d={HOVER_PATH} />
        <path className="ln s" pathLength={1} d="M64 106.0A109.0 109.0 0 0 1 282 106.0V402.0A109.0 109.0 0 0 1 64 402.0Z" />
        <path className="ln s" pathLength={1} d="M54 95.0A107.0 107.0 0 0 1 268 95.0V395.0A107.0 107.0 0 0 1 54 395.0Z" />
        <path className="ln s f" pathLength={1} d="M70 110.0A109.0 109.0 0 0 1 288 110.0V405.0A109.0 109.0 0 0 1 70 405.0Z" />
      </g>
      <path className="foot" d="M60 398V495H120.5A108 108 0 0 1 60 398Z" />
    </svg>
  )
}

function DetailsBackground() {
  return (
    <svg className="gdi-tm-details-bg" viewBox="0 0 210 64" preserveAspectRatio="none" aria-hidden="true">
      <path className="lens" d="M0 26Q52 8 105 34Q52 60 0 42M210 26Q158 8 105 34Q158 60 210 42M8 34Q60 20 105 34M202 34Q150 48 105 34" />
      <path className="gl" d="M6 34H204" />
      <path className="st" d="M105 22L107.4 31.6L117 34L107.4 36.4L105 46L102.6 36.4L93 34L102.6 31.6Z" />
    </svg>
  )
}

const rarityClass = (rarity: number | undefined) => `gdi-r${rarity ?? 4}`

// an omitted slot index selects a weapon conflict.
export type ResolveHandler = (resonatorId: string, anchor: HTMLElement, slotIndex?: number) => void

interface TeamProps {
  row: ReviewRow
  index: number
  side: 'file' | 'now'
  build: BuildDetails | null
  // current build for change markers
  current: BuildDetails | null
  weapon: WeaponState | null
  open: boolean
  // selection state for contested Echo slots
  slots: ReadonlyMap<number, boolean>
  off: boolean
  done: boolean
  onSkip?: (resonatorId: string) => void
  onResolve?: ResolveHandler
}

function Weapon({ row, weapon, open, resolvable, kept, onResolve }: {
  row: ReviewRow
  weapon: WeaponState | null
  open: boolean
  resolvable: boolean
  // current weapon when the file has none
  kept: boolean
  onResolve?: ResolveHandler
}) {
  if (open) {
    return (
      <div className="gdi-wpn is-unset">
        <button
          type="button"
          className="gdi-wpn-w"
          aria-label={`Choose ${row.name}'s weapon`}
          data-resolve={row.id}
          onClick={(event) => onResolve?.(row.id, event.currentTarget)}
        >
          ?
        </button>
      </div>
    )
  }
  if (!weapon?.id) return null
  const info = getWpnById(weapon.id)
  const title = `${info?.name ?? 'Weapon'}, Lv ${weapon.level}${kept ? '. Not in the file, kept as it is' : ''}`
  const body = (
    <>
      {info?.icon ? <img alt="" src={info.icon} /> : null}
      <b>R{weapon.rank}</b>
    </>
  )
  return (
    <div className={`gdi-wpn${kept ? ' is-kept' : ''}`}>
      {resolvable ? (
        <button
          type="button"
          className={`gdi-wpn-w ${rarityClass(info?.rarity)}`}
          title={title}
          aria-label={`${info?.name ?? 'Weapon'}. Change ${row.name}'s weapon`}
          data-resolve={row.id}
          onClick={(event) => onResolve?.(row.id, event.currentTarget)}
        >
          {body}
        </button>
      ) : (
        <span className={`gdi-wpn-w ${rarityClass(info?.rarity)}`} title={title}>{body}</span>
      )}
    </div>
  )
}

function EchoSlots({ id, name, build, current, slots, onResolve }: {
  id: string
  name: string
  build: BuildDetails
  current: BuildDetails | null
  // contested slots available for selection before import
  slots: ReadonlyMap<number, boolean> | null
  onResolve?: ResolveHandler
}) {
  const sig = (slot: number, echoes: BuildDetails['echoes']) => (echoes[slot] ? getEchoSignature(echoes[slot]) : '')
  const changed = current != null && build.echoes.some((_, slot) => sig(slot, build.echoes) !== sig(slot, current.echoes))
  return (
    <div className={`gdi-tm-ec${changed ? ' chg' : ''}`}>
      {build.echoes.map((echo, slot) => {
        const contested = slots?.has(slot) ?? false
        if (contested && !slots!.get(slot)) {
          return (
            <button
              key={slot}
              type="button"
              className="gdi-tm-ec-q"
              aria-label={`Choose ${name}'s echo for slot ${slot + 1}`}
              data-resolve={`${id}:${slot}`}
              onClick={(event) => onResolve?.(id, event.currentTarget, slot)}
            >
              ?
            </button>
          )
        }
        if (!echo) return <span key={slot} />
        const def = getEchoById(echo.id)
        const glyph = echoStatIconSrc(echo.mainStats.primary.key)
        const inner = (
          <>
            {def?.icon ? <img alt="" src={def.icon} /> : null}
            {glyph ? <i className="gdi-g" style={{ '--g': `url("${glyph}")` } as CSSProperties} /> : null}
          </>
        )
        const style = { '--set': getSntSetClr(echo.set) ?? '#888' } as CSSProperties
        return contested ? (
          <button
            key={slot}
            type="button"
            className="has gdi-tm-ec-p"
            style={style}
            title={`${def?.name ?? 'Echo'}. Change slot ${slot + 1}`}
            data-resolve={`${id}:${slot}`}
            onClick={(event) => onResolve?.(id, event.currentTarget, slot)}
          >
            {inner}
          </button>
        ) : (
          <span key={slot} className="has" style={style} title={def?.name}>{inner}</span>
        )
      })}
    </div>
  )
}

function Skills({ id, build, current }: { id: string; build: BuildDetails; current: BuildDetails | null }) {
  return (
    <div className="gdi-tm-sk">
      {REVIEW_SKILLS.map((key, index) => (
        <span key={key} className={current && current.skills[index] !== build.skills[index] ? 'chg' : ''} title={key}>
          <i style={{ '--img': `url("${resNodeIcon(id, key)}")` } as CSSProperties} />
          {build.skills[index]}
        </span>
      ))}
    </div>
  )
}

export const Team = memo(function Team({
  row, index, side, build, current, weapon, open, slots, off, done, onSkip, onResolve,
}: TeamProps) {
  const n = index + 1
  const fileSide = side === 'file'
  const chg = (changed: boolean) => (fileSide && current && changed ? 'chg' : '')
  const style = { '--el': ATTR_COLORS[row.attribute], '--i': index } as CSSProperties

  return (
    <div className={`gdi-tm${build ? '' : ' is-new'}${off ? ' is-off' : ''}`} style={style} data-id={row.id}>
      <CardBackground />
      <i className="gdi-tm-dots" /><i className="gdi-tm-qd" />
      <i className={`gdi-tm-num${n > 9 ? ' two' : ''}`}>{n}</i>
      <i className="gdi-tm-vl a" /><i className="gdi-tm-vl b" /><i className="gdi-tm-vl c" />
      <i className="gdi-tm-vt" /><i className="gdi-tm-hl" /><i className="gdi-tm-star" /><i className="gdi-tm-base" />
      <div className="gdi-tm-art">
        {build
          ? <img className="spr" alt="" src={row.sprite} draggable={false} />
          : <i className="sil" style={{ '--m': `url("${row.sprite}")` } as CSSProperties} />}
      </div>
      <i className="gdi-tm-rl" /><i className="gdi-tm-rr" />
      {build ? (
        <Weapon
          row={row}
          weapon={weapon}
          open={fileSide && open}
          resolvable={fileSide && !done && row.conflict != null && !off}
          kept={fileSide && !row.weaponFromFile && !row.conflict}
          onResolve={onResolve}
        />
      ) : null}
      <span className="gdi-tm-el"><img alt="" src={attrIcon(row.attribute)} /></span>
      {build ? <span className={`gdi-tm-seq ${chg(current?.sequence !== build.sequence)}`}>S{build.sequence}</span> : null}
      {build ? <div className="gdi-tm-lv"><span>Lv.</span><b className={chg(current?.level !== build.level)}>{build.level}</b></div> : null}
      <div className="gdi-tm-nm">{row.name}</div>
      {build ? (
        <div className="gdi-tm-details">
          <DetailsBackground />
          <EchoSlots
            id={row.id}
            name={row.name}
            build={build}
            current={fileSide ? current : null}
            slots={fileSide && !done && !off && slots.size ? slots : null}
            onResolve={onResolve}
          />
          <Skills id={row.id} build={build} current={fileSide ? current : null} />
        </div>
      ) : <div className="gdi-tm-details nw">New</div>}
      {fileSide && !done ? (
        <button type="button" className="gdi-x" onClick={() => onSkip?.(row.id)}>{off ? 'Skipped' : 'Skip'}</button>
      ) : null}
    </div>
  )
})
