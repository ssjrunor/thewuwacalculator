/*
  Author: Runor Ewhro
  Description: Resolves echo stat keys to shared mask-icon output, grouping
               flat and percent variants that use the same source asset.
*/

import type { CSSProperties } from 'react'
import { ATTR_COLORS } from '@/domain/gameData/attributeDisplay.ts'
import type { AttributeKey } from '@/domain/entities/stats'

const STAT_ICON_FILE: Record<string, string> = {
  atk: 'atk',
  atkPercent: 'atk',
  atkFlat: 'atk',
  hp: 'hp',
  hpPercent: 'hp',
  hpFlat: 'hp',
  def: 'def',
  defPercent: 'def',
  defFlat: 'def',
  critRate: 'critrate',
  critDmg: 'critdmg',
  energyRegen: 'energyregen',
  healingBonus: 'healing',
  tuneBreakBoost: 'tune-break-boost',
  basicAtk: 'basic',
  heavyAtk: 'heavy',
  resonanceSkill: 'skill',
  resonanceLiberation: 'liberation',
  aero: 'aero',
  glacio: 'glacio',
  spectro: 'spectro',
  fusion: 'fusion',
  electro: 'electro',
  havoc: 'havoc',
}

const ATTRIBUTE_KEYS = new Set(['aero', 'glacio', 'spectro', 'fusion', 'electro', 'havoc'])

export function echoStatIconSrc(key: string): string | null {
  const file = STAT_ICON_FILE[key]
  return file ? `/assets/stat-icons/${file}.png` : null
}

export function echoStatTint(key: string): string {
  if (ATTRIBUTE_KEYS.has(key)) {
    return ATTR_COLORS[key as AttributeKey] ?? 'var(--picker-modal-accent)'
  }
  return 'color-mix(in srgb, var(--picker-modal-muted) 55%, var(--picker-modal-text))'
}

export function EchoStatGlyph({ statKey, size = 0.85 }: { statKey: string; size?: number }) {
  const icon = echoStatIconSrc(statKey)
  if (!icon) return null
  return (
    <span
      className="echo-stat-glyph"
      style={{
        '--stat-color': echoStatTint(statKey),
        width: `${size}rem`,
        height: `${size}rem`,
        WebkitMaskImage: `url("${icon}")`,
        maskImage: `url("${icon}")`,
      } as CSSProperties}
    />
  )
}
