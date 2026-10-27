/*
  Author: Runor Ewhro
  description: defines persisted preferences and transient interface mutations,
               including history bounds and inventory visibility delegation.
*/

import type { AppStore } from './store'
import type { StoreSliceContext } from './storeContracts'
import { HIST_MAX_OPTS, type HistoryMax } from '@/domain/entities/appState'
import { DEF_SHOWCASE_CARD_STYLE, DEF_SHOWCASE_HIDE } from '@/domain/entities/preferences'
import { trimHistEnts, type PrssHistStt } from './history'
import { getSystTheme } from '@/shared/lib/systemTheme'
import { useInventoryUiStore } from './inventoryUiStore'
import { convertLibraryRoverGender, convertSimulationRoverGender, convertUiRoverGender, convertWorkspaceRoverGender } from './roverGenderConversion'
import { cancelOptimizerRequest } from './optimizerSlice'
import { resetOptimizerRun } from './optimizerRunStore'

function trimHistStt(history: PrssHistStt, max: HistoryMax): PrssHistStt {
  return {
    ...history,
    past: trimHistEnts(history.past, max, 'recent'),
    future: trimHistEnts(history.future, max, 'earliest'),
  }
}

export type UiActionNames = 'setTheme' | 'setThemePref' | 'syncTheme' | 'setLightVar' | 'setDarkVar' | 'setBgVar' | 'setBgImgKey' | 'setBgTxtMode' | 'setBodyFont' | 'setBlurMode' | 'setEntrAnim' | 'setCtxMenu' | 'setUpdToast' | 'setGameBetaData' | 'setRoverGender' | 'setRecMenus' | 'setMaxResInit' | 'setAnimatedRailPortraits' | 'commitAppearanceConfig' | 'patchShowcaseCardStyle' | 'toggleShowcaseHide' | 'patchShowcaseCardHidden' | 'resetShowcaseCard' | 'setShowcaseLayout' | 'setUploadPersist' | 'setImgbbApiKey' | 'setPlayerIdentity' | 'setEchoImportBands' | 'setRotationImportPick' | 'setSugView' | 'setSubHits' | 'setCmpInv' | 'setGrpInv' | 'setSeeEqp' | 'setHistOn' | 'setHistMax' | 'setOptHint' | 'setCmprXprts' | 'setRotEditorPrefs' | 'setRotPrefs' | 'setInvOpen' | 'setInvEchoQ'

export function createUiActions({ get, persistedSet }: Pick<StoreSliceContext, 'get' | 'persistedSet'>): Pick<AppStore, UiActionNames> {
  return {
  setTheme: (theme) => {
    persistedSet(['ui.appearance'], (state) => ({
      ...state,
      ui: {
        ...state.ui,
        theme,
        themePreference: theme,
      },
    }), { historyLabel: 'Changed Theme' })
  },

  setThemePref: (themePref) => {
    persistedSet(['ui.appearance'], (state) => ({
      ...state,
      ui: {
        ...state.ui,
        themePreference: themePref,
        theme: themePref === 'system'
          ? getSystTheme()
          : themePref,
      },
    }), { historyLabel: 'Changed Theme Preference' })
  },

  syncTheme: (theme) => {
    persistedSet(['ui.appearance'], (state) => {
      if (state.ui.themePreference !== 'system' || state.ui.theme === theme) {
        return state
      }

      return {
        ...state,
        ui: {
          ...state.ui,
          theme,
        },
      }
    }, { recHist: false })
  },

  setLightVar: (lightVariant) => {
    persistedSet(['ui.appearance'], (state) => ({
      ...state,
      ui: {
        ...state.ui,
        lightVariant,
      },
    }), { historyLabel: 'Changed Light Theme Variant' })
  },

  setDarkVar: (darkVariant) => {
    persistedSet(['ui.appearance'], (state) => ({
      ...state,
      ui: {
        ...state.ui,
        darkVariant,
      },
    }), { historyLabel: 'Changed Dark Theme Variant' })
  },

  setBgVar: (bgVar) => {
    persistedSet(['ui.appearance'], (state) => ({
      ...state,
      ui: {
        ...state.ui,
        backgroundVariant: bgVar,
      },
    }), { historyLabel: 'Changed Background Variant' })
  },

  setBgImgKey: (bgMgKey) => {
    persistedSet(['ui.appearance'], (state) => ({
      ...state,
      ui: {
        ...state.ui,
        backgroundImageKey: bgMgKey,
      },
    }), { historyLabel: 'Changed Background Image' })
  },

  setBgTxtMode: (bgTextMode) => {
    persistedSet(['ui.appearance'], (state) => ({
      ...state,
      ui: {
        ...state.ui,
        backgroundTextMode: bgTextMode,
      },
    }), { historyLabel: 'Changed Background Text Mode' })
  },

  setBodyFont: (bodyFontName, bodyFontUrl) => {
    persistedSet(['ui.appearance'], (state) => ({
      ...state,
      ui: {
        ...state.ui,
        bodyFontName,
        bodyFontUrl,
      },
    }), { historyLabel: 'Changed Body Font' })
  },

  setBlurMode: (blurMode) => {
    persistedSet(['ui.appearance'], (state) => ({
      ...state,
      ui: {
        ...state.ui,
        blurMode,
      },
    }), { historyLabel: 'Changed Blur Mode' })
  },

  setEntrAnim: (ntrnNmtn) => {
    persistedSet(['ui.appearance'], (state) => ({
      ...state,
      ui: {
        ...state.ui,
        entranceAnimations: ntrnNmtn,
      },
    }), { historyLabel: 'Changed Entrance Animations' })
  },

  setCtxMenu: (ctxMenu) => {
    persistedSet(['ui.layout'], (state) => ({
      ...state,
      ui: {
        ...state.ui,
        preferences: {
          ...state.ui.preferences,
          ctxMenu,
        },
      },
    }), { historyLabel: 'Changed Context Menu Mode' })
  },

  setUpdToast: (updateToast) => {
    persistedSet(['ui.layout'], (state) => ({
      ...state,
      ui: {
        ...state.ui,
        preferences: {
          ...state.ui.preferences,
          updateToast,
        },
      },
    }), { historyLabel: 'Changed Update Toast Mode' })
  },

  setGameBetaData: (gameBetaData) => {
    persistedSet(['ui.layout'], (state) => ({
      ...state,
      ui: {
        ...state.ui,
        preferences: {
          ...state.ui.preferences,
          gameBetaData,
        },
      },
    }), { historyLabel: 'Changed Game Data Mode' })
  },

  setRoverGender: (roverGender) => {
    if (get().ui.preferences.roverGender === roverGender) return
    if (roverGender !== 'both') {
      get().ensureFullLibrary()
      cancelOptimizerRequest()
      resetOptimizerRun()
    }
    persistedSet([
      'ui.layout', 'combat.workspace',
      'library.builds', 'library.rotations', 'library.scenarios',
      'simulation.optimizerSettings', 'simulation.suggestions',
    ], (state) => {
      if (state.ui.preferences.roverGender === roverGender) return state
      const library = roverGender === 'both'
        ? state.library
        : convertLibraryRoverGender(state.library, roverGender)
      return {
        ...state,
        ui: convertUiRoverGender({
          ...state.ui,
          preferences: { ...state.ui.preferences, roverGender },
        }, roverGender),
        combat: convertWorkspaceRoverGender(state.combat, roverGender),
        library,
        simulation: convertSimulationRoverGender(state.simulation, roverGender),
        history: { past: [], future: [], isRestoring: false },
      }
    }, { recHist: false })
  },

  setRecMenus: (rcmmMenuTms) => {
    persistedSet(['ui.layout'], (state) => ({
      ...state,
      ui: {
        ...state.ui,
        preferences: {
          ...state.ui.preferences,
          recommendedMenuItems: rcmmMenuTms,
        },
      },
    }), { historyLabel: 'Changed Recommended Menu Items' })
  },

  setMaxResInit: (maxResOnInit) => {
    persistedSet(['ui.layout'], (state) => ({
      ...state,
      ui: {
        ...state.ui,
        preferences: {
          ...state.ui.preferences,
          maxResOnInit,
        },
      },
    }), { historyLabel: 'Changed Resonator Init Mode' })
  },

  setAnimatedRailPortraits: (animatedRailPortraits) => {
    persistedSet(['ui.layout'], (state) => ({
      ...state,
      ui: {
        ...state.ui,
        preferences: {
          ...state.ui.preferences,
          animatedRailPortraits,
        },
      },
    }), { historyLabel: 'Changed Rail Portrait Mode' })
  },

  commitAppearanceConfig: (updater) => {
    persistedSet(['ui.appearance'], (state) => {
      const ui = updater(state.ui)
      return ui === state.ui ? state : { ...state, ui }
    }, { historyLabel: 'Updated Appearance' })
  },

  patchShowcaseCardStyle: (resId, patch) => {
    persistedSet(['ui.showcaseCards'], (state) => {
      const cards = state.ui.preferences.showcaseCards
      const current = cards[resId] ?? { style: DEF_SHOWCASE_CARD_STYLE, hidden: DEF_SHOWCASE_HIDE }
      if (Object.entries(patch).every(([key, value]) => Object.is(current.style[key as keyof typeof current.style], value))) return state
      return {
        ...state,
        ui: {
          ...state.ui,
          preferences: {
            ...state.ui.preferences,
            showcaseCards: {
              ...cards,
              [resId]: { ...current, style: { ...current.style, ...patch } },
            },
          },
        },
      }
    }, { recHist: false })
  },

  toggleShowcaseHide: (resId, key) => {
    persistedSet(['ui.showcaseCards'], (state) => {
      const cards = state.ui.preferences.showcaseCards
      const current = cards[resId] ?? { style: DEF_SHOWCASE_CARD_STYLE, hidden: DEF_SHOWCASE_HIDE }
      return {
        ...state,
        ui: {
          ...state.ui,
          preferences: {
            ...state.ui.preferences,
            showcaseCards: {
              ...cards,
              [resId]: { ...current, hidden: { ...current.hidden, [key]: !current.hidden[key] } },
            },
          },
        },
      }
    }, { recHist: false })
  },

  patchShowcaseCardHidden: (resId, patch) => {
    persistedSet(['ui.showcaseCards'], (state) => {
      const cards = state.ui.preferences.showcaseCards
      const current = cards[resId] ?? { style: DEF_SHOWCASE_CARD_STYLE, hidden: DEF_SHOWCASE_HIDE }
      if (Object.entries(patch).every(([key, value]) => Object.is(current.hidden[key as keyof typeof current.hidden], value))) return state
      return {
        ...state,
        ui: {
          ...state.ui,
          preferences: {
            ...state.ui.preferences,
            showcaseCards: {
              ...cards,
              [resId]: { ...current, hidden: { ...current.hidden, ...patch } },
            },
          },
        },
      }
    }, { recHist: false })
  },

  resetShowcaseCard: (resId) => {
    persistedSet(['ui.showcaseCards'], (state) => {
      const cards = state.ui.preferences.showcaseCards
      if (!(resId in cards)) return state
      const next = { ...cards }
      delete next[resId]
      return {
        ...state,
        ui: {
          ...state.ui,
          preferences: { ...state.ui.preferences, showcaseCards: next },
        },
      }
    }, { recHist: false })
  },

  setShowcaseLayout: (showcaseLayout) => {
    persistedSet(['ui.layout'], (state) => ({
      ...state,
      ui: {
        ...state.ui,
        preferences: { ...state.ui.preferences, showcaseLayout },
      },
    }), { recHist: false })
  },

  setUploadPersist: (uploadPersist) => {
    persistedSet(['ui.layout'], (state) => ({
      ...state,
      ui: {
        ...state.ui,
        preferences: { ...state.ui.preferences, uploadPersist },
      },
    }), { recHist: false })
  },

  setImgbbApiKey: (imgbbApiKey) => {
    persistedSet(['ui.layout'], (state) => ({
      ...state,
      ui: {
        ...state.ui,
        preferences: { ...state.ui.preferences, imgbbApiKey },
      },
    }), { recHist: false })
  },

  setPlayerIdentity: (playerId, playerUid) => {
    persistedSet(['ui.layout'], (state) => ({
      ...state,
      ui: {
        ...state.ui,
        preferences: {
          ...state.ui.preferences,
          playerId: playerId.trim(),
          playerUid: playerUid.trim(),
        },
      },
    }), { recHist: false })
  },

  setEchoImportBands: (echoImportBands) => {
    persistedSet(['ui.layout'], (state) => ({
      ...state,
      ui: {
        ...state.ui,
        preferences: { ...state.ui.preferences, echoImportBands },
      },
    }), { recHist: false })
  },

  setRotationImportPick: (rotationImportPick) => {
    persistedSet(['ui.layout'], (state) => ({
      ...state,
      ui: {
        ...state.ui,
        preferences: { ...state.ui.preferences, rotationImportPick },
      },
    }), { recHist: false })
  },

  setSugView: (suggsViewMode) => {
    persistedSet(['ui.layout'], (state) => ({
      ...state,
      ui: {
        ...state.ui,
        suggsViewMode,
      },
    }), { historyLabel: 'Changed Suggestions View' })
  },

  setSubHits: (showSubHits) => {
    persistedSet(['ui.layout'], (state) => ({
      ...state,
      ui: {
        ...state.ui,
        showSubHits,
      },
    }), { historyLabel: 'Updated Sub-Hit Visibility' })
  },

  setCmpInv: (compactInv) => {
    persistedSet(['ui.layout'], (state) => ({
      ...state,
      ui: {
        ...state.ui,
        compactInv,
      },
    }), { historyLabel: 'Toggled Compact Inventory', recHist: false })
  },

  setGrpInv: (groupInv) => {
    persistedSet(['ui.layout'], (state) => ({
      ...state,
      ui: {
        ...state.ui,
        groupInv,
      },
    }), { historyLabel: 'Toggled Inventory Grouping', recHist: false })
  },

  setSeeEqp: (seeEquipped) => {
    persistedSet(['ui.layout'], (state) => ({
      ...state,
      ui: {
        ...state.ui,
        seeEquipped,
      },
    }), { historyLabel: 'Toggled Equipped Items', recHist: false })
  },

  setHistOn: (haveHistory) => {
    persistedSet(['ui.layout'], (state) => ({
      ...state,
      ui: {
        ...state.ui,
        haveHistory,
      },
      history: haveHistory
        ? state.history
        : {
          ...state.history,
          past: [],
          future: [],
        },
    }), { historyLabel: 'Toggled History', recHist: false })
  },

  setHistMax: (historyMax) => {
    const nextHistMax = HIST_MAX_OPTS.includes(historyMax) ? historyMax : 10
    persistedSet(['ui.layout'], (state) => ({
      ...state,
      ui: {
        ...state.ui,
        historyMax: nextHistMax,
      },
      history: trimHistStt(state.history, nextHistMax),
    }), { historyLabel: 'Changed History Capacity', recHist: false })
  },

  setOptHint: (optCpuHintSe) => {
    persistedSet(['ui.layout'], (state) => ({
      ...state,
      ui: {
        ...state.ui,
        optimizerCpuHintSeen: optCpuHintSe,
      },
    }))
  },

  setCmprXprts: (compressed) => {
    persistedSet(['ui.layout'], (state) => ({
      ...state,
      ui: {
        ...state.ui,
        compressedExports: compressed,
      },
    }))
  },

  setRotEditorPrefs: (patch) => {
    persistedSet(['ui.layout'], (state) => ({
      ...state,
      ui: {
        ...state.ui,
        rotationEditorPreferences: {
          ...state.ui.rotationEditorPreferences,
          ...patch,
        },
      },
    }), { recHist: false })
  },

  setRotPrefs: (updater) => {
    persistedSet(['ui.savedRotationPreferences'], (state) => ({
      ...state,
      ui: {
        ...state.ui,
        savedRotationPreferences: updater(state.ui.savedRotationPreferences),
      },
    }), { historyLabel: 'Updated Saved Rotation Preferences' })
  },

  setInvOpen: (invOpen) => {
    if (invOpen) get().ensInvHydr()
    useInventoryUiStore.getState().setOpen(invOpen)
  },

  setInvEchoQ: (invEchoSrch) => {
    useInventoryUiStore.getState().setEchoQuery(invEchoSrch)
  },

  }
}
