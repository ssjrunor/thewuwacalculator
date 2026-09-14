/*
  Author: Runor Ewhro
  Description: Owns columns menu behavior and state transitions for the components module.
*/

import { useRef } from 'react'
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
} from '@/modules/simulation/features/rotation/program-editor/components/ColumnRack.tsx'
import {
  DEFAULT_STAT_KEYS,
  REGISTER_GROUPS,
  type RegisterGroup,
  type StatKey,
} from '@/modules/simulation/features/rotation/program-editor/presentation/registerRows.ts'

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
  const budget = useColumnBudget(statKeys, groupOrder, ceiling)

  useAppPopupDismiss({
    open,
    onDismiss: () => onOpenChange(false),
    hostRef,
    popupRef,
    returnFocusRef: triggerRef,
    pointerEvent: 'mousedown',
  })

  const reset = () => {
    onStatKeys(DEFAULT_STAT_KEYS.slice(0, ceiling))
    onGroupOrder(REGISTER_GROUPS)
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
        onClick={() => onOpenChange(!open)}
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
          statKeys={statKeys}
          onStatKeys={onStatKeys}
          groupOrder={groupOrder}
          onGroupOrder={onGroupOrder}
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
