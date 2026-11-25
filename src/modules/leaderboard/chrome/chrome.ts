/*
  Author: Runor Ewhro
  description: state shared by the app chrome and the leaderboard, light enough
               for every page: the submit sheet (opened from the header, U, or a
               card link pasted anywhere), the tracked sent cards, the signed-in
               viewer (for the inbox bell), and the sign-in modal. short reports
               go to the app's toasts.
*/

import { useSyncExternalStore } from 'react'
import { QueryObserver } from '@tanstack/react-query'
import type { CardStatusResponse, MeResponse } from '@/domain/leaderboard/api'
import { queryClient } from '@/shared/lib/queryClient'
import { useTstStr } from '@/shared/util/toastStore'
import { restoreLb } from '../api/persist'
import { invalidateLb, lbKeys, lbq } from '../api/queries'

export interface SentCard {
  status: CardStatusResponse
  duplicate: boolean
  sentAt: number
}

interface ChromeState {
  /** the submit sheet is open; `prefill` is a link pasted to open it. */
  open: boolean
  prefill: string | null
  sent: SentCard[]
  /** incremented when a tracked card is read or settles, which reloads open pages. */
  settled: number
  me: MeResponse | null
  /** the service has answered who is signed in at least once. */
  known: boolean
  /** the sign-in window is open. */
  signIn: boolean
}

let state: ChromeState = { open: false, prefill: null, sent: [], settled: 0, me: null, known: false, signIn: false }
const listeners = new Set<() => void>()
const set = (patch: Partial<ChromeState>) => { state = { ...state, ...patch }; listeners.forEach((fn) => fn()) }
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } }

export function useLbChrome<T>(pick: (s: ChromeState) => T): T {
  return useSyncExternalStore(subscribe, () => pick(state))
}

export const openSubmit = (prefill: string | null = null) => set({ open: true, prefill })
export const closeSubmit = () => set({ open: false, prefill: null })
export const openSignIn = () => set({ signIn: true, open: false })
export const closeSignIn = () => set({ signIn: false })
/** a short report in the app's toast corner. */
export function notify(text: string, bad = false) {
  useTstStr.getState().show({ content: text, variant: bad ? 'error' : 'success' })
}
/** stack size: the newest ten (one full submission), with three shown until expanded. */
const STACK = 10
/** cards sent together, listed in the order they were sent, above the ones already in the stack. */
export const addSent = (...cards: SentCard[]) => {
  const ids = new Set(cards.map((c) => c.status.cardId))
  set({ sent: [...cards, ...state.sent.filter((c) => !ids.has(c.status.cardId))].slice(0, STACK) })
}
export const dropSent = (cardId: string) => set({ sent: state.sent.filter((c) => c.status.cardId !== cardId) })
/** a followed card was read or scored: every leaderboard read is asked again where it shows. */
export const noteSettled = () => { set({ settled: state.settled + 1 }); void invalidateLb() }
/** the viewer changed (signed in or out, claimed a uid): reload what depends on them, who they are first. */
export const noteViewerChanged = async () => {
  set({ settled: state.settled + 1 })
  await refreshMe()
  void invalidateLb()
}

/** who is viewing, as the chrome and the pages draw it: not answered yet, signed out (a 401), or signed in. */
export type Session = 'unknown' | 'out' | 'in'
export const sessionOf = (s: Pick<ChromeState, 'me' | 'known'>): Session => !s.known ? 'unknown' : s.me ? 'in' : 'out'

/**
 * the signed-in viewer and unread count: the single /me observer shared by every page and the header, watching lbq.me.
 * only a 401 means signed out; other failures keep the last data, and before the first response it retries every few
 * seconds, which keeps a slow service from showing a signed-in viewer "Sign in".
 */
let watching: QueryObserver<MeResponse | null, Error, MeResponse | null, MeResponse | null, ReturnType<typeof lbKeys.me>> | null = null
/** how often the header looks again while the tab is in view (for the unread count); shown again, it looks at once. */
const LOOK_EVERY_MS = 60_000
/** starts the /me observer (from the header on every page): fetches now, then on its own schedule. */
export function watchMe() {
  if (watching) return
  restoreLb()
  const observer = new QueryObserver(queryClient, { ...lbq.me(), refetchInterval: LOOK_EVERY_MS })
  watching = observer
  const apply = (data: MeResponse | null | undefined) => {
    if (data !== undefined && (data !== state.me || !state.known)) set({ me: data, known: true })
  }
  observer.subscribe((result) => apply(result.data))
  // draw the header from the stored response of the last visit; the live response replaces it
  apply(observer.getCurrentResult().data)
}

/** refetches the viewer now (after a write that changed it, or when the tab is shown again); the chrome draws the result. */
export async function refreshMe(): Promise<void> {
  watchMe()
  await queryClient.refetchQueries({ queryKey: lbKeys.me(), exact: true }).catch(() => undefined)
}

/* a kuro card address, the same in discord's media proxy, or a card's 40-character file name. */
const CARD_TEXT = /kurogames-global\.com\/back\/|^\s*<?https:\/\/images-ext-\d+\.discordapp\.net\/.*kurogames|^\s*[0-9a-f]{40}(?:\s*\(\d{1,3}\))?(?:\.(?:jpe?g|png|webp))?\s*$/i
export const looksLikeCard = (text: string) => text.length <= 2048 && CARD_TEXT.test(text)

/** public words (comments, the profile, card looks) are the signed-in account's. */
export const canWrite = (me: MeResponse | null) => Boolean(me?.account)

/** whether the session has this uid (linked to the account, or claimed in this browser), making its builds the viewer's. */
export const ownsUid = (me: MeResponse | null | undefined, uid: string | null | undefined) =>
  Boolean(uid && me?.uids.some((row) => row.uid === uid))
