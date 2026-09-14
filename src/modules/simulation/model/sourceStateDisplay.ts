/*
  Author: Runor Ewhro
  Description: Owns source state display behavior and state transitions for the model module.
*/

import { getEchoSetDe } from '@/data/gameData/echoSets/effects'
import type { DataSrcRef, EffectDef, SourceState } from '@/domain/gameData/contracts'
import { getEchoById } from '@/domain/services/echoCatalogService'
import { getWpnById } from '@/domain/services/weaponCatalogService'

export interface SrcSttDspl {
  sourceName?: string
  label: string
  description?: string
}

/**
 * Resolve the semantic name of a source-backed effect without replacing the
 * authored control/stat label. Weapon effects are split into several numeric
 * operations, but they all belong to the weapon's one named passive.
 */
export function getSourceEffectName(
  source: DataSrcRef,
  fallback: string,
): string {
  if (source.type === 'weapon') {
    return getWpnById(source.id)?.passive.name ?? fallback
  }

  return fallback
}

/** Resolve the human-facing owner name used by source summary surfaces. */
export function getSourceOwnerName(
  source: DataSrcRef,
  fallback: string,
): string {
  return getSourceEffectName(source, fallback)
}

/** Resolve the semantic effect identity for a state while keeping its authored
 * control label available for condition editors and enabler controls. */
export function getStateEffectName(state: SourceState): string {
  if (state.source.type === 'echoSet') {
    return getStateText(state).label
  }

  return getSourceEffectName(state.source, state.label)
}

/** Format a condition with its semantic effect and authored control text. */
export function formatEffectConditionName(
  effectName: string | undefined,
  controlLabel: string,
): string {
  if (!effectName || effectName === controlLabel || controlLabel.startsWith(`${effectName} `)) {
    return controlLabel
  }

  return `${effectName} · ${controlLabel}`
}

/** Resolve the semantic name for a registered effect definition. */
export function getEffectName(effect: Pick<EffectDef, 'id' | 'source' | 'label'>): string {
  if (effect.source.type === 'echoSet') {
    const setId = Number(effect.source.id)
    const setDef = Number.isFinite(setId) ? getEchoSetDe(setId) : undefined
    if (setDef) {
      const prefix = `echoSet:${effect.source.id}:`
      const key = effect.id.startsWith(prefix) ? effect.id.slice(prefix.length) : ''
      const baseKey = key.endsWith(':max') ? key.slice(0, -4) : key
      const piece = baseKey.match(/^([135])pc$/)?.[1]
      const isSetState = Boolean(baseKey && setDef.states[baseKey])

      if (piece || isSetState) {
        const pieceCount = piece
          ? Number(piece)
          : setDef.setMax === 1 ? 1 : setDef.setMax === 3 ? 3 : 5
        return `${setDef.name} ${pieceCount}pc`
      }
    }
  }

  return getSourceEffectName(effect.source, effect.label)
}

// map internal echo set part keys to their short piece labels
function getEchoSetPc(stateId: string, setMax: 1 | 3 | 5): string {
  if (stateId === 'onePiece') {
    return '1pc'
  }

  if (stateId === 'twoPiece') {
    return '2pc'
  }

  if (stateId === 'threePiece') {
    return '3pc'
  }

  if (stateId === 'fivePiece') {
    return '5pc'
  }

  // fallback for custom/other part ids based on the set's max piece format
  if (setMax === 1) return '1pc'
  return setMax === 3 ? '3pc' : '5pc'
}

// build the ui display payload for a source state
// weapons expose the weapon name as the source name
// echo sets expose the set name and a formatted piece desc
export function getStateText(state: SourceState): SrcSttDspl {
  // source kind controls whether the desc should favor the source owner name
  // or the authored state desc itself.
  if (state.source.type === 'enemy') {
    return {
      sourceName: 'Enemy',
      label: state.label,
      description: state.description,
    }
  }

  if (state.source.type === 'echo') {
    const echo = getEchoById(state.source.id)
    return {
      sourceName: echo?.name ?? 'Main Echo',
      label: echo?.name ?? state.label,
      description: echo?.skillDesc ?? state.description,
    }
  }

  // weapon states show the owning weapon name directly
  if (state.source.type === 'weapon') {
    const weapon = getWpnById(state.source.id)
    return {
      sourceName: weapon?.name,
      label: state.label,
      description: state.description,
    }
  }

  // non-echo-set states just use their own desc/description as-is
  if (state.source.type !== 'echoSet') {
    return {
      label: state.label,
      description: state.description,
    }
  }

  // echo set ids come in as strings, so normalize to a numeric id first
  const setId = Number(state.source.id)
  const setDef = Number.isFinite(setId) ? getEchoSetDe(setId) : null

  // if the set cannot be resolved, fall back to the raw state text
  if (!setDef) {
    return {
      label: state.label,
      description: state.description,
    }
  }

  // try to resolve the matching set part so we can surface a better description
  const part = setDef.parts.find((entry) => entry.key === state.id)

  return {
    sourceName: setDef.name,
    label: `${setDef.name} ${getEchoSetPc(state.id, setDef.setMax)}`,
    description: part?.description ?? state.description ?? part?.label ?? state.label,
  }
}
