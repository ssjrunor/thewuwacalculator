/*
  Author: Runor Ewhro
  Description: Minimal wrapper for trusted html snippets that need to render in
               a configurable block or inline tag.
*/

interface HtmlCntnPrps {
  html: string
  className?: string
  as?: 'div' | 'span' | 'p' | 'li'
}

export function HtmlContent({ html, className, as: Tag = 'div' }: HtmlCntnPrps) {
  return <Tag className={className} dangerouslySetInnerHTML={{ __html: html }} />
}
