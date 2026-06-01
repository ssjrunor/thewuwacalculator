/*
  Author: Runor Ewhro
  Description: Renders the node deets surface for the calculator rotation flow.
*/

import * as React from "react";
import {type CSSProperties as CssProps, useCallback, useEffect, useRef, useState} from "react";
import type {HTMLAttributes as HtmlAttrs, ReactElement} from "react";
import {useAnimVis} from "@/app/hooks/useAnimatedVisibility.ts";
import {bodyPortal} from "@/shared/lib/portalTarget.ts";
import {createPortal} from "react-dom";
import {GrLinkDown} from "react-icons/gr";
import type {ResRuntime} from "@/domain/entities/runtime.ts";
import type {RotationNode} from "@/domain/gameData/contracts.ts";
import type {SimResult} from "@/engine/pipeline/types.ts";
import type {
  CondChoice,
  FeatureMeta,
  NodeTotals,
} from "@/modules/calculator/features/rotation/lib/types.ts";
import {
  fmtCondChng,
  getCondChoice
} from "@/modules/calculator/features/rotation/lib/conditions.tsx";
import type {SkillAggType} from "@/domain/entities/stats.ts";
import {
  formatNumber,
  getFeatLblCl,
  getNodeMemIc,
  getNodeTotals,
  getSpprStyl,
  hasTotals,
  INLINE_MENU_GAP,
  INLINE_MENU_PAD,
  INLINE_MENU_WD,
} from "@/modules/calculator/features/rotation/lib/utils.ts";
import type { MenuEntry } from "@/shared/ui/CtxMenu.tsx";
import { ContextTrigger } from "@/shared/ui/CtxTrigger.tsx";
import {withDefResMg} from "@/shared/lib/imageFallback.ts";

export function RotVls({
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

export function RotDragPrvw({
                                      runtime,
                                      node,
                                      resultMap,
                                      featMetaById: ftrMetaById,
                                      condChoices: condChoices,
                                      compact = false,
                                    }: {
  runtime: ResRuntime
  node: Extract<RotationNode, { type: 'feature' | 'condition' }>
  resultMap: Map<string, SimResult['perSkill']>
  featMetaById: Record<string, FeatureMeta>
  condChoices: CondChoice[]
  compact?: boolean
}) {
  const memberIcon = getNodeMemIc(node, runtime, ftrMetaById, condChoices)

  if (node.type === 'feature') {
    const meta = ftrMetaById[node.featureId]
    const totals = getNodeTotals(node, resultMap)
    const ttchChng = node.changes ?? []

    return (
      <article className={`rotation-item rotation-drag-preview ui-surface-card ui-surface-card--inner ${compact ? 'compact' : ''}`}>
        <div className="rotation-header">
          <div className="rotation-entry-main">
            <span
              className="entry-name rotation-skill-name"
              style={{ color: getFeatLblCl(meta) }}
            >
              {meta?.label ?? node.featureId}
            </span>
            <span className="rotation-entry-sub">{meta?.skillTypeLabel ?? 'Feature'}</span>
          </div>
          {memberIcon ? (
            <span className="rotation-node-member-icon" title={memberIcon.name}>
              <img src={memberIcon.profile} alt="" onError={withDefResMg} />
            </span>
          ) : null}
        </div>
        {ttchChng.length > 0 ? (
          <div className="rotation-condition-list">
            {ttchChng.map((change, changeIndex) => (
              <span key={`${change.path}:${changeIndex}`} className="rotation-condition-chip">
                {fmtCondChng(change, getCondChoice(condChoices, change, node.resonatorId))}
              </span>
            ))}
          </div>
        ) : null}
        {!compact ? (
          <div className="rotation-footer">
            <RotVls totals={totals} ggrgType={meta?.ggrgType} />
          </div>
        ) : null}
      </article>
    )
  }

  const displayChange = node.changes[0]
  const condChc = getCondChoice(condChoices, displayChange, node.resonatorId)

  return (
    <article className={`rotation-item rotation-condition rotation-drag-preview ui-surface-card ui-surface-card--inner ${compact ? 'compact' : ''}`}>
      <div className="rotation-header">
        <div className="rotation-entry-main">
          <span className="entry-name">{node.label ?? condChc?.label ?? 'Condition'}</span>
        </div>
        {memberIcon ? (
          <span className="rotation-node-member-icon" title={memberIcon.name}>
            <img src={memberIcon.profile} alt="" onError={withDefResMg} />
          </span>
        ) : null}
      </div>
      {displayChange ? (
        <div className="rotation-condition-list">
          <span className="rotation-condition-chip">{fmtCondChng(displayChange, condChc)}</span>
        </div>
      ) : null}
    </article>
  )
}

export function NlnAddMenu({
                                portalTarget,
                                allowFeature = true,
                                llwCond: llwCndt = true,
                                allowBlock = true,
                                allowLoop = true,
                                onAddFeature,
                                onAddCond: onAddCndt,
                                onAddBlock,
                                onAddLoop,
                              }: {
  portalTarget: HTMLElement | null
  allowFeature?: boolean
  llwCond?: boolean
  allowBlock?: boolean
  allowLoop?: boolean
  onAddFeature: () => void
  onAddCond: () => void
  onAddBlock: () => void
  onAddLoop: () => void
}) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const frameRef = useRef<number | null>(null)
  const visibility = useAnimVis(620)
  const [placement, setPlacement] = useState<'up' | 'down'>('down')
  const [menuLayout, setMenuLyt] = useState<CssProps>({
    left: `${INLINE_MENU_PAD}px`,
    top: `${INLINE_MENU_PAD}px`,
    width: `${INLINE_MENU_WD}px`,
  })
  const vsblPtnCnt = [allowFeature, llwCndt, allowBlock, allowLoop].filter(Boolean).length
  const rslvPrtlTgt = portalTarget ?? bodyPortal()

  const closeMenu = useCallback(() => {
    visibility.hide()
  }, [visibility])

  const clearMeasure = useCallback(() => {
    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current)
      frameRef.current = null
    }
  }, [])

  const measureMenu = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) {
      return
    }

    // inline add menus are anchored to the trigger button, so measurement
    // chooses the side that keeps action rows inside the viewport.
    const stmtHght = 18 + vsblPtnCnt * 42
    const spaceBelow = window.innerHeight - rect.bottom - INLINE_MENU_PAD
    const spaceAbove = rect.top - INLINE_MENU_PAD
    const openUpward = spaceBelow < stmtHght && spaceAbove > spaceBelow
    const width = Math.min(
      INLINE_MENU_WD,
      window.innerWidth - INLINE_MENU_PAD * 2,
    )
    const left = Math.min(
      Math.max(INLINE_MENU_PAD, rect.right - width),
      Math.max(
        INLINE_MENU_PAD,
        window.innerWidth - INLINE_MENU_PAD - width,
      ),
    )

    setPlacement(openUpward ? 'up' : 'down')
    setMenuLyt({
      left: `${left}px`,
      width: `${width}px`,
      top: openUpward ? undefined : `${rect.bottom + INLINE_MENU_GAP}px`,
      bottom: openUpward ? `${window.innerHeight - rect.top + INLINE_MENU_GAP}px` : undefined,
    })
  }, [vsblPtnCnt])

  const schdMsrMenu = useCallback(() => {
    clearMeasure()
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null
      measureMenu()
    })
  }, [clearMeasure, measureMenu])

  useEffect(() => {
    if (!visibility.visible) {
      return
    }

    schdMsrMenu()
    menuRef.current?.focus()

    // outside pointer handling is scoped to this menu island so row-level drag
    // and selection events remain owned by the rotation tree.
    const onPntrDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return
      }

      closeMenu()
    }

    const onWndwChng = () => {
      schdMsrMenu()
    }

    document.addEventListener('pointerdown', onPntrDown)
    window.addEventListener('scroll', onWndwChng, true)
    window.addEventListener('resize', onWndwChng)

    return () => {
      clearMeasure()
      document.removeEventListener('pointerdown', onPntrDown)
      window.removeEventListener('scroll', onWndwChng, true)
      window.removeEventListener('resize', onWndwChng)
    }
  }, [clearMeasure, closeMenu, schdMsrMenu, visibility.visible])

  useEffect(() => clearMeasure, [clearMeasure])

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
    { label: 'Feature', hint: 'Skill step', enabled: allowFeature, onSelect: onAddFeature },
    { label: 'Condition', hint: 'State change', enabled: llwCndt, onSelect: onAddCndt },
    { label: 'Block', hint: 'Repeat or uptime', enabled: allowBlock, onSelect: onAddBlock },
    { label: 'Loop', hint: 'Start/end marker', enabled: allowLoop, onSelect: onAddLoop },
  ]
  const totalItems = nlnAddPtns.length

  const menu =
    visibility.visible && rslvPrtlTgt
      ? createPortal(
        <div
          ref={menuRef}
          className="floating-context-menu rotation-inline-add-popover"
          data-placement={placement}
          data-side="right"
          data-open={visibility.open ? 'true' : undefined}
          data-closing={visibility.closing ? 'true' : undefined}
          style={menuLayout}
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
          <div className="floating-context-menu__group" role="presentation">
            {nlnAddPtns.map((option, index) => (
              <button
                key={option.label}
                type="button"
                className="floating-context-menu__item rotation-inline-add-option"
                role="menuitem"
                data-side="right"
                disabled={!option.enabled}
                style={{
                  '--bubble-index': index,
                  '--bubble-rev-index': totalItems - index - 1,
                } as CssProps}
                onClick={() => handleSelect(option.onSelect)}
              >
                <span className="floating-context-menu__item-surface" aria-hidden="true" />
                <span className="floating-context-menu__item-bracket floating-context-menu__item-bracket--tl" aria-hidden="true" />
                <span className="floating-context-menu__item-bracket floating-context-menu__item-bracket--br" aria-hidden="true" />
                <span className="floating-context-menu__label">{option.label}</span>
                <span className="floating-context-menu__hint">{option.hint}</span>
              </button>
            ))}
          </div>
        </div>,
        rslvPrtlTgt,
      )
      : null

  return (
    <div ref={rootRef} className="rotation-inline-add-menu">
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
            schdMsrMenu()
            visibility.show()
          }
        }}
      >
        <GrLinkDown size={15} />
      </button>
      {menu}
    </div>
  )
}


export function NodeDeets({
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
