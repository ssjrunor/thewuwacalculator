import { describe, expect, it } from 'vitest'
import { listStatesForSource } from '@/domain/services/gameDataService'
import { stateHasTeamFacingEffects } from '@/modules/calculator/components/workspace/panes/left/helpers/runtimeStateUtils'

describe('runtimeStateUtils', () => {
  it('treats negative-effect max-state drivers as team-facing states', () => {
    const stormsEcho = listStatesForSource('resonator', '1406')
      .find((state) => state.controlKey === 'team:1406:storms_echo:active')

    if (!stormsEcho) {
      throw new Error("missing Storm's Echo state")
    }

    expect(stateHasTeamFacingEffects(stormsEcho, { includeTeamWide: false })).toBe(true)
  })
})
