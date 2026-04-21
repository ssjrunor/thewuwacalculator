import { describe, expect, it } from 'vitest'
import { listStatesForSource } from '@/domain/services/gameDataService'
import { getSourceStateDisplay } from '@/modules/calculator/model/sourceStateDisplay'

describe('sourceStateDisplay', () => {
  it('uses echo set effect text as the description instead of trigger text', () => {
    const moonlitOutro = listStatesForSource('echoSet', '8')
      .find((state) => state.id === 'moonlit5')

    if (!moonlitOutro) {
      throw new Error('missing Moonlit Clouds outro state')
    }

    expect(moonlitOutro.description).toBe('Triggered by using Outro Skill.')

    const display = getSourceStateDisplay(moonlitOutro)

    expect(display.label).toBe('Moonlit Clouds 5pc')
    expect(display.description).toBe('Upon using Outro Skill, ATK of the next Resonator increases by 22.5% for 15s.')
  })

  it('uses echo names as source names for main echo states', () => {
    const heronToggle = listStatesForSource('echo', '6000052')
      .find((state) => state.controlKey === 'echo:6000052:main:active')

    if (!heronToggle) {
      throw new Error('missing Impermanence Heron main echo state')
    }

    const display = getSourceStateDisplay(heronToggle)

    expect(display.sourceName).toBe('Impermanence Heron')
    expect(display.label).toBe('Impermanence Heron')
    expect(display.description).toContain('Transform into Impermanence Heron')
  })
})
