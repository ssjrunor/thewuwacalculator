/*
  Author: Runor Ewhro
  Description: Defines suggestion state types for targeted feature
               suggestions and random generation preferences.
*/

export interface SuggSets {
  targetFeatureId: string | null
  rotationMode: boolean
}

export type SuggsViewMod = 'mainStats' | 'setPlans' | 'weapons' | 'random' | 'substats'

export interface RandGnrtSetP {
  setId: number
  count: number
}

export interface RandGnrtSets {
  bias: number
  rollQuality: number
  targetEnergyRegen: number
  setPreferences: RandGnrtSetP[]
  mainEchoId: string | null
}

export type WpnSuggMode = 'default' | 'max' | 'both'
export type WpnSuggTgt = 'default' | 'max'
export type WpnStMax = boolean | number | string

export interface WpnStCfg {
  off?: true
  max?: WpnStMax
}

export interface WeaponPlanSet {
  mode: WpnSuggMode
  target: WpnSuggTgt
  ranks: Record<string, number>
  stdRank: number
  visible: Record<string, boolean>
  states: Record<string, Record<string, WpnStCfg>>
}

export interface SuggestState {
  settings: SuggSets
  random: RandGnrtSets
}
