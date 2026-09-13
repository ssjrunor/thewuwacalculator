/*
  Author: Runor Ewhro
  Description: UI component for managing team loadouts in inventory.
               Handles saving, loading, and deleting team loadout snapshots.
*/

import { Trash2, Layers } from 'lucide-react'
import type { InvTeamLoadout } from '@/domain/entities/teamLoadout.ts'
import { useTstStr } from '@/shared/util/toastStore.ts'
import { useCnfr } from '@/app/hooks/useConfirmation.ts'
import { CnfrMdl } from '@/shared/ui/ConfirmationModal.tsx'

interface TeamLoadoutManagerProps {
  loadouts: InvTeamLoadout[]
  portalTarget: HTMLElement | null
  onLoadLoadout: (loadout: InvTeamLoadout) => void
  onDeleteLoadout: (id: string) => void
}

export function TeamLoadoutManager({
  loadouts,
  portalTarget,
  onLoadLoadout,
  onDeleteLoadout,
}: TeamLoadoutManagerProps) {
  const showToast = useTstStr((state) => state.show)
  const confirmation = useCnfr()

  const handleDelete = (loadout: InvTeamLoadout) => {
    confirmation.confirm({
      title: 'Delete team loadout?',
      message: `Are you sure you want to delete "${loadout.name}"? This action cannot be undone.`,
      confirmLabel: 'Delete',
      variant: 'danger',
      onConfirm: () => {
        onDeleteLoadout(loadout.id)
        showToast({
          content: `Deleted "${loadout.name}".`,
          variant: 'success',
          duration: 2200,
        })
      },
    })
  }

  return (
    <>
      <div className="inv-team-loadouts">
        <div className="inv-section-head">
          <span className="inv-section-label">Team Loadouts</span>
          <span className="inv-section-meta">{loadouts.length}</span>
        </div>

        {loadouts.length > 0 ? (
          <div className="inv-loadout-grid">
            {loadouts.map((loadout) => (
              <div key={loadout.id} className="inv-loadout-card">
                <div className="inv-loadout-header">
                  <span className="inv-loadout-name">{loadout.name}</span>
                  <span className="inv-loadout-meta">
                    {new Date(loadout.updatedAt).toLocaleDateString()}
                  </span>
                </div>

                <div className="inv-loadout-actions" role="group" aria-label={`${loadout.name} actions`}>
                  <button
                    type="button"
                    className="inv-loadout-action"
                    title={`Load "${loadout.name}"`}
                    aria-label={`Load "${loadout.name}"`}
                    onClick={() => {
                      onLoadLoadout(loadout)
                      showToast({
                        content: `Loaded "${loadout.name}".`,
                        variant: 'success',
                        duration: 2200,
                      })
                    }}
                  >
                    <Layers size="1em" aria-hidden="true" />
                    Load
                  </button>

                  <button
                    type="button"
                    className="inv-loadout-action is-danger"
                    title={`Delete "${loadout.name}"`}
                    aria-label={`Delete "${loadout.name}"`}
                    onClick={() => handleDelete(loadout)}
                  >
                    <Trash2 size="1em" aria-hidden="true" />
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="inv-empty-state">
            No saved team loadouts yet. Save one from the team creator.
          </p>
        )}
      </div>

      <CnfrMdl
        visible={confirmation.visible}
        open={confirmation.open}
        closing={confirmation.closing}
        portalTarget={portalTarget}
        title={confirmation.title}
        message={confirmation.message}
        confirmLabel={confirmation.confirmLabel}
        cancelLabel={confirmation.cancelLabel}
        variant={confirmation.variant}
        onConfirm={confirmation.onConfirm}
        onCancel={confirmation.onCancel}
      />
    </>
  )
}
