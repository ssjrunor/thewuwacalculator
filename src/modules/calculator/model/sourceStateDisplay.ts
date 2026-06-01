/*
  Author: Runor Ewhro
  Description: resolves display labels and descriptions for source
               states, including weapon states and echo set piece states.
*/

import { getEchoSetDe } from '@/data/gameData/echoSets/effects'
import type { SourceState } from '@/domain/gameData/contracts'
import { getEchoById } from '@/domain/services/echoCatalogService'
import { getWpnById } from '@/domain/services/weaponCatalogService'

export interface SrcSttDspl {
  sourceName?: string
  label: string
  description?: string
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
