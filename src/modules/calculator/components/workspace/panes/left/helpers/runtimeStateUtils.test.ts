import { describe, expect, it } from 'vitest'
import { listStatesForSource } from '@/domain/services/gameDataService'
import {
  getStateTeamTargetMode,
  stateHasTeamFacingEffects,
} from '@/modules/calculator/components/workspace/panes/left/helpers/runtimeStateUtils'

describe('runtimeStateUtils', () => {
  it('treats negative-effect max-state drivers as team-facing states', () => {
    const stormsEcho = listStatesForSource('resonator', '1406')
      .find((state) => state.controlKey === 'team:1406:storms_echo:active')

    if (!stormsEcho) {
      throw new Error("missing Storm's Echo state")
    }

    expect(stateHasTeamFacingEffects(stormsEcho, { includeTeamWide: false })).toBe(true)
  })

  it('only exposes team target routing for the specific echo-set state that owns it', () => {
    const snowfall = listStatesForSource('echoSet', '30')
      .find((state) => state.id === 'snowfall')
    const snowfallCrit = listStatesForSource('echoSet', '30')
      .find((state) => state.id === 'snowfallCrit')
    const snowfallOutro = listStatesForSource('echoSet', '30')
      .find((state) => state.id === 'snowfallOutro')

    if (!snowfall || !snowfallCrit || !snowfallOutro) {
      throw new Error('missing Wishes of Quiet Snowfall states')
    }

    expect(getStateTeamTargetMode(snowfall)).toBe(null)
    expect(getStateTeamTargetMode(snowfallCrit)).toBe(null)
    expect(getStateTeamTargetMode(snowfallOutro)).toBe('activeOther')
  })
})
