import * as Collapsible from '@radix-ui/react-collapsible'
import { ChevronDown } from 'lucide-react'
import { useState } from 'react'
import type { CSSProperties, ElementType, ReactNode } from 'react'

interface ExpandableProps {
  as?: ElementType
  children: ReactNode
  className?: string
  chevronContainerClassName?: string
  contentClassName?: string
  contentInnerClassName?: string
  defaultOpen?: boolean
  disabled?: boolean
  header: ReactNode | ((args: { open: boolean }) => ReactNode)
  open?: boolean
  onOpenChange?: (open: boolean) => void
  chevronClassName?: string
  chevronSize?: number
  hideChevron?: boolean
  triggerClassName?: string
  triggerStyle?: CSSProperties
  ignoreDefaultTriggerStyle?: boolean
  TriggerTag?: ElementType
  noHeaderWrapper?: boolean
  contentAsChild?: boolean
}

export function Expandable({
  as = 'div',
  children,
  className,
  chevronContainerClassName,
  contentClassName,
  contentInnerClassName,
  defaultOpen = false,
  disabled = false,
  header,
  open: openProp,
  onOpenChange,
  chevronClassName,
  chevronSize = 16,
  hideChevron = false,
  triggerClassName,
  triggerStyle: triggerStyleProp,
  ignoreDefaultTriggerStyle = false,
  TriggerTag = 'div',
  noHeaderWrapper = false,
  contentAsChild = false,
}: ExpandableProps) {
  const isControlled = openProp != null
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen)
  const open = openProp ?? uncontrolledOpen
  const RootTag = as
  const TTag = TriggerTag

  const handleOpenChange = (nextOpen: boolean) => {
    if (disabled) {
      return
    }

    if (!isControlled) {
      setUncontrolledOpen(nextOpen)
    }
    onOpenChange?.(nextOpen)
  }

  const renderedHeader = typeof header === 'function' ? header({ open }) : header
  const chevronStyle: CSSProperties = {
    flexShrink: 0,
    transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
    transformOrigin: '50% 50%',
    transition: 'transform 260ms cubic-bezier(0.22, 1, 0.36, 1)',
    display: hideChevron ? 'none' : 'block',
  }
  const defaultTriggerStyle: CSSProperties = ignoreDefaultTriggerStyle
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

  const mergedTriggerStyle: CSSProperties = {
    ...defaultTriggerStyle,
    ...triggerStyleProp,
  }

  return (
    <Collapsible.Root asChild open={open} onOpenChange={handleOpenChange} disabled={disabled}>
      <RootTag className={className}>
        <Collapsible.Trigger asChild>
          <TTag
            className={triggerClassName}
            aria-expanded={open}
            aria-disabled={disabled}
            style={mergedTriggerStyle}
          >
            {noHeaderWrapper ? renderedHeader : (
              <div>{renderedHeader}</div>
            )}
            {!hideChevron && (
              <span aria-hidden="true" className={chevronContainerClassName}>
                <ChevronDown
                  size={chevronSize}
                  className={chevronClassName}
                  aria-hidden="true"
                  style={chevronStyle}
                />
              </span>
            )}
          </TTag>
        </Collapsible.Trigger>

        <Collapsible.Content
          asChild={contentAsChild}
          className={contentAsChild ? undefined : ['expandable__content', contentClassName].filter(Boolean).join(' ')}
        >
          {contentAsChild ? children : (
            <div className={['expandable__content-inner', contentInnerClassName].filter(Boolean).join(' ')}>
              {children}
            </div>
          )}
        </Collapsible.Content>
      </RootTag>
    </Collapsible.Root>
  )
}
