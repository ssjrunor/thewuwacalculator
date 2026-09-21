/*
  Author: Runor Ewhro
  Description: Drafts register stat-column selection and group ordering within
               a column budget, committing changes when the popup closes.
*/

import { useCallback, useRef } from 'react'
import { Columns3Cog } from '@/shared/ui/LucideMotionIcons.ts'
import {
  AnchoredAppPopup,
  AppPopupFooter,
  AppPopupHeader,
  AppPopupFill,
  useAppPopupDismiss,
} from '@/shared/ui/AppPopup.tsx'
import {
  ColumnRack,
  useColumnBudget,
} from '@/modules/simulation/surfaces/rotation/program-editor/components/ColumnRack.tsx'
import {
  DEFAULT_STAT_KEYS,
  REGISTER_GROUPS,
  type RegisterGroup,
  type StatKey,
} from '@/modules/simulation/surfaces/rotation/program-editor/presentation/registerRows.ts'
import { useConfigurationSession } from '@/shared/ui/useConfigurationSession.ts'

interface ColumnsMenuProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  statKeys: readonly StatKey[]
  onStatKeys: (value: readonly StatKey[]) => void
  groupOrder: readonly RegisterGroup[]
  onGroupOrder: (value: readonly RegisterGroup[]) => void
  ceiling: number
  disabled?: boolean
}

export function ColumnsMenu({
  open,
  onOpenChange,
  statKeys,
  onStatKeys,
  groupOrder,
  onGroupOrder,
  ceiling,
  disabled = false,
}: ColumnsMenuProps) {
  const hostRef = useRef<HTMLSpanElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const popupRef = useRef<HTMLDivElement | null>(null)
  const session = useConfigurationSession({
    source: { statKeys, groupOrder },
    active: open,
    commit: (reducer) => {
      const next = reducer({ statKeys, groupOrder })
      if (next.statKeys !== statKeys) onStatKeys(next.statKeys)
      if (next.groupOrder !== groupOrder) onGroupOrder(next.groupOrder)
    },
  })
  const draft = open ? session.draft : { statKeys, groupOrder }
  const budget = useColumnBudget(draft.statKeys, draft.groupOrder, ceiling)
  const close = useCallback(() => {
    onOpenChange(false)
    session.finish()
  }, [onOpenChange, session])

  useAppPopupDismiss({
    open,
    onDismiss: close,
    hostRef,
    popupRef,
    returnFocusRef: triggerRef,
    pointerEvent: 'mousedown',
  })

  const reset = () => {
    session.replace({
      statKeys: DEFAULT_STAT_KEYS.slice(0, ceiling),
      groupOrder: REGISTER_GROUPS,
    })
  }

  return (
    <span className="rte-cm" ref={hostRef}>
      <button
        ref={triggerRef}
        type="button"
        className={`rte-tool${open ? ' is-on' : ''}`}
        data-motion-icon-group=""
        aria-expanded={open}
        aria-haspopup="dialog"
        title="Choose the columns and the order their bands read in"
        aria-label="Choose the columns"
        disabled={disabled}
        onClick={() => open ? close() : onOpenChange(true)}
      >
        <Columns3Cog size="0.86rem" mode="signature" trigger="parent-hover" aria-hidden="true" />
      </button>

      <AnchoredAppPopup
        visible={open}
        anchorRef={triggerRef}
        popupRef={popupRef}
        align="end"
        preferredPlacement="down"
        maxHeight={640} className="rte-columns__drop"
        open={open}
        role="dialog"
        aria-label="Columns"
      >
        <AppPopupHeader>
          <span>Columns</span>
          <AppPopupFill />
          <span className={`app-popup__metric${budget.full ? ' is-full' : ''}`}>
            {budget.taken} / {budget.ceiling}
            <i>{budget.widthRem.toFixed(1)}rem</i>
          </span>
        </AppPopupHeader>

        <ColumnRack
          statKeys={draft.statKeys}
          onStatKeys={(next) => session.update((current) => ({
            ...current,
            statKeys: next,
          }))}
          groupOrder={draft.groupOrder}
          onGroupOrder={(next) => session.update((current) => ({
            ...current,
            groupOrder: next,
          }))}
          ceiling={ceiling}
        />

        <AppPopupFooter>
          <span>Drag a band to move it. Click a column to switch it.</span>
          <AppPopupFill />
          <button type="button" className="app-popup__action" onClick={reset}>Reset</button>
        </AppPopupFooter>
      </AnchoredAppPopup>
    </span>
  )
}
