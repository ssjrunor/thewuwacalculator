/*
  Author: Runor Ewhro
  Description: Defines persisted UI preferences for showcase customization,
               editor behavior, motion, exports, and local image storage.
*/

export type StatsColumnHighlight = 'build' | 'combat' | 'both'

/** Showcase-only layout selection; Build Lab always uses the classic layout. */
export type ShowcaseLayout = 'classic' | 'seal'

/** Semantic text roles shared across showcase regions. */
export type TextSlot = 'numbers' | 'names' | 'labels' | 'muted' | 'display'

export interface TextSlotStyle {
  color: string | null
  font: string | null
  size: number | null
  weight: number | null
  spacing: number | null
  transform: 'none' | 'uppercase' | 'lowercase' | 'capitalize' | null
}

export const TEXT_SLOTS: TextSlot[] = ['numbers', 'names', 'labels', 'muted', 'display']

/** Per-resonator showcase overrides; null fields inherit resonator defaults. */
export interface ShowcaseCardStyle {
  accent: string | null
  surface: string | null
  text: string | null
  opacity: number | null
  displayFont: string | null
  monoFont: string | null
  portraitX: number | null
  portraitY: number | null
  portraitScale: number | null
  maskTop: number | null
  maskRight: number | null
  maskBottom: number | null
  maskLeft: number | null
  maskTopSharp: number | null
  maskRightSharp: number | null
  maskBottomSharp: number | null
  maskLeftSharp: number | null
  backdropBlur: number | null
  backdropOpacity: number | null
  backdropX: number | null
  backdropY: number | null
  backdropScale: number | null
  portraitImage: string | null
  backdropImage: string | null
  portraitCredit: string | null
  backdropCredit: string | null
  statsColumn: StatsColumnHighlight | null
  /** Absent text roles retain their defaults. */
  textSlots: Partial<Record<TextSlot, TextSlotStyle>>
  /** Raw CSS scoped to this card. */
  customCss: string | null
}

export interface ShowcaseCardHidden {
  score: boolean
  damage: boolean
  cv: boolean
  team: boolean
  brand: boolean
  portraitCredit: boolean
  backdropCredit: boolean
  seqRail: boolean
  subVal: boolean
  subColor: boolean
  relStats: boolean
}

export interface ShowcaseCardConfig {
  style: ShowcaseCardStyle
  hidden: ShowcaseCardHidden
}

export const DEF_SHOWCASE_CARD_STYLE: ShowcaseCardStyle = {
  accent: null,
  surface: null,
  text: null,
  opacity: null,
  displayFont: null,
  monoFont: null,
  portraitX: null,
  portraitY: null,
  portraitScale: null,
  maskTop: null,
  maskRight: null,
  maskBottom: null,
  maskLeft: null,
  maskTopSharp: null,
  maskRightSharp: null,
  maskBottomSharp: null,
  maskLeftSharp: null,
  backdropBlur: null,
  backdropOpacity: null,
  backdropX: null,
  backdropY: null,
  backdropScale: null,
  portraitImage: null,
  backdropImage: null,
  portraitCredit: null,
  backdropCredit: null,
  statsColumn: null,
  textSlots: {},
  customCss: null,
}

export const DEF_SHOWCASE_HIDE: ShowcaseCardHidden = {
  score: false,
  damage: false,
  cv: false,
  team: false,
  brand: false,
  portraitCredit: false,
  backdropCredit: false,
  seqRail: false,
  subVal: false,
  subColor: false,
  relStats: true,
}

export interface UiPrefs {
  ctxMenu: boolean
  updateToast: boolean
  gameBetaData: boolean
  recommendedMenuItems: boolean
  showEvaluationStates: boolean
  maxResOnInit: boolean
  animatedRailPortraits: boolean
  showcaseCards: Record<string, ShowcaseCardConfig>
  showcaseLayout: ShowcaseLayout
  uploadPersist: UploadPersistMode | null
  imgbbApiKey: string
  playerId: string
  playerUid: string
}

export type UploadPersistMode = 'indexeddb' | 'imgbb'

export const DEF_UI_PREFS: UiPrefs = {
  ctxMenu: true,
  updateToast: true,
  gameBetaData: true,
  recommendedMenuItems: false,
  showEvaluationStates: false,
  maxResOnInit: true,
  animatedRailPortraits: true,
  showcaseCards: {},
  showcaseLayout: 'classic',
  uploadPersist: null,
  imgbbApiKey: '',
  playerId: '',
  playerUid: '',
}
