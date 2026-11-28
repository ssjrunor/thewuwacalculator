/*
  Author: Runor Ewhro
  description: actions for an opened build: save, copy link and report, and look, hide and delete for the owner.
*/

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Bookmark, BookmarkCheck, Eye, EyeOff, Flag, Link2, Palette, Trash2 } from 'lucide-react'
import type { BuildSocialResponse } from '@/domain/leaderboard/api'
import { queryClient } from '@/shared/lib/queryClient'
import { mainPortal } from '@/shared/lib/portalTarget'
import { ConfirmHost } from '@/shared/ui/ConfirmationModal'
import { useConfirm } from '@/shared/hooks/useConfirmation'
import { APP_ROUTES } from '@/shared/lib/appRoutes'
import { lbApi } from '../../api/client'
import { invalidate, lbKeys, lbq } from '../../api/queries'
import { openSignIn } from '../../chrome/chrome'
import { LbModal } from '../../chrome/LbModal'
import { errorText } from '../../model/cardTrack'
import { resName } from '../../model/format'
import { useScope } from '../../state/ctx'
import { CopyIb, Ib } from '../IconButtons'
import { ReportBuild } from './ReportBuild'

export function BuildTools({ buildId, resonatorId, uid, mine, hidden }: {
  buildId: string
  resonatorId: string
  uid: string | null
  mine: boolean
  // the owner hid it from everyone else
  hidden: boolean
}) {
  const { me, go, playerTo, changed, toast } = useScope()
  const signedIn = Boolean(me?.account)
  const read = useQuery(lbq.buildSocial(buildId))
  const social = read.data ?? null
  const [report, setReport] = useState(false)
  // the report form mounts on first open and stays mounted so the modal can play its exit
  const [reportAsked, setReportAsked] = useState(false)
  if (report && !reportAsked) setReportAsked(true)
  const confirmation = useConfirm()

  const setSocial = (change: (s: BuildSocialResponse) => BuildSocialResponse) =>
    queryClient.setQueryData<BuildSocialResponse>(lbKeys.buildSocial(buildId), (s) => s ? change(s) : s)
  const needAccount = (run: () => void) => () => { if (signedIn) run(); else openSignIn() }

  const save = needAccount(() => {
    if (!social) return
    const was = social
    setSocial((s) => ({ ...s, bookmarked: !was.bookmarked }))
    ;(was.bookmarked ? lbApi.unsave(buildId) : lbApi.save(buildId)).then(() => {
      void invalidate(lbKeys.bookmarks())
      toast(was.bookmarked ? 'removed from your saved builds.' : 'saved! find it in Saved on your profile :P')
    }, (e: unknown) => { setSocial(() => was); toast(errorText(e), true) })
  })
  const link = () => `${location.origin}${playerTo({ uid, buildId })}?build=${buildId}`

  const hide = () => {
    lbApi.setHidden(buildId, !hidden).then(() => changed(hidden ? 'the build is visible again! :P' : 'build hidden! only you can see it now.'),
      (e: unknown) => toast(errorText(e), true))
  }
  const remove = () => confirmation.confirm({
    title: 'Delete this build?',
    message: `Its scores and saves go with it, and this exact ${resName(resonatorId)} card can't be submitted again.`,
    confirmLabel: 'Delete build',
    cancelLabel: 'Keep it',
    variant: 'danger',
    onConfirm: () => {
      lbApi.deleteBuild(buildId).then(() => changed('build deleted. this exact card cannot be submitted again.'), (e: unknown) => toast(errorText(e), true))
    },
  })

  return (
    <span className="xtl" onClick={(event) => event.stopPropagation()}>
      {mine ? <>
        <Ib small icon={Palette} label="Card look" onClick={() => go(`${APP_ROUTES.leaderboard}/me/looks?res=${resonatorId}`)} />
        <Ib small icon={hidden ? Eye : EyeOff} label={hidden ? 'Show to everyone' : 'Hide from everyone'} on={hidden} className={hidden ? 'on' : undefined} onClick={hide} />
        <Ib small icon={Trash2} label="Delete" className="xtl-warn" onClick={remove} />
        <ConfirmHost control={confirmation} portalTarget={mainPortal()} />
      </> : <>
        <Ib small icon={social?.bookmarked ? BookmarkCheck : Bookmark} label={social?.bookmarked ? 'Saved' : 'Save'} on={social?.bookmarked} className={social?.bookmarked ? 'on' : undefined} onClick={save} />
        <CopyIb small icon={Link2} label="Copy link" text={link} />
        <i className="xtl-sep" />
        <Ib small icon={Flag} label="Report" className="xtl-warn" onClick={() => setReport(true)} />
        {reportAsked ? (
          <LbModal open={report} onClose={() => setReport(false)} over={resName(resonatorId)} title="Report this build" className="lrp">
            <ReportBuild key={buildId} buildId={buildId} onClose={() => setReport(false)} />
          </LbModal>
        ) : null}
      </>}
    </span>
  )
}
