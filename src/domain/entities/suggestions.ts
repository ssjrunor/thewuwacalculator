/*
  Author: Runor Ewhro
  Description: Defines suggestion state types for targeted feature
               suggestions and random generation preferences.
*/

export interface SuggestionSettings {
  targetFeatureId: string | null
  rotationMode: boolean
}

export interface RandomGeneratorSetPreference {
  setId: number
  count: number
}

export interface RandomGeneratorSettings {
  bias: number
  rollQuality: number
  targetEnergyRegen: number
  setPreferences: RandomGeneratorSetPreference[]
  mainEchoId: string | null
}

export interface ResonatorSuggestionsState {
  settings: SuggestionSettings
  random: RandomGeneratorSettings
}