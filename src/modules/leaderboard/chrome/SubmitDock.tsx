/*
  Author: Runor Ewhro
  description: card submission from any page. the leaderboard shows a "paste a
               card link" bar at the bottom; elsewhere, the header button, U, or
               a pasted card link opens it as a sheet. multiple links split by
               commas or whitespace are sent together, and each sent card is
               tracked in a small bottom-left stack until scored or refused, with
               finished ones opening their build.
*/

import { useEffect, useRef, useState, type ClipboardEvent } from 'react'
import { useLocation } from 'react-router-dom'
import { Link2, Upload, X } from 'lucide-react'
import { MAX_CARDS_PER_SUBMIT, splitCardInputs, type CardStatusResponse, type ScenarioCell } from '@/domain/leaderboard/api'
import { APP_ROUTES } from '@/shared/lib/appRoutes'
import { useNavX } from '@/shared/navigation/useNavX'
import { errorText, useCardTrack } from '../model/cardTrack'
import { resFace, resName, score1, scoreInk } from '../model/format'
import { trackText } from '../components/SubmitCard'
import { TURNSTILE_KEY, Turnstile } from '../components/Turnstile'
import { LbError, lbApi } from '../api/client'
import { addSent, closeSubmit, dropSent, noteSettled, openSubmit, useLbChrome, type SentCard } from './chrome'
import { queryClient } from '@/shared/lib/queryClient'
import { lbq } from '../api/queries'

const LB = APP_ROUTES.leaderboard
/** time before a finished card leaves the stack. */
const LINGER_MS = 15_000
const DONE = new Set<CardStatusResponse['status']>(['scored', 'rejected', 'insufficient_data'])
/** the stack shows this many until asked for the rest. */
const SHOWN = 3

function Sheet({ prefill }: { prefill: string | null }) {
  const [input, setInput] = useState(prefill ?? '')
  const [token, setToken] = useState<string | null>(null)
  const [round, setRound] = useState(0)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const field = useRef<HTMLInputElement>(null)
  useEffect(() => { field.current?.focus() }, [])

  const links = splitCardInputs(input)
  const many = links.length > 1

  // a pasted list on several lines would lose its line breaks in a one-line field and run together.
  const paste = (event: ClipboardEvent<HTMLInputElement>) => {
    const text = event.clipboardData.getData('text')
    if (!/[\r\n]/.test(text)) return
    event.preventDefault()
    const el = event.currentTarget
    const at = el.selectionStart ?? input.length
    const to = el.selectionEnd ?? at
    setInput(`${input.slice(0, at)}${splitCardInputs(text).join(', ')}${input.slice(to)}`)
  }

  const send = async () => {
    if (!links.length) { setNote("hmm... paste a card link or file name first :P"); field.current?.focus(); return }
    if (links.length > MAX_CARDS_PER_SUBMIT) { setNote(`woah there... we can take ${MAX_CARDS_PER_SUBMIT} cards at once! split these into smaller batches :P`); return }
    if (!token) { setNote(TURNSTILE_KEY ? "hold on... let the bot check finish, then try again :P" : "oopsies... card submission isn't available on this site yet :("); return }
    setBusy(true)
    setNote(null)
    // a token is good for one request: a refusal, or links left over, take a new one.
    const again = () => { setToken(null); setRound((r) => r + 1) }
    try {
      if (!many) {
        const { duplicate, ...status } = await lbApi.submit({ input: links[0], turnstileToken: token })
        addSent({ status, duplicate, sentAt: Date.now() })
        closeSubmit()
        return
      }
      const { results } = await lbApi.submitMany({ inputs: links, turnstileToken: token })
      const at = Date.now()
      addSent(...results.flatMap((r) => {
        if (!r.ok) return []
        const { duplicate, ...status } = r.card
        return [{ status, duplicate, sentAt: at }]
      }))
      const left = results.filter((r) => !r.ok)
      if (!left.length) { closeSubmit(); return }
      // what did not go stays in the field to fix or send again, with why.
      const why = [...new Set(left.map((r) => r.ok ? '' : errorText(new LbError(0, r.error.code, r.error.message))))]
      setInput(left.map((r) => r.input).join(', '))
      setNote(`${results.length - left.length} sent! ${left.length} couldn't go through and stayed in the field. ${why.join(' ')}`)
      again()
    } catch (error) {
      setNote(errorText(error))
      again()
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="lbd-sheet" onSubmit={(event) => { event.preventDefault(); void send() }}>
      <label className="lbd-field">
        <Link2 aria-hidden="true" />
        <input ref={field} value={input} onChange={(event) => setInput(event.target.value)} onPaste={paste}
          placeholder="paste card links or file names, separated by commas" autoComplete="off" aria-label="Card links" />
        {many ? <span className={`lbd-n${links.length > MAX_CARDS_PER_SUBMIT ? ' over' : ''}`}>{links.length} / {MAX_CARDS_PER_SUBMIT}</span> : null}
        <button type="submit" className="lbd-go" disabled={busy}>{busy ? 'Sending' : many ? `Submit ${links.length}` : 'Submit'}</button>
      </label>
      <Turnstile key={round} onToken={setToken} />
      {note ? <p className="lbd-note" role="alert">{note}</p> : null}
      <div className="lbd-foot">
        <span>copy the link from your shared in-game build card and paste it here! up to {MAX_CARDS_PER_SUBMIT} at once, separated by commas or spaces :P</span>
        <kbd>Esc</kbd>
      </div>
    </form>
  )
}

function Sent({ card, hidden }: { card: SentCard; hidden: boolean }) {
  const navigate = useNavX()
  const [best, setBest] = useState<ScenarioCell | null>(null)
  const track = useCardTrack(card.status, (status) => {
    noteSettled()
    if (status.status === 'scored' && status.buildId) queryClient.fetchQuery(lbq.build(status.buildId)).then((d) => setBest(d.best), () => undefined)
  })
  const status = track.status ?? card.status
  const done = DONE.has(status.status) || track.stalled
  useEffect(() => {
    if (!done) return
    const timer = window.setTimeout(() => dropSent(card.status.cardId), LINGER_MS)
    return () => window.clearTimeout(timer)
  }, [done, card.status.cardId])

  const line = track.unreachable && !track.stalled
    ? { text: "uh oh... the leaderboard isn't answering. we'll keep checking...", tone: 'wait' as const }
    : trackText(status, track.stalled)
  const res = status.resonatorId ?? null
  const to = status.buildId ? `${LB}/player/build/${status.buildId}?build=${status.buildId}` : null

  return (
    <div className={`lbd-card ${line.tone}`} hidden={hidden}>
      <button type="button" className="lbd-open" disabled={!to} onClick={() => { if (to) navigate(to) }}>
        <span className={`lbd-face${res ? '' : ' wait'}`}>{res ? <img src={resFace(res)} alt="" /> : null}</span>
        <span className="lbd-tx">
          <b>{res ? resName(res) : 'New card'}</b>
          <small>{card.duplicate ? 'we already have this card! ' : ''}{line.text}</small>
        </span>
        {best?.score != null ? (
          <span className="lbd-sc"><em style={scoreInk(best.score)}>{score1(best.score)}</em>{best.rank != null ? <small>#{best.rank} of {best.total}</small> : null}</span>
        ) : null}
      </button>
      <button type="button" className="lbd-x" aria-label="Dismiss" onClick={() => dropSent(card.status.cardId)}><X aria-hidden="true" /></button>
    </div>
  )
}

export function SubmitDock() {
  const { pathname } = useLocation()
  const open = useLbChrome((s) => s.open)
  const prefill = useLbChrome((s) => s.prefill)
  const sent = useLbChrome((s) => s.sent)
  const comp = useRef<HTMLDivElement>(null)
  const [all, setAll] = useState(false)
  const onBoards = pathname.startsWith(LB)

  useEffect(() => {
    if (!open) return
    const down = (event: MouseEvent) => { if (!comp.current?.contains(event.target as Node)) closeSubmit() }
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') closeSubmit() }
    document.addEventListener('mousedown', down)
    window.addEventListener('keydown', key)
    return () => { document.removeEventListener('mousedown', down); window.removeEventListener('keydown', key) }
  }, [open])

  return (
    <div className="lbd">
      {/* every card stays mounted, so the hidden ones are still followed until they settle. */}
      {sent.length ? (
        <div className="lbd-stack" aria-live="polite">
          {sent.map((card, i) => <Sent key={card.status.cardId} card={card} hidden={!all && i >= SHOWN} />)}
          {sent.length > SHOWN ? <button type="button" className="lbd-more" onClick={() => setAll(!all)}>
            {all ? 'Show fewer' : `${sent.length - SHOWN} more`}</button> : null}
        </div>
      ) : null}
      {open || onBoards ? (
        <div ref={comp} className={`lbd-comp${open ? ' open' : ''}`}>
          {open ? <Sheet key={prefill ?? ''} prefill={prefill} />
            : <button type="button" className="lbd-bar" onClick={() => openSubmit()}>
              <Upload aria-hidden="true" />Paste a card link to submit<kbd>U</kbd>
            </button>}
        </div>
      ) : null}
    </div>
  )
}
