/*
  Author: Runor Ewhro
  Description: Renders the parser surface for the calculator echoes flow.
*/

import { cloneElement, isValidElement as isVldElem, useEffect, useMemo, useRef, useState } from 'react'
import type { HTMLAttributes as HtmlAttrs } from 'react'
import type { EchoInstance } from '@/domain/entities/runtime.ts'
import { getResSeedBy } from '@/domain/services/resonatorSeedService.ts'
import { getMkScrPrcn, getEchoScrPr, getMaxEchoSc } from '@/data/scoring/echoScoring.ts'
import { hideBrknMg } from '@/shared/lib/imageFallback'
import { AppModal } from '@/shared/ui/AppModal'
import { MdlClsBttn } from '@/shared/ui/ModalCloseButton.tsx'
import { ContextTrigger } from '@/shared/ui/CtxTrigger.tsx'
import { EchoGrid, mkEchoGridTm } from '@/shared/ui/EchoGrid.tsx'
import { useAppStore } from '@/domain/state/store.ts'
import { prsChsFromMg } from '@/engine/echoParser/ocrParsing.ts'
import { mkEchoNstnFr } from '@/engine/echoParser/echoBuilder.ts'
import { useTstStr } from '@/shared/util/toastStore.ts'
import { useEchoSrfcM } from '@/modules/calculator/features/echoes/lib/useEchoSurfaceMenu.tsx'
import { qpEchoAtSlot } from '@/modules/calculator/features/echoes/lib/equip.ts'
import { Copy } from 'lucide-react'
import { useSel } from '@/modules/calculator/lib/sel.tsx'

// handles the screenshot parser workflow for batch importing echoes.
interface EchoMgPrsrMd {
  visible: boolean
  open: boolean
  closing?: boolean
  portalTarget: HTMLElement | null
  charId: string
  curChs: Array<EchoInstance | null>
  onEquip: (echoes: Array<EchoInstance | null>) => void
  onEquipEcho: (echoes: Array<EchoInstance | null>) => void
  onClose: () => void
}

export function Parser({
  visible,
  open,
  closing = false,
  charId,
  curChs: crrnChs,
  onEquip,
  onEquipEcho,
  onClose,
}: EchoMgPrsrMd) {
  const addEchoToInv = useAppStore((s) => s.addInvEcho)
  const showToast = useTstStr((state) => state.show)

  const [view, setView] = useState<'instructions' | 'preview'>('instructions')
  const [parsedEchoes, setPrsdChs] = useState<Array<EchoInstance | null>>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function trnsToPrvw(echoes: Array<EchoInstance | null>) {
    setPrsdChs(echoes)
    setView('preview')
  }

  function backToNstr() {
    selection.exitSelectionMode()
    setView('instructions')
    setError(null)
  }

  async function onMgFile(file: File) {
    setError(null)
    setIsLoading(true)
    try {
      const raw = await prsChsFromMg(file)
      const instances = mkEchoNstnFr(raw)
      setIsLoading(false)
      trnsToPrvw(instances)
    } catch (err) {
      setIsLoading(false)
      if (err instanceof Error && err.message === 'invalid_image_size') {
        setError('Image must be exactly 1920×1080. Do not resize or crop.')
      } else {
        setError('Parsing failed, please try again.')
      }
    }
  }

  // Global paste listener
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items
      if (!items) return
      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile()
          if (file) {
            onMgFile(file)
            break
          }
        }
      }
    }
    document.addEventListener('paste', handlePaste)
    return () => document.removeEventListener('paste', handlePaste)
  })

  function closeSelf() {
    if (closing) return
    selection.exitSelectionMode()
    onClose()
  }

  const hasWeights = getMaxEchoSc(charId) > 0
  const scores = hasWeights
    ? parsedEchoes.map((echo) => (echo ? getEchoScrPr(charId, echo) : null))
    : null
  const buildScore = hasWeights ? getMkScrPrcn(charId, parsedEchoes) : null
  const resName = getResSeedBy(charId)?.name ?? charId
  const previewItems = useMemo(() => mkEchoGridTm({
    echoes: parsedEchoes,
    scores,
    slotCount: 5,
  }), [parsedEchoes, scores])
  const menuHelpers = useEchoSrfcM({
    clpbSrcResId: charId,
    clipSourceName: resName,
    curChs: crrnChs,
    onQpEchoAtjg: (echo, slotIndex) => {
      onEquipEcho(qpEchoAtSlot(crrnChs, echo, slotIndex))
    },
  })
  const selTms = useMemo(
    () => previewItems
      .filter((item): item is typeof item & { echo: EchoInstance } => Boolean(item.echo))
      .map((item) => ({
        id: `parser:${item.echo.uid}:${item.rndrIdx}`,
        val: item.echo,
      })),
    [previewItems],
  )
  const selCtns = useMemo(() => [{
    id: 'parser:copy',
    key: 'copy' as const,
    needsSel: true,
    icon: <Copy size={14} />,
    label: ({ count }: { count: number }) => `Copy (${count})`,
    title: 'Copy selected echoes (Ctrl/Cmd+C)',
    run: async ({ vals }: { vals: EchoInstance[] }) => {
      const wrote = await menuHelpers.copyEchoesToClipboard(vals)
      if (wrote) {
        showToast({
          content: `Copied ${vals.length} echo${vals.length === 1 ? '' : 'es'}.`,
          variant: 'success',
          duration: 2200,
        })
      }
    },
  }], [menuHelpers, showToast])
  const selection = useSel({
    active: visible && view === 'preview',
    surfaceId: 'echo-parser-preview',
    ariaLabel: 'Parser echo selection actions',
    items: selTms,
    acts: selCtns,
  })

  return (
    <AppModal
      state={{ visible, open, closing }}
      variant="echo-parser"
      parserView={view}
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
          if (file) onMgFile(file)
          e.target.value = ''
        }}
      />

      {view === 'instructions' ? (
        <div className="echo-parser-instructions">
          <div className="app-modal-header">
            <div className="app-modal-header-top">
              <h2 className="echo-parser-title">Import Echo</h2>
              <MdlClsBttn onClick={closeSelf} />
            </div>
          </div>

          <div className="echo-parser-body">
            <img
              src="/assets/sample-import-image.png"
              alt="Sample Echo Import Format"
              className="echo-parser-sample-image"
              onError={hideBrknMg}
            />
            <ul className="echo-parser-list">
              <li>Image should be generated with the <strong>wuwa bot</strong>. You can find it
                on the official Wuthering Waves Discord server: <code>/create</code></li>
              <li>Do <strong>NOT</strong> resize, compress, or crop the image</li>
              <li>Must be <strong>1920 × 1080</strong></li>
              <li>Only works well with English text</li>
              <li>Only imports echoes; other build data is unaffected</li>
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
                if (file) onMgFile(file)
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
              <MdlClsBttn onClick={closeSelf} />
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
                  if (echo) addEchoToInv(echo)
                }
              }}
            >
              Save All to Bag
            </button>
            <button
              type="button"
              className="ui-pill-button ui-pill-button-secondary"
              onClick={backToNstr}
            >
              Cancel
            </button>
          </div>

          <div className="echo-parser-preview-grid">
            <EchoGrid
              selection={selection}
              echoes={parsedEchoes}
              variant="full"
              showSubstats
              showImage
              scores={scores}
              slotCount={5}
              interactive
              getCardClskn={(item) => {
                if (!item.echo) {
                  return ''
                }

                const itemId = `parser:${item.echo.uid}:${item.rndrIdx}`
                return selection.selectionMode
                  ? `echo-card selection-mode${selection.isSelected(itemId) ? ' focus-selected' : ''}`
                  : ''
              }}
              wrapCard={(card, item) => {
                if (!item.echo) {
                  return <div key={item.key}>{card}</div>
                }

                const itemId = `parser:${item.echo.uid}:${item.rndrIdx}`
                const cardElement = isVldElem<HtmlAttrs<HTMLElement>>(card)
                  ? cloneElement(card, {
                      'data-selection-focus-item': 'true',
                      onClickCapture: selection.buildClickCapture(itemId),
                    } as HtmlAttrs<HTMLElement> & { 'data-selection-focus-item': string })
                  : (
                      <div data-selection-focus-item="true" onClickCapture={selection.buildClickCapture(itemId)}>
                        {card}
                      </div>
                    )

                return (
                  <ContextTrigger
                    key={item.key}
                    asChild
                    ariaLabel={`${item.echo.mainEcho ? 'Main echo' : 'Echo'} actions`}
                    items={menuHelpers.buildReadOnlyMenu({
                      id: itemId,
                      echo: item.echo,
                      onSelect: () => {
                        selection.focusSurface()
                        selection.addToSelection(itemId)
                      },
                    })}
                  >
                    {cardElement}
                  </ContextTrigger>
                )
              }}
            />
          </div>
        </div>
      )}
    </AppModal>
  )
}
