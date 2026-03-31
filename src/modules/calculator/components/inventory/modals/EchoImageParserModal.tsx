import { useEffect, useRef, useState } from 'react'
import type { EchoInstance } from '@/domain/entities/runtime'
import { getBuildScorePercent, getEchoScorePercent, getMaxEchoScore } from '@/data/scoring/echoScoring'
import { AppDialog } from '@/shared/ui/AppDialog'
import { ModalCloseButton } from '@/shared/ui/ModalCloseButton'
import { EchoGrid } from '@/shared/ui/EchoGrid'
import { useAppStore } from '@/domain/state/store'
import { parseEchoesFromImage } from '@/engine/echoParser/ocrParsing'
import { buildEchoInstancesFromParsed } from '@/engine/echoParser/echoBuilder'

// handles the screenshot parser workflow for batch importing echoes.
interface EchoImageParserModalProps {
  visible: boolean
  portalTarget: HTMLElement | null
  charId: string
  onEquip: (echoes: Array<EchoInstance | null>) => void
  onClose: () => void
}

export function EchoImageParserModal({
  visible,
  portalTarget,
  charId,
  onEquip,
  onClose,
}: EchoImageParserModalProps) {
  const addEchoToInventory = useAppStore((s) => s.addEchoToInventory)

  const [internalOpen, setInternalOpen] = useState(false)
  const [internalClosing, setInternalClosing] = useState(false)
  const [view, setView] = useState<'instructions' | 'preview'>('instructions')
  const [parsedEchoes, setParsedEchoes] = useState<Array<EchoInstance | null>>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const closeTimerRef = useRef<number | null>(null)

  function transitionToPreview(echoes: Array<EchoInstance | null>) {
    setParsedEchoes(echoes)
    setInternalOpen(false)
    setInternalClosing(true)
    closeTimerRef.current = window.setTimeout(() => {
      setView('preview')
      setInternalClosing(false)
      setInternalOpen(true)
      closeTimerRef.current = null
    }, 300)
  }

  function backToInstructions() {
    setInternalOpen(false)
    setInternalClosing(true)
    closeTimerRef.current = window.setTimeout(() => {
      setView('instructions')
      setError(null)
      setInternalClosing(false)
      setInternalOpen(true)
      closeTimerRef.current = null
    }, 300)
  }

  async function handleImageFile(file: File) {
    setError(null)
    setIsLoading(true)
    try {
      const raw = await parseEchoesFromImage(file)
      const instances = buildEchoInstancesFromParsed(raw)
      setIsLoading(false)
      transitionToPreview(instances)
    } catch (err) {
      setIsLoading(false)
      if (err instanceof Error && err.message === 'invalid_image_size') {
        setError('Image must be exactly 1920×1080. Do not resize or crop.')
      } else {
        setError('Parsing failed — please try again.')
      }
    }
  }

  // Open animation on mount
  useEffect(() => {
    if (!visible) return
    const frame = requestAnimationFrame(() => setInternalOpen(true))
    return () => cancelAnimationFrame(frame)
  }, [visible])

  // Global paste listener
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items
      if (!items) return
      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile()
          if (file) {
            handleImageFile(file)
            break
          }
        }
      }
    }
    document.addEventListener('paste', handlePaste)
    return () => document.removeEventListener('paste', handlePaste)
  })

  useEffect(() => {
    return () => {
      if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current)
    }
  }, [])

  function closeSelf() {
    if (internalClosing) return
    setInternalOpen(false)
    setInternalClosing(true)
    closeTimerRef.current = window.setTimeout(() => {
      setInternalClosing(false)
      setView('instructions')
      setParsedEchoes([])
      setError(null)
      onClose()
      closeTimerRef.current = null
    }, 300)
  }

  const hasWeights = getMaxEchoScore(charId) > 0
  const scores = hasWeights
    ? parsedEchoes.map((echo) => (echo ? getEchoScorePercent(charId, echo) : null))
    : null
  const buildScore = hasWeights ? getBuildScorePercent(charId, parsedEchoes) : null

  return (
    <AppDialog
      visible={visible}
      open={internalOpen}
      closing={internalClosing}
      portalTarget={portalTarget}
      contentClassName={`app-modal-panel echo-parser-panel ${view}`}
      ariaLabel="Import Echo from Image"
      onClose={closeSelf}
    >
      <input
        type="file"
        ref={fileInputRef}
        accept="image/*"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) handleImageFile(file)
          e.target.value = ''
        }}
      />

      {view === 'instructions' ? (
        <div className="echo-parser-instructions">
          <div className="app-modal-header">
            <div className="app-modal-header-top">
              <h2 className="echo-parser-title">Import Echo</h2>
              <ModalCloseButton onClick={closeSelf} />
            </div>
          </div>

          <div className="echo-parser-body">
            <img
              src="/assets/sample-import-image.png"
              alt="Sample Echo Import Format"
              className="echo-parser-sample-image"
            />
            <ul className="echo-parser-list">
              <li>Image should be generated with the <strong>wuwa bot</strong>. You can find it
                on the official Wuthering Waves Discord server — <code>/create</code></li>
              <li>Do <strong>NOT</strong> resize, compress, or crop the image</li>
              <li>Must be <strong>1920 × 1080</strong></li>
              <li>Only works well with English text</li>
              <li>Only imports echoes — other build data is unaffected</li>
            </ul>

            {error ? (
              <p className="echo-parser-error">{error}</p>
            ) : null}

            <div
              className="echo-parser-dropzone"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault()
                const file = e.dataTransfer.files[0]
                if (file) handleImageFile(file)
              }}
            >
              {isLoading ? (
                <div className="echo-parser-spinner" />
              ) : (
                <div className="echo-parser-dropzone-inner">
                  <p
                    className="echo-parser-choose"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    Choose Image
                  </p>
                  <p className="echo-parser-hint">or drag & drop · paste from clipboard</p>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="echo-parser-preview">
          <div className="app-modal-header">
            <div className="app-modal-header-top">
              <div>
                <h2 className="echo-parser-title">Import Preview</h2>
                <p className="echo-parser-subtitle">You're about to import the following echoes:</p>
              </div>
              {buildScore !== null ? (
                <span className="echo-parser-build-score echo-score-badge">
                  Build Score: {buildScore.toFixed(1)}%
                </span>
              ) : null}
              <ModalCloseButton onClick={closeSelf} />
            </div>
          </div>

          <div className="echo-parser-preview-actions">
            <button
              type="button"
              className="ui-pill-button"
              onClick={() => {
                onEquip(parsedEchoes)
                closeSelf()
              }}
            >
              Equip
            </button>
            <button
              type="button"
              className="ui-pill-button"
              onClick={() => {
                for (const echo of parsedEchoes) {
                  if (echo) addEchoToInventory(echo)
                }
              }}
            >
              Save All to Bag
            </button>
            <button
              type="button"
              className="ui-pill-button ui-pill-button-secondary"
              onClick={backToInstructions}
            >
              Cancel
            </button>
          </div>

          <div className="echo-parser-preview-grid">
            <EchoGrid
              echoes={parsedEchoes}
              variant="full"
              showSubstats
              showImage
              scores={scores}
              slotCount={5}
            />
          </div>
        </div>
      )}
    </AppDialog>
  )
}
