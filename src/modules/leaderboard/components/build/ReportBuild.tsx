/*
  Author: Runor Ewhro
  description: the report form for an opened build.
*/

import { useState } from 'react'
import type { ReportRequest } from '@/domain/leaderboard/api'
import { lbApi } from '../../api/client'
import { errorText } from '../../model/cardTrack'
import { TURNSTILE_KEY, Turnstile } from '../Turnstile'

const REASONS: Array<[ReportRequest['reason'], string]> = [
  ['misread', 'Misread'],
  ['not_owner', 'Not their card'],
  ['abuse', 'Abusive name'],
  ['other', 'Other'],
]
const MAX_DETAILS = 2000

export function ReportBuild({ buildId, onClose }: { buildId: string; onClose: () => void }) {
  const [reason, setReason] = useState<ReportRequest['reason'] | null>(null)
  const [details, setDetails] = useState('')
  const [token, setToken] = useState<string | null>(null)
  const [round, setRound] = useState(0)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ text: string; bad: boolean } | null>(null)
  const [done, setDone] = useState(false)

  if (done) return <p className="sbm-note ok" role="status">report sent! a moderator will take a look.</p>

  const send = async () => {
    if (!reason) { setNote({ text: 'pick a reason first so staff know what to look at :P', bad: true }); return }
    if (!token) { setNote({ text: TURNSTILE_KEY ? 'hold on... let the bot check finish, then send your report :P' : "oopsies... reports aren't available on this site yet :(", bad: true }); return }
    setBusy(true)
    setNote(null)
    try {
      await lbApi.report({ buildId, reason, details: details.trim() || undefined, turnstileToken: token })
      setDone(true)
    } catch (error) {
      setNote({ text: errorText(error), bad: true })
    } finally {
      setBusy(false)
      setToken(null)
      setRound((r) => r + 1)
    }
  }

  return (
    <form className="rpb" onSubmit={(event) => { event.preventDefault(); void send() }}>
      <div className="rpb-why" role="radiogroup" aria-label="Reason">
        {REASONS.map(([key, label]) => (
          <button key={key} type="button" role="radio" aria-checked={reason === key} className={reason === key ? 'on' : ''}
            onClick={() => setReason(key)}>{label}</button>
        ))}
      </div>
      <textarea value={details} maxLength={MAX_DETAILS} onChange={(event) => setDetails(event.target.value)}
        placeholder="anything else staff should know? (optional)" rows={3} aria-label="Details" />
      <Turnstile key={round} onToken={setToken} />
      {note ? <p className={`sbm-note${note.bad ? ' bad' : ''}`} role="alert">{note.text}</p> : null}
      <div className="rpb-act">
        <button className="sbm-btn solid" disabled={busy}>Send report</button>
        <button type="button" className="sbm-btn" onClick={() => { setNote(null); onClose() }}>Cancel</button>
      </div>
    </form>
  )
}
