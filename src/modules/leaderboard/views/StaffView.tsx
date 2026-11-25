/*
  Author: Runor Ewhro
  description: staff queues for moderators and admins: reports, appeals, profile
               text and uploaded images, one queue at a time beside the selected
               item. reports can be claimed, noted, dismissed or resolved (hiding
               the build or removing the comment), with the player warned, muted,
               suspended or banned; appeals are upheld or granted with a reply;
               text is marked reviewed or cleared; images approved or rejected.
*/

import { useEffect, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { BuildDetailResponse, MediaItem, ReportDetailResponse, SanctionKind, StaffAppeal, StaffDocument, StaffReport } from '@/domain/leaderboard/api'
import { can } from '@/domain/leaderboard/permissions'
import { lbApi } from '../api/client'
import { invalidate, invalidateLb, lbKeys, lbq } from '../api/queries'
import { errorText } from '../model/cardTrack'
import { agoText, dayText, resFace, resName } from '../model/format'
import { useScope } from '../state/ctx'
import { fmtUid } from '../model/listed'

type Queue = 'reports' | 'appeals' | 'profiles' | 'media'
const QUEUES: Array<[Queue, string]> = [['reports', 'Reports'], ['appeals', 'Appeals'], ['profiles', 'Profiles'], ['media', 'Images']]
const REASON: Record<StaffReport['reason'], string> = { misread: 'Misread', not_owner: 'Not their card', abuse: 'Abusive', other: 'Other' }
const SANCTION: Record<SanctionKind, string> = { warn: 'Warn', mute: 'Mute', suspend: 'Suspend', ban: 'Ban' }

interface Lists { reports: StaffReport[]; appeals: StaffAppeal[]; profiles: StaffDocument[]; media: MediaItem[] }

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="stf-f"><span>{label}</span><div>{children}</div></div>
}

/** warn, mute, suspend or ban the player behind a report. */
/** what a sanction falls on: a comment's account, or a build's uid. */
type Subject = { kind: 'uid' | 'account'; id: string }

function Sanction({ subject, reportId, onDone }: { subject: Subject; reportId: string; onDone: (message: string) => void }) {
  const [kind, setKind] = useState<SanctionKind>('warn')
  const [days, setDays] = useState<number | null>(3)
  const [reason, setReason] = useState('')
  const [note, setNote] = useState<string | null>(null)
  const timed = kind === 'suspend' || kind === 'mute'
  const issue = () => {
    if (!reason.trim()) { setNote("add a reason first... the player will see it."); return }
    if (kind === 'suspend' && days == null) { setNote('pick how long the suspension should last first.'); return }
    setNote(null)
    lbApi.staff.sanction({ subjectKind: subject.kind, subjectId: subject.id, kind, reason: reason.trim(), reportId, ...(timed && days != null ? { days } : {}) })
      .then(() => onDone(`${SANCTION[kind]} issued.`), (e: unknown) => setNote(errorText(e)))
  }
  return (
    <div className="stf-san">
      <div className="stf-seg" role="radiogroup" aria-label="Sanction">
        {(Object.keys(SANCTION) as SanctionKind[]).map((k) => <button key={k} type="button" role="radio" aria-checked={kind === k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{SANCTION[k]}</button>)}
      </div>
      {timed ? <div className="stf-days">{[1, 3, 7, 30].map((n) => <button key={n} type="button" className={days === n ? 'on' : ''} onClick={() => setDays(n)}>{n} {n === 1 ? 'day' : 'days'}</button>)}
        {kind === 'mute' ? <button type="button" className={days == null ? 'on' : ''} onClick={() => setDays(null)}>Until lifted</button> : null}</div> : null}
      <textarea value={reason} rows={2} maxLength={500} placeholder="Reason, shown to the player" aria-label="Reason" onChange={(event) => setReason(event.target.value)} />
      <div className="stf-acts">{note ? <span className="bad">{note}</span> : null}<button type="button" className="act go" onClick={issue}>Issue {SANCTION[kind].toLowerCase()}</button></div>
    </div>
  )
}

function ReportPane({ r, onDone }: { r: StaffReport; onDone: (message: string) => void }) {
  const { toast } = useScope()
  const detailRead = useQuery(lbq.staffReport(r.id))
  const detail: ReportDetailResponse | null = detailRead.data ?? null
  const buildRead = useQuery(lbq.build(r.buildId))
  // undefined while asking; null when it could not be read.
  const build: BuildDetailResponse | null | undefined = buildRead.isError ? null : buildRead.data
  const [resolution, setResolution] = useState('')
  const [hide, setHide] = useState(false)
  const [noteText, setNoteText] = useState('')
  const failed = detailRead.error
  useEffect(() => { if (failed) toast(errorText(failed), true) }, [failed, toast])

  const close = (status: 'resolved' | 'dismissed') => lbApi.staff.resolve(r.id, {
    status, ...(resolution.trim() ? { resolution: resolution.trim() } : {}),
    ...(status === 'resolved' && hide ? (r.commentId ? { removeComment: true } : { hideBuild: true }) : {}),
  }).then(() => {
    // a hidden build or removed comment changes what every board and profile shows.
    if (status === 'resolved' && hide) void invalidateLb()
    onDone(status === 'resolved' ? 'report resolved! thanks for reviewing it.' : 'report dismissed.')
  }, (e: unknown) => toast(errorText(e), true))
  const take = () => lbApi.staff.take(r.id, !r.assignedTo).then(() => onDone(r.assignedTo ? 'report unassigned.' : 'report assigned to you! :P'), (e: unknown) => toast(errorText(e), true))
  const note = () => lbApi.staff.note(r.id, noteText.trim()).then(() => { setNoteText(''); void invalidate(lbKeys.staffReport(r.id)) },
    (e: unknown) => toast(errorText(e), true))
  // a comment is its account's words; a build is its uid's.
  const subject: Subject | null = r.commentId ? (detail?.comment?.accountId ? { kind: 'account', id: detail.comment.accountId } : null)
    : build?.uid ? { kind: 'uid', id: build.uid } : null

  return (
    <div className="stf-d">
      <header><h4>{r.commentId ? 'Comment report' : 'Build report'}</h4><span className="stf-tag">{REASON[r.reason]}</span>
        <button type="button" className="lk" onClick={() => void take()}>{r.assignedTo ? `Taken by ${r.assignedTo}. Release` : 'Assign to me'}</button></header>
      <div className="stf-ctx">
        {build ? <><img src={resFace(build.snapshot.resonator.id)} alt="" /><span><b>{build.name ?? 'Unnamed'}</b>
          <small>{resName(build.snapshot.resonator.id)}{build.uid ? `, UID ${fmtUid(build.uid)}` : ''}</small></span></>
          : build === null ? <span className="quiet">hmm... this build is unavailable. it may be hidden or deleted.</span> : <span className="quiet">loading the reported build...</span>}
      </div>
      {r.details ? <Field label="Reporter says"><q>{r.details}</q></Field> : null}
      {detail?.comment ? <Field label={detail.comment.removedAt ? 'Comment (removed)' : 'Comment'}><q>{detail.comment.body ?? '(empty)'}</q></Field> : null}
      <Field label="Reported">{agoText(r.createdAt)}</Field>
      {detail?.notes.length ? <Field label="Notes">{detail.notes.map((n) => <p key={n.id} className="stf-note"><b>{n.author}</b> {n.body}</p>)}</Field> : null}
      <div className="stf-addnote">
        <input value={noteText} maxLength={2000} placeholder="Add a note for staff" aria-label="Note" onChange={(event) => setNoteText(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter' && noteText.trim()) void note() }} />
      </div>
      <div className="stf-close">
        <input value={resolution} maxLength={500} placeholder="Resolution (optional)" aria-label="Resolution" onChange={(event) => setResolution(event.target.value)} />
        <label className="stf-chk"><input type="checkbox" checked={hide} onChange={(event) => setHide(event.target.checked)} />{r.commentId ? 'Remove the comment' : 'Hide the build'}</label>
        <div className="stf-acts"><button type="button" className="act" onClick={() => void close('dismissed')}>Dismiss</button>
          <button type="button" className="act go" onClick={() => void close('resolved')}>Resolve</button></div>
      </div>
      {subject ? <Field label={subject.kind === 'account' ? "Sanction the commenter's account" : `Sanction UID ${fmtUid(subject.id)}`}>
        <Sanction subject={subject} reportId={r.id} onDone={onDone} /></Field> : null}
    </div>
  )
}

function AppealPane({ a, onDone }: { a: StaffAppeal; onDone: (message: string) => void }) {
  const [status, setStatus] = useState<'upheld' | 'granted'>('upheld')
  const [response, setResponse] = useState('')
  const [note, setNote] = useState<string | null>(null)
  const send = () => {
    if (!response.trim()) { setNote('add a reply for the player before sending the decision.'); return }
    lbApi.staff.decide(a.id, { status, response: response.trim() }).then(() => onDone(status === 'granted' ? 'appeal granted! the sanction has been lifted.' : 'appeal denied. the sanction has been upheld.'),
      (e: unknown) => setNote(errorText(e)))
  }
  return (
    <div className="stf-d">
      <header><h4>{SANCTION[a.sanction.kind]} appeal</h4><span className="stf-tag">{a.sanction.subjectKind === 'uid' ? `UID ${fmtUid(a.sanction.subjectId)}` : 'Account'}</span></header>
      <Field label="Sanction"><q>{a.sanction.reason}</q><small>by {a.sanction.issuedBy}, {dayText(a.sanction.createdAt)}{a.sanction.expiresAt ? `, until ${dayText(a.sanction.expiresAt)}` : ''}</small></Field>
      <Field label="Appeal"><q>{a.body}</q></Field>
      <div className="stf-seg" role="radiogroup" aria-label="Decision">
        <button type="button" role="radio" aria-checked={status === 'upheld'} className={status === 'upheld' ? 'on' : ''} onClick={() => setStatus('upheld')}>Deny appeal</button>
        <button type="button" role="radio" aria-checked={status === 'granted'} className={status === 'granted' ? 'on' : ''} onClick={() => setStatus('granted')}>Grant appeal and lift sanction</button>
      </div>
      <textarea value={response} rows={3} maxLength={2000} placeholder="Reply to the player" aria-label="Reply" onChange={(event) => setResponse(event.target.value)} />
      <div className="stf-acts">{note ? <span className="bad">{note}</span> : null}<button type="button" className="act go" onClick={send}>Send decision</button></div>
    </div>
  )
}

function DocPane({ doc, onDone }: { doc: StaffDocument; onDone: (message: string) => void }) {
  const { toast } = useScope()
  const body = doc.body as Record<string, unknown> | null
  const text = (key: string) => typeof body?.[key] === 'string' ? body[key] as string : null
  const links = Array.isArray(body?.links) ? body.links as Array<{ label: string; url: string }> : []
  return (
    <div className="stf-d">
      <header><h4>{doc.kind === 'profile' ? 'Profile' : doc.kind === 'build' ? 'Build notes' : doc.kind}</h4><span className="stf-tag">{doc.kind === 'profile' ? `UID ${fmtUid(doc.ownerId)}` : doc.ownerId.slice(0, 8)}</span></header>
      {text('displayName') ? <Field label="Display name">{text('displayName')}</Field> : null}
      {text('bio') ? <Field label="Signature"><q>{text('bio')}</q></Field> : null}
      {text('title') ? <Field label="Title">{text('title')}</Field> : null}
      {text('note') ? <Field label="Note"><q>{text('note')}</q></Field> : null}
      {links.length ? <Field label="Links">{links.map((l) => <p key={l.url}>{l.label}: <code>{l.url}</code></p>)}</Field> : null}
      <Field label="Written">{agoText(doc.updatedAt)}</Field>
      <div className="stf-acts">
        <button type="button" className="act" onClick={() => { void lbApi.staff.clear(doc.kind, doc.ownerId).then(() => onDone('content cleared.'), (e: unknown) => toast(errorText(e), true)) }}>Clear content</button>
        <button type="button" className="act go" onClick={() => { void lbApi.staff.reviewed(doc.kind, doc.ownerId, doc.updatedAt).then(() => onDone('marked as reviewed! :P'), (e: unknown) => toast(errorText(e), true)) }}>Mark reviewed</button>
      </div>
    </div>
  )
}

function MediaPane({ m, onDone }: { m: MediaItem; onDone: (message: string) => void }) {
  const { toast } = useScope()
  const review = (status: 'approved' | 'rejected') => lbApi.staff.reviewMedia(m.id, status)
    .then(() => onDone(status === 'approved' ? 'image approved! :P' : 'image rejected and erased.'), (e: unknown) => toast(errorText(e), true))
  return (
    <div className="stf-d">
      <header><h4>{m.purpose === 'avatar' ? 'Avatar' : m.purpose === 'banner' ? 'Banner' : 'Card image'}</h4><span className="stf-tag">{Math.round(m.byteSize / 1024)} KB</span></header>
      <div className={`stf-img ${m.purpose}`}><img src={lbApi.mediaUrl(m.id)} alt="" /></div>
      <Field label="Uploaded">{agoText(m.createdAt)}</Field>
      <div className="stf-acts">
        <button type="button" className="act" onClick={() => void review('rejected')}>Reject</button>
        <button type="button" className="act go" onClick={() => void review('approved')}>Approve</button>
      </div>
    </div>
  )
}

export function StaffView() {
  const { me, toast } = useScope()
  const role = me?.account?.role ?? 'user'
  const [queue, setQueue] = useState<Queue>('reports')
  const [pick, setPick] = useState<string | null>(null)

  const allowed = can(role, 'reports.review')
  // each queue reads its own key and fills in as it loads
  const reports = useQuery({ ...lbq.staffReports(), enabled: allowed }).data?.reports
  const appeals = useQuery({ ...lbq.staffAppeals(), enabled: allowed }).data?.appeals
  const profiles = useQuery({ ...lbq.staffDocuments(), enabled: allowed }).data?.documents
  const media = useQuery({ ...lbq.staffMedia(), enabled: allowed }).data?.media
  const lists: Partial<Lists> = { reports, appeals, profiles, media }

  if (!allowed) return <main className="lpage"><div className="empty">Staff only.</div></main>

  const done = (message: string) => { toast(message); setPick(null); void invalidate(lbKeys.staff()) }
  const keyOf = (x: { id?: string; kind?: string; ownerId?: string }) => x.id ?? `${x.kind}:${x.ownerId}`
  const list: Array<{ key: string; face: string | null; title: string; sub: string; at: number }> =
    queue === 'reports' ? (lists.reports ?? []).map((r) => ({ key: r.id, face: null, title: r.commentId ? 'Comment report' : 'Build report', sub: `${REASON[r.reason]}${r.details ? `: ${r.details}` : ''}`, at: r.createdAt }))
    : queue === 'appeals' ? (lists.appeals ?? []).map((a) => ({ key: a.id, face: null, title: `${SANCTION[a.sanction.kind]} appeal`, sub: a.body, at: a.createdAt }))
    : queue === 'profiles' ? (lists.profiles ?? []).map((d) => ({ key: keyOf(d), face: null, title: d.kind === 'profile' ? `Profile, UID ${fmtUid(d.ownerId)}` : 'Build notes', sub: 'Waiting for review', at: d.updatedAt }))
    : (lists.media ?? []).map((m) => ({ key: m.id, face: lbApi.mediaUrl(m.id), title: m.purpose === 'avatar' ? 'Avatar' : m.purpose === 'banner' ? 'Banner' : 'Card image', sub: 'Waiting for review', at: m.createdAt }))
  const picked = pick ?? list[0]?.key ?? null
  const count = (q: Queue) => (q === 'reports' ? lists.reports : q === 'appeals' ? lists.appeals : q === 'profiles' ? lists.profiles : lists.media)?.length

  return (
    <main className="lpage stf">
      <div className="stf-top"><h1 className="k-ttl">Staff</h1><span className="k-read">{role === 'admin' ? 'Admin' : 'Moderator'}</span></div>
      <div className="stf-grid">
        <nav className="stf-n" aria-label="Queues">
          {QUEUES.map(([k, label]) => <button key={k} type="button" className={queue === k ? 'on' : ''} onClick={() => { setQueue(k); setPick(null) }}>
            {label}<small>{count(k) ?? ''}</small></button>)}
        </nav>
        <div className="stf-l">
          {!list.length ? <p className="stf-empty">{count(queue) == null ? 'Loading...' : 'Nothing waiting.'}</p>
            : list.map((x) => (
              <button key={x.key} type="button" className={`stf-q${x.key === picked ? ' on' : ''}`} onClick={() => setPick(x.key)}>
                {x.face ? <img src={x.face} alt="" /> : <span className="stf-dot" />}
                <span><b>{x.title}</b><small>{x.sub}</small></span><time>{agoText(x.at)}</time>
              </button>
            ))}
        </div>
        {(() => {
          if (!picked) return <div className="stf-d quiet">pick an item from the queue to review it :P</div>
          if (queue === 'reports') { const r = lists.reports?.find((x) => x.id === picked); return r ? <ReportPane key={r.id} r={r} onDone={done} /> : null }
          if (queue === 'appeals') { const a = lists.appeals?.find((x) => x.id === picked); return a ? <AppealPane key={a.id} a={a} onDone={done} /> : null }
          if (queue === 'profiles') { const d = lists.profiles?.find((x) => keyOf(x) === picked); return d ? <DocPane key={picked} doc={d} onDone={done} /> : null }
          const m = lists.media?.find((x) => x.id === picked)
          return m ? <MediaPane key={m.id} m={m} onDone={done} /> : null
        })()}
      </div>
    </main>
  )
}
