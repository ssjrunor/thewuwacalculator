/*
  Author: Runor Ewhro
  description: the card link field: submits a card for reading and scoring, or,
               signed out, signs in with a freshly drawn card. a submitted card
               is tracked until read, showing its build or refusal reason.
*/

import { useState } from 'react'
import { CreditCard } from 'lucide-react'
import type { CardStatusResponse } from '@/domain/leaderboard/api'
import { lbApi } from '../api/client'
import { errorText, reasonText, useCardTrack } from '../model/cardTrack'
import { resName } from '../model/format'
import { TURNSTILE_KEY, Turnstile } from './Turnstile'

/**
 * the status line under the field while a submitted card is tracked. the service reports whether a resonator can be
 * scored (a build with no verified team settles as insufficient_data), so a scoring card shows as scoring.
 */
export function trackText(status: CardStatusResponse, stalled: boolean): { text: string; tone: 'wait' | 'ok' | 'bad' } {
  // the resonator is known once the card is read into a build.
  const resonatorId = status.resonatorId ?? null
  const named = resonatorId ? resName(resonatorId) : null
  switch (status.status) {
    case 'pending':
    case 'reading':
      return stalled
        ? { text: 'hmm... this card is taking a little longer to read. it can still finish in the background; check back later :P', tone: 'wait' }
        : { text: 'reading your card... :P', tone: 'wait' }
    case 'rejected':
      return { text: reasonText(status.rejectReason), tone: 'bad' }
    case 'scored':
      // a build removed from the boards (deleted, or hidden by staff) returns scored with active false
      if (status.active === false) return { text: `${named ?? 'This build'} is off the boards now.`, tone: 'ok' }
      return { text: named ? `${named} is on the board! :P` : 'on the board! :P', tone: 'ok' }
    case 'insufficient_data':
      return { text: `saved! scores aren't available for this ${named ? `${named} ` : ''}build yet, so it stays unranked on the player's profile for now.`, tone: 'ok' }
    case 'scoring':
      return stalled
        ? { text: `the card is read! scoring ${named ?? 'this build'} is taking a little longer; check back later.`, tone: 'ok' }
        : { text: named ? `card read! scoring ${named}...` : 'card read! working on the score...', tone: 'wait' }
  }
}

export function SubmitCard({ mode, onDone }: {
  mode: 'submit' | 'login'
  /** login: signed in, with a message; submit: the card was read or refused. */
  onDone: (message?: string) => void
}) {
  const [input, setInput] = useState('')
  const [token, setToken] = useState<string | null>(null)
  // a turnstile token is good for one request; each try draws a new widget.
  const [round, setRound] = useState(0)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [sent, setSent] = useState<{ status: CardStatusResponse; duplicate: boolean } | null>(null)

  const track = useCardTrack(sent?.status ?? null, () => onDone())

  const send = async () => {
    if (!input.trim()) { setNote("hmm... paste a card link or file name first :P"); return }
    if (!token) { setNote(TURNSTILE_KEY ? "hold on... let the bot check finish, then try again :P" : "oopsies... card submission isn't available on this site yet :("); return }
    setBusy(true)
    setNote(null)
    try {
      if (mode === 'login') {
        await lbApi.login({ input: input.trim(), turnstileToken: token })
        onDone('UID claimed! :P')
      } else {
        const result = await lbApi.submit({ input: input.trim(), turnstileToken: token })
        const { duplicate, ...status } = result
        setSent({ status, duplicate })
      }
      setInput('')
    } catch (error) {
      setNote(errorText(error))
    } finally {
      setBusy(false)
      setToken(null)
      setRound((r) => r + 1)
    }
  }

  const line = sent && track.status
    ? track.unreachable && !track.stalled
      ? { text: "uh oh... we can't reach the leaderboard right now. we'll keep checking your card...", tone: 'wait' as const }
      : trackText(track.status, track.stalled)
    : null

  return (
    <>
      <form className="sbm-field" onSubmit={(event) => { event.preventDefault(); void send() }}>
        <span className="sbm-ic"><CreditCard size={16} /></span>
        <input value={input} onChange={(event) => setInput(event.target.value)} placeholder="Card link" autoComplete="off" aria-label="Card link" />
        <button className="sbm-btn solid" disabled={busy}>{mode === 'login' ? 'Claim' : 'Submit'}</button>
      </form>
      <Turnstile key={round} onToken={setToken} />
      {note ? <p className="sbm-note bad" role="alert">{note}</p> : null}
      {line ? (
        <p className={`sbm-note ${line.tone}`} role="status">
          {sent?.duplicate ? 'we already have this card! ' : ''}{line.text}
        </p>
      ) : null}
    </>
  )
}
