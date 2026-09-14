/*
  Author: Runor Ewhro
  Description: Resolves a resonance-mode identity to its icon or deterministic
               text fallback.
*/

import { withDefIconM } from '@/shared/lib/imageFallback.ts'

export function ModeGlyph({ icon, label }: { icon?: string; label: string }) {
  return (
    <span className="res-mode-glyph" aria-hidden="true">
      {icon
        ? <img src={icon} alt="" onError={withDefIconM} />
        : <span>{label.trim().slice(0, 1).toUpperCase() || 'M'}</span>}
    </span>
  )
}
