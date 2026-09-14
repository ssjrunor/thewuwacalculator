/*
  Author: Runor Ewhro
  Description: The once-a-day notice. It greets the account the app already
               knows, which is the whole condition for it standing at all: with
               no saved player ID there is nobody to greet and nothing is shown.

               A day is the local calendar date rather than a stored clock, so
               the notice comes back after midnight wherever the reader is and
               never twice in the same evening. Mounting is what fires it, so
               a caller can put it on the tree wherever the app should greet.
*/

import { useEffect } from 'react'
import { useAppStore } from '@/domain/state/store'
import { useTstStr } from '@/shared/util/toastStore.ts'

const DLYNTCSTORE = 'seen-daily-notice'

// the local calendar day, which is what "daily" means to the person reading it
function todayKey(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

export function DlyNtc() {
  const playerId = useAppStore((state) => state.ui.preferences.playerId)
  const showToast = useTstStr((state) => state.show)
  const dismiss = useTstStr((state) => state.dismiss)

  useEffect(() => {
    if (!playerId) return

    const day = todayKey()
    if (localStorage.getItem(DLYNTCSTORE) === day) {
      return
    }

    /*
      The slab is raised a beat after the mount rather than during it. A mount
      that is torn down and run again in the same commit, which is every mount
      under StrictMode, would otherwise raise one toast, dismiss it, and raise a
      second: the dismissal is animated, so the two stand together for the
      length of the close and the notice reads as double. Deferring lets the
      teardown cancel the first before it ever reaches the store.

      The day is marked here too, so a mount that never showed anything does not
      spend the day's only notice.
    */
    let id: string | null = null
    const timer = setTimeout(() => {
      localStorage.setItem(DLYNTCSTORE, day)

      id = showToast({
        content: `Welcome back, ${playerId}~`,
        variant: 'default',
        duration: 8000,
      })
    })

    // taking the notice off the tree takes its toast with it, so a slab never
    // outlives the mount that raised it
    return () => {
      clearTimeout(timer)
      if (id) dismiss(id)
    }
  }, [dismiss, playerId, showToast])

  return null
}
