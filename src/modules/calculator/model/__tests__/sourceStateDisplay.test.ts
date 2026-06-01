import { describe, expect, it } from 'vitest'
import { listStatesFor } from '@/domain/services/gameDataService.ts'
import { getStateText } from '@/modules/calculator/model/sourceStateDisplay.ts'

describe('sourceStateDisplay', () => {
  it('uses echo set effect text as the description instead of trigger text', () => {
    const moonlitOutro = listStatesFor('echoSet', '8')
      .find((state) => state.id === 'moonlit5')

    if (!moonlitOutro) {
      throw new Error('missing Moonlit Clouds outro state')
    }

    expect(moonlitOutro.label).toBe('5pc Outro ATK')
    expect(moonlitOutro.description).toBe('Upon using Outro Skill, ATK of the next Resonator increases by 22.5% for 15s.')

    const display = getStateText(moonlitOutro)

    expect(display.label).toBe('Moonlit Clouds 5pc')
    expect(display.description).toBe('Upon using Outro Skill, ATK of the next Resonator increases by 22.5% for 15s.')
  })

  it('uses echo names as source names for main echo states', () => {
    const heronToggle = listStatesFor('echo', '6000052')
      .find((state) => state.controlKey === 'echo:6000052:main:active')

    if (!heronToggle) {
      throw new Error('missing Impermanence Heron main echo state')
    }

    const display = getStateText(heronToggle)

    expect(display.sourceName).toBe('Impermanence Heron')
    expect(display.label).toBe('Impermanence Heron')
    expect(display.description).toContain('Transform into Impermanence Heron')
  })
})
