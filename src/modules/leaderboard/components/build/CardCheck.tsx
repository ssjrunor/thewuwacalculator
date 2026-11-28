/*
  Author: Runor Ewhro
  description: staff check of a build against its stored Kuro card, with the fixes for a misread report.
*/

import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { StaffBuildDetails, StaffCardResponse } from '@/domain/leaderboard/api'
import type { BuildSnapshot } from '@/domain/leaderboard/snapshot'
import { Select } from '@/application/ui/Select'
import { getResById } from '@/data/catalog/resonatorCatalogService'
import { listWpnsByTy } from '@/data/catalog/weaponCatalogService'
import AppLdrVrly from '@/shared/ui/AppLoaderOverlay'
import { lbApi } from '../../api/client'
import { invalidate, invalidateLb, lbKeys } from '../../api/queries'
import { errorText } from '../../model/cardTrack'
import { CardBuildError, loadPendingCard, type CardBuild } from '../../model/cardBuild'
import { dayText } from '../../model/format'
import { useScope } from '../../state/ctx'
import { LbCard } from './LbCard'

const CARD_WIDTH = 992

// the width of an element, followed as it resizes
function useWidth() {
  const ref = useRef<HTMLDivElement | null>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return { ref, width }
}

// the app's card for what was read, drawn once per read
function AsRead({ card }: { card: StaffCardResponse }) {
  // a card refused for its uid alone is drawn from what else was read
  const snapshot = card.read?.snapshot ?? card.read?.awaitingUid ?? null
  const key = snapshot ? `${card.cardId}:${card.read!.parserVer}` : null
  const [drawn, setDrawn] = useState<{ key: string; build: CardBuild | null; error: string | null } | null>(null)
  const { ref, width } = useWidth()
  useEffect(() => {
    if (!snapshot || !key) return
    let live = true
    loadPendingCard({ buildId: card.buildId ?? card.cardId, snapshot }).then(
      (build) => { if (live) setDrawn({ key, build, error: null }) },
      (error: unknown) => { if (live) setDrawn({ key, build: null, error: error instanceof CardBuildError ? error.message : errorText(error) }) })
    return () => { live = false }
  }, [card.buildId, card.cardId, key, snapshot])

  if (!snapshot) return <p className="quiet">nothing was read off this card, so there is no build to draw.</p>
  const shown = drawn?.key === key ? drawn : null
  return (
    <>
    {snapshot.weapon.id ? null : <p className="quiet">no weapon was read, so this is drawn with the board's top scenario weapon. pick the real one under Fill in.</p>}
    <div ref={ref} className="stf-fit" style={{ height: width ? 720 * (width / CARD_WIDTH) : undefined }}>
      {shown?.build && width ? (
        <div className="fcard" style={{ zoom: width / CARD_WIDTH }}>
          <LbCard build={shown.build} score={null} damage={null} holder={{ name: snapshot.name, uid: snapshot.uid || null }} />
        </div>
      ) : shown?.error ? <p className="quiet">{shown.error}</p> : <AppLdrVrly mode="inline" text="putting the card together... :P" />}
    </div>
    </>
  )
}

const SKILLS: Array<[string, string]> = [['normalAttack', 'Basic'], ['resonanceSkill', 'Skill'], ['forteCircuit', 'Forte'],
  ['resonanceLiberation', 'Liberation'], ['introSkill', 'Intro']]

type Draft = Record<string, string>

// the fields staff may fill in, as the stored build has them
function draftOf(snapshot: BuildSnapshot): Draft {
  const draft: Draft = { name: snapshot.name ?? '', level: String(snapshot.resonator.level ?? ''), weapon: snapshot.weapon.id ?? '',
    weaponLevel: String(snapshot.weapon.level ?? '') }
  for (const [key] of SKILLS) if (key in snapshot.resonator.skillLevels) draft[`skill:${key}`] = String(snapshot.resonator.skillLevels[key] ?? '')
  return draft
}

// the changed fields as a request, or a reason it can't be sent
function detailsOf(draft: Draft, stored: Draft): StaffBuildDetails | string {
  const details: StaffBuildDetails = {}
  const whole = (value: string, max: number, what: string) => {
    const n = Number(value)
    if (!/^\d+$/.test(value) || n < 1 || n > max) throw new Error(`${what} is a whole number from 1 to ${max}`)
    return n
  }
  try {
    for (const [field, raw] of Object.entries(draft)) {
      const value = raw.trim()
      if (value === stored[field] || (!value && !stored[field])) continue
      if (field === 'name') {
        if (!value) return 'a name can be changed, not cleared'
        details.name = value
      } else if (field === 'weapon') {
        if (!value) return 'a weapon can be changed, not cleared'
        details.weaponId = value
      } else if (field === 'level') details.level = whole(value, 90, 'the resonator level')
      else if (field === 'weaponLevel') details.weaponLevel = whole(value, 90, 'the weapon level')
      else {
        const key = field.slice('skill:'.length)
        details.skillLevels = { ...details.skillLevels, [key]: whole(value, 10, `${SKILLS.find(([k]) => k === key)?.[1] ?? key}'s level`) }
      }
    }
  } catch (error) {
    return (error as Error).message
  }
  return Object.keys(details).length ? details : 'nothing changed'
}

// read again, score again, and fill in what scoring maxes
function Fixes({ card }: { card: StaffCardResponse }) {
  const { toast } = useScope()
  const build = card.build!
  const stored = draftOf(build.snapshot)
  const seed = JSON.stringify(stored)
  // reseeded when the stored build changes (a save, a re-read)
  const [draft, setDraft] = useState<{ seed: string; values: Draft }>({ seed, values: stored })
  if (draft.seed !== seed) setDraft({ seed, values: stored })
  const [busy, setBusy] = useState(false)
  const changed = detailsOf(draft.values, stored)
  const weaponType = getResById(build.snapshot.resonator.id)?.weaponType
  const weapons = weaponType ? listWpnsByTy(weaponType).map((weapon) => ({ value: weapon.id, label: weapon.name, icon: weapon.icon })) : []

  const run = (work: Promise<unknown>, done: string) => {
    setBusy(true)
    work.then(() => {
      toast(done)
      void invalidate(lbKeys.staffBuildCard(build.id))
      void invalidateLb()
    }, (error: unknown) => toast(errorText(error), true)).finally(() => setBusy(false))
  }
  const field = (key: string, label: string, wide = false) => {
    const missing = !stored[key]
    return (
      <label key={key} className={`stf-fill-f${wide ? ' wide' : ''}${missing ? ' missing' : ''}`}>
        <span>{label}{missing ? <em>missing</em> : null}</span>
        <input value={draft.values[key] ?? ''} inputMode={wide ? undefined : 'numeric'} maxLength={wide ? 32 : 2} aria-label={label}
          onChange={(event) => setDraft({ seed, values: { ...draft.values, [key]: event.target.value } })} />
      </label>
    )
  }

  return (
    <div className="stf-fix">
      <div className="stf-fix-acts">
        <button type="button" className="act" disabled={busy || !card.imageKept || card.status === 'blocked'}
          title={!card.imageKept ? "the card's image was erased" : card.status === 'blocked' ? 'the card is blocked' : undefined}
          onClick={() => run(lbApi.staff.reread(card.cardId), 'card queued for a re-read! a different build replaces this one. :P')}>Read again</button>
        <button type="button" className="act" disabled={busy || build.removed}
          onClick={() => run(lbApi.staff.rescore(build.id), 'build queued for scoring again! :P')}>Score again</button>
      </div>
      <h5>Fill in</h5>
      <p className="stf-fix-note">scoring maxes these, so scores and ownership stay. a name renames the player too.</p>
      <div className="stf-fill">
        {field('name', 'Player name', true)}
        {field('level', 'Resonator Lv')}
        <label className={`stf-fill-f wide${stored.weapon ? '' : ' missing'}`}>
          <span>Weapon{stored.weapon ? null : <em>missing</em>}</span>
          <Select value={draft.values.weapon ?? ''} options={weapons} placeholder="Pick a weapon" ariaLabel="Weapon"
            onChange={(value) => setDraft({ seed, values: { ...draft.values, weapon: value } })} />
        </label>
        {field('weaponLevel', 'Weapon Lv')}
        {SKILLS.filter(([key]) => `skill:${key}` in stored).map(([key, label]) => field(`skill:${key}`, label))}
      </div>
      <div className="stf-acts">
        {typeof changed === 'string' && changed !== 'nothing changed' ? <span className="bad">{changed}</span> : null}
        <button type="button" className="act go" disabled={busy || typeof changed === 'string'}
          onClick={() => typeof changed !== 'string' && run(lbApi.staff.fillIn(build.id, changed), 'build filled in! thanks :P')}>Save</button>
      </div>
    </div>
  )
}

// a refused card's uid, read off the image by staff: placing it makes the build, and the report moves to it
function UidFix({ card }: { card: StaffCardResponse }) {
  const { toast } = useScope()
  const guess = card.read?.awaitingUid?.uid ?? ''
  const [uid, setUid] = useState(/^\d{9}$/.test(guess) ? guess : '')
  const [busy, setBusy] = useState(false)
  const clean = uid.replace(/\s+/g, '')
  const valid = /^[1-9]\d{8}$/.test(clean)
  const place = () => {
    setBusy(true)
    lbApi.staff.setUid(card.cardId, clean).then(() => {
      toast(`build placed under UID ${clean}! :P`)
      void invalidate(lbKeys.staff())
      void invalidateLb()
    }, (error: unknown) => toast(errorText(error), true)).finally(() => setBusy(false))
  }
  return (
    <div className="stf-fix">
      <h5>Enter UID</h5>
      <p className="stf-fix-note">
        {/^\d{9}$/.test(guess) ? `the reader's best read was ${guess}, but its two reads disagreed. ` : 'the reader could not read the UID. '}
        check the card and enter the UID printed on it; the build is placed under it.
      </p>
      <div className="stf-fill">
        <label className="stf-fill-f wide missing">
          <span>UID<em>missing</em></span>
          <input value={uid} inputMode="numeric" maxLength={11} aria-label="UID" onChange={(event) => setUid(event.target.value)} />
        </label>
      </div>
      <div className="stf-acts">
        {clean && !valid ? <span className="bad">a UID is 9 digits</span> : null}
        <button type="button" className="act go" disabled={busy || !valid} onClick={place}>Place build</button>
      </div>
    </div>
  )
}

export function CardCheck({ buildId, cardId = null, fixes = false }: { buildId: string | null; cardId?: string | null; fixes?: boolean }) {
  // opened per report subject: another report starts closed. a card report uses its card as the key, so it stays
  // open when entering the uid gives it a build
  const subject = cardId ?? buildId ?? ''
  const [openFor, setOpenFor] = useState<string | null>(null)
  const open = openFor === subject
  const read = useQuery({ queryKey: buildId ? lbKeys.staffBuildCard(buildId) : lbKeys.staffCard(subject),
    queryFn: () => buildId ? lbApi.staff.buildCard(buildId) : lbApi.staff.card(subject), enabled: open && !!subject })
  const card = read.data
  const doubts = card?.read ? [...card.read.confidence.flags ?? [],
    ...(card.read.confidence.review ?? []).map(({ slot, key }) => `echo ${slot + 1} ${key} corrected`)] : []

  if (!open) return <button type="button" className="lk" onClick={() => setOpenFor(subject)}>Compare with the Kuro card</button>
  if (read.error) return <p className="quiet">{errorText(read.error)}</p>
  if (!card) return <AppLdrVrly mode="inline" text="fetching the card... :P" />
  return (
    <div className="stf-card">
      <p className="stf-card-meta">
        card {card.cardId}, drawn {dayText(card.drawnAt)}{card.read ? `, read by ${card.read.parserVer}` : ''}
        {card.status !== 'read' ? `, ${card.rejectReason ?? card.status}` : ''}
        {doubts.length ? <><br />{doubts.join(', ')}</> : null}
      </p>
      <h5>Kuro card</h5>
      {card.imageKept
        ? <img className="stf-kuro" src={lbApi.staff.cardImageUrl(card.cardId)} alt={`Kuro card ${card.cardId}`} />
        : <p className="quiet">this card's image was erased by retention.</p>}
      <h5>As read</h5>
      <AsRead card={card} />
      {fixes && card.build ? <Fixes card={card} /> : null}
      {fixes && !card.build && card.status === 'rejected' && card.rejectReason === 'uid_unreadable' && card.read?.awaitingUid
        ? <UidFix card={card} /> : null}
    </div>
  )
}
