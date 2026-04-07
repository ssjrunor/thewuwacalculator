import { useMemo } from 'react'
import { formatDescription } from '@/shared/lib/formatDescription'

interface RichDescriptionProps {
  description: string
  params?: Array<string | number>
  accentColor?: string
  className?: string
  extraKeywords?: string[]
  unstyled?: boolean
}

export function RichDescription({
  description,
  params = [],
  accentColor,
  className,
  extraKeywords = [],
  unstyled = false,
}: RichDescriptionProps) {
  const html = useMemo(
    () => formatDescription(description, params, accentColor, { extraKeywords }),
    [accentColor, description, extraKeywords, params],
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
