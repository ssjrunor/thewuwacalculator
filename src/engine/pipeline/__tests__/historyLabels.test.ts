import { beforeEach, describe, expect, it } from 'vitest'
import { ECHO_MAIN_STATS, ECHO_SIDE_STATS } from '@/data/gameData/catalog/echoStats'
import type { EchoInstance } from '@/domain/entities/runtime'
import { makeEchoUid } from '@/domain/entities/runtime'
import { listEchoes } from '@/domain/services/echoCatalogService'
import { getResById } from '@/domain/services/resonatorCatalogService'
import { DEF_RES_ID } from '@/domain/state/defaults'
import { useAppStore } from '@/domain/state/store'

function makeEchoInstance(echoId: string, slotIndex = 0): EchoInstance {
  const definition = listEchoes().find((echo) => echo.id === echoId)
  if (!definition) {
    throw new Error(`missing echo ${echoId}`)
  }

  const primaryStats = ECHO_MAIN_STATS[definition.cost]
  const secondaryStat = ECHO_SIDE_STATS[definition.cost]
  const primaryKey = Object.keys(primaryStats)[0]

  return {
    uid: makeEchoUid(),
    id: definition.id,
    set: definition.sets[0] ?? 0,
    mainEcho: slotIndex === 0,
    mainStats: {
      primary: { key: primaryKey, value: primaryStats[primaryKey] },
      secondary: { key: secondaryStat.key, value: secondaryStat.value },
    },
    substats: {
      critRate: 6.3,
      critDmg: 12.6,
    },
  }
}

describe('history labels', () => {
  beforeEach(() => {
    useAppStore.getState().resetState()

    const defaultSeed = getResById(DEF_RES_ID)
    if (!defaultSeed) {
      throw new Error(`missing default resonator ${DEF_RES_ID}`)
    }

    useAppStore.getState().ensResRt(defaultSeed)

    useAppStore.setState((state) => ({
      ...state,
      history: {
        past: [],
        future: [],
        isRestoring: false,
      },
    }))
  })

  it('tracks labels across undo and redo', () => {
    const initialTheme = useAppStore.getState().ui.theme
    const nextTheme = initialTheme === 'dark' ? 'light' : 'dark'

    useAppStore.getState().setTheme(nextTheme)

    expect(useAppStore.getState().undoHist().map((entry) => entry.label)).toEqual(['Changed Theme'])

    useAppStore.getState().undo()

    expect(useAppStore.getState().ui.theme).toBe(initialTheme)
    expect(useAppStore.getState().undoHist()).toHaveLength(0)
    expect(useAppStore.getState().redoHist().map((entry) => entry.label)).toEqual(['Changed Theme'])

    useAppStore.getState().redo()

    expect(useAppStore.getState().ui.theme).toBe(nextTheme)
    expect(useAppStore.getState().undoHist().map((entry) => entry.label)).toEqual(['Changed Theme'])
    expect(useAppStore.getState().redoHist()).toHaveLength(0)
  })

  it('supports jumping multiple levels of undo and redo', () => {
    const initialState = useAppStore.getState()
    const initialTheme = initialState.ui.theme
    const initialLeftPaneView = initialState.ui.leftPaneView
    const initialShowSubHits = initialState.ui.showSubHits

    useAppStore.getState().setTheme(initialTheme === 'dark' ? 'light' : 'dark')
    useAppStore.getState().setLeftView(initialLeftPaneView === 'echoes' ? 'teams' : 'echoes')
    useAppStore.getState().setSubHits(!initialShowSubHits)

    expect(useAppStore.getState().undoHist().map((entry) => entry.label)).toEqual([
      'Updated Sub-Hit Visibility',
      'Changed Left Pane View',
      'Changed Theme',
    ])

    useAppStore.getState().undoTo(1)

    expect(useAppStore.getState().ui.theme).toBe(initialTheme === 'dark' ? 'light' : 'dark')
    expect(useAppStore.getState().ui.leftPaneView).toBe(initialLeftPaneView)
    expect(useAppStore.getState().ui.showSubHits).toBe(initialShowSubHits)
    expect(useAppStore.getState().undoHist().map((entry) => entry.label)).toEqual(['Changed Theme'])
    expect(useAppStore.getState().redoHist().map((entry) => entry.label)).toEqual([
      'Changed Left Pane View',
      'Updated Sub-Hit Visibility',
    ])

    useAppStore.getState().redoTo(1)

    expect(useAppStore.getState().ui.leftPaneView).toBe(initialLeftPaneView === 'echoes' ? 'teams' : 'echoes')
    expect(useAppStore.getState().ui.showSubHits).toBe(!initialShowSubHits)
    expect(useAppStore.getState().undoHist().map((entry) => entry.label)).toEqual([
      'Updated Sub-Hit Visibility',
      'Changed Left Pane View',
      'Changed Theme',
    ])
    expect(useAppStore.getState().redoHist()).toHaveLength(0)
  })

  it('uses runtime-specific labels for equipped echo updates', () => {
    const firstEcho = listEchoes()[0]
    if (!firstEcho) {
      throw new Error('missing echo catalog data')
    }

    useAppStore.getState().updActRt((prev) => ({
      ...prev,
      build: {
        ...prev.build,
        echoes: [makeEchoInstance(firstEcho.id), ...prev.build.echoes.slice(1)],
      },
    }))

    expect(useAppStore.getState().undoHist()[0]?.label).toBe('Updated Equipped Echoes')
  })

  it('falls back to a generic domain desc when no explicit desc is provided', () => {
    const initialSeen = useAppStore.getState().ui.optimizerCpuHintSeen

    useAppStore.getState().setOptHint(!initialSeen)

    expect(useAppStore.getState().undoHist()[0]?.label).toBe('Updated Layout')
  })

  it('records a single pane-change action when returning from another mode', () => {
    useAppStore.getState().setMainMode('optimizer')
    useAppStore.setState((state) => ({
      ...state,
      history: {
        past: [],
        future: [],
        isRestoring: false,
      },
    }))

    useAppStore.getState().openLeftView('echoes')

    expect(useAppStore.getState().ui.mainMode).toBe('default')
    expect(useAppStore.getState().ui.leftPaneView).toBe('echoes')
    expect(useAppStore.getState().undoHist().map((entry) => entry.label)).toEqual(['Opened Echoes Pane'])
  })
})
