/*
  Author: Runor Ewhro
  Description: Normalizes route and startup errors, builds copyable diagnostics,
               and renders without depending on application state or providers.
*/

import { useState } from 'react'

const LIBRARY_FRAME = /react-core|react-dom|react-router|node_modules/

export interface NoticeError {
  message: string
  stack: string | null
}

export function readNoticeError(error: unknown): NoticeError {
  if (error instanceof Error) {
    return { message: error.message || error.name, stack: error.stack ?? null }
  }
  return { message: String(error), stack: null }
}

interface ErrorNoticeProps {
  error: NoticeError
  route: string
  bare?: boolean
  startup?: boolean
  heading?: string
  onHome?: () => void
}

export function ErrorNotice({ error, route, bare = false, startup = false, heading, onHome }: ErrorNoticeProps) {
  const [open, setOpen] = useState(startup)
  const [note, setNote] = useState<string | null>(null)

  function copyReport() {
    const report = [
      error.message,
      `Route: ${route}`,
      `Time: ${new Date().toISOString()}`,
      `Agent: ${navigator.userAgent}`,
      '',
      error.stack ?? '(no stack)',
    ].join('\n')

    const blocked = () => setNote('Copy was blocked')
    try {
      navigator.clipboard.writeText(report).then(() => setNote('Report copied'), blocked)
    } catch {
      blocked()
    }
  }

  return (
    <div className={`page rer${bare ? ' rer--bare' : ''}${startup ? ' rer--startup' : ''}`} role="alert">
      {startup && <div className="rer-wallpaper" aria-hidden="true" />}
      <div className="rer-band">
        <div className="rer-in">
          <div className="rer-mate" aria-hidden="true">
            <span className="rer-sprite" />
            <span className="rer-aside">huh..?</span>
          </div>

          <div className="rer-copy">
            <span className="rer-caps">Stopped on <b>{route}</b></span>
            <h1 className="rer-head">
              {heading ?? (startup ? 'The app could not start.' : 'This page stopped working.')}
            </h1>
            <p className="rer-msg">{error.message}</p>
            <p className="rer-body">
              Reload to try again. If this keeps happening, copy the error report.
            </p>

            <div className="rer-acts">
              <button type="button" className="rer-cap rer-cap--pri" onClick={() => window.location.reload()}>
                Reload page
              </button>
              {onHome && (
                <button type="button" className="rer-cap" onClick={onHome}>
                  Go to Home
                </button>
              )}
              {error.stack && (
                <button
                  type="button" className="rer-lnk"
                  aria-expanded={open} onClick={() => setOpen((value) => !value)}
                >
                  {open ? 'Hide stack trace' : 'Show stack trace'}
                </button>
              )}
              <button type="button" className="rer-lnk" onClick={copyReport}>Copy report</button>
              <span className="rer-note" role="status" key={note ?? ''}>{note}</span>
            </div>
          </div>

          {error.stack && (
            <div className="rer-fold" data-open={open}>
              <div>
                <pre className="rer-stack" tabIndex={open ? 0 : -1}>
                  {error.stack.split('\n').map((line, index) => (
                    <span key={index} className={LIBRARY_FRAME.test(line) ? 'rer-lib' : undefined}>
                      {line}{'\n'}
                    </span>
                  ))}
                </pre>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
