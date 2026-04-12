import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SONATA_SET_CONDITIONALS,
  getCompactSonataSetPart,
  withCompactSonataSetUpdates,
} from './sonataSetConditionals'

describe('sonata set conditionals', () => {
  it('keeps compact keys after clearing every set part', () => {
    const disabled = withCompactSonataSetUpdates(
      DEFAULT_SONATA_SET_CONDITIONALS,
      DEFAULT_SONATA_SET_CONDITIONALS.setIds.flatMap((setId) => (
        DEFAULT_SONATA_SET_CONDITIONALS.keys.map((partKey) => ({
          setId,
          partKey,
          checked: false,
        }))
      )),
    )

    expect(disabled.keys).toEqual(DEFAULT_SONATA_SET_CONDITIONALS.keys)
    expect(disabled.wordsPerSet).toBe(DEFAULT_SONATA_SET_CONDITIONALS.wordsPerSet)
    expect(disabled.masks.every((word) => word === 0)).toBe(true)

    const reenabled = withCompactSonataSetUpdates(disabled, [
      { setId: 1, partKey: 'twoPiece', checked: true },
    ])

    expect(getCompactSonataSetPart(reenabled, 1, 'twoPiece', false)).toBe(true)
  })

  it('recovers from an empty compact key table when a part is toggled on', () => {
    const reenabled = withCompactSonataSetUpdates({
      ...DEFAULT_SONATA_SET_CONDITIONALS,
      keys: [],
      wordsPerSet: 0,
      masks: [],
    }, [
      { setId: 1, partKey: 'twoPiece', checked: true },
    ])

    expect(reenabled.keys).toEqual(['twoPiece'])
    expect(reenabled.wordsPerSet).toBe(1)
    expect(getCompactSonataSetPart(reenabled, 1, 'twoPiece', false)).toBe(true)
  })
})
