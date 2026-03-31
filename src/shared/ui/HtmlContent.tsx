interface HtmlContentProps {
  html: string
  className?: string
  as?: 'div' | 'span' | 'p' | 'li'
}

export function HtmlContent({ html, className, as: Tag = 'div' }: HtmlContentProps) {
  return <Tag className={className} dangerouslySetInnerHTML={{ __html: html }} />
}
