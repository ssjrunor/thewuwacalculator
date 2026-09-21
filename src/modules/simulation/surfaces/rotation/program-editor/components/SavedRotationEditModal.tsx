/*
  Author: Runor Ewhro
  Description: Creates live saved rotations and edits persisted saved metadata.
*/

import { useState } from 'react'
import { Clock3, Save } from 'lucide-react'
import type { SavedRotation } from '@/domain/entities/inventoryStorage.ts'
import { AppModal } from '@/shared/ui/AppModal.tsx'
import { ModalHeader } from '@/shared/ui/AppModalShell.tsx'

interface SavedRotationEditModalProps {
  visible: boolean
  open: boolean
  closing: boolean
  mode: 'create' | 'edit'
  initial: Pick<SavedRotation, 'name' | 'duration' | 'note'>
  onClose: () => void
  onSave: (changes: Pick<SavedRotation, 'name' | 'duration' | 'note'>) => void
}

export function SavedRotationEditModal({
  visible,
  open,
  closing,
  mode,
  initial,
  onClose,
  onSave,
}: SavedRotationEditModalProps) {
  const [name, setName] = useState(initial.name)
  const [duration, setDuration] = useState(String(initial.duration))
  const [note, setNote] = useState(initial.note)

  const seconds = Number(duration)
  const valid = Boolean(
    name.trim()
    && Number.isFinite(seconds)
    && seconds >= 0,
  )

  return (
    <AppModal
      state={{ visible, open, closing }}
      variant="saved-rotation-editor"
      ariaLabel={mode === 'edit' ? `Edit ${initial.name}` : 'Save live rotation'}
      onClose={onClose}
    >
      <form className="amdl rse"
        onSubmit={(event) => {
          event.preventDefault()
          if (!valid) return
          onSave({
            name: name.trim(),
            duration: seconds,
            note,
          })
        }}
      >
        <ModalHeader
          over={mode === 'edit' ? 'Saved rotation' : 'Live advanced rotation'}
          title={<h2>{mode === 'edit' ? initial.name : 'Save rotation'}</h2>}
          onClose={onClose}
        />

        <div className="rse__body">
          <label className="rse__field">
            <span>Name</span>
            <input
              type="text"
              value={name}
              autoFocus
              onChange={(event) => setName(event.target.value)}
            />
          </label>

          <label className="rse__field">
            <span>Duration</span>
            <span className="rse__duration">
              <Clock3 size="0.8rem" aria-hidden="true" />
              <input
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                value={duration}
                onChange={(event) => setDuration(event.target.value)}
              />
              <samp>sec</samp>
            </span>
          </label>

          <label className="rse__field rse__field--note">
            <span>Note</span>
            <textarea
              rows={6}
              value={note}
              placeholder="Add context for this saved rotation."
              onChange={(event) => setNote(event.target.value)}
            />
          </label>
        </div>

        <footer className="amdl__foot">
          <button type="button" className="amdl__act" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="amdl__act is-go" disabled={!valid}>
            <Save size="0.8rem" aria-hidden="true" />
            {mode === 'edit' ? 'Save changes' : 'Save rotation'}
          </button>
        </footer>
      </form>
    </AppModal>
  )
}
