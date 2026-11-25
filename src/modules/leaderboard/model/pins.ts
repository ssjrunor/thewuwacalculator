/*
  Author: Runor Ewhro
  description: boards and players the viewer pins. signed in, pins are stored on
               the account (the service calls them follows), sync across devices
               and count toward a player's "pinned by", with a local copy for
               instant display. signed out, they are stored only in this browser
               and merged into the account at the next sign-in.
*/

import { useSyncExternalStore } from 'react'
import type { FollowsResponse } from '@/domain/leaderboard/api'
import { lbApi } from '../api/client'
import { invalidate, lbKeys } from '../api/queries'

export interface PinnedPlayer {
  /** null when the player hides their uid; then the build reaches them. */
  uid: string | null
  buildId: string
  name: string
  /** resonators of their best builds, for the capsule. */
  faces: string[]
}

export interface Pins {
  boards: string[]
  players: PinnedPlayer[]
}

const KEY = 'lb-pins-v1'
/** set when a pin changes with no account; those pins merge into the next signed-in account. */
const LOCAL_EDITS = 'lb-pins-local-edits'
/** accounts this browser already merged its pins into, which limits merging to once per account. */
const MERGED = 'lb-pins-merged'
const EMPTY: Pins = { boards: [], players: [] }
let current: Pins = read()
const listeners = new Set<() => void>()
/** the account the pins are kept on; null while signed out (or not yet known). */
let account: string | null = null

function store<T>(key: string, fallback: T): T {
  try { return (JSON.parse(localStorage.getItem(key) ?? 'null') as T | null) ?? fallback } catch { return fallback }
}
function keep(key: string, value: unknown) {
  // storage can be blocked; pins then last as long as the page.
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* see above */ }
}

function read(): Pins {
  const value = store<Pins | null>(KEY, null)
  return value && Array.isArray(value.boards) && Array.isArray(value.players) ? value : EMPTY
}

function write(next: Pins) {
  current = next
  keep(KEY, next)
  for (const listener of listeners) listener()
}

const fromAccount = (r: FollowsResponse): Pins => ({
  boards: r.boards,
  players: r.players.map((p) => ({ uid: p.uid, buildId: p.buildId ?? '', name: p.name ?? 'Unnamed', faces: p.faces })),
})

const samePlayer = (a: PinnedPlayer, b: { uid: string | null; buildId: string }) => (a.uid && a.uid === b.uid) || a.buildId === b.buildId
const refOf = (p: { uid: string | null; buildId: string }) => p.uid ?? p.buildId

export function usePins(): Pins {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => listeners.delete(listener) }, () => current, () => EMPTY)
}

/** whether pins are stored on an account, which makes them count toward "pinned by". */
export const pinsOnAccount = () => account != null

/** handles a changed (or first known) session account: stores pins on it, merging this browser's pins once. */
export async function syncPins(accountId: string | null): Promise<void> {
  if (accountId === account) return
  account = accountId
  if (!accountId) return
  const merged = store<string[]>(MERGED, [])
  const merge = store<boolean>(LOCAL_EDITS, false) || !merged.includes(accountId)
  try {
    const r = merge && (current.boards.length || current.players.length)
      ? await lbApi.importPins({ boards: current.boards, players: current.players.map((p) => ({ uid: p.uid, buildId: p.buildId })) })
      : await lbApi.pins()
    if (account !== accountId) return
    keep(MERGED, [...merged.filter((id) => id !== accountId), accountId].slice(-8))
    keep(LOCAL_EDITS, false)
    write(fromAccount(r))
  } catch { /* the copy in this browser stands until the service answers */ }
}

/** changes a pin locally at once, then on the account; the account's response wins, and a refusal reverts it. */
function change(next: Pins, send: () => Promise<FollowsResponse>) {
  const before = current
  write(next)
  if (!account) { keep(LOCAL_EDITS, true); return }
  const held = account
  send().then((r) => {
    if (account !== held) return
    write(fromAccount(r))
    // a pin counts toward the player's "pinned by", and names what the feed follows.
    void invalidate(['lb', 'player-social'], lbKeys.feed(held))
  }, () => { if (account === held) write(before) })
}

export const boardPinned = (pins: Pins, resonatorId: string) => pins.boards.includes(resonatorId)
export const playerPinned = (pins: Pins, who: { uid: string | null; buildId: string }) => pins.players.some((p) => samePlayer(p, who))

export function toggleBoardPin(resonatorId: string) {
  const on = current.boards.includes(resonatorId)
  change({ ...current, boards: on ? current.boards.filter((id) => id !== resonatorId) : [...current.boards, resonatorId] },
    () => on ? lbApi.unpinBoard(resonatorId) : lbApi.pinBoard(resonatorId))
}

export function togglePlayerPin(player: PinnedPlayer) {
  const on = current.players.some((p) => samePlayer(p, player))
  change({ ...current, players: on ? current.players.filter((p) => !samePlayer(p, player)) : [...current.players, player] },
    () => on ? lbApi.unpinPlayer(refOf(player)) : lbApi.pinPlayer(refOf(player)))
}
