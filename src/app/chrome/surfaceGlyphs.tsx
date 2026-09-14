/*
  Author: Runor Ewhro
  Description: The mark each page of the work wears where it is read by glyph
               rather than by word. Every one is the shape of what its page
               reads rather than a picture of a tool: a build being modulated,
               a run of hits on a clock, a build presented, and every build
               ranked. Their order follows the Simulation index.
*/

import type { ReactNode } from 'react'
import type { SimulationPageId } from '@/app/chrome/appIndex'

const PATHS: Record<SimulationPageId, ReactNode> = {
  // one sequence: hits standing on a clock
  rotation: (
    <>
      <path d="M3.5 12h17" />
      <circle cx="6.2" cy="12" r="2.1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="2.1" fill="currentColor" stroke="none" />
      <circle cx="17.8" cy="12" r="2.1" fill="currentColor" stroke="none" />
    </>
  ),
  // one build, climbing: where it stands against where it can still get to
  modulation: <path d="M3.5 17.8 9 12.3l3.4 2.4 8.1-8.5M14.6 6.2h6.1v6.1" />,
  // one build, presented: the card it is put on
  showcase: (
    <>
      <rect x="4.4" y="3.4" width="15.2" height="17.2" rx="2.2" />
      <circle cx="12" cy="10.1" r="2.3" />
      <path d="M7.3 18c1.3-2.3 2.8-3.4 4.7-3.4s3.4 1.1 4.7 3.4" />
    </>
  ),
  // every build: the search, ranked
  optimizer: <path d="M4 6.5h16M4 12h11M4 17.5h6.5" />,
  // one change: what the build could reach from where it stands
  suggestions: (
    <>
      <path d="M3.4 18.6c4.6 0 6.2-3.2 8.2-6.4s3.6-5 8.6-5" />
      <circle cx="3.4" cy="18.6" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="20.2" cy="7.2" r="1.5" />
    </>
  ),
}

export function SurfaceGlyph({ id }: { id: SimulationPageId }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[id]}
    </svg>
  )
}
