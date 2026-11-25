/*
  Author: Runor Ewhro
  description: the inbox dropdown from the header bell: the account's
               notifications with today's first. opening one marks it read and
               navigates to its build or profile.
*/

import { useRef, type RefObject } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AnchoredAppPopup, useAppPopupDismiss } from '@/shared/ui/AppPopup'
import { Check, Crown, Heart, ImageIcon, MessageSquare, Shield, Trash2, Unlink, type LucideIcon } from 'lucide-react'
import type { NotificationItem, NotificationKind } from '@/domain/leaderboard/api'
import { APP_ROUTES } from '@/shared/lib/appRoutes'
import { useNavX } from '@/shared/navigation/useNavX'
import { agoText, resFace, resName, score1, scoreInk } from '../model/format'
import { errorText } from '../model/cardTrack'
import { queryClient } from '@/shared/lib/queryClient'
import { lbApi } from '../api/client'
import { refreshMe } from './chrome'
import { lbKeys, lbq } from '../api/queries'

const GLYPH: Record<NotificationKind, LucideIcon> = {
  scored: Check, dethroned: Crown, like: Heart, comment: MessageSquare, reply: MessageSquare,
  comment_removed: Trash2, media: ImageIcon, sanction: Shield, appeal: Shield, uid_moved: Unlink,
}
const BAD = new Set<NotificationKind>(['dethroned', 'comment_removed', 'sanction', 'uid_moved'])

type Data = Record<string, unknown> | null
const num = (d: Data, key: string) => typeof d?.[key] === 'number' ? d[key] as number : null
const str = (d: Data, key: string) => typeof d?.[key] === 'string' ? d[key] as string : null
const day = (at: number) => new Date(at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

function Line({ n }: { n: NotificationItem }) {
  const d = n.data as Data
  const res = n.resonatorId ?? str(d, 'resonatorId')
  const who = <b>{n.actor?.name ?? 'Someone'}</b>
  const named = res ? <b>{resName(res)}</b> : <b>build</b>
  const score = num(d, 'score')
  switch (n.kind) {
    case 'scored': {
      const rank = num(d, 'rank'), total = num(d, 'total')
      return <>your {named} was scored! {score != null ? <em style={scoreInk(score)}>{score1(score)}</em> : null}
        <small>{rank != null && total ? `#${rank} of ${total}` : 'unranked'}</small></>
    }
    case 'dethroned':
      return <>{who} took #1 on {res ? named : 'a board'}{score != null ? <> with <em style={scoreInk(score)}>{score1(score)}</em></> : null}</>
    case 'like':
      return <>{who}{n.count > 1 ? ` and ${n.count - 1} other${n.count > 2 ? 's' : ''}` : ''} liked your {named}</>
    case 'comment':
      return <>{who} commented on your {named}{n.excerpt ? <q>{n.excerpt}</q> : null}</>
    case 'reply':
      return <>{who} replied to you on {named}{n.excerpt ? <q>{n.excerpt}</q> : null}</>
    case 'comment_removed':
      return <>staff removed your comment{res ? <> on {named}</> : null}</>
    case 'media':
      return <>your {str(d, 'purpose') ?? 'image'} was {str(d, 'status') === 'approved' ? 'approved' : 'rejected'}</>
    case 'sanction': {
      const kind = str(d, 'kind'), until = num(d, 'expiresAt'), reason = str(d, 'reason')
      const what = kind === 'warn' ? 'a warning was issued on your account' : kind === 'ban' ? 'your account is banned'
        : `${kind === 'mute' ? 'muted' : 'suspended'}${until ? ` until ${day(until)}` : ''}`
      return <>{what}{reason ? <q>{reason}</q> : null}</>
    }
    case 'appeal':
      return <>{str(d, 'status') === 'granted' ? 'your appeal was granted! the sanction has been lifted.' : 'your appeal was denied. the sanction has been upheld.'}{str(d, 'response') ? <q>{str(d, 'response')}</q> : null}</>
    case 'uid_moved':
      return <>UID <b>{str(d, 'uid') ?? ''}</b> was claimed elsewhere with a fresh card and left your account</>
  }
}

function Row({ n, onOpen }: { n: NotificationItem; onOpen: (n: NotificationItem) => void }) {
  const res = n.resonatorId ?? str(n.data as Data, 'resonatorId')
  const Glyph = GLYPH[n.kind]
  return (
    <button type="button" className={`lbi-row${n.read ? '' : ' new'}${BAD.has(n.kind) ? ' bad' : ''}`} onClick={() => onOpen(n)}>
      <span className="lbi-ic">
        {res ? <img src={resFace(res)} alt="" /> : <Glyph aria-hidden="true" />}
        {res ? <i><Glyph aria-hidden="true" /></i> : null}
      </span>
      <span className="lbi-tx"><Line n={n} /></span>
      <time dateTime={new Date(n.at).toISOString()}>{agoText(n.at)}</time>
    </button>
  )
}

export function InboxPop({ open: shown, host, trigger, onClose }: {
  open: boolean
  host: RefObject<HTMLElement | null>
  trigger: RefObject<HTMLButtonElement | null>
  onClose: () => void
}) {
  const navigate = useNavX()
  const popup = useRef<HTMLDivElement | null>(null)
  // refetch on every open (never fresh) while the last data shows
  const inbox = useQuery({ ...lbq.notifications(), enabled: shown })
  const items = inbox.data?.notifications ?? null
  const error = inbox.error && !inbox.data ? errorText(inbox.error) : null
  useAppPopupDismiss({ open: shown, onDismiss: onClose, hostRef: host, popupRef: popup, returnFocusRef: trigger, pointerEvent: 'mousedown' })

  const read = (ids?: string[]) => {
    queryClient.setQueryData(lbKeys.notifications(), (r: typeof inbox.data) => r
      ? { ...r, notifications: r.notifications.map((n) => !ids || ids.includes(n.id) ? { ...n, read: true } : n) } : r)
    void lbApi.readNotifications(ids).then(() => refreshMe(), () => undefined)
  }
  const open = (n: NotificationItem) => {
    if (!n.read) read([n.id])
    onClose()
    const LB = APP_ROUTES.leaderboard
    navigate(n.kind === 'sanction' || n.kind === 'appeal' ? `${LB}/standing`
      : n.kind === 'dethroned' && n.resonatorId ? `${LB}/${n.resonatorId}`
      : n.buildId && n.kind !== 'comment_removed' ? `${LB}/me?build=${n.buildId}` : `${LB}/me`)
  }

  const startOfToday = new Date().setHours(0, 0, 0, 0)
  const today = items?.filter((n) => n.at >= startOfToday) ?? []
  const earlier = items?.filter((n) => n.at < startOfToday) ?? []
  const unread = items?.filter((n) => !n.read).length ?? 0

  return (
    <AnchoredAppPopup visible={shown} open={shown} anchorRef={trigger} popupRef={popup} portalClassName="ax-menu" align="end"
      maxHeight={560} className="app-popup--chrome lbi-pop" role="dialog" aria-label="Inbox">
      <div className="lbi-h">
        <h4>Inbox</h4>{unread ? <span className="lbi-ct">{unread}</span> : null}
        <button type="button" disabled={!unread} onClick={() => read()}>Mark all read</button>
      </div>
      <div className="lbi-list">
        {error ? <p className="lbi-none">{error}</p>
          : !items ? <p className="lbi-none">checking your inbox... :P</p>
          : !items.length ? <p className="lbi-none">nothing here yet... scores, likes, replies and account updates will show up here :P</p>
          : <>
            {today.length ? <><h6>Today</h6>{today.map((n) => <Row key={n.id} n={n} onOpen={open} />)}</> : null}
            {earlier.length ? <><h6>Earlier</h6>{earlier.map((n) => <Row key={n.id} n={n} onOpen={open} />)}</> : null}
          </>}
      </div>
    </AnchoredAppPopup>
  )
}
