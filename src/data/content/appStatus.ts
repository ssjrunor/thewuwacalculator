/*
  Author: Runor Ewhro
  Description: The app's own condition, authored in one place. The system
               report modal reads it, the head's stamp reads it, and the home
               page opens with it, so the three can never disagree about what
               patch the app is on or how much of the game it holds.
*/

import { CURRENT_VERSION } from '@/shared/lib/appMetadata'

export type AppState = 'stable' | 'degraded' | 'wip'
export type CoverageKey = 'resonators' | 'weapons' | 'echoes' | 'enemies'

export interface CoverageDomain {
  key: CoverageKey
  title: string
  status: 'ok' | 'down'
  // only for saying what is missing when a domain is not ok
  note: string
}

export const STATUS_DATA = {
  lastUpdated: '18/08/2026',

  // is the scrim angle, which has to flip for art that is dark on the left.
  wallpaper: {
    src: '/assets/app/pheobeW.webp',
    pos: '62% 42%',
    // the direction the art fades in from; flip it for art that is busy on the left
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
    'OR... you could just fuck off and make something better yourself~! (˶>⩊<˶)'
  ],
  // the count comes from the catalog itself, so it cannot drift from the truth.
  // `note` is only for saying what is missing when a domain is not ok.
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

/*
  What the head's stamp reads. It is the front of the report's own stamp, being
  the state tag the header wears and the first of the `PATCH · COVERAGE ·
  ISSUES · VIA` probes below, so the line and the report can never disagree
  about the app's condition.
*/
export const APP_CONDITION = {
  ok: STATUS_DATA.overallState === 'stable',
  label: STATE_LABELS[STATUS_DATA.overallState],
  patch: STATUS_DATA.patchVersion,
} as const
