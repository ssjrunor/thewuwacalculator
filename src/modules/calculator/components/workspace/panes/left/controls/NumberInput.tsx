import { useState } from 'react'

// wraps the native number input with min/max enforcement and step snapping.
interface NumberInputProps {
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number
  disabled?: boolean
}

function getStepPrecision(step: number): number {
  const stepString = String(step)
  const decimalIndex = stepString.indexOf('.')
  return decimalIndex === -1 ? 0 : stepString.length - decimalIndex - 1
}

function formatInputValue(value: number): string {
  return Number.isFinite(value) ? String(value) : '0'
}

export function NumberInput({
  value,
  onChange,
  min,
  max,
  step,
  disabled,
}: NumberInputProps) {
  const [draftValue, setDraftValue] = useState(() => formatInputValue(value))
  const [isEditing, setIsEditing] = useState(false)
  const inputValue = isEditing ? draftValue : formatInputValue(value)

  const commitValue = (rawValue: string) => {
    const trimmedValue = rawValue.trim()

    if (
      trimmedValue === ''
      || trimmedValue === '-'
      || trimmedValue === '.'
      || trimmedValue === '-.'
    ) {
      setDraftValue(formatInputValue(value))
      return
    }

    const parsedValue = Number(trimmedValue)
    if (!Number.isFinite(parsedValue)) {
      setDraftValue(formatInputValue(value))
      return
    }

    let nextValue = parsedValue

    if (typeof min === 'number') {
      nextValue = Math.max(min, nextValue)
    }

    if (typeof max === 'number') {
      nextValue = Math.min(max, nextValue)
    }

    if (typeof step === 'number' && step > 0) {
      const stepBase = typeof min === 'number' ? min : 0
      const precision = getStepPrecision(step)
      nextValue = stepBase + Math.round((nextValue - stepBase) / step) * step
      nextValue = Number(nextValue.toFixed(precision))
    }

    if (typeof min === 'number') {
      nextValue = Math.max(min, nextValue)
    }

    if (typeof max === 'number') {
      nextValue = Math.min(max, nextValue)
    }

    setDraftValue(formatInputValue(nextValue))
    if (nextValue !== value) {
      onChange(nextValue)
    }
  }

  return (
    <input
      type="number"
      min={min}
      max={max}
      step={step}
      value={inputValue}
      disabled={disabled}
      onChange={(event) => {
        setIsEditing(true)
        setDraftValue(event.target.value)
      }}
      onBlur={(event) => {
        setIsEditing(false)
        commitValue(event.target.value)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.currentTarget.blur()
        }
      }}
    />
  )
}
