/*
  Author: Runor Ewhro
  description: registers share handlers, resolves incoming payloads, and gates imports behind confirmation.
*/

import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { ClipboardPaste } from 'lucide-react'
import { ConfirmModal } from '@/shared/ui/ConfirmationModal.tsx'
import { useAppModal } from '@/shared/ui/useAppModal.ts'
import { mainPortal } from '@/shared/lib/portalTarget.ts'
import { resolveShareText } from '@/shared/lib/shareCodec.ts'

import { useTstStr } from '@/shared/util/toastStore.ts'
import {
  defineImport,
  type ImportApplyVariant,
  type ImportReview,
} from '@/application/imports/types.ts'
import { ImportReceived } from './ImportReceived.tsx'
import { useRotationImportHandler } from './rotation.ts'
import { useImportRequest } from './request.ts'

interface ImportSurfaceApi {
  // callers pass raw share text; the provider validates it and presents the review.
  queryImport: (raw: string) => Promise<void>
  // manual imports enter through the same resolver as deep links and files.
  openImport: () => void
}

const ImportSurfaceCtx = createContext<ImportSurfaceApi | null>(null)

export function useImportSurface(): ImportSurfaceApi {
  const ctx = useContext(ImportSurfaceCtx)
  if (!ctx) {
    throw new Error('useImportSurface must be used within an ImportSurfaceProvider')
  }
  return ctx
}

type ResolvedImport = {
  review: ImportReview
  apply: (variant: ImportApplyVariant) => void | Promise<void>
}

type Phase =
  | { mode: 'input' }
  | { mode: 'review'; resolved: ResolvedImport }

const NOT_FOUND = 'Could not read that link. Copy the complete link or token and try again.'

export function ImportSurfaceProvider({ children }: { children: ReactNode }) {
  const rotationHandler = useRotationImportHandler()
  const registry = useMemo(() => [defineImport(rotationHandler)], [rotationHandler])

  const showToast = useTstStr((state) => state.show)
  const modal = useAppModal()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const applyingRef = useRef(false)

  const [phase, setPhase] = useState<Phase>({ mode: 'input' })
  const [inputText, setInputText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [applying, setApplying] = useState(false)

  const resolve = useCallback(async (raw: string): Promise<ResolvedImport | null> => {
    const text = await resolveShareText(raw)
    if (!text.trim()) return null

    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      return null
    }

    for (const entry of registry) {
      const matched = await entry.tryResolve(parsed)
      if (matched) return matched
    }
    return null
  }, [registry])

  const queryImport = useCallback(async (raw: string) => {
    try {
      const resolved = await resolve(raw)
      if (!resolved) {
        showToast({ content: NOT_FOUND, variant: 'error', duration: 3500 })
        return
      }
      setInputText('')
      setError(null)
      setPhase({ mode: 'review', resolved })
      modal.show()
    } catch {
      showToast({ content: 'Could not load the imported data. Please try again.', variant: 'error' })
    }
  }, [modal, resolve, showToast])

  const openImport = useCallback(() => {
    setInputText('')
    setError(null)
    setBusy(false)
    setPhase({ mode: 'input' })
    modal.show()
  }, [modal])

  // advance the paste-or-pick step to review, or surface an inline error.
  const toReview = useCallback(async (raw: string) => {
    if (!raw.trim()) return
    setBusy(true)
    try {
      const resolved = await resolve(raw)
      if (!resolved) {
        setError(NOT_FOUND)
        return
      }
      setError(null)
      setPhase({ mode: 'review', resolved })
    } catch {
      setError('Could not load the imported data. Please try again.')
    } finally {
      setBusy(false)
    }
  }, [resolve])

  const onPasteToken = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (text.trim()) {
        setInputText(text.trim())
        setError(null)
      }
    } catch {
      setError('Could not read the clipboard. Enter the token in the field.')
    }
  }, [])

  const onPickFile = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      const { readAppFile } = await import('@/application/persistence/fileCodec.ts')
      await toReview(await readAppFile(file))
    } catch {
      setError('Failed to read that file. Select a valid export.')
    } finally {
      event.target.value = ''
    }
  }, [toReview])

  const runApply = useCallback(async (variant: ImportApplyVariant) => {
    if (phase.mode !== 'review' || applyingRef.current) return
    applyingRef.current = true
    setApplying(true)
    try {
      await phase.resolved.apply(variant)
      modal.hide()
    } catch {
      showToast({ content: 'Could not apply the imported data. Please try again.', variant: 'error' })
    } finally {
      applyingRef.current = false
      setApplying(false)
    }
  }, [modal, phase, showToast])

  const api = useMemo<ImportSurfaceApi>(() => ({ queryImport, openImport }), [queryImport, openImport])

  // the header import sheet asks for this review from any route.
  const pending = useImportRequest((state) => state.pending)
  useEffect(() => {
    if (!pending) return
    const taken = useImportRequest.getState().take()
    if (!taken) return
    if (taken.raw) void queryImport(taken.raw)
    else openImport()
  }, [pending, queryImport, openImport])

  const isReview = phase.mode === 'review'
  const review = isReview ? phase.resolved.review : null

  return (
    <ImportSurfaceCtx.Provider value={api}>
      {children}
      {review?.take ? (
        <ImportReceived
          state={modal.dialogProps}
          take={review.take}
          busy={applying}
          onTake={(pick) => void runApply(pick)}
          onCancel={modal.hide}
        />
      ) : (
        <ConfirmModal
          visible={modal.dialogProps.visible}
          open={modal.dialogProps.open}
          closing={modal.dialogProps.closing}
          portalTarget={mainPortal()}
          title={review ? review.title : 'Import'}
          message={
            review ? (
              review.summary
            ) : (
              <>
                Paste a share token, or choose an exported file.
                <div className="ims-token">
                  <input className="ims-token__input"
                    placeholder="Paste a share token"
                    value={inputText}
                    onChange={(event) => {
                      setInputText(event.target.value)
                      if (error) setError(null)
                    }}
                  />
                  <button
                    type="button" className="ims-token__paste"
                    onClick={() => void onPasteToken()}
                  >
                    {createElement(ClipboardPaste, { size: '0.85rem' })}
                    Paste
                  </button>
                </div>
                {error ? <div className="ims-error">{error}</div> : null}
              </>
            )
          }
          confirmLabel={review ? review.primaryLabel : 'Continue'}
          confirmDisabled={review ? false : !inputText.trim() || busy}
          secondaryLabel={review ? review.secondaryLabel : 'Choose file'}
          cancelLabel="Cancel"
          onConfirm={() => {
            if (review) {
              void runApply('primary')
            } else {
              void toReview(inputText)
            }
          }}
          onSecondary={
            review
              ? review.secondaryLabel
                ? () => void runApply('secondary')
                : undefined
              : () => fileInputRef.current?.click()
          }
          onCancel={modal.hide}
        />
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,.wwcalc,application/json"
        style={{ display: 'none' }}
        onChange={onPickFile}
      />
    </ImportSurfaceCtx.Provider>
  )
}
