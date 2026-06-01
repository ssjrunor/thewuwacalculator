/*
  Author: Runor Ewhro
  Description: Shared collapsible primitive with a styled header row and
               optional controlled-open state.
*/

import * as Collapsible from '@radix-ui/react-collapsible'
import { ChevronDown } from 'lucide-react'
import { useState } from 'react'
import type { CSSProperties as CssProps, ElementType, HTMLAttributes as HtmlAttrs, ReactNode } from 'react'

interface ExpandProps extends Omit<HtmlAttrs<HTMLElement>, 'children' | 'className'> {
  as?: ElementType
  children: ReactNode
  className?: string
  chevWrapClass?: string
  contentClass?: string
  innerClass?: string
  defaultOpen?: boolean
  disabled?: boolean
  header: ReactNode | ((args: { open: boolean }) => ReactNode)
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

        <Collapsible.Content
          asChild={contentAsChild}
          className={contentAsChild ? undefined : ['expandable__content', contentClass].filter(Boolean).join(' ')}
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
