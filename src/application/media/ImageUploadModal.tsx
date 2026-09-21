/*
  Author: Runor Ewhro
  Description: Resolves image links or uploads with scaling and storage-mode
               selection, then commits successful upload preferences on close.
*/

import { useRef, useState } from 'react'
import { X } from 'lucide-react'
import { AppModal } from '@/shared/ui/AppModal'
import type { AppModalState } from '@/shared/ui/AppModal'
import { Expandable } from '@/shared/ui/Expandable'
import { useAppStore } from '@/application/state'
import { storeUploadedImage } from '@/application/media/imageUpload.ts'
import type { StoredImage, UploadMode } from '@/application/media/imageUpload.ts'
import { useConfigurationSession } from '@/shared/ui/useConfigurationSession.ts'

interface ImageUploadModalProps {
  state: AppModalState
  title?: string
  initialCredit?: string
  onClose: (onClosed?: () => void) => void
  onApply: (result: StoredImage, credit: string) => void
}

const MODE_COPY: Record<UploadMode, { label: string; blurb: string }> = {
  session: { label: 'Session only', blurb: 'Kept until you refresh. Never leaves this device.' },
  indexeddb: { label: 'This device', blurb: "Saved in this browser's storage. Persists, stays private, this browser only." },
  imgbb: { label: 'ImgBB (your key)', blurb: 'Uploaded to your ImgBB account; only the link is saved. Works across devices.' },
}

type ScaleKey = 'recommended' | 'compact' | 'original'

// Default compression caps the longest edge; `original` bypasses scaling.
const SCALE_COPY: Record<ScaleKey, { label: string; sub: string; maxEdge: number | null }> = {
  recommended: { label: 'Recommended', sub: '2048px', maxEdge: 2048 },
  compact: { label: 'Compact', sub: '1280px', maxEdge: 1280 },
  original: { label: 'Original', sub: 'Full size', maxEdge: null },
}

// Key the body by open cycle to initialize form state without effect-driven reset.
export function ImageUploadModal({ state, title = 'Add image', initialCredit = '', onClose, onApply }: ImageUploadModalProps) {
  return (
    <AppModal state={state} ariaLabel={title} onClose={onClose}>
      {state.visible ? (
        <UploadBody key={state.open ? 'open' : 'closed'} title={title} initialCredit={initialCredit} onClose={onClose} onApply={onApply} />
      ) : null}
    </AppModal>
  )
}

function UploadBody({ title, initialCredit, onClose, onApply }: { title: string; initialCredit: string; onClose: (onClosed?: () => void) => void; onApply: (result: StoredImage, credit: string) => void }) {
  const uploadPersist = useAppStore((s) => s.ui.preferences.uploadPersist)
  const imgbbApiKey = useAppStore((s) => s.ui.preferences.imgbbApiKey)
  const setUploadPersist = useAppStore((s) => s.setUploadPersist)
  const setImgbbApiKey = useAppStore((s) => s.setImgbbApiKey)
  const preferences = useConfigurationSession({
    source: { uploadPersist, imgbbApiKey },
    commit: (reducer) => {
      const next = reducer({ uploadPersist, imgbbApiKey })
      if (next.uploadPersist !== uploadPersist) setUploadPersist(next.uploadPersist)
      if (next.imgbbApiKey !== imgbbApiKey) setImgbbApiKey(next.imgbbApiKey)
    },
  })

  const [tab, setTab] = useState<'upload' | 'link'>('upload')
  const [file, setFile] = useState<File | null>(null)
  const [linkUrl, setLinkUrl] = useState('')
  const [credit, setCredit] = useState(initialCredit)
  const [chosenMode, setChosenMode] = useState<UploadMode | null>(null)
  const [scale, setScale] = useState<ScaleKey>('recommended')
  const [keyInput, setKeyInput] = useState(imgbbApiKey)
  const [busy, setBusy] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const savedKey = preferences.draft.imgbbApiKey.trim()
  const effectiveMode: UploadMode | null = preferences.draft.uploadPersist ?? chosenMode
  const needsKey = effectiveMode === 'imgbb' && !savedKey
  const canUpload = !!file && !!effectiveMode && (!needsKey || keyInput.trim().length > 0) && !busy

  const handleUpload = async () => {
    if (!file || !effectiveMode) return
    setBusy(true)
    const apiKey = effectiveMode === 'imgbb' ? savedKey || keyInput.trim() : undefined
    const result = await storeUploadedImage(file, effectiveMode, apiKey, SCALE_COPY[scale].maxEdge)
    if (!result) {
      setBusy(false)
      return
    }
    if (effectiveMode !== 'session' && preferences.draft.uploadPersist !== effectiveMode) {
      preferences.update((current) => ({ ...current, uploadPersist: effectiveMode }))
    }
    if (effectiveMode === 'imgbb' && keyInput.trim() && keyInput.trim() !== savedKey) {
      preferences.update((current) => ({ ...current, imgbbApiKey: keyInput.trim() }))
    }
    onApply(result, credit)
    onClose(preferences.finish)
  }

  const handleUseLink = () => {
    const url = linkUrl.trim()
    if (!url) return
    onApply({ ref: url, persisted: true }, credit)
    onClose(preferences.finish)
  }

  return (
    <div className="image-upload-modal">
      <header className="iu-head">
          <h2 className="iu-title">{title}</h2>
          <button type="button" className="iu-close" aria-label="Close" onClick={() => onClose(preferences.finish)}>
            <X size="1rem" aria-hidden="true" />
          </button>
        </header>

        <div className="iu-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'upload'} data-on={tab === 'upload' ? 'true' : undefined} className="iu-tab" onClick={() => setTab('upload')}>
            Upload
          </button>
          <button type="button" role="tab" aria-selected={tab === 'link'} data-on={tab === 'link' ? 'true' : undefined} className="iu-tab" onClick={() => setTab('link')}>
            Url
          </button>
        </div>

        <div className="iu-field iu-credit">
          <label className="iu-field-label">
            Artist credit <span className="iu-field-opt">optional</span>
          </label>
          <input
            type="text" className="iu-input"
            placeholder="@artist or source"
            value={credit}
            onChange={(event) => setCredit(event.target.value)}
          />
          <span className="iu-field-note">Drop the artist's handle so they're credited on the card.</span>
        </div>

        {tab === 'link' ? (
          <div className="iu-section">
            <input
              type="url" className="iu-input"
              placeholder="https://…"
              value={linkUrl}
              onChange={(event) => setLinkUrl(event.target.value)}
            />
            <button type="button" className="iu-primary" disabled={!linkUrl.trim()} onClick={handleUseLink}>
              Use link
            </button>
          </div>
        ) : (
          <div className="iu-section">
            <button type="button" className="iu-drop" onClick={() => fileInputRef.current?.click()}>
              {file ? <span className="iu-filename">{file.name}</span> : <span>Choose an image…</span>}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(event) => {
                const next = event.target.files?.[0] ?? null
                setFile(next)
                event.target.value = ''
              }}
            />

            {file ? (
              <>
                <div className="iu-scale" role="radiogroup" aria-label="Resize before saving">
                  <span className="iu-scale-label">Size</span>
                  <div className="iu-scale-opts">
                    {(['recommended', 'compact', 'original'] as ScaleKey[]).map((key) => (
                      <button
                        key={key}
                        type="button"
                        role="radio"
                        aria-checked={scale === key}
                        data-on={scale === key ? 'true' : undefined} className="iu-scale-opt"
                        onClick={() => setScale(key)}
                      >
                        <span className="iu-scale-opt-label">{SCALE_COPY[key].label}</span>
                        <span className="iu-scale-opt-sub">{SCALE_COPY[key].sub}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {uploadPersist ? (
                  <p className="iu-hint">
                    Saving via <b>{MODE_COPY[uploadPersist].label}</b>. Change in Settings.
                  </p>
                ) : (
                  <div className="iu-modes" role="radiogroup" aria-label="How to keep this image">
                    {(['session', 'indexeddb', 'imgbb'] as UploadMode[]).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        role="radio"
                        aria-checked={chosenMode === mode}
                        data-on={chosenMode === mode ? 'true' : undefined} className="iu-mode"
                        onClick={() => setChosenMode(mode)}
                      >
                        <span className="iu-mode-label">{MODE_COPY[mode].label}</span>
                        <span className="iu-mode-blurb">{MODE_COPY[mode].blurb}</span>
                      </button>
                    ))}
                  </div>
                )}

                {needsKey ? (
                  <div className="iu-field">
                    <label className="iu-field-label">ImgBB API key</label>
                    <input
                      type="text" className="iu-input"
                      placeholder="Paste your ImgBB key"
                      value={keyInput}
                      onChange={(event) => setKeyInput(event.target.value)}
                    />
                    <a className="iu-link" href="https://imgbb.com/api" target="_blank" rel="noreferrer">
                      Get a free key →
                    </a>
                  </div>
                ) : null}

                <button type="button" className="iu-primary" disabled={!canUpload} onClick={handleUpload}>
                  {busy ? 'Saving…' : 'Save image'}
                </button>
              </>
            ) : null}
          </div>
        )}

        {tab === 'upload' && file && !uploadPersist ? (
          <Expandable className="iu-why"
            triggerClass="iu-why-toggle"
            chevronSize={13}
            innerClass="iu-why-body"
            noHeaderWrap
            header={<span className="iu-why-title">Why these options?</span>}
          >
            <p>
              Browsers can't stuff big images into normal settings storage, so you pick where each
              upload lives:
            </p>
            <ul className="iu-why-list">
              <li><b>Session only</b>: quickest, but gone on refresh.</li>
              <li><b>This device</b>: saved in your browser's database; private and persistent, but only here.</li>
              <li><b>ImgBB</b>: hosted under your own key; persists and follows you across devices.</li>
            </ul>
            <p className="iu-why-foot">
              No built-in uploader because Imgur stopped handing out new API keys; no keyless host like
              Catbox because browsers block direct uploads to it (it'd need a server) and it's a fragile
              one-person service; and no shared app key because everyone would share one rate limit,
              it invites abuse, and your images would sit on someone else's account instead of yours.
            </p>
          </Expandable>
        ) : null}
    </div>
  )
}
