/*
  Author: Runor Ewhro
  description: a board build's showcase card: the app's card at its natural
               992x720, drawn from the rebuilt runtime in the default showcase
               style. the viewer's card customizations do not apply.
*/

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { DEF_SHOWCASE_CARD_STYLE, DEF_SHOWCASE_HIDE } from '@/domain/entities/preferences'
import { BuildRail } from '@/modules/simulation/workspace/BuildRail'
import type { CssVars } from '@/modules/simulation/workspace/ui'
import { DEFAULT_PORTRAIT_SURFACE, inkForSurface, readPortraitSurface } from '@/modules/simulation/surfaces/showcase/portraitSurface'
import { getEvaluationSpinePlacement } from '@/shared/spine/placement'
import { getBuildEvaluationGrade, getBuildEvaluationTone } from '@/modules/simulation/model/buildEvaluationDisplay'
import type { CardBuild } from '../../model/cardBuild'

const STYLE = DEF_SHOWCASE_CARD_STYLE
const HIDDEN = { ...DEF_SHOWCASE_HIDE, portraitCredit: true, backdropCredit: true }

export function LbCard({ build, score, damage, holder }: {
  build: CardBuild
  score: number | null
  damage: number | null
  /** the build's owner, named on the card in place of the viewer. */
  holder: { name: string | null; uid: string | null }
}) {
  const cardRef = useRef<HTMLElement | null>(null)
  const resId = build.runtime.id
  const [surface, setSurface] = useState<{ owner: string; color: string } | null>(null)
  const onPortraitReady = useCallback((source: string) => {
    void readPortraitSurface(source).then((color) => setSurface({ owner: resId, color }))
  }, [resId])
  const bg = surface?.owner === resId ? surface.color : DEFAULT_PORTRAIT_SURFACE
  const opacity = STYLE.opacity ?? 82

  const railStyle = useMemo<CssVars>(() => ({
    '--resonator-accent': build.rail.accent,
    '--bg': bg,
    '--text': inkForSurface(bg),
    '--rail-glass': `color-mix(in srgb, var(--bg) ${opacity}%, transparent)`,
    '--rail-glass-2': `color-mix(in srgb, var(--bg) ${Math.round(opacity * 0.67)}%, transparent)`,
    '--mask-bottom': `${STYLE.maskBottom ?? 45}%`,
  }), [bg, build.rail.accent, opacity])

  // the showcase sets its card's look as inherited variables on the card itself.
  useLayoutEffect(() => {
    const card = cardRef.current
    if (!card) return
    for (const [key, value] of Object.entries(railStyle)) card.style.setProperty(key, String(value))
    card.dispatchEvent(new Event('showcase:appearance'))
  }, [railStyle])

  const backdropStyle = useMemo<CssVars>(() => ({
    '--asset-base-opacity': (STYLE.backdropOpacity ?? 67) / 100,
    '--asset-base-filter': `blur(${(((STYLE.backdropBlur ?? 30) / 100) * 20).toFixed(1)}px) saturate(1.3)`,
    backgroundSize: `${(STYLE.backdropScale ?? 67) * 3}%`,
    backgroundPosition: `${STYLE.backdropX ?? 20}% ${STYLE.backdropY ?? 50}%`,
  }), [])

  const tone = score != null ? getBuildEvaluationTone(score).color : build.rail.accent

  return (
    <div className="k-cardbox wk-board" data-view="showcase"><div className="wk-workspace"><div className="wk-rail-wrapper">
      <BuildRail
        buildCardRef={cardRef}
        onPortraitReady={onPortraitReady}
        isShowcase
        customCss={null}
        railPhase="idle"
        editMode={null}
        railResId={resId}
        scenarioId={build.scenario.id}
        railModel={build.rail}
        cardHidden={HIDDEN}
        railStyle={railStyle}
        backdropStyle={backdropStyle}
        statsColumn={STYLE.statsColumn ?? 'build'}
        portraitCredit={null}
        backdropCredit={null}
        resolvedPortrait={null}
        animatedPortraits
        editable={false}
        showcasePlacement={getEvaluationSpinePlacement(resId)}
        score={score}
        grade={getBuildEvaluationGrade(score)}
        tone={tone}
        showcaseBuild={build.showcase}
        showcaseAvgDamage={damage}
        autoImageContrast
        layout="seal"
        holder={holder}
      />
    </div></div></div>
  )
}
