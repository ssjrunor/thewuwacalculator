/*
  Author: Runor Ewhro
  description: what the service says, in the page's words: one line for every
               error code, and a submitted card followed from its read to its
               build (or its refusal), polling the card's public status.
*/

import { useEffect, useState } from 'react'
import type { CardStatusResponse } from '@/domain/leaderboard/api'
import { lbApi, LbError } from '../api/client'

export { reasonText } from '@/domain/leaderboard/messages'

/** the message for anything a request threw, keeping deliberate service refusals specific. */
export const errorText = (error: unknown): string => {
  if (error instanceof LbError) return error.message
  if (error instanceof TypeError && /fetch|network|load failed/i.test(error.message)) return "uh oh... we couldn't finish the request. check your connection and try again; the leaderboard may be unavailable :("
  return "oopsies... something went wrong while opening this. refresh the page and try again :("
}

/** true when the service reports no live ruleset, meaning no board exists yet. */
export const noRuleset = (error: unknown) => error instanceof LbError && error.code === 'not_found'

const READING = new Set(['pending', 'reading'])
const TERMINAL = new Set(['rejected', 'scored', 'insufficient_data'])
const EVERY_MS = 2000
/** a read takes seconds to a minute; scoring can wait on a ruleset, so stop following it sooner. */
const READ_FOR_MS = 180_000
const SCORE_FOR_MS = 300_000
/** the longest wait between polls while the service is not answering. */
const MISS_MAX_MS = 30_000

export interface CardTrack {
  status: CardStatusResponse | null
  /** the read or scoring is taking longer than it should; following stopped. */
  stalled: boolean
  /** set when the last poll got no response; tracking continues more slowly until one arrives. */
  unreachable?: boolean
}

/** refresh the owner list when the build appears and when scoring finishes. */
export function useCardTrack(first: CardStatusResponse | null, onSettled?: (status: CardStatusResponse) => void): CardTrack {
  const [track, setTrack] = useState<CardTrack>({ status: first, stalled: false })
  const [prev, setPrev] = useState(first)
  if (prev !== first) { setPrev(first); setTrack({ status: first, stalled: false }) }

  useEffect(() => {
    if (!first) return
    let live = true
    let timer = 0
    const started = Date.now()
    let scoringSince: number | null = null
    let settled: string | null = null
    const settle = (status: CardStatusResponse) => {
      const phase = TERMINAL.has(status.status) ? 'finished' : 'read'
      if (settled !== phase) { settled = phase; onSettled?.(status) }
    }
    const step = (status: CardStatusResponse) => {
      if (!live) return
      setTrack({ status, stalled: false })
      if (status.buildId || TERMINAL.has(status.status)) settle(status)
      if (TERMINAL.has(status.status)) return
      const now = Date.now()
      if (status.status === 'scoring') scoringSince ??= now
      const over = READING.has(status.status) ? now - started > READ_FOR_MS : now - (scoringSince ?? now) > SCORE_FOR_MS
      if (over) { setTrack({ status, stalled: true }); return }
      timer = window.setTimeout(poll, EVERY_MS)
    }
    // a missed response may be a restarting service, so retry with a growing delay
    let misses = 0
    const missed = () => {
      if (!live) return
      misses += 1
      setTrack((t) => ({ ...t, unreachable: true }))
      timer = window.setTimeout(poll, Math.min(EVERY_MS * 2 ** misses, MISS_MAX_MS))
    }
    const poll = () => { lbApi.cardStatus(first.cardId).then((status) => { misses = 0; step(status) }, missed) }
    // the first response is already in state, so only track it
    if (first.buildId || TERMINAL.has(first.status)) settle(first)
    if (!TERMINAL.has(first.status)) timer = window.setTimeout(poll, EVERY_MS)
    return () => { live = false; window.clearTimeout(timer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one card per submission; the callback is read once settled.
  }, [first?.cardId])

  return track
}
