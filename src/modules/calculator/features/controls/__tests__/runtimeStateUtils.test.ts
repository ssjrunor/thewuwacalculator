import { describe, expect, it } from 'vitest'
import { listStatesFor } from '@/domain/services/gameDataService.ts'
import {
  getStateTeamTag,
  sttHasTeamFc,
} from '@/modules/calculator/features/controls/lib/runtimeStateUtils.ts'

describe('runtimeStateUtils', () => {
  it('treats negative-effect max-state drivers as team-facing states', () => {
    const stormsEcho = listStatesFor('resonator', '1406')
      .find((state) => state.controlKey === 'team:1406:storms_echo:active')

    if (!stormsEcho) {
      throw new Error("missing Storm's Echo state")
    }

    expect(sttHasTeamFc(stormsEcho, { ncldTeamWide: false })).toBe(true)
  })

  it('only exposes team target routing for the specific echo-set state that owns it', () => {
    const snowfall = listStatesFor('echoSet', '30')
      .find((state) => state.id === 'snowfall')
    const snowfallCrit = listStatesFor('echoSet', '30')
      .find((state) => state.id === 'snowfallCrit')
    const snowfallOutro = listStatesFor('echoSet', '30')
      .find((state) => state.id === 'snowfallOutro')

    if (!snowfall || !snowfallCrit || !snowfallOutro) {
      throw new Error('missing Wishes of Quiet Snowfall states')
    }

    expect(getStateTeamTag(snowfall)).toBe(null)
    expect(getStateTeamTag(snowfallCrit)).toBe(null)
    expect(getStateTeamTag(snowfallOutro)).toBe('activeOther')
  })
})
