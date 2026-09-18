/*
  Author: Runor Ewhro
  Description: Gates beta acknowledgement behind a timed countdown, records
               daily confirmation, and delays unmount through modal exit.
*/

import { useCallback, useEffect, useRef, useState } from 'react'
import { FlaskConical, TimerReset } from 'lucide-react'
import { AppModal } from '@/shared/ui/AppModal'
import { ModalShell } from '@/shared/ui/AppModalShell'
import { MODAL_EXIT_MS } from '@/shared/ui/useAppModal'
import {
  acknowledgeBetaNotice,
  isBetaNoticeAcknowledgedToday,
} from '@/infra/persistence/betaNotice'

const NOTICE_DELAY_MS = 10000
const COUNTDOWN_TICK_MS = 100

function countdownLabel(seconds: number) {
  return `${seconds} second${seconds === 1 ? '' : 's'}`
}

export function BetaNoticeModal() {
  const unlockAtRef = useRef<number | null>(null)
  const closeTimerRef = useRef<number | null>(null)
  const [secondsLeft, setSecondsLeft] = useState(NOTICE_DELAY_MS / 1000)
  const [canConfirm, setCanConfirm] = useState(false)
  const [closing, setClosing] = useState(false)
  const [dismissed, setDismissed] = useState(isBetaNoticeAcknowledgedToday)

  useEffect(() => {
    if (dismissed) return

    const unlockAt = performance.now() + NOTICE_DELAY_MS
    unlockAtRef.current = unlockAt

    const updateCountdown = () => {
      const remaining = Math.max(0, unlockAt - performance.now())
      setSecondsLeft(Math.ceil(remaining / 1000))

      if (remaining === 0) {
        setCanConfirm(true)
        window.clearInterval(interval)
      }
    }

    const interval = window.setInterval(updateCountdown, COUNTDOWN_TICK_MS)

    return () => {
      window.clearInterval(interval)
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current)
      }
      unlockAtRef.current = null
    }
  }, [dismissed])

  const confirm = useCallback(() => {
    const unlockAt = unlockAtRef.current
    if (!canConfirm || unlockAt === null || performance.now() < unlockAt) {
      return
    }

    acknowledgeBetaNotice()
    setClosing(true)
    closeTimerRef.current = window.setTimeout(() => {
      setDismissed(true)
      closeTimerRef.current = null
    }, MODAL_EXIT_MS)
  }, [canConfirm])

  if (dismissed) {
    return null
  }

  return (
    <AppModal
      state={{ visible: true, open: !closing, closing }}
      variant="beta-notice"
      ariaLabel="Welcome to the UI beta"
      ariaDscrBy="beta-notice-description"
      dismissible={false}
      onClose={() => undefined}
    >
      <ModalShell className="beta-notice-modal__frame">
        <header className="amdl__head">
          <span className="amdl__lead beta-notice-modal__lead" aria-hidden="true">
            <FlaskConical />
          </span>
          <span className="amdl__title">
            <span className="amdl__over">Public preview</span>
            <h2 id="beta-notice-title">Hewo~!</h2>
          </span>
          <span className="amdl__fill" />
          <span
            id="beta-notice-countdown"
            className={`amdl__tag beta-notice-modal__countdown${canConfirm ? ' is-accent' : ''}`}
            aria-live="polite"
          >
            <TimerReset aria-hidden="true" />
            {canConfirm ? 'Ready' : countdownLabel(secondsLeft)}
          </span>
        </header>

        <div className="amdl__pane beta-notice-modal__body">
          <div id="beta-notice-description" className="amdl__prose beta-notice-modal__intro">
            <p>Explore the interface before it becomes the production app, use the app as is, play around, do some stuff, idc.</p>
            <p>WAIT! If you're using this on mobile i recommend you use it on desktop as there's not much support for that YET (keyword being "yet").</p>
            <p>FOR THOSE INTERESTED IN GIVING FEEDBACK please use the app. Don't ask me where stuff is when you've barely explored. Click on anything and everything, be free,
            get used to the new surfaces. I expect you to have used it for a total of 48 hours before crying back to me about anything you happened to not like.</p>
            <p>And ofc, if you do find something that seems broken, please let me know on the discord, if you aren't on the discord... oh well, sucks to suck i guess, i can't read your mind.</p>
            <p>
              This is an early preview intended to help shape the new experience. Expect parts of
              it to change while the beta is public.
            </p>
            <p>You can load in any of your saved data from the current live app on here, it should work. If it doesn't, let me know.</p>
          </div>

          <section className="amdl__grp" aria-labelledby="beta-notice-before-title">
            <h3 id="beta-notice-before-title" className="amdl__grp-name">
              Before you continue
            </h3>
            <ul className="beta-notice-modal__points">
              <li>Some interactions, layouts, and wording are still being refined.</li>
              <li>Backend-dependent features, saved data, and shared links may be unavailable or reset.</li>
              <li>Results and workflows in this preview should not be treated as production-ready.</li>
            </ul>
          </section>
        </div>

        <footer className="amdl__foot">
          <button
            type="button"
            className="amdl__act is-go beta-notice-modal__confirm"
            onClick={confirm}
            disabled={!canConfirm}
            aria-describedby="beta-notice-countdown"
          >
            I understand
          </button>
        </footer>
      </ModalShell>
    </AppModal>
  )
}
