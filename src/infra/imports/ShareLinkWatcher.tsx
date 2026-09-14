/*
  Author: Runor Ewhro
  Description: Watches the address bar for an incoming share link (remote token
               or local fragment) and routes it through the import surface so it
               opens the import confirmation modal instead of applying silently.
               Clears the share params once handed off so a refresh won't repeat.
*/

import { useEffect, useRef } from 'react'
import { useNavX } from '@/app/nav/useNavX'
import { SHR_LINK_FRAG, SHR_REMOTE_PARAM } from '@/shared/lib/shareCodec.ts'
import { useImportSurface } from './ImportSurface.tsx'

export function ShareLinkWatcher({ enabled }: { enabled: boolean }) {
  const { queryImport } = useImportSurface()
  const navigate = useNavX()
  const handledRef = useRef(false)

  useEffect(() => {
    if (!enabled || handledRef.current || typeof window === 'undefined') {
      return
    }

    const params = new URLSearchParams(window.location.search)
    const hasRemoteShare = params.has(SHR_REMOTE_PARAM)
    const hasLocalShare = window.location.hash.startsWith(SHR_LINK_FRAG)
    if (!hasRemoteShare && !hasLocalShare) {
      return
    }

    handledRef.current = true
    const href = window.location.href

    // strip the share params before opening so a reload cannot reprocess it.
    params.delete(SHR_REMOTE_PARAM)
    const nextSearch = params.toString()
    const nextHash = hasLocalShare ? '' : window.location.hash
    const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${nextHash}`
    navigate(nextUrl, { replace: true })

    void queryImport(href)
  }, [enabled, navigate, queryImport])

  return null
}
