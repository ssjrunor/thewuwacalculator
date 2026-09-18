/*
  Author: Runor Ewhro
  Description: Owns build-card import state, hosting the import strip and
               converting parsed candidates into preview rows.
*/

import { cloneElement, isValidElement as isVldElem, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, HTMLAttributes as HtmlAttrs } from 'react'
import type { ReactNode } from 'react'
import type { EchoInstance, ResRuntime } from '@/domain/entities/runtime.ts'
import { getResAccent, getResSeedBy } from '@/domain/services/resonatorSeedService.ts'
import { getEchoById, listEchoes } from '@/domain/services/echoCatalogService.ts'
import { useEchoScores } from '@/data/scoring/useEchoScoringRevision.ts'
import { AppModal } from '@/shared/ui/AppModal'
import { useAppModal } from '@/shared/ui/useAppModal.ts'
import { useConfigurationSession } from '@/shared/ui/useConfigurationSession.ts'
import { ImportStrip } from '@/modules/simulation/features/echoes/ImportStrip.tsx'
import { ImportReceipt } from '@/modules/simulation/features/echoes/ImportReceipt.tsx'
import { Edit } from '@/modules/simulation/features/echoes/Edit.tsx'
import { ConfirmModal } from '@/shared/ui/ConfirmationModal.tsx'
import { applyImprtRd, type ImportBands } from '@/modules/simulation/features/echoes/lib/importApply.ts'
import {
  askForIdntty,
  idntyDffrs,
  readIdentity,
  type PlayerIdentity,
} from '@/modules/simulation/features/echoes/lib/playerIdentity.ts'
import { ContextTrigger } from '@/shared/ui/CtxTrigger.tsx'
import { EchoRows, EchoRowsFoot, makeEchoRows } from '@/shared/ui/EchoRows.tsx'
import { useAppStore } from '@/domain/state/store.ts'
import { prsBldFromMg, type ParsedBuildScreenshot } from '@/engine/echoParser/ocrParsing.ts'
import { READ_CANCELLED, type ReadProgress } from '@/engine/echoParser/readProgress.ts'
import { mkEchoNstnFr } from '@/engine/echoParser/echoBuilder.ts'
import { useTstStr } from '@/shared/util/toastStore.ts'
import { useEchoSrfcM } from '@/modules/simulation/features/echoes/lib/useEchoSurfaceMenu.tsx'
import { qpEchoAtSlot } from '@/modules/simulation/features/echoes/lib/equip.ts'
import { Copy, LibraryBig } from 'lucide-react'
import { useSel } from '@/modules/simulation/lib/sel.tsx'

function UidDigits({ uid, against }: { uid: string; against: string | null }) {
  return (
    <span className="imp-id__uid">
      {uid.split('').map((digit, index) => (
        <i key={index} className={against && digit !== against[index] ? 'is-off' : ''}>{digit}</i>
      ))}
    </span>
  )
}

function IdentityLine({ saved, card }: { saved: PlayerIdentity; card: PlayerIdentity }) {
  const hadSaved = Boolean(saved.playerId || saved.playerUid)
  return (
    <span className="imp-id">
      <span className="imp-id__side">
        {hadSaved ? (
          <>
            <b>{saved.playerId || 'no name'}</b>
            <UidDigits uid={saved.playerUid} against={null} />
          </>
        ) : (
          <b>nothing saved</b>
        )}
      </span>
      <span className="imp-id__arw">→</span>
      <span className="imp-id__side is-card">
        <b>{card.playerId || 'no name read'}</b>
        <UidDigits uid={card.playerUid} against={hadSaved ? saved.playerUid : null} />
      </span>
    </span>
  )
}

// handles the screenshot parser workflow for batch importing echoes.
interface EchoMgPrsrMd {
  visible: boolean
  open: boolean
  closing?: boolean
  portalTarget: HTMLElement | null
  charId: string | null
  runtime: ResRuntime | null
  currentEchoes: Array<EchoInstance | null>
  onEquipEcho: (echoes: Array<EchoInstance | null>) => void
  onApplyRead: (read: ParsedBuildScreenshot, next: (prev: ResRuntime) => ResRuntime) => void
  onDetectedResonator?: (resonatorId: string) => void
  allowDetectedDestination?: boolean
  headerExtra?: ReactNode
  onClose: () => void
}

export function Parser({
  visible,
  open,
  closing = false,
  portalTarget,
  charId,
  runtime,
  currentEchoes: crrnChs,
  onEquipEcho,
  onApplyRead,
  onDetectedResonator,
  allowDetectedDestination = false,
  headerExtra,
  onClose,
}: EchoMgPrsrMd) {
  const addEchoToInv = useAppStore((s) => s.addInvEcho)
  const savedPlayerId = useAppStore((s) => s.ui.preferences.playerId)
  const savedPlayerUid = useAppStore((s) => s.ui.preferences.playerUid)
  const setPlayerIdntty = useAppStore((s) => s.setPlayerIdentity)
  const identitySession = useConfigurationSession({
    source: { playerId: savedPlayerId, playerUid: savedPlayerUid },
    active: visible,
    commit: (reducer) => {
      const next = reducer({ playerId: savedPlayerId, playerUid: savedPlayerUid })
      setPlayerIdntty(next.playerId, next.playerUid)
    },
  })
  const showToast = useTstStr((state) => state.show)
  const editModal = useAppModal()
  const allEchoes = useMemo(() => listEchoes(), [])

  const [view, setView] = useState<'instructions' | 'preview'>('instructions')
  const [parsedEchoes, setPrsdChs] = useState<Array<EchoInstance | null>>([])
  const [editSlot, setEditSlot] = useState<number | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [progress, setProgress] = useState<ReadProgress | null>(null)
  const [readSrc, setReadSrc] = useState<string | null>(null)
  const [read, setRead] = useState<ParsedBuildScreenshot | null>(null)
  const [bands, setBands] = useState<ImportBands>({ resonator: true, weapon: true, echoes: true })
  const [gateOpen, setGateOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const readCtrlRef = useRef<AbortController | null>(null)
  const scores = useEchoScores(charId, parsedEchoes)

  function trnsToPrvw(echoes: Array<EchoInstance | null>) {
    setPrsdChs(echoes)
    setView('preview')
  }

  // Resolve parsed holder identity separately before accepting the Echo preview.
  const savedIdentity = identitySession.draft
  const cardIdentity = read ? readIdentity(read.player) : null
  const identityAsk = cardIdentity ? askForIdntty(savedIdentity, cardIdentity) : null

  function answerGate(keep: boolean) {
    if (!keep && cardIdentity) {
      identitySession.replace({
        playerId: cardIdentity.playerId,
        playerUid: cardIdentity.playerUid,
      })
    }
    setGateOpen(false)
  }

  function backToNstr() {
    selection.exitSelectionMode()
    setView('instructions')
    setError(null)
    setRead(null)
    setGateOpen(false)
  }

  function dropReadSrc() {
    setReadSrc((current) => {
      if (current) URL.revokeObjectURL(current)
      return null
    })
  }

  function stopRead() {
    readCtrlRef.current?.abort()
    readCtrlRef.current = null
    setIsLoading(false)
    setProgress(null)
    dropReadSrc()
  }

  async function onMgFile(file: File) {
    readCtrlRef.current?.abort()
    const control = new AbortController()
    readCtrlRef.current = control

    setError(null)
    setProgress({ stage: 'catalog', done: 0, total: 1 })
    dropReadSrc()
    setReadSrc(URL.createObjectURL(file))
    setIsLoading(true)

    try {
      const result = await prsBldFromMg(file, {
        signal: control.signal,
        onProgress: (next) => {
          if (!control.signal.aborted) setProgress(next)
        },
      })
      const instances = mkEchoNstnFr(result.echoes)
      if (control.signal.aborted) return
      readCtrlRef.current = null
      setIsLoading(false)
      setProgress(null)
      dropReadSrc()
      setRead(result)
      if (result.resonator.id) onDetectedResonator?.(result.resonator.id)
      setBands({ resonator: true, weapon: true, echoes: true })
      setGateOpen(idntyDffrs(savedIdentity, readIdentity(result.player)))
      trnsToPrvw(instances)
    } catch (err) {
      if (control.signal.aborted || (err instanceof Error && err.message === READ_CANCELLED)) {
        return
      }
      readCtrlRef.current = null
      setIsLoading(false)
      setProgress(null)
      dropReadSrc()
      if (err instanceof Error && err.message === 'invalid_image_size') {
        setError('This image is not 1920 × 1080. Save the bot\'s picture at full size, uncropped.')
      } else {
        setError('No echo panels found. This needs a card from /create, with the bottom row intact.')
      }
    }
  }

  // Register paste handling only while this parser instance is mounted.
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
    readCtrlRef.current?.abort()
    readCtrlRef.current = null
    if (editModal.visible) editModal.hide()
    selection.exitSelectionMode()
    onClose()
  }

  const resName = charId ? getResSeedBy(charId)?.name ?? charId : 'No resonator selected'
  const modalAccent = charId ? getResAccent(charId) : null
  const previewItems = useMemo(() => makeEchoRows({
    echoes: parsedEchoes,
    scores,
    slotCount: 5,
  }), [parsedEchoes, scores])
  const menuHelpers = useEchoSrfcM({
    clpbSrcResId: charId ?? 'echo-import',
    clipSourceName: resName,
    currentEchoes: crrnChs,
    onQpEchoAtjg: (echo, slotIndex) => {
      onEquipEcho(qpEchoAtSlot(crrnChs, echo, slotIndex))
    },
  })
  const selTms = useMemo(
    () => previewItems
      .filter((item): item is typeof item & { echo: EchoInstance } => Boolean(item.echo))
      .map((item) => ({
        id: `parser:${item.echo.uid}:${item.renderIndex}`,
        val: item.echo,
      })),
    [previewItems],
  )
  const selCtns = useMemo(() => [{
    id: 'parser:copy',
    key: 'copy' as const,
    needsSel: true,
    icon: <Copy size="1em" />,
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
  const editEcho = editSlot !== null ? parsedEchoes[editSlot] ?? null : null
  const parsedEchoCost = parsedEchoes.reduce(
    (total, echo) => total + (echo ? getEchoById(echo.id)?.cost ?? 0 : 0),
    0,
  )
  const editEchoCost = editEcho ? getEchoById(editEcho.id)?.cost ?? 0 : 0
  const maxEditCost = 12 - parsedEchoCost + editEchoCost

  function closeEdit() {
    editModal.hide(() => setEditSlot(null))
  }

  function saveEditedEcho(updated: EchoInstance) {
    if (editSlot === null) return
    setPrsdChs((current) => qpEchoAtSlot(current, updated, editSlot))
    closeEdit()
  }

  function clearEditedEcho() {
    if (editSlot === null) return
    setPrsdChs((current) => {
      const next = [...current]
      next[editSlot] = null
      return next
    })
    closeEdit()
  }

  const parserModal = (
    <AppModal
      state={{ visible, open, closing }}
      variant="echo-parser"
      parserView={view}
      ariaLabel="Import Echo from Image"
      style={modalAccent ? {
        '--modal-accent': modalAccent,
        '--resonator-accent': modalAccent,
      } as CSSProperties : undefined}
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
        <ImportStrip
            error={error}
            loading={isLoading}
            progress={progress}
            readSrc={readSrc}
            onFile={onMgFile}
            onCancel={stopRead}
            onChoose={() => fileInputRef.current?.click()}
            headerExtra={headerExtra}
            onClose={closeSelf}
        />
      ) : (
        <ImportReceipt
            read={read!}
            runtime={runtime}
            bands={bands}
            echoRows={(
            <div className="echo-parser-preview-grid">
              <EchoRows
                selection={selection}
                echoes={parsedEchoes}
                variant="card"
                scores={scores}
                slotCount={5}
                interactive
                onEchoClick={(echo, slotIndex) => {
                  if (!echo || selection.selectionMode) return
                  setEditSlot(slotIndex)
                  editModal.show()
                }}
                getRowActions={(item) => {
                  const echo = item.echo
                  if (!echo || selection.selectionMode) return null
                  const canSave = menuHelpers.canSaveEcho(echo)
                  const echoName = getEchoById(echo.id)?.name ?? 'Echo'

                  return (
                    <button
                      type="button" className="workspace-echo-ctl"
                      title={canSave ? 'Save to bag' : 'Already in the bag'}
                      aria-label={canSave ? `Save ${echoName} to bag` : `${echoName} is already in the bag`}
                      data-saved={canSave ? undefined : 'true'}
                      disabled={!canSave}
                      onClick={(event) => {
                        event.stopPropagation()
                        menuHelpers.saveEchoToInventory(echo)
                      }}
                    >
                      <LibraryBig size="0.86rem" aria-hidden="true" />
                    </button>
                  )
                }}
                getRowClskn={(item) => {
                  if (!item.echo) {
                    return ''
                  }

                  const itemId = `parser:${item.echo.uid}:${item.renderIndex}`
                  return selection.selectionMode
                    ? `selection-mode${selection.isSelected(itemId) ? ' focus-selected' : ''}`
                    : ''
                }}
                wrapRow={(card, item) => {
                  if (!item.echo) {
                    return <div key={item.key}>{card}</div>
                  }

                  const itemId = `parser:${item.echo.uid}:${item.renderIndex}`
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
              <EchoRowsFoot echoes={parsedEchoes} />
            </div>
            )}
            onToggleBand={(band) => setBands((prev) => ({ ...prev, [band]: !prev[band] }))}
            onApply={() => {
              if (read) onApplyRead(read, (prev) => applyImprtRd(prev, read, parsedEchoes, bands))
              closeSelf()
            }}
            onBagAll={() => {
              for (const echo of parsedEchoes) {
                if (echo) addEchoToInv(echo)
              }
              showToast({
                content: 'Echoes saved to the bag.',
                variant: 'success',
                duration: 2200,
              })
            }}
            onDiscard={backToNstr}
            allowDetectedDestination={allowDetectedDestination}
            headerExtra={headerExtra}
            onClose={closeSelf}
        />
      )}
    </AppModal>
  )

  return (
    <>
      {parserModal}
      {editModal.visible && editSlot !== null && editEcho ? (
        <Edit
          visible={editModal.visible}
          open={editModal.open}
          closing={editModal.closing}
          portalTarget={portalTarget}
          echo={editEcho}
          slotIndex={editSlot}
          echoes={allEchoes}
          maxCost={maxEditCost}
          onSave={saveEditedEcho}
          onClear={clearEditedEcho}
          onClose={closeEdit}
        />
      ) : null}
      {gateOpen && identityAsk && cardIdentity ? (
        <ConfirmModal
          visible
          open={open}
          portalTarget={portalTarget}
          title={identityAsk.title}
          message={(
            <>
              {identityAsk.lead}
              <IdentityLine saved={savedIdentity} card={cardIdentity} />
              <span className="imp-id__note">{identityAsk.verdict}</span>
            </>
          )}
          variant={identityAsk.tone}
          confirmLabel={identityAsk.confirmLabel}
          cancelLabel={identityAsk.cancelLabel}
          onConfirm={() => answerGate(identityAsk.confirmKeeps)}
          onCancel={() => answerGate(!identityAsk.confirmKeeps)}
        />
      ) : null}
    </>
  )
}
