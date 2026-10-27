/*
  Author: Runor Ewhro
  description: routes dropped files and share text to the matching import flow.
*/

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ClipboardEvent, DragEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { SIMULATION_ROUTES } from '@/shared/lib/appRoutes'
import { AnchoredAppPopup, useAppPopupDismiss } from '@/shared/ui/AppPopup'
import { Tooltip } from '@/shared/ui/Tooltip'
import { ConfirmModal } from '@/shared/ui/ConfirmationModal'
import { useAppModal } from '@/shared/ui/useAppModal'
import { mainPortal } from '@/shared/lib/portalTarget'
import { useTstStr } from '@/shared/util/toastStore'
import type { ResolvedImport } from '@/modules/calibration/api/imports'
import { openEchoImport } from '@/modules/simulation/features/echoes/lib/echoImportStore'
import { requestSharedImport } from '@/modules/simulation/shell/imports/request'
import { useGameImport } from './lib/store'
import '@/styles/features/imports/sheet.css'

const MORNYE = 'https://yumeo.dev/mornye-tools'
const SEEN_KEY = 'wwc.gameImport.seen'
const PROFILE_IDS = ['1506', '1108', '1413']


const NOTICE = [
  'Mornye Tools is a pretty nifty tool independently developed by Yumeo.',
  'This app supports importing compatible files exported by Mornye Tools. This integration is limited to its exports; the two applications are developed and maintained separately.',
  'Before using Mornye Tools, please familiarize yourself with its functionality and terms. Your decision to use it, and how you use it, is your own responsibility.',
]

type Row = 'game' | 'card' | 'code'

const ROWS: Array<[Row, string, string]> = [
  ['game', 'Game data', 'Resonators, weapons and echoes from a Mornye Tools export'],
  ['card', 'Build card', 'Echoes read from a screenshot of the in-game card'],
  ['code', 'Shared code', 'A rotation someone sent you, as a code or a link'],
]

type AppData = Extract<ResolvedImport, { kind: 'snapshot' | 'legacy' }> & { name: string }

function appDataAsk(data: AppData): { title: string; message: string; confirm: string; danger: boolean } {
  if (data.kind === 'legacy') {
    const { report } = data.result
    return {
      title: 'Import a v1 backup',
      message: `${report.importedProfileIds.length} profiles, ${report.importedInventoryEchoes} bag echoes and ${report.importedInventoryBuilds} saved builds will be imported from ${data.name}.`,
      confirm: 'Import backup',
      danger: false,
    }
  }
  if (data.label === 'full snapshot') {
    return {
      title: 'Restore a snapshot',
      message: `The builds, inventory, rotations and settings in this browser are replaced with the ones in ${data.name}.`,
      confirm: 'Restore',
      danger: true,
    }
  }
  return {
    title: 'Import app data',
    message: `The ${data.label} in ${data.name} is merged into your app data. Everything else stays as it is.`,
    confirm: 'Import',
    danger: false,
  }
}

function readSeen(): boolean {
  try {
    return window.localStorage.getItem(SEEN_KEY) === '1'
  } catch {
    return false
  }
}

function writeSeen() {
  try {
    window.localStorage.setItem(SEEN_KEY, '1')
  } catch {
    return
  }
}

function UploadIcon({ up = false }: { up?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={up ? 1.8 : 2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {up ? <><path d="M12 15V4" /><path d="m7.5 8.5 4.5-4.5 4.5 4.5" /></> : <><path d="M12 3v11" /><path d="m7.5 9.5 4.5 4.5 4.5-4.5" /></>}
      <path d="M4 15.5V19a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3.5" />
    </svg>
  )
}

function ExternalLinkIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 4h6v6" /><path d="M20 4 10 14" /><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" />
    </svg>
  )
}

function SourceIcon({ row }: { row: Row }) {
  if (row === 'game') {
    return (
      <span className="isht-source-icon isht-source-icon--profiles">
        {PROFILE_IDS.map((id, index) => (
          <img key={id} alt="" src={`/assets/game/resonators/profiles/${id}.webp`} style={{ left: `${0.375 + index * 0.5625}rem`, zIndex: 3 - index }} />
        ))}
      </span>
    )
  }
  if (row === 'card') return <span className="isht-source-icon"><span className="isht-source-icon-card"><i /><i /><i /></span></span>
  return <span className="isht-source-icon"><span className="isht-source-icon-code">k3V-tQ9</span></span>
}

export function Sheet({ simulating }: { simulating: boolean }) {
  const navigate = useNavigate()
  const hostRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const popupRef = useRef<HTMLDivElement | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const anyFileRef = useRef<HTMLInputElement | null>(null)
  const [reading, setReading] = useState(false)
  const [dropError, setDropError] = useState<string | null>(null)
  const [appData, setAppData] = useState<AppData | null>(null)
  const [applying, setApplying] = useState(false)
  const confirmModal = useAppModal()
  const showToast = useTstStr((state) => state.show)
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<'menu' | 'game'>('menu')
  const [notice, setNotice] = useState(false)
  const [hot, setHot] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [seen, setSeen] = useState(readSeen)
  const [outline, setOutline] = useState<{ d: string; dash: string; markerY: number | null; originX: number }>({ d: '', dash: '0 4000', markerY: null, originX: 0 })
  const reviewing = useGameImport((state) => state.session != null)
  const shown = useGameImport((state) => state.shown)
  const reopenDrop = useGameImport((state) => state.reopenDrop)

  const close = useCallback(() => {
    setOpen(false)
    setNotice(false)
    setHot(null)
    setError(null)
    setDropError(null)
  }, [])

  // return to file selection after a review change request.
  const [handledReopen, setHandledReopen] = useState(reopenDrop)
  if (reopenDrop !== handledReopen) {
    setHandledReopen(reopenDrop)
    setOpen(true)
    setStep('game')
  }

  useAppPopupDismiss({ open, onDismiss: close, hostRef, popupRef, returnFocusRef: triggerRef })

  useLayoutEffect(() => {
    const popup = popupRef.current
    const trigger = triggerRef.current
    if (!open || !popup || !trigger) return
    const pr = popup.getBoundingClientRect()
    const tr = trigger.getBoundingClientRect()
    const scale = pr.width / popup.offsetWidth || 1
    const x0 = (tr.left + tr.width / 2 - pr.left) / scale
    const h = popup.offsetHeight
    const r = 12
    const d = `M${x0} 0.5 H${r} A${r - 0.5} ${r - 0.5} 0 0 0 0.5 ${r} V${h - r}`
    const row = hot ? popup.querySelector<HTMLElement>(`[data-hot="${hot}"]`) : null
    if (!row || step !== 'menu') {
      setOutline({ d, dash: '0 4000', markerY: null, originX: x0 })
      return
    }
    const y = row.offsetTop + row.offsetHeight / 2
    setOutline({ d, dash: `${(x0 - r) + (Math.PI * r) / 2 + (y - r)} 4000`, markerY: y, originX: x0 })
  }, [open, hot, step])

  const toggle = () => {
    if (reviewing) {
      useGameImport.getState().dismiss()
      return
    }
    if (open) {
      close()
      return
    }
    setStep('menu')
    setOpen(true)
  }

  const loadGameFile = useCallback(async (file: File, raw?: string) => {
    setBusy(true)
    setError(null)
    try {
      const { openYumeoGameDataImport } = await import('@/application/imports/yumeo/session')
      const session = await openYumeoGameDataImport(raw ?? file)
      const origin = popupRef.current?.getBoundingClientRect() ?? null
      useGameImport.getState().open(session, { name: file.name, modified: file.lastModified || null }, origin)
      writeSeen()
      setSeen(true)
    } catch {
      setError('Could not read that file. Choose the .json Mornye Tools exported.')
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    if (!shown || !open) return
    setBusy(false)
    close()
  }, [shown, open, close])

  // preload review modules during file selection.
  useEffect(() => {
    if (step !== 'game' || !open) return
    void import('@/modules/simulation/api/globalHosts')
    void import('@/application/imports/yumeo/session')
  }, [step, open])

  const goShared = (raw?: string) => {
    close()
    requestSharedImport(raw)
    if (!simulating) navigate(SIMULATION_ROUTES.modulation)
  }

  const pick = (row: Row) => {
    if (row === 'game') {
      setStep('game')
      setHot(null)
      return
    }
    if (row === 'card') {
      close()
      openEchoImport()
      return
    }
    goShared()
  }

  // route dropped data by import type.
  const routeAny = async (source: File | string) => {
    if (reading) return
    setReading(true)
    setDropError(null)
    try {
      const { resolveImport } = await import('@/modules/calibration/api/imports')
      const read = await resolveImport(source)
      const name = typeof source === 'string' ? 'the pasted data' : source.name
      if (read.kind === 'image') {
        close()
        openEchoImport(null, read.file)
      } else if (read.kind === 'gameData') {
        setStep('game')
        void loadGameFile(typeof source === 'string' ? new File([], 'Pasted export') : source, read.raw)
      } else if (read.kind === 'other') {
        goShared(read.raw)
      } else {
        close()
        setAppData({ ...read, name })
        confirmModal.show()
      }
    } catch (failure) {
      setDropError(failure instanceof Error ? failure.message : 'Could not read that.')
    } finally {
      setReading(false)
    }
  }

  const applyAppDataPick = async () => {
    if (!appData || applying) return
    setApplying(true)
    try {
      const { applyAppData } = await import('@/modules/calibration/api/imports')
      await applyAppData(appData.kind === 'legacy' ? appData.result.snapshot : appData.snapshot)
      confirmModal.hide()
      showToast({
        content: appData.kind === 'legacy'
          ? 'Imported the v1 backup into your app data.'
          : `Imported the ${appData.label} into your app data.`,
        variant: 'success',
      })
    } catch {
      showToast({ content: 'Could not apply the imported data. Please try again.', variant: 'error' })
    } finally {
      setApplying(false)
    }
  }

  const onDropAny = (event: DragEvent<HTMLElement>) => {
    event.preventDefault()
    const file = event.dataTransfer.files?.[0]
    if (file) void routeAny(file)
  }

  const onPasteAny = (event: ClipboardEvent<HTMLElement>) => {
    const file = event.clipboardData.files?.[0]
    const text = event.clipboardData.getData('text').trim()
    if (!file && !text) return
    event.preventDefault()
    void routeAny(file ?? text)
  }

  const onDropGame = (event: DragEvent<HTMLElement>) => {
    event.preventDefault()
    const file = event.dataTransfer.files?.[0]
    if (file) void loadGameFile(file)
  }

  const lit = open || reviewing

  return (
    <div className="ax-drop-holder isht-holder" ref={hostRef}>
      <Tooltip content="Import" placement="bottom">
        <button
          ref={triggerRef}
          type="button"
          className={`ax-g isht-trigger-icon${lit ? ' is-open' : ''}`}
          aria-expanded={open}
          aria-haspopup="menu"
          aria-label="Import"
          onClick={toggle}
        >
          <UploadIcon />
        </button>
      </Tooltip>
      <span className={`isht-connector${open ? ' is-open' : ''}`} aria-hidden="true" />

      <AnchoredAppPopup
        visible={open}
        open={open}
        anchorRef={triggerRef}
        popupRef={popupRef}
        portalClassName="ax-menu"
        align="end"
        maxHeight={720}
        className={`isht${step === 'game' ? ' is-wide' : ''}${notice ? ' has-notice' : ''}`}
        role="dialog"
        aria-label="Import"
        onPointerLeave={() => setHot(null)}
      >
        {step === 'menu' ? (
          <>
            <svg className="isht-outline" aria-hidden="true"><path d={outline.d} style={{ strokeDasharray: outline.dash }} /></svg>
            <i className="isht-origin-marker" style={{ left: `${outline.originX - 4.5}px` }} aria-hidden="true" />
            <i className="isht-progress-marker" style={{ top: `${outline.markerY ?? 0}px`, opacity: outline.markerY == null ? 0 : 1 }} aria-hidden="true" />
            <div className="isht-k">Import</div>
            {ROWS.map(([id, name, desc]) => (
              <button
                key={id}
                type="button"
                className={`isht-src${hot === id ? ' is-hot' : ''}`}
                data-hot={id}
                onPointerEnter={() => setHot(id)}
                onFocus={() => setHot(id)}
                onClick={() => pick(id)}
              >
                <SourceIcon row={id} />
                <span className="isht-src-t">
                  <span className="isht-src-n">{name}{id === 'game' && !seen ? <i className="isht-new" title="New" /> : null}</span>
                  <span className="isht-src-d">{desc}</span>
                </span>
                <svg className="isht-go" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
              </button>
            ))}
            <div className="isht-rule" />
            <div
              className={`isht-drop${reading ? ' is-busy' : ''}`}
              data-hot="drop"
              tabIndex={0}
              role="button"
              aria-label="Drop or choose a file, or paste a code"
              aria-busy={reading}
              onPointerEnter={() => setHot('drop')}
              onFocus={() => setHot('drop')}
              onClick={() => anyFileRef.current?.click()}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                anyFileRef.current?.click()
              }}
              onDragOver={(event) => event.preventDefault()}
              onDrop={onDropAny}
              onPaste={onPasteAny}
            >
              <UploadIcon up />
              <span>{reading ? 'Reading' : 'Drop anything, or paste a code'}</span>
              <small>{reading ? 'one moment' : 'go on...'}</small>
            </div>
            {dropError ? <p className="isht-err" role="alert">{dropError}</p> : null}
            <input
              ref={anyFileRef}
              type="file"
              accept=".json,.wwcalc,application/json,image/*"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (file) void routeAny(file)
              }}
            />
          </>
        ) : (
          <>
            <i className="isht-origin-marker" style={{ left: `${outline.originX - 4.5}px` }} aria-hidden="true" />
            <div className="isht-gh">
              <button type="button" className="isht-back" aria-label="Back to imports" onClick={() => { setStep('menu'); setNotice(false); setError(null) }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 6-6 6 6 6" /></svg>
              </button>
              <b>Game data</b>
              <span>from a Mornye Tools export</span>
            </div>
            <button
              type="button"
              className={`isht-bigdrop${busy ? ' is-busy' : ''}`}
              disabled={busy}
              onClick={() => fileRef.current?.click()}
              onDragOver={(event) => event.preventDefault()}
              onDrop={onDropGame}
            >
              <UploadIcon up />
              <b>{busy ? 'Reading the file' : 'Drop the export here'}</b>
              <span>{busy ? 'one moment' : 'or click to choose the .json file'}</span>
            </button>
            {error ? <p className="isht-err" role="alert">{error}</p> : null}
            <div className="isht-refer">
              No file yet?
              <button type="button" onClick={() => setNotice((value) => !value)}>
                <ExternalLinkIcon />yumeo.dev/mornye-tools
              </button>
              {notice ? (
                <div className="isht-notice" role="dialog" aria-label="About Mornye Tools">
                  <h4><i className="isht-sp4" aria-hidden="true" />About Mornye Tools</h4>
                  <ul>{NOTICE.map((line) => <li key={line}>{line}</li>)}</ul>
                  <div className="isht-notice-act">
                    <button type="button" onClick={() => setNotice(false)}>Stay here</button>
                    <a href={MORNYE} target="_blank" rel="noopener noreferrer" onClick={() => setNotice(false)}>
                      <ExternalLinkIcon />Open yumeo.dev
                    </a>
                  </div>
                </div>
              ) : null}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".json,application/json"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (file) void loadGameFile(file)
              }}
            />
          </>
        )}
      </AnchoredAppPopup>
      {appData ? (() => {
        const ask = appDataAsk(appData)
        return (
          <ConfirmModal
            visible={confirmModal.dialogProps.visible}
            open={confirmModal.dialogProps.open}
            closing={confirmModal.dialogProps.closing}
            portalTarget={mainPortal()}
            title={ask.title}
            message={ask.message}
            confirmLabel={applying ? 'Importing...' : ask.confirm}
            confirmDisabled={applying}
            cancelLabel="Cancel"
            variant={ask.danger ? 'danger' : 'info'}
            onConfirm={() => void applyAppDataPick()}
            onCancel={confirmModal.hide}
          />
        )
      })() : null}
    </div>
  )
}
