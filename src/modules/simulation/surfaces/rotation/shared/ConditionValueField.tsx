/*
  Author: Runor Ewhro
  description: renders the editable value control for one condition state.
*/

import { Select } from '@/application/ui/Select'
import { NumberInput } from '@/modules/simulation/features/controls/NumberInput.tsx'
import type { SourceState } from '@/domain/gameData/contracts.ts'
import type { RotationConditionValue } from './authoringTypes.ts'

export function viewCondVlFl(
  definition: SourceState,
  value: RotationConditionValue,
  onChange: (value: RotationConditionValue) => void,
) {
  if (definition.kind === 'toggle') {
    const checked = value === true

    return (
      <div className="fcb" role="group" aria-label={`${definition.label} value`}>
        <button
          type="button"
          className={`fcb__btn${checked ? ' is-active' : ''}`}
          aria-pressed={checked}
          onClick={() => onChange(true)}
        >
          True
        </button>
        <button
          type="button"
          className={`fcb__btn${!checked ? ' is-active' : ''}`}
          aria-pressed={!checked}
          onClick={() => onChange(false)}
        >
          False
        </button>
      </div>
    )
  }

  if (definition.kind === 'select') {
    return (
      <Select
        value={String(value)}
        options={(definition.options ?? []).map((option) => ({
          value: option.id,
          label: option.label,
        }))}
        onChange={(nextValue) => onChange(nextValue)}
        ariaLabel={`${definition.label} value`}
      />
    )
  }

  const min = definition.kind === 'stack' ? definition.min ?? 0 : definition.min

  return (
    <NumberInput
      min={min}
      max={definition.max}
      step={definition.kind === 'stack' ? 1 : 0.1}
      value={typeof value === 'number' ? value : Number(value) || 0}
      onChange={(nextValue) => {
        onChange(definition.kind === 'stack' ? Math.max(min ?? 0, Math.floor(nextValue)) : nextValue)
      }}
    />
  )
}
