/*
  Author: Runor Ewhro
  Description: Defines persisted ui preference switches that sit under the
               shared ui preferences object.
*/

export type BenchmarkViewMode = 'benchmark' | 'showcase'

// Which value column(s) the showcase stat ladder emphasizes. 'build' is the default.
export type StatsColumnHighlight = 'build' | 'combat' | 'both'

// Per-text-type typography overrides for the showcase card. Each slot is a
// typographic ROLE that cuts across the whole card: numeric readouts, proper
// names, small-caps labels, dim meta text, and the oversized grade letter, not a
// card region. Every field is nullable; null means "keep the role's built-in
// styling".
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

// Per-resonator showcase-card customization. Every field is nullable; null means
// "use the resonator default", so an untouched card carries no overrides. Image
// fields hold a URL (imgur link, or a data URL on localhost where imgur is blocked).
export interface BenchmarkCardStyle {
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
  // Artist handles credited for each image. Null when unattributed.
  portraitCredit: string | null
  backdropCredit: string | null
  statsColumn: StatsColumnHighlight | null
  // Per-text-type typography overrides, keyed by slot. Absent slots use defaults.
  textSlots: Partial<Record<TextSlot, TextSlotStyle>>
  // Raw CSS scoped to this card (advanced / future upload). Null when unused.
  customCss: string | null
}

export interface BenchmarkCardHidden {
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

export interface BenchmarkCardConfig {
  style: BenchmarkCardStyle
  hidden: BenchmarkCardHidden
}

export interface BenchRptSettings {
  rotationFeatures: boolean
  activeStateSources: boolean
  upgradePaths: boolean
  buildDetails: boolean
  echoStatsTable: boolean
  benchmarkTargets: boolean
}

export const DEF_BENCH_CARD_STYLE: BenchmarkCardStyle = {
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

export const DEF_BENCH_HIDE: BenchmarkCardHidden = {
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

export const DEF_BENCH_RPT: BenchRptSettings = {
  rotationFeatures: true,
  activeStateSources: true,
  upgradePaths: true,
  buildDetails: true,
  echoStatsTable: true,
  benchmarkTargets: true,
}

export interface UiPrefs {
  ctxMenu: boolean
  updateToast: boolean
  recommendedMenuItems: boolean
  showBenchStates: boolean
  maxResOnInit: boolean
  benchmarkViewMode: BenchmarkViewMode
  benchAnim2d: boolean
  benchmarkCards: Record<string, BenchmarkCardConfig>
  benchRptSettings: BenchRptSettings
  uploadPersist: UploadPersistMode | null
  imgbbApiKey: string
}

// How an uploaded image's bytes are kept. 'session' lives only until reload;
// 'indexeddb' stores the blob locally; 'imgbb' hosts it and keeps only the URL.
export type UploadPersistMode = 'indexeddb' | 'imgbb'

export const DEF_UI_PREFS: UiPrefs = {
  ctxMenu: true,
  updateToast: true,
  recommendedMenuItems: false,
  showBenchStates: false,
  maxResOnInit: true,
  benchmarkViewMode: 'benchmark',
  benchAnim2d: true,
  benchmarkCards: {},
  benchRptSettings: DEF_BENCH_RPT,
  uploadPersist: null,
  imgbbApiKey: '',
}
