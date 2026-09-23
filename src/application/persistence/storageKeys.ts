/*
  Author: Runor Ewhro
  Description: Defines versioned storage identifiers without importing state
               hydration or schema construction.
*/

import { APP_STATE_VER } from '@/domain/entities/appStateVersion'

export const APP_STORAGE_KEY = `wwcalc.app.v${APP_STATE_VER}`
export const APPSTOREUIPP = `${APP_STORAGE_KEY}.ui.appearance`
export const APPSTOREUILY = `${APP_STORAGE_KEY}.ui.layout`
export const APPSTOREUISV = `${APP_STORAGE_KEY}.ui.saved-rotation-preferences`
export const APPSTORECMBT = `${APP_STORAGE_KEY}.combat.workspace`
export const APPSTORECMBTINDEX = `${APPSTORECMBT}.index`
export const APPSTORECMBTREC = `${APPSTORECMBT}.scenario.`
/** Retired v25 key retained only for cleanup and migration assertions. */
export const APPSTOREPRFL = `${APP_STORAGE_KEY}.profiles`
export const APPSTOREOPTS = `${APP_STORAGE_KEY}.optimizer-settings`
export const SUGG_STORE_KEY = `${APP_STORAGE_KEY}.suggestions`
export const APPSTOREINVC = `${APP_STORAGE_KEY}.inventory.echoes`
export const APPSTOREINVB = `${APP_STORAGE_KEY}.inventory.builds`
export const APPSTOREINVR = `${APP_STORAGE_KEY}.inventory.rotations`
export const APPSTOREINVS = `${APP_STORAGE_KEY}.inventory.scenarios`
export const APPSTORERCVR = `${APP_STORAGE_KEY}.recovery`
export const RETIRED_SESSION_STORE_KEY = `${APP_STORAGE_KEY}.session`
