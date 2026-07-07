/*
  Author: Runor Ewhro
  Description: A self-contained, data-free benchmark rail used as a decorative
               preview (e.g. on the What's New page). It reuses the real
               benchmark-mode rail (RailCard with isShowcase=false): the Spine
               portrait plus the setup-image backdrop for one resonator, with no
               build data. Carries its own Live2D on/off toggle.
*/

import { useRef } from 'react'
import type { ResSeed } from '@/domain/entities/runtime'
import { DEF_BENCH_HIDE } from '@/domain/entities/preferences'
import { getResonator, spriteVars } from '@/modules/calculator/features/resonator/lib/resonator.ts'
import { ATTR_COLORS } from '@/modules/calculator/model/display'
import { getAttributeIconSrc } from '@/domain/gameData/attributeDisplay.ts'
import { getBenchmarkSpinePlacement } from './ui.tsx'
import { RailCard, type RailCardModel } from './RailCard.tsx'

export function RailCardPreview({ resId, animated }: { resId: string; animated: boolean }) {
  const cardRef = useRef<HTMLElement | null>(null)

  const res = getResonator(resId)
  const accent = res ? ATTR_COLORS[res.attribute] ?? '#6b7cff' : '#6b7cff'
  const portraitSrc = res?.sprite ?? res?.profile ?? '/assets/default.webp'

  const railModel: RailCardModel = {
    runtime: null,
    seed: res
      ? ({
          name: res.name,
          attribute: res.attribute,
          rarity: res.rarity,
          sprite: res.sprite,
          profile: res.profile,
          weaponType: res.weaponType,
        } as unknown as ResSeed)
      : null,
    rarity: res?.rarity ?? 5,
    accent,
    attrIcon: getAttributeIconSrc(res?.attribute),
    portraitSrc,
    spriteCss: spriteVars(res),
    weaponState: null,
    weapon: null,
    weaponName: 'No Weapon',
    weaponRarity: null,
    weaponIcon: null,
    sonataSets: [],
    teamSupports: [],
  }

  return (
    <div className="wn-card-stage">
      <div className="wn-card-fit">
          <RailCard
            buildCardRef={cardRef}
            isShowcase={false}
            customCss={null}
            railPhase="idle"
            editMode={null}
            railResId={resId}
            railModel={railModel}
            cardHidden={{
              ...DEF_BENCH_HIDE,
              brand: true,
              portraitCredit: true,
              backdropCredit: true,
            }}
            railStyle={{ '--resonator-accent': accent }}
            backdropStyle={{}}
            statsColumn="both"
            portraitCredit={null}
            backdropCredit={null}
            resolvedPortrait={null}
            animatedPortraits={animated}
            surfacePhase="idle"
            showcasePlacement={getBenchmarkSpinePlacement(resId)}
            score={null}
            grade={null}
            tone={accent}
            showcaseBuild={null}
            showcaseAvgDamage={null}
          />
      </div>
    </div>
  )
}
