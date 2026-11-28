/*
  Author: Runor Ewhro
  description: the profile editor; saving replaces the profile document except its privacy.
*/

import { useEffect, useMemo, useRef, useState } from 'react'
import { Plus, X } from 'lucide-react'
import type { MediaItem, PlayerProfileResponse } from '@/domain/leaderboard/api'
import type { ImageFrame, ProfileDoc } from '@/domain/leaderboard/documents'
import { lbApi } from '../../api/client'
import { LbModal } from '../../chrome/LbModal'
import { PICK_TYPES, PrepareError, prepareImage } from '../../lib/prepareImage'
import { errorText } from '../../model/cardTrack'
import { regionCode, resFace, resName } from '../../model/format'
import type { Row } from '../../model/listed'
import { AccentPicker, LookStage } from './ProfileLook'

const MAX = { name: 24, bio: 280, label: 24, links: 4, featured: 6 }

interface Draft {
  displayName: string
  bio: string
  links: Array<{ label: string; url: string }>
  accent: string | null
  avatar: string | null
  banner: string | null
  avatarFrame: ImageFrame | null
  bannerFrame: ImageFrame | null
  featured: string[]
  followers: boolean
}

const draftOf = (doc: ProfileDoc | null): Draft => ({
  displayName: doc?.displayName ?? '', bio: doc?.bio ?? '', links: doc?.links.map((l) => ({ ...l })) ?? [],
  accent: doc?.accent ?? null, avatar: doc?.avatar ?? null, banner: doc?.banner ?? null,
  avatarFrame: doc?.avatarFrame ?? null, bannerFrame: doc?.bannerFrame ?? null, featured: doc?.featured ?? [],
  followers: doc?.privacy.followers ?? true,
})

function docOf(d: Draft): ProfileDoc {
  return {
    ...(d.displayName.trim() ? { displayName: d.displayName.trim() } : {}),
    ...(d.bio.trim() ? { bio: d.bio.trim() } : {}),
    links: d.links.filter((l) => l.label.trim() && l.url.trim()).map((l) => ({ label: l.label.trim(), url: l.url.trim() })),
    ...(d.accent ? { accent: d.accent } : {}),
    ...(d.avatar ? { avatar: d.avatar } : {}),
    ...(d.banner ? { banner: d.banner } : {}),
    ...(d.avatar && d.avatarFrame ? { avatarFrame: d.avatarFrame } : {}),
    ...(d.banner && d.bannerFrame ? { bannerFrame: d.bannerFrame } : {}),
    featured: d.featured,
    privacy: { followers: d.followers },
  }
}

// what is wrong with a draft, before the service says so
function problem(d: Draft): string | null {
  for (const l of d.links) {
    if (!l.label.trim() && !l.url.trim()) continue
    if (!l.label.trim()) return "hmm... give each link a label so people know where it goes :P"
    try { if (new URL(l.url.trim()).protocol !== 'https:') return "hmm... links need to start with https:// :P" } catch { return `hmm... "${l.url}" doesn't look like a full link. try an https:// address :P` }
  }
  return null
}

export function ProfileEditor({ profile, rows, onClose, onSaved }: {
  profile: PlayerProfileResponse
  rows: Row[]
  onClose: () => void
  onSaved: (message: string) => void
}) {
  const [open, setOpen] = useState(true)
  const start = useMemo(() => draftOf(profile.profile), [profile.profile])
  const [d, setD] = useState<Draft>(start)
  const [media, setMedia] = useState<Map<string, MediaItem>>(new Map())
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const edit = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }))
  // one hidden file input for both images, with a ref to the requesting image
  const picker = useRef<HTMLInputElement>(null)
  const picking = useRef<'avatar' | 'banner'>('avatar')
  const pickFor = (purpose: 'avatar' | 'banner') => { picking.current = purpose; picker.current?.click() }
  const statusOf = (id: string | null) => id ? media.get(id)?.status ?? null : null

  useEffect(() => {
    lbApi.myMedia().then((r) => setMedia(new Map(r.media.map((m) => [m.id, m]))), () => undefined)
  }, [])

  // the modal plays its exit, then the profile unmounts it
  const close = () => { setOpen(false); window.setTimeout(onClose, 340) }

  const upload = (purpose: 'avatar' | 'banner', file: File) => {
    setBusy(purpose)
    setNote(null)
    // scale and re-encode before upload, which shrinks large photos and strips their metadata
    prepareImage(file, purpose).then((image) => lbApi.upload(purpose, image)).then((m) => { setMedia((all) => new Map(all).set(m.id, m)); edit({ [purpose]: m.id, [`${purpose}Frame`]: null }) },
      (e: unknown) => setNote(e instanceof PrepareError ? e.message : errorText(e))).finally(() => setBusy(null))
  }

  const save = async () => {
    const wrong = problem(d)
    if (wrong) { setNote(wrong); return }
    setBusy('save')
    setNote(null)
    try {
      await lbApi.putProfile(docOf(d))
      onSaved(d.avatar !== start.avatar || d.banner !== start.banner ? "profile saved! any new images show to others after staff approve them :P" : 'profile saved! :P')
      close()
    } catch (e) {
      setNote(errorText(e))
    } finally {
      setBusy(null)
    }
  }

  const ranked = rows
  const pickable = ranked.filter((x) => !d.featured.includes(x.buildId))
  const byId = new Map(rows.map((x) => [x.buildId, x]))

  return (
    <LbModal open={open} onClose={close} over="Your profile" title="Edit profile" className="ped"
      foot={<>
        {note ? <span className="ped-note" role="alert">{note}</span> : <span className="ped-foot">save to update your text! new images show to others after staff approve them :P</span>}
        <span className="amdl__fill" />
        <button type="button" className="amdl__act" onClick={close}>Cancel</button>
        <button type="button" className="amdl__act is-go" disabled={busy != null} onClick={() => void save()}>{busy === 'save' ? 'Saving' : 'Save'}</button>
      </>}>
      <section className="amdl__grp">
        <h3 className="amdl__grp-name">Banner and avatar <span className="amdl__grp-n">drag to move, scroll to zoom :P</span></h3>
        <LookStage name={d.displayName.trim() || profile.name || 'Unnamed'} region={regionCode(profile.region) ?? null} accent={d.accent}
          avatar={{ src: d.avatar ? lbApi.mediaUrl(d.avatar) : null, frame: d.avatarFrame, status: statusOf(d.avatar) }}
          banner={{ src: d.banner ? lbApi.mediaUrl(d.banner) : null, frame: d.bannerFrame, status: statusOf(d.banner) }}
          busy={busy === 'avatar' || busy === 'banner' ? busy : null}
          onFrame={(purpose, frame) => edit({ [`${purpose}Frame`]: frame })}
          onPick={pickFor} onClear={(purpose) => edit({ [purpose]: null, [`${purpose}Frame`]: null })} />
        <input ref={picker} type="file" accept={PICK_TYPES} hidden
          onChange={(event) => { const f = event.target.files?.[0]; if (f) upload(picking.current, f); event.target.value = '' }} />
      </section>
      <div className="ped-cols">
        <div>
          <section className="amdl__grp">
            <h3 className="amdl__grp-name">Name and signature</h3>
            <label className="ped-f"><span>Display name</span>
              <input value={d.displayName} maxLength={MAX.name} placeholder={profile.name ?? 'In-game name'} onChange={(e) => edit({ displayName: e.target.value })} />
              <small>{d.displayName.length} / {MAX.name}</small></label>
            <label className="ped-f"><span>Signature</span>
              <textarea value={d.bio} maxLength={MAX.bio} rows={3} placeholder="a little about you or your builds..." onChange={(e) => edit({ bio: e.target.value })} />
              <small>{d.bio.length} / {MAX.bio}</small></label>
          </section>
          <section className="amdl__grp">
            <h3 className="amdl__grp-name">Links <span className="amdl__grp-n">{d.links.length} / {MAX.links}</span></h3>
            {d.links.map((l, i) => (
              <div key={i} className="ped-link">
                <input value={l.label} maxLength={MAX.label} placeholder="Label" aria-label="Link label"
                  onChange={(e) => edit({ links: d.links.map((x, j) => j === i ? { ...x, label: e.target.value } : x) })} />
                <input value={l.url} placeholder="https://" aria-label="Link address"
                  onChange={(e) => edit({ links: d.links.map((x, j) => j === i ? { ...x, url: e.target.value } : x) })} />
                <button type="button" className="ped-x" aria-label="Remove link" onClick={() => edit({ links: d.links.filter((_, j) => j !== i) })}><X aria-hidden="true" /></button>
              </div>
            ))}
            {d.links.length < MAX.links ? <button type="button" className="ped-add" onClick={() => edit({ links: [...d.links, { label: '', url: '' }] })}><Plus aria-hidden="true" />Add link</button> : null}
          </section>
          <section className="amdl__grp">
            <h3 className="amdl__grp-name">Featured builds <span className="amdl__grp-n">{d.featured.length} / {MAX.featured}</span></h3>
            <div className="ped-feat">
              {[...d.featured.map((id) => byId.get(id)).filter((x): x is Row => Boolean(x)), ...pickable].map((x) => {
                const at = d.featured.indexOf(x.buildId)
                return (
                  <button key={x.buildId} type="button" className={`ped-chip${at >= 0 ? ' on' : ''}`} aria-pressed={at >= 0}
                    disabled={at < 0 && d.featured.length >= MAX.featured}
                    onClick={() => edit({ featured: at >= 0 ? d.featured.filter((f) => f !== x.buildId) : [...d.featured, x.buildId] })}>
                    {at >= 0 ? <b>{at + 1}</b> : null}<img src={resFace(x.resonatorId)} alt="" />{resName(x.resonatorId)}
                  </button>
                )
              })}
            </div>
            <p className="ped-hint">pick up to six builds to show first! they appear in the order you pick them :P</p>
          </section>
        </div>
        <div>
          <section className="amdl__grp">
            <h3 className="amdl__grp-name">Accent</h3>
            <AccentPicker value={d.accent} onChange={(accent) => edit({ accent })} />
          </section>
        </div>
      </div>
    </LbModal>
  )
}
