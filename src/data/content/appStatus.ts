/*
  Author: Runor Ewhro
  Description: Defines canonical application status, coverage, source, and
               wallpaper metadata consumed by chrome and reporting surfaces.
*/

import { CURRENT_VERSION } from '@/shared/lib/appMetadata'

export type AppState = 'stable' | 'degraded' | 'wip'
export type CoverageKey = 'resonators' | 'weapons' | 'echoes' | 'enemies'

export interface CoverageDomain {
  key: CoverageKey
  title: string
  status: 'ok' | 'down'
  /** Explanation shown only when this domain is unavailable. */
  note: string
}

export const STATUS_DATA = {
  lastUpdated: '18/08/2026',

  wallpaper: {
    src: '/assets/app/phoebeW.webp',
    pos: '62% 42%',
    dir: '100deg',
  } as { src: string; pos: string; dir: string } | null,
  overallState: 'stable' as AppState,
  patchVersion: CURRENT_VERSION,
  dataSources: [
    { label: 'Encore', href: 'https://encore.moe/new?lang=en' },
    { label: 'Nanoka', href: 'https://ww.nanoka.cc/' },
  ],
  notes: [
    'hello my lovelies~! ٩(ˊᗜˋ*)و ♡',
    'Where you\'re reading this from looks different doesn\'t it? so does a lot of other stuff~! As you may have noticed the whole interface looks way WAY different now..',
    'A series of visual changes that would affect your experience (positively yes?) while using this have been made while some not so visual changes have been made as well to have stuff run' +
    ' more smoothly.',
    'IMPORTANT: As a lot has been changed, if you feel like there\'s something missing or something you don\t quite like, please POLITELY let me know in the discord server. It\'s not like i don\'t' +
    ' listen and/or act on your feedback. I\'m very active i promise.',
  ],
  // Consumers join these status records with live catalog counts by key.
  coverage: [
    { key: 'resonators', title: 'Resonators', status: 'ok', note: '' },
    { key: 'weapons',    title: 'Weapons',    status: 'ok', note: '' },
    { key: 'echoes',     title: 'Echoes',     status: 'ok', note: '' },
    { key: 'enemies',    title: 'Enemies',    status: 'ok', note: '' },
  ] as CoverageDomain[],
  recentChanges: [
    '3.6 patch stuff.',
  ],

  knownIssues: [] as string[]
}

export const STATE_LABELS = {
  stable:   'NOMINAL',
  degraded: 'DEGRADED',
  wip:      'IN PROGRESS',
} as const

// Derive the compact chrome status from the same canonical report state.
export const APP_CONDITION = {
  ok: STATUS_DATA.overallState === 'stable',
  label: STATE_LABELS[STATUS_DATA.overallState],
  patch: STATUS_DATA.patchVersion,
} as const
