/*
  Author: Runor Ewhro
  description: the account's standing: every sanction on the account or its
               UIDs, newest first, each with its latest appeal. an active
               suspension or ban leads, with its end time, reason and what still
               works. an active sanction without a pending appeal can be
               appealed, and staff reply in the inbox and here.
*/

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Shield } from 'lucide-react'
import type { OwnSanction } from '@/domain/leaderboard/api'
import { lbApi } from '../api/client'
import { invalidate, lbKeys, lbq } from '../api/queries'
import { errorText } from '../model/cardTrack'
import { dayText } from '../model/format'
import { useScope } from '../state/ctx'
import { fmtUid } from '../model/listed'

const KIND: Record<OwnSanction['kind'], string> = { warn: 'Warning', mute: 'Mute', suspend: 'Suspension', ban: 'Ban' }
const MAX = 2000
const running = (s: OwnSanction, now: number) => s.liftedAt == null && (s.expiresAt == null || s.expiresAt > now)
const covers = (s: OwnSanction) => s.subjectKind === 'uid' ? `UID ${fmtUid(s.subjectId)}` : 'This account'

function Appeal({ s, onSent }: { s: OwnSanction; onSent: () => void }) {
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const send = () => {
    if (!body.trim()) return
    setBusy(true)
    setNote(null)
    lbApi.appeal(s.id, body.trim()).then(() => { setBody(''); onSent() }, (e: unknown) => setNote(errorText(e))).finally(() => setBusy(false))
  }
  return (
    <form className="stg-apl" onSubmit={(event) => { event.preventDefault(); send() }}>
      <textarea value={body} maxLength={MAX} rows={4} placeholder="tell staff what you think they should reconsider..." aria-label="Appeal" onChange={(event) => setBody(event.target.value)} />
      <div className="stg-apl-f">
        {note ? <span className="bad" role="alert">{note}</span> : <span>{body.length} / {MAX}</span>}
        <button type="submit" className="act go" disabled={busy || !body.trim()}>Send appeal</button>
      </div>
    </form>
  )
}

function Item({ s, now, onSent }: { s: OwnSanction; now: number; onSent: () => void }) {
  const live = running(s, now)
  const a = s.appeal
  return (
    <article className={`stg-it${live ? ' live' : ''}`}>
      <header>
        <b>{KIND[s.kind]}</b>
        <span className={`stg-tag${live ? ' on' : ''}`}>{s.liftedAt ? 'Lifted' : live ? 'Active' : 'Ended'}</span>
        <time>{dayText(s.createdAt)}</time>
      </header>
      <dl>
        <dt>Reason</dt><dd>{s.reason}</dd>
        <dt>Covers</dt><dd>{covers(s)}</dd>
        {s.kind !== 'warn' ? <><dt>Until</dt><dd>{s.liftedAt ? `lifted ${dayText(s.liftedAt)}` : s.expiresAt ? dayText(s.expiresAt) : 'until staff lift it'}</dd></> : null}
      </dl>
      {a ? (
        <div className={`stg-prev ${a.status}`}>
          <div><span className="stg-tag">{a.status === 'open' ? 'awaiting review' : a.status === 'granted' ? 'appeal granted' : 'appeal denied'}</span><time>{dayText(a.decidedAt ?? a.createdAt)}</time></div>
          <q>{a.body}</q>
          {a.response ? <p><b>Staff:</b> {a.response}</p> : null}
        </div>
      ) : null}
      {live && a?.status !== 'open' ? <Appeal s={s} onSent={onSent} /> : null}
    </article>
  )
}

export function StandingView() {
  const { me, toast } = useScope()
  const read = useQuery(lbq.sanctions())
  const list: OwnSanction[] | null = read.data?.sanctions ?? null
  const error = read.error
  // read once per load, so "running" does not flip under the reader.
  const [now] = useState(() => Date.now())

  const stop = me?.account?.suspension ?? null
  return (
    <main className="lpage stg">
      {stop ? (
        <section className="k-band stg-band">
          <span className="stg-k"><Shield aria-hidden="true" />{stop.kind === 'ban' ? 'Account banned' : 'Account suspended'}</span>
          <h1>{stop.expiresAt ? `Until ${dayText(stop.expiresAt)}` : 'Until staff lift it'}</h1>
          <p className="stg-why">{stop.reason}</p>
          <div className="stg-can">
            <div><b>Still works</b><span>Reading boards and profiles</span><span>Your inbox</span><span>Appeals</span></div>
            <div><b>Paused</b><span>Submitting cards</span><span>Pins, likes and comments</span><span>Profile edits and uploads</span></div>
          </div>
        </section>
      ) : (
        <section className="k-band stg-band ok">
          <span className="stg-k"><Shield aria-hidden="true" />Account standing</span>
          <h1>{list && !list.some((s) => running(s, now)) ? 'all clear! :P' : 'Sanctions'}</h1>
        </section>
      )}
      <div className="stg-list">
        {error && !list ? <div className="empty">{errorText(error)}</div>
          : !list ? <div className="empty">checking your account standing...</div>
          : !list.length ? <div className="empty">no sanctions on this account. all clear! :P</div>
          : list.map((s) => <Item key={s.id} s={s} now={now} onSent={() => { toast('appeal sent! staff will reply in your inbox.'); void invalidate(lbKeys.sanctions()) }} />)}
      </div>
    </main>
  )
}
