/*
  Author: Runor Ewhro
  Description: Defines persisted ui preference switches that sit under the
               shared ui preferences object.
*/

export interface UiPrefs {
  ctxMenu: boolean
  updateToast: boolean
  recommendedMenuItems: boolean
  showUnquantifiedOverviewStates: boolean
  maxResOnInit: boolean
}

export const DEF_UI_PREFS: UiPrefs = {
  ctxMenu: true,
  updateToast: true,
  recommendedMenuItems: false,
  showUnquantifiedOverviewStates: false,
  maxResOnInit: true,
}
