/*
  Author: Runor Ewhro
  Description: Owns expandable behavior and state transitions for the ui module.
*/

import * as Collapsible from '@radix-ui/react-collapsible'
import { ChevronDown } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import type { CSSProperties as CssProps, ElementType, HTMLAttributes as HtmlAttrs, ReactNode } from 'react'

export interface ExpandableCollection<Id extends string> {
  /** IDs whose controlled disclosure is currently closed. */
  closedIds: ReadonlySet<Id>
  isOpen: (id: Id) => boolean
  setOpen: (id: Id, open: boolean) => void
  toggle: (id: Id) => void
  collapse: (id: Id) => void
  expand: (id: Id) => void
  /** Close every supplied ID without reopening closed IDs outside that set. */
  collapseAll: (ids: Iterable<Id>) => void
  /** Open every supplied ID without changing IDs outside that set. */
  expandAll: (ids: Iterable<Id>) => void
  /** Replace the complete controlled collection, used when restoring view state. */
  replaceClosed: (ids: Iterable<Id>) => void
}

/**
 * ID-based disclosure state shared by Expandable and lower-level Collapsible
 * structures. The collection owns no component registry: surfaces declare the
 * IDs a bulk command concerns and React applies the result in one state update.
 */
export function useExpandableCollection<Id extends string = string>(
  initiallyClosed?: Iterable<Id>,
): ExpandableCollection<Id> {
  const [closedIds, setClosedIds] = useState<ReadonlySet<Id>>(
    () => new Set(initiallyClosed),
  )

  const setOpen = useCallback((id: Id, open: boolean) => {
    setClosedIds((current) => {
      const closed = current.has(id)
      if (closed === !open) return current

      const next = new Set(current)
      if (open) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const toggle = useCallback((id: Id) => {
    setClosedIds((current) => {
      const next = new Set(current)
      if (!next.delete(id)) next.add(id)
      return next
    })
  }, [])

  const collapse = useCallback((id: Id) => {
    setOpen(id, false)
  }, [setOpen])

  const expand = useCallback((id: Id) => {
    setOpen(id, true)
  }, [setOpen])

  const collapseAll = useCallback((ids: Iterable<Id>) => {
    const targets = [...ids]
    setClosedIds((current) => {
      let next: Set<Id> | null = null
      for (const id of targets) {
        if (current.has(id)) continue
        next ??= new Set(current)
        next.add(id)
      }
      return next ?? current
    })
  }, [])

  const expandAll = useCallback((ids: Iterable<Id>) => {
    const targets = [...ids]
    setClosedIds((current) => {
      let next: Set<Id> | null = null
      for (const id of targets) {
        if (!current.has(id)) continue
        next ??= new Set(current)
        next.delete(id)
      }
      return next ?? current
    })
  }, [])

  const replaceClosed = useCallback((ids: Iterable<Id>) => {
    const next = new Set(ids)
    setClosedIds((current) => {
      if (current.size === next.size) {
        let equal = true
        for (const id of current) {
          if (next.has(id)) continue
          equal = false
          break
        }
        if (equal) return current
      }
      return next
    })
  }, [])

  const isOpen = useCallback((id: Id) => !closedIds.has(id), [closedIds])

  return useMemo(() => ({
    closedIds,
    isOpen,
    setOpen,
    toggle,
    collapse,
    expand,
    collapseAll,
    expandAll,
    replaceClosed,
  }), [
    closedIds,
    collapse,
    collapseAll,
    expand,
    expandAll,
    isOpen,
    replaceClosed,
    setOpen,
    toggle,
  ])
}

interface ExpandProps extends Omit<HtmlAttrs<HTMLElement>, 'children' | 'className'> {
  as?: ElementType
  children: ReactNode
  className?: string
  chevWrapClass?: string
  contentClass?: string
  innerClass?: string
  defaultOpen?: boolean
  disabled?: boolean
  header?: ReactNode | ((args: { open: boolean }) => ReactNode)
  open?: boolean
  onOpenChange?: (open: boolean) => void
  chevronClass?: string
  chevronSize?: number
  hideChevron?: boolean
  triggerClass?: string
  triggerStyle?: CssProps
  plainTrigger?: boolean
  TriggerTag?: ElementType
  noHeaderWrap?: boolean
  contentAsChild?: boolean

  contentOnly?: boolean
}

export function Expandable({
  as = 'div',
  children,
  className,
  chevWrapClass: chevWrapClass,
  contentClass: contentClass,
  innerClass: innerClassName,
  defaultOpen = false,
  disabled = false,
  header,
  open: openProp,
  onOpenChange,
  chevronClass: chevronClass,
  chevronSize = 16,
  hideChevron = false,
  triggerClass: triggerClass,
  triggerStyle: triggerStyle,
  plainTrigger: plainTrigger = false,
  TriggerTag = 'div',
  noHeaderWrap: noHeaderWrap = false,
  contentAsChild: contentAsChild = false,
  contentOnly: contentOnly = false,
  ...rootProps
}: ExpandProps) {
  const isControlled = openProp != null
  const [innerOpen, setNcntOpen] = useState(defaultOpen)
  const open = openProp ?? innerOpen
  const RootTag = as
  const TriggerElem = TriggerTag

  const changeOpen = (nextOpen: boolean) => {
    if (disabled) {
      return
    }

    if (!isControlled) {
      setNcntOpen(nextOpen)
    }
    onOpenChange?.(nextOpen)
  }

  const renderHeader = typeof header === 'function' ? header({ open }) : header
  const chevronStyle: CssProps = {
    flexShrink: 0,
    transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
    transformOrigin: '50% 50%',
    transition: 'transform 260ms cubic-bezier(0.22, 1, 0.36, 1)',
    display: hideChevron ? 'none' : 'block',
  }
  const triggerBase: CssProps = plainTrigger
    ? {}
    : {
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) auto',
        alignItems: 'start',
        width: '100%',
        gap: '0.45rem',
        padding: 0,
        border: 'none',
        background: 'transparent',
        color: 'inherit',
        textAlign: 'inherit',
        appearance: 'none',
        cursor: disabled ? 'default' : 'pointer',
      }

  const mergedStyle: CssProps = {
    ...triggerBase,
    ...triggerStyle,
  }

  return (
    <Collapsible.Root asChild open={open} onOpenChange={changeOpen} disabled={disabled}>
      <RootTag {...rootProps} className={className}>
        {!contentOnly && (
          <Collapsible.Trigger asChild>
            <TriggerElem
              className={triggerClass}
              aria-expanded={open}
              aria-disabled={disabled}
              style={mergedStyle}
            >
              {noHeaderWrap ? renderHeader : (
                <div>{renderHeader}</div>
              )}
              {!hideChevron && (
                <span aria-hidden="true" className={chevWrapClass}>
                  <ChevronDown
                    size={chevronSize}
                    className={chevronClass}
                    aria-hidden="true"
                    style={chevronStyle}
                  />
                </span>
              )}
            </TriggerElem>
          </Collapsible.Trigger>
        )}

        <Collapsible.Content
          asChild={contentAsChild}
          className={['expandable__content', contentClass].filter(Boolean).join(' ')}
        >
          {contentAsChild ? children : (
            <div className={['expandable__content-inner', innerClassName].filter(Boolean).join(' ')}>
              {children}
            </div>
          )}
        </Collapsible.Content>
      </RootTag>
    </Collapsible.Root>
  )
}
