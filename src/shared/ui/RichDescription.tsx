/*
  Author: Runor Ewhro
  Description: Formats authored description text into highlighted rich content
               using the shared description parser.
*/

import { useMemo } from 'react'
import { fmtDscr } from '@/shared/lib/formatDescription'

interface RichDscrPrps {
  description: string
  params?: Array<string | number>
  accentColor?: string
  className?: string
  xtrKywr?: string[]
  unstyled?: boolean
}

export function RichDscr({
  description,
  params = [],
  accentColor,
  className,
  xtrKywr: xtrKywr = [],
  unstyled = false,
}: RichDscrPrps) {
  const html = useMemo(
    () => fmtDscr(description, params, accentColor, { xtrKywr: xtrKywr }),
    [accentColor, description, xtrKywr, params],
  )

  return (
    <div
      className={
        unstyled
          ? className
          : ['rich-description', 'changelog-entries', 'main-echo-description', 'guides', className]
              .filter(Boolean)
              .join(' ')
      }
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
