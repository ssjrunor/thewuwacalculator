/*
  Author: Runor Ewhro
  description: selects a weapon or Echo for an equipment conflict.
*/

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { getEchoById } from '@/data/catalog/echoCatalogService'
import { getSntSetClr, getSntSetNam } from '@/data/gameData/catalog/sonataSets'
import { getWpnById } from '@/data/catalog/weaponCatalogService'
import { cmptEchoCrit } from '@/modules/simulation/features/echoes/lib/metric'
import { formatStatKeyLabel, formatStatKeyValue } from '@/modules/simulation/model/statsView'
import { formatTruncCompact } from '@/shared/lib/number'
import type { ReviewRow } from './lib/model'

const KEPT_BEAT_MS = 420

interface ConflictProps {
  row: ReviewRow
  // null selects the weapon conflict
  slotIndex: number | null
  anchor: HTMLElement
  host: HTMLElement
  kept: number | null
  onPick: (sourceIndex: number) => void
  onClose: () => void
}

export function Conflict({ row, slotIndex, anchor, host, kept, onPick, onClose }: ConflictProps) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [place, setPlace] = useState<{ left: number; top: number; tx: number; up: boolean } | null>(null)
  const [shut, setShut] = useState(false)

  useLayoutEffect(() => {
    const pop = ref.current
    if (!pop) return
    const hr = host.getBoundingClientRect()
    const scale = hr.width / host.offsetWidth || 1
    const ar = anchor.getBoundingClientRect()
    const ax = (ar.left + ar.width / 2 - hr.left) / scale
    const top = (ar.top - hr.top) / scale
    const bottom = (ar.bottom - hr.top) / scale
    const w = pop.offsetWidth
    const h = pop.offsetHeight
    const gap = 12
    const up = bottom + gap + h > host.offsetHeight - 8
    const left = Math.max(12, Math.min(host.offsetWidth - w - 12, ax - w / 2))
    setPlace({ left, top: up ? top - gap - h : bottom + gap, tx: ax - left, up })
  }, [anchor, host])

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('.gdi-pop-o')?.focus({ preventScroll: true })
  }, [])

  const dismiss = () => setShut(true)

  useEffect(() => {
    const onDown = (event: PointerEvent) => {
      const target = event.target as Element
      if (ref.current?.contains(target) || target.closest?.('[data-resolve], .gdi-go')) return
      dismiss()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      dismiss()
    }
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [])

  useEffect(() => {
    if (kept == null) return
    const timer = window.setTimeout(dismiss, KEPT_BEAT_MS)
    return () => window.clearTimeout(timer)
  }, [kept])

  const slot = slotIndex == null ? null : row.echoConflicts.find((entry) => entry.slotIndex === slotIndex) ?? null
  if (slotIndex == null ? !row.conflict : !slot) return null
  const style = place
    ? ({ left: place.left, top: place.top, '--tx': `${place.tx}px` } as CSSProperties)
    : ({ visibility: 'hidden' } as CSSProperties)
  const count = slot ? slot.candidates.length : row.conflict!.candidates.length
  const what = slot ? `echoes for slot ${slot.slotIndex + 1}` : 'weapons in the file'

  return (
    <div
      ref={ref}
      className={`gdi-pop${place?.up ? ' is-up' : ''}${shut ? ' is-shut' : ''}`}
      style={style}
      role="dialog"
      aria-label={slot ? `${row.name}'s echo in slot ${slot.slotIndex + 1}` : `${row.name}'s weapon`}
      onAnimationEnd={(event) => { if (shut && event.target === event.currentTarget) onClose() }}
    >
      <div className="gdi-pop-h">
        <img alt="" src={row.profile} />
        <b>{row.name}</b>
        <i>{kept == null ? `${count} ${what}` : slot ? 'Echo kept' : 'Weapon kept'}</i>
      </div>
      {slot ? slot.candidates.map((candidate) => {
        const info = getEchoById(candidate.echo.id)
        const on = kept === candidate.sourceIndex
        const cv = cmptEchoCrit(candidate.echo.substats)
        const primary = candidate.echo.mainStats.primary
        return (
          <button
            key={candidate.sourceIndex}
            type="button"
            className={`gdi-pop-o is-echo${on ? ' is-on' : ''}`}
            style={{ '--rc': getSntSetClr(candidate.echo.set) ?? '#888' } as CSSProperties}
            onClick={() => onPick(candidate.sourceIndex)}
          >
            <span className="gdi-pop-i">{info?.icon ? <img alt="" src={info.icon} /> : null}</span>
            <span className="gdi-pop-t">
              <b>{info?.name ?? 'Echo'}</b>
              <i>{getSntSetNam(candidate.echo.set)}{info ? ` · ${info.cost}c` : ''}</i>
              <u>
                {formatStatKeyLabel(primary.key)} {formatStatKeyValue(primary.key, primary.value)}
                {cv > 0 ? ` · CV ${formatTruncCompact(cv, 1)}` : ''}
              </u>
            </span>
            <span className="gdi-pop-k">{on ? 'Kept' : 'Keep'}</span>
          </button>
        )
      }) : row.conflict!.candidates.map((candidate) => {
        const info = candidate.weapon.id ? getWpnById(candidate.weapon.id) : null
        const on = kept === candidate.sourceIndex
        return (
          <button
            key={candidate.sourceIndex}
            type="button"
            className={`gdi-pop-o gdi-r${info?.rarity ?? 4}${on ? ' is-on' : ''}`}
            onClick={() => onPick(candidate.sourceIndex)}
          >
            <span className="gdi-pop-i">{info?.icon ? <img alt="" src={info.icon} /> : null}</span>
            <span className="gdi-pop-t">
              <b>{info?.name ?? 'Weapon'}</b>
              <i>Lv {candidate.weapon.level} · R{candidate.weapon.rank}</i>
              <u>
                ATK {Math.round(candidate.weapon.baseAtk).toLocaleString('en-US')}
                {info?.statKey ? ` · ${formatStatKeyLabel(info.statKey)} ${formatStatKeyValue(info.statKey, info.statsByLevel?.[candidate.weapon.level]?.secondaryStatValue ?? info.statValue)}` : ''}
              </u>
            </span>
            <span className="gdi-pop-k">{on ? 'Kept' : 'Keep'}</span>
          </button>
        )
      })}
    </div>
  )
}
