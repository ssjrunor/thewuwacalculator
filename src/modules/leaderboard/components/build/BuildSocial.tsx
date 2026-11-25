/*
  Author: Runor Ewhro
  description: the social section under an opened build: like, save and
               comments. threads are one level deep, with replies under the
               comment they answer. writers edit or remove their own comments;
               the build's owner can remove any comment on it and close it to new
               ones; any signed-in viewer can report one. every write requires an
               account, and viewers without one get a sign-in prompt.
*/

import { useState } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { Bookmark, BookmarkCheck, Flag, Heart, Lock, LockOpen, PenLine, Trash2 } from 'lucide-react'
import type { BuildDetailResponse, BuildSocialResponse, CommentItem } from '@/domain/leaderboard/api'
import { queryClient } from '@/shared/lib/queryClient'
import { lbApi } from '../../api/client'
import { invalidate, lbKeys, lbq } from '../../api/queries'
import { canWrite, openSignIn } from '../../chrome/chrome'
import { errorText } from '../../model/cardTrack'
import { agoText } from '../../model/format'
import { ReportBuild } from './ReportBuild'
import { useScope } from '../../state/ctx'

const MAX = 1000

function Composer({ placeholder, start = '', onSend, onCancel, small }: {
  placeholder: string
  start?: string
  onSend: (body: string) => Promise<void>
  onCancel?: () => void
  small?: boolean
}) {
  const [body, setBody] = useState(start)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const send = () => {
    if (!body.trim()) return
    setBusy(true)
    setNote(null)
    onSend(body.trim()).then(() => setBody(''), (e: unknown) => setNote(errorText(e))).finally(() => setBusy(false))
  }
  return (
    <form className={`bcm-cmp${small ? ' small' : ''}`} onSubmit={(event) => { event.preventDefault(); send() }}>
      <textarea value={body} maxLength={MAX} rows={small ? 2 : 3} placeholder={placeholder} aria-label={placeholder}
        autoFocus={Boolean(onCancel)} onChange={(event) => setBody(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); send() } }} />
      <div className="bcm-cmp-f">
        {note ? <span className="bad" role="alert">{note}</span> : <span>{body.length} / {MAX}</span>}
        {onCancel ? <button type="button" className="lk" onClick={onCancel}>Cancel</button> : null}
        <button type="submit" className="act go" disabled={busy || !body.trim()}>{start ? 'Save' : 'Post'}</button>
      </div>
    </form>
  )
}

function Comment({ c, buildId, signedIn, open, onReply, onChange }: {
  c: CommentItem
  buildId: string
  signedIn: boolean
  open: boolean
  onReply?: (body: string) => Promise<void>
  onChange: () => void
}) {
  const { me, playerTo, go, toast } = useScope()
  const [mode, setMode] = useState<'read' | 'edit' | 'reply' | 'report'>('read')
  const who = c.author
  const remove = () => { lbApi.removeComment(c.id).then(onChange, (e: unknown) => toast(errorText(e), true)) }
  return (
    <div className={`bcm-c${c.parentId ? ' reply' : ''}`}>
      <span className="bcm-av">{(who && !who.anonymous ? who.name ?? '?' : '?')[0]?.toUpperCase()}</span>
      <div>
        <div className="bcm-h">
          {who?.anonymous ? <b className="bcm-who">anon</b>
            : who ? <button type="button" className="bcm-who" onClick={() => go(playerTo({ uid: who.uid, buildId: who.buildId ?? buildId }))}>{who.name ?? 'Unnamed'}</button>
            : <b className="bcm-who gone">Removed</b>}
          <time dateTime={new Date(c.createdAt).toISOString()}>{agoText(c.createdAt)}</time>
          {c.editedAt ? <small>edited</small> : null}
        </div>
        {mode === 'edit'
          ? <Composer small placeholder="Edit your comment" start={c.body ?? ''} onCancel={() => setMode('read')}
            onSend={(body) => lbApi.editComment(c.id, body).then(() => { setMode('read'); onChange() })} />
          : <p className={c.removed ? 'gone' : ''}>{c.removed ? 'This comment was removed.' : c.body}</p>}
        {!c.removed && mode !== 'edit' ? (
          <div className="bcm-a">
            {onReply && open && signedIn && canWrite(me) ? <button type="button" onClick={() => setMode(mode === 'reply' ? 'read' : 'reply')}>Reply</button> : null}
            {c.own ? <button type="button" aria-label="Edit" title="Edit" onClick={() => setMode('edit')}><PenLine aria-hidden="true" /></button> : null}
            {c.canRemove ? <button type="button" aria-label="Remove" title="Remove" onClick={remove}><Trash2 aria-hidden="true" /></button> : null}
            {!c.own && signedIn ? <button type="button" aria-label="Report" title="Report" className={mode === 'report' ? 'on' : ''}
              onClick={() => setMode(mode === 'report' ? 'read' : 'report')}><Flag aria-hidden="true" /></button> : null}
          </div>
        ) : null}
        {mode === 'reply' && onReply ? <Composer small placeholder={`Reply to ${who?.name ?? 'this comment'}`} onCancel={() => setMode('read')}
          onSend={(body) => onReply(body).then(() => setMode('read'))} /> : null}
        {mode === 'report' ? <div className="bcm-rp"><ReportBuild buildId={buildId} commentId={c.id} onClose={() => setMode('read')} /></div> : null}
      </div>
    </div>
  )
}

export function BuildSocial({ buildId, d, mine }: { buildId: string; d: BuildDetailResponse | null; mine: boolean }) {
  const { me, session, toast } = useScope()
  const signedIn = Boolean(me?.account)
  const writes = canWrite(me)
  // likes, saves and comments each read their own key; signing in or out invalidates every key, which refetches them
  // for the new viewer
  const socialRead = useQuery(lbq.buildSocial(buildId))
  const social = socialRead.data ?? null
  const thread = useInfiniteQuery(lbq.comments(buildId))
  const comments: CommentItem[] | null = thread.data ? thread.data.pages.flatMap((page) => page.comments) : null
  const next = thread.hasNextPage
  /** a comment written, edited or removed: this build's thread and its count are read again. */
  const reload = () => { void invalidate(lbKeys.comments(buildId), lbKeys.buildSocial(buildId)) }
  const setSocial = (change: (s: BuildSocialResponse) => BuildSocialResponse) =>
    queryClient.setQueryData<BuildSocialResponse>(lbKeys.buildSocial(buildId), (s) => s ? change(s) : s)

  const needAccount = (run: () => void) => () => { if (signedIn) run(); else openSignIn() }
  const like = needAccount(() => {
    if (!social) return
    const was = social
    setSocial((s) => ({ ...s, liked: !was.liked, likes: was.likes + (was.liked ? -1 : 1) }))
    ;(was.liked ? lbApi.unlike(buildId) : lbApi.like(buildId)).then((r) => setSocial((s) => ({ ...s, ...r })),
      (e: unknown) => { setSocial(() => was); toast(errorText(e), true) })
  })
  const save = needAccount(() => {
    if (!social) return
    const was = social
    setSocial((s) => ({ ...s, bookmarked: !was.bookmarked }))
    ;(was.bookmarked ? lbApi.unsave(buildId) : lbApi.save(buildId)).then(() => {
      void invalidate(lbKeys.bookmarks())
      toast(was.bookmarked ? 'removed from your saved builds.' : 'saved! find it in Saved on your profile :P')
    }, (e: unknown) => { setSocial(() => was); toast(errorText(e), true) })
  })
  const setOpen = (open: boolean) => {
    lbApi.putBuildDoc(buildId, { ...(d?.notes ?? { tags: [] }), commentsOpen: open })
      .then(() => { setSocial((s) => ({ ...s, commentsOpen: open })); void invalidate(lbKeys.build(buildId)); toast(open ? 'comments are open! :P' : 'comments are closed now. existing comments stay visible.') },
        (e: unknown) => toast(errorText(e), true))
  }
  const more = () => {
    if (next) thread.fetchNextPage().then((r) => { if (r.isError) toast(errorText(r.error), true) }, () => undefined)
  }
  const post = (body: string, parentId?: string) => lbApi.comment(buildId, { body, ...(parentId ? { parentId } : {}) }).then(reload)

  const open = social?.commentsOpen ?? true
  return (
    <section className="bcm" onClick={(event) => event.stopPropagation()}>
      <div className="bcm-row">
        <button type="button" className={`bcm-b${social?.liked ? ' on' : ''}`} aria-pressed={social?.liked ?? false} onClick={like} disabled={!social}>
          <Heart aria-hidden="true" />{social ? social.likes : '-'}<span>{social?.liked ? 'Liked' : 'Like'}</span></button>
        {!mine ? <button type="button" className={`bcm-b${social?.bookmarked ? ' on' : ''}`} aria-pressed={social?.bookmarked ?? false} onClick={save} disabled={!social}>
          {social?.bookmarked ? <BookmarkCheck aria-hidden="true" /> : <Bookmark aria-hidden="true" />}<span>{social?.bookmarked ? 'Saved' : 'Save'}</span></button> : null}
        <span className="bcm-ct">{social ? `${social.comments} comment${social.comments === 1 ? '' : 's'}` : ''}</span>
        {mine && social ? <button type="button" className="bcm-b ghost" onClick={() => setOpen(!open)}>
          {open ? <Lock aria-hidden="true" /> : <LockOpen aria-hidden="true" />}<span>{open ? 'Close comments' : 'Open comments'}</span></button> : null}
      </div>

      {socialRead.isError ? <p className="bcm-quiet" role="alert">{errorText(socialRead.error)} <button type="button" className="lk" onClick={() => void socialRead.refetch()}>Try again</button></p> : null}

      {(open || mine) && signedIn && !writes ? <p className="bcm-quiet">claim your UID before commenting! change your build in game, generate a new card and claim it within 15 minutes.
          claim while signed in to keep the UID on your account :P <button type="button" className="lk" onClick={openSignIn}>Claim your UID</button></p>
        : (open || mine) && signedIn ? <Composer placeholder="Comment on this build" onSend={(body) => post(body)} />
        : !signedIn && session !== 'unknown' ? <p className="bcm-quiet"><button type="button" className="lk" onClick={openSignIn}>Sign in</button> to like, save or comment :P</p>
        : !mine ? <p className="bcm-quiet">the owner has closed comments on this build. you can still read the ones already here.</p> : null}

      <div className="bcm-list">
        {thread.isError && !thread.data ? <p className="bcm-quiet" role="alert">{errorText(thread.error)} <button type="button" className="lk" onClick={() => void thread.refetch()}>Try again</button></p>
          : comments == null ? <p className="bcm-quiet">loading comments... :P</p>
          : !comments.length ? <p className="bcm-quiet">no comments here yet... :P</p>
          : comments.map((c) => (
            <div key={c.id} className="bcm-th">
              <Comment c={c} buildId={buildId} signedIn={signedIn} open={open} onChange={reload} onReply={(body) => post(body, c.id)} />
              {c.replies?.map((r) => <Comment key={r.id} c={r} buildId={buildId} signedIn={signedIn} open={open} onChange={reload} />)}
            </div>
          ))}
        {next ? <button type="button" className="lk bcm-more" onClick={more}>Older comments</button> : null}
      </div>
    </section>
  )
}
