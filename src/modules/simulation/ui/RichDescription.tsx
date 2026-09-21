/*
  Author: Runor Ewhro
  Description: Formats authored description text into highlighted rich content
               using the shared description parser.
*/

import { useMemo } from 'react'
import { fmtDscr } from '@/modules/simulation/model/formatDescription'

interface RichDscrPrps {
  description: string
  params?: Array<string | number>
  accentColor?: string
  className?: string
  xtrKywr?: string[]
}

export function RichDscr({
  description,
  params = [],
  accentColor,
  className,
  xtrKywr: xtrKywr = [],
}: RichDscrPrps) {
  const html = useMemo(
    () => fmtDscr(description, params, accentColor, { xtrKywr: xtrKywr }),
    [accentColor, description, xtrKywr, params],
  )

  return (
    <div className={className ?? 'rich-description'} dangerouslySetInnerHTML={{ __html: html }} />
  )
}
