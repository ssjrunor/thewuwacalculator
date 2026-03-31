/*
  Author: Runor Ewhro
  Description: shared guide-page helpers for transforming stored guide html
               into the highlighted content style used by the app.
*/

// replace strong tags with the guide-page highlight span styling
export function processGuideHtml(html: string): string {
  return html.replace(/<strong>(.*?)<\/strong>/g, '<span class="highlight">$1</span>')
}
