/*
  Author: Runor Ewhro
  Description: Watches the address bar for an incoming share link (remote token
               or local fragment) and routes it through the import surface so it
               opens the import confirmation modal instead of applying silently.
               Clears the share params once handed off so a refresh won't repeat.
*/

import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { useNavX } from '@/shared/navigation/useNavX'
import { SHR_LINK_FRAG, SHR_REMOTE_PARAM } from '@/shared/lib/shareCodec.ts'
import { useImportSurface } from './ImportSurface.tsx'

export function ShareLinkWatcher({ enabled }: { enabled: boolean }) {
  const { queryImport } = useImportSurface()
  const navigate = useNavX()
  const { search, hash } = useLocation()
  // the page stays mounted across simulation surfaces, so a link is handled
  // once per address it arrives on, not once per mount
  const handledRef = useRef<string | null>(null)

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') {
      return
    }

    const params = new URLSearchParams(search)
    const hasRemoteShare = params.has(SHR_REMOTE_PARAM)
    const hasLocalShare = hash.startsWith(SHR_LINK_FRAG)
    if (!hasRemoteShare && !hasLocalShare) {
      handledRef.current = null
      return
    }

    const href = window.location.href
    if (handledRef.current === href) {
      return
    }
    handledRef.current = href

    // strip the share params before opening so a reload cannot reprocess it.
    params.delete(SHR_REMOTE_PARAM)
    const nextSearch = params.toString()
    const nextHash = hasLocalShare ? '' : hash
    const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${nextHash}`
    navigate(nextUrl, { replace: true })

    void queryImport(href)
  }, [enabled, hash, navigate, queryImport, search])

  return null
}
