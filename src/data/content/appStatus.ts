/*
  Author: Runor Ewhro
  description: defines canonical application status, coverage, source, and
               wallpaper metadata consumed by chrome and reporting surfaces.
*/

import { CURRENT_VERSION } from '@/shared/lib/appMetadata'

export type AppState = 'stable' | 'degraded' | 'wip'
export type CoverageKey = 'resonators' | 'weapons' | 'echoes' | 'enemies'

export interface CoverageDomain {
  key: CoverageKey
  title: string
  status: 'ok' | 'down'
  /** explanation shown only when this domain is unavailable. */
  note: string
}

export const STATUS_DATA = {
  lastUpdated: '23/10/2026',

  wallpaper: {
    src: '/assets/app/phoebeW.webp',
    pos: '62% 42%',
    dir: '100deg',
  } as { src: string; pos: string; dir: string } | null,
  overallState: 'stable' as AppState,
  patchVersion: CURRENT_VERSION,
  dataSources: [
    { label: 'encore.moe', href: 'https://encore.moe/new?lang=en' },
    { label: 'nanoka.cc', href: 'https://ww.nanoka.cc/' },
  ],
  notes: [
    'hello my pookie wookiesss~! (∩˃o˂∩)♡',
    'you can import compatible Mornye Tools exports. (click the import button to see more about it).',
    'made some minor fixes here and there... nothing too crazy yk?'
  ],
  // consumers join these status records with live catalog counts by key.
  coverage: [
    { key: 'resonators', title: 'Resonators', status: 'ok', note: '' },
    { key: 'weapons',    title: 'Weapons',    status: 'ok', note: '' },
    { key: 'echoes',     title: 'Echoes',     status: 'ok', note: '' },
    { key: 'enemies',    title: 'Enemies',    status: 'ok', note: '' },
  ] as CoverageDomain[],
  recentChanges: [
    'added mornye tools game data import.',
  ],

  knownIssues: [] as string[]
}

export const STATE_LABELS = {
  stable:   'NOMINAL',
  degraded: 'DEGRADED',
  wip:      'IN PROGRESS',
} as const

// derive the compact chrome status from the same canonical report state.
export const APP_CONDITION = {
  ok: STATUS_DATA.overallState === 'stable',
  label: STATE_LABELS[STATUS_DATA.overallState],
  patch: STATUS_DATA.patchVersion,
} as const
