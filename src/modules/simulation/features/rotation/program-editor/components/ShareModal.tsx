/*
  Author: Runor Ewhro
  Description: Generates rotation share payloads through the remote-token path
               with an inline-token fallback, while keeping export and clipboard
               state scoped to the selected saved rotation.
*/

import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Copy, Download } from 'lucide-react'
import { AppModal } from '@/shared/ui/AppModal.tsx'
import { ModalHeader } from '@/shared/ui/AppModalShell'
import type { SavedRotation } from '@/domain/entities/inventoryStorage.ts'
import { useTstStr } from '@/shared/util/toastStore.ts'
import {
  makeRotationShare,
  makeRotationExportPayload,
  slugifyRotationFileName,
  type RotationShare,
} from '@/modules/simulation/features/rotation/program-editor/saved/share.ts'
import { xprtAppFile } from '@/shared/lib/fileCodec.ts'

interface RotationShareModalProps {
  visible: boolean
  open: boolean
  closing?: boolean
  entry: SavedRotation | null
  onClose: () => void
}

type Channel = 'token' | 'link'

export function RotationShareModal({
  visible,
  open,
  closing = false,
  entry,
  onClose,
}: RotationShareModalProps) {
  const showToast = useTstStr((state) => state.show)
  const [share, setShare] = useState<RotationShare | null>(null)
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState<Channel | null>(null)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Share output depends on remote KV availability, so regenerate per entry/open
  // instead of caching a possibly stale fallback decision.
  /* eslint-disable react-hooks/set-state-in-effect -- this effect owns the async share-generation lifecycle for the modal. */
  useEffect(() => {
    if (!visible || !entry) return

    let active = true
    setLoading(true)
    setShare(null)
    setCopied(null)

    void makeRotationShare(entry).then((result) => {
      if (active) {
        setShare(result)
        setLoading(false)
      }
    })

    return () => {
      active = false
    }
  }, [visible, entry])
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => () => {
    if (copyTimer.current) clearTimeout(copyTimer.current)
  }, [])

  const onCopy = useCallback(async (channel: Channel, value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(channel)
      if (copyTimer.current) clearTimeout(copyTimer.current)
      copyTimer.current = setTimeout(() => setCopied(null), 1600)
    } catch {
      showToast({ content: 'Clipboard write failed.', variant: 'error', duration: 3000 })
    }
  }, [showToast])

  const onExport = useCallback(async () => {
    if (!entry) return
    const payload = makeRotationExportPayload(entry)
    await xprtAppFile(
      `${slugifyRotationFileName(entry.name || 'rotation')}.json`,
      JSON.stringify(payload),
    )
    showToast({ content: `Exported "${entry.name}"`, variant: 'success', duration: 2500 })
  }, [entry, showToast])

  const renderField = (channel: Channel, label: string, value: string) => (
    <div className="amdl__fld">
      <span className="amdl__fld-k">{label}</span>
      <span className="rot-share__take">
        <code className={`rot-share__code${channel === 'link' ? ' rot-share__code--link' : ''}`}>
          {loading ? 'Generating…' : value}
        </code>
        <button
          type="button" className="amdl__act"
          onClick={() => onCopy(channel, value)}
          disabled={loading}
        >
          {copied === channel ? <Check size="0.8rem" /> : <Copy size="0.8rem" />}
          {copied === channel ? 'Copied' : 'Copy'}
        </button>
      </span>
    </div>
  )

  return (
    <AppModal
      state={{ visible, open, closing }}
      variant="rotation-share"
      ariaLabel={entry ? `Share ${entry.name}` : 'Share rotation'}
      onClose={onClose}
    >
      <div className="amdl amdl-inset rot-share">
        <ModalHeader
          over="Share rotation"
          title={<h2>{entry?.name ?? 'Rotation'}</h2>}
          onClose={onClose}
        />
        <div className="amdl__grp">
          {renderField('token', 'Token', share?.token ?? '')}
          {renderField('link', 'Link', share?.link ?? '')}
        </div>

        <div className="amdl__foot">
          <button type="button" className="amdl__act" onClick={() => void onExport()}>
            <Download size="0.8rem" />
            Export file
          </button>
          <button type="button" className="amdl__act is-go" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </AppModal>
  )
}
