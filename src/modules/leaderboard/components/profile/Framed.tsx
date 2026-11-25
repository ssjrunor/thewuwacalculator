/*
  Author: Runor Ewhro
  description: an uploaded profile image in a frame of any shape. the frame
               clips, and the image covers it, pinned at the profile's chosen
               point and zoomed around it. a frame class may set its own default
               point (--fx, --fy) for an unframed image.
*/

import type { CSSProperties } from 'react'
import type { ImageFrame } from '@/domain/leaderboard/documents'

export const frameVars = (frame: ImageFrame | null | undefined): CSSProperties | undefined =>
  frame ? { '--fx': `${frame.x}%`, '--fy': `${frame.y}%`, '--fz': frame.zoom } as CSSProperties : undefined

export function Framed({ src, frame, className }: { src: string; frame?: ImageFrame | null; className: string }) {
  return <span className={`frm ${className}`} style={frameVars(frame)}><img src={src} alt="" draggable={false} /></span>
}
