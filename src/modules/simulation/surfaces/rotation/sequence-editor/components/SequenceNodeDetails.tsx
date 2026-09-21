/*
  Author: Runor Ewhro
  Description: Converts rotation nodes into editable detail rows while preserving
               node-specific drag, condition, and skill-action contracts.
*/

import * as React from "react";
import {type CSSProperties as CssProps, useCallback, useEffect, useRef} from "react";
import type {HTMLAttributes as HtmlAttrs, ReactElement} from "react";
import {GrLinkDown} from "react-icons/gr";
import type {RotationNode} from "@/domain/gameData/contracts.ts";
import type {SimResult} from "@/engine/pipeline/types.ts";
import type {
  FeatureMeta,
  NodeTotals,
} from "@/modules/simulation/surfaces/rotation/shared/authoringTypes.ts";
import type {SkillAggType} from "@/domain/entities/stats.ts";
import {
  formatNumber,
  getFeatLblCl,
  getNodeTotals,
  getSpprStyl,
  hasTotals,
  INLINE_MENU_GAP,
  INLINE_MENU_PAD,
  INLINE_MENU_WD,
} from "@/modules/simulation/surfaces/rotation/shared/nodeTools.ts";
import type { MenuEntry } from "@/shared/ui/CtxMenu.tsx";
import { ContextTrigger } from "@/application/context-menu/ContextTrigger.tsx";
import {
  AnchoredAppPopup,
  useAppPopup,
  useAppPopupDismiss,
} from '@/shared/ui/AppPopup.tsx'

export function SequenceNodeTotals({
                                 totals,
                                 ggrgType: ggrgType,
                               }: {
  totals: NodeTotals
  ggrgType?: SkillAggType
}) {
  if (!hasTotals(totals)) {
    return null
  }

  const supportStyle = getSpprStyl(ggrgType)

  if (supportStyle) {
    return (
      <div className="rotation-values">
        <div className="value-cell">
          <span className="value-label value-label--support" style={{ color: supportStyle.color }}>
            {supportStyle.label}
          </span>
          <span className="value value-support-dash" style={{ color: supportStyle.color }}>
            -
          </span>
          <span className="value avg value--support" style={{ color: supportStyle.color }}>
            {formatNumber(totals.avg)}
          </span>
        </div>
      </div>
    )
  }

  return (
    <div className="rotation-values">
      <div className="value-cell">
        <span className="value-label">Normal</span>
        <span className="value">{formatNumber(totals.normal)}</span>
      </div>
      <div className="value-cell">
        <span className="value-label">Crit</span>
        <span className="value">{formatNumber(totals.crit)}</span>
      </div>
      <div className="value-cell">
        <span className="value-label">Avg</span>
        <span className="value avg">{formatNumber(totals.avg)}</span>
      </div>
    </div>
  )
}

export function SequenceDragPreview({
                                      node,
                                      resultMap,
                                      featMetaById: ftrMetaById,
                                      compact = false,
                                    }: {
  node: Extract<RotationNode, { type: 'feature' }>
  resultMap: Map<string, SimResult['perSkill']>
  featMetaById: Record<string, FeatureMeta>
  compact?: boolean
}) {
  const meta = ftrMetaById[node.featureId]
  const totals = getNodeTotals(node, resultMap)

  return (
    <article className={`rotation-item rotation-drag-preview ui-surface-card ui-surface-card--inner ${compact ? 'compact' : ''}`}>
      <div className="rotation-header">
        <div className="rotation-entry-main">
          <span className="entry-name rotation-skill-name"
            style={{ color: getFeatLblCl(meta) }}
          >
            {meta?.label ?? node.featureId}
          </span>
          <span className="rotation-entry-sub">{meta?.skillTypeLabel ?? 'Feature'}</span>
        </div>
      </div>
      {!compact ? (
        <div className="rotation-footer">
          <SequenceNodeTotals totals={totals} ggrgType={meta?.ggrgType} />
        </div>
      ) : null}
    </article>
  )
}

export function InlineAddMenu({
                                portalTarget,
                                onAddFeature,
                                onAddRepeat,
                              }: {
  portalTarget: HTMLElement | null
  onAddFeature: () => void
  onAddRepeat: () => void
}) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const visibility = useAppPopup()
  const statementHeight = 28 + 2 * 34
  const setRootNode = useCallback((node: HTMLDivElement | null) => {
    rootRef.current = node
  }, [])

  const closeMenu = useCallback(() => {
    visibility.hide()
  }, [visibility])

  useEffect(() => {
    if (!visibility.visible) {
      return
    }

    menuRef.current?.focus()
  }, [visibility.visible])

  useAppPopupDismiss({
    open: visibility.open,
    onDismiss: closeMenu,
    hostRef: rootRef,
    popupRef: menuRef,
    returnFocusRef: triggerRef,
  })

  const handleSelect = useCallback((action: () => void) => {
    closeMenu()
    action()
  }, [closeMenu])

  const nlnAddPtns: Array<{
    label: string
    hint: string
    enabled: boolean
    onSelect: () => void
  }> = [
    { label: 'Feature', hint: 'Skill step', enabled: true, onSelect: onAddFeature },
    { label: 'Repeat', hint: 'Repeat a sequence', enabled: true, onSelect: onAddRepeat },
  ]
  const menu = (
        <AnchoredAppPopup
          visible={visibility.visible}
          anchorRef={triggerRef}
          popupRef={menuRef}
          portalTarget={portalTarget}
          minWidth={INLINE_MENU_WD}
          minHeight={statementHeight}
          maxHeight={statementHeight}
          viewportPadding={INLINE_MENU_PAD}
          offset={INLINE_MENU_GAP}
          flipBelowHeight={statementHeight}
          align="end" className="floating-context-menu rotation-inline-add-popover"
          open={visibility.open}
          closing={visibility.closing}
          data-col="true"
          data-kind="text"
          data-placed="true"
          tabIndex={-1}
          role="menu"
          onClick={(event) => {
            event.stopPropagation()
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape' || event.key === 'Tab') {
              closeMenu()
            }
          }}
        >
          <div className="floating-context-menu__cells">
            {nlnAddPtns.map((option, index) => (
              <button
                key={option.label}
                type="button" className="floating-context-menu__item rotation-inline-add-option"
                role="menuitem"
                disabled={!option.enabled}
                style={{ '--well-index': index } as CssProps}
                onClick={() => handleSelect(option.onSelect)}
              >
                <span className="floating-context-menu__label">{option.label}</span>
                <span className="floating-context-menu__hint">{option.hint}</span>
              </button>
            ))}
          </div>

          <div className="floating-context-menu__read" data-idle="true" aria-hidden="true">
            <b>Add step</b>
            <em>{nlnAddPtns.length}</em>
          </div>
        </AnchoredAppPopup>
  )

  return (
    <div
      ref={setRootNode} className="rotation-inline-add-menu"
    >
      <button
        ref={triggerRef}
        type="button"
        className={`block-icon-button${visibility.open ? ' active' : ''}`}
        title="Add below"
        aria-label="Add below this rotation item"
        aria-haspopup="menu"
        aria-expanded={visibility.visible}
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          if (visibility.visible) {
            closeMenu()
          } else {
            visibility.show()
          }
        }}
      >
        <GrLinkDown size=".6em" />
      </button>
      {menu}
    </div>
  )
}


export function SequenceNodeDetails({
                            children,
                            depth,
                            disabled,
                            selected = false,
                            selMode: selectMode = false,
                            draggable = false,
                            onDragStart,
                            onDragEnd,
                            onDragOver,
                            onDragLeave,
                            onDrop,
                            ctxMenuTms: ctxMenuTms,
                            ctxMenuArigs: ctxMenuAriaL,
                            onClick,
                            isDragOver = false,
                            isDragging = false,
                            focusItem = false,
                          }: {
  children: React.ReactNode
  depth: number
  disabled?: boolean
  selected?: boolean
  selMode?: boolean
  draggable?: boolean
  onDragStart?: (event: React.DragEvent<HTMLDivElement>) => void
  onDragEnd?: () => void
  onDragOver?: (event: React.DragEvent<HTMLDivElement>) => void
  onDragLeave?: () => void
  onDrop?: (event: React.DragEvent<HTMLDivElement>) => void
  ctxMenuTms?: MenuEntry[]
  ctxMenuArigs?: string
  onClick?: (event: React.MouseEvent<HTMLDivElement>) => void
  isDragOver?: boolean
  isDragging?: boolean
  focusItem?: boolean
}) {
  const style = {
    '--rotation-depth': depth,
  } as CssProps

  const slctChld = React.isValidElement<HtmlAttrs<HTMLElement>>(children)
    ? React.cloneElement(children as ReactElement<HtmlAttrs<HTMLElement>>, {
      // selection state belongs on the actual row child so aria state follows
      // the selectable item instead of only the wrapper.
      className: [
        children.props.className,
        focusItem && selected ? 'focus-selected' : '',
        focusItem && selectMode ? 'selection-mode' : '',
      ].filter(Boolean).join(' '),
      'data-selection-focus-item': focusItem ? 'true' : undefined,
      'aria-selected': focusItem ? (selected ? 'true' : 'false') : undefined,
    } as HtmlAttrs<HTMLElement> & {
      'data-selection-focus-item'?: string
      'aria-selected'?: string
    })
    : children

  const content = (
    <div
      className={`rotation-item-wrapper ${disabled ? 'disabled' : ''} ${selectMode ? 'selection-mode' : ''} ${isDragOver ? 'drag-over' : ''} ${isDragging ? 'dragging' : ''}`}
      style={style}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onClick={onClick}
    >
      {slctChld}
    </div>
  )

  if (!ctxMenuTms || !ctxMenuAriaL) {
    return content
  }

  return (
    <ContextTrigger
      asChild
      ariaLabel={ctxMenuAriaL}
      items={ctxMenuTms}
    >
      {content}
    </ContextTrigger>
  )
}
