/*
  Author: Runor Ewhro
  description: the showcase card of a board build, in the owner's look for its resonator.
*/

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { DEF_SHOWCASE_CARD_STYLE, DEF_SHOWCASE_HIDE, type ShowcaseCardHidden, type ShowcaseCardStyle } from '@/domain/entities/preferences'
import { mediaRefId, type CardDoc } from '@/domain/leaderboard/documents'
import { BuildRail } from '@/modules/simulation/workspace/BuildRail'
import type { CssVars } from '@/modules/simulation/workspace/ui'
import { DEFAULT_PORTRAIT_SURFACE, inkForSurface, readPortraitSurface } from '@/modules/simulation/surfaces/showcase/portraitSurface'
import { buildTextSlotVars, collectCardFontFamilies } from '@/modules/simulation/surfaces/showcase/cardStyleVars'
import { ensureGoogleFamily, ensureShowcaseFonts } from '@/application/theme/typography'
import { getEvaluationSpinePlacement } from '@/shared/spine/placement'
import { getBuildEvaluationGrade, getBuildEvaluationTone } from '@/modules/simulation/model/buildEvaluationDisplay'
import { lbApi } from '../../api/client'
import type { CardBuild } from '../../model/cardBuild'

const DEFAULT_HIDDEN: ShowcaseCardHidden = { ...DEF_SHOWCASE_HIDE, portraitCredit: true, backdropCredit: true }

// a stored image: an upload's url, or null for the resonator's own art
export const lookImage = (value: string | null | undefined): string | null => {
  const id = mediaRefId(value ?? null)
  return id ? lbApi.mediaUrl(id) : null
}

// a look's style over the defaults (stored looks leave unset fields out)
export const lookStyle = (look: CardDoc | null | undefined): ShowcaseCardStyle => ({ ...DEF_SHOWCASE_CARD_STYLE, ...(look?.style ?? {}) })
export const lookHidden = (look: CardDoc | null | undefined): ShowcaseCardHidden =>
  look ? { ...DEF_SHOWCASE_HIDE, ...look.hidden } : DEFAULT_HIDDEN

export function LbCard({ build, score, damage, holder, look, onSurface }: {
  build: CardBuild
  score: number | null
  damage: number | null
  // the build's owner, named on the card
  holder: { name: string | null; uid: string | null }
  // the owner's look for the resonator; null draws the default style
  look?: CardDoc | null
  // the card's surface colour as drawn: the look's, or sampled from the portrait
  onSurface?: (color: string) => void
}) {
  const cardRef = useRef<HTMLElement | null>(null)
  const resId = build.runtime.id
  const style = useMemo(() => lookStyle(look), [look])
  const hidden = useMemo(() => lookHidden(look), [look])
  const portrait = lookImage(style.portraitImage)
  const backdrop = lookImage(style.backdropImage)

  const [surface, setSurface] = useState<{ owner: string; color: string } | null>(null)
  const owner = `${resId}:${portrait ?? ''}`
  const onPortraitReady = useCallback((source: string) => {
    void readPortraitSurface(source).then((color) => setSurface({ owner, color }))
  }, [owner])
  const bg = style.surface ?? (surface?.owner === owner ? surface.color : DEFAULT_PORTRAIT_SURFACE)
  const opacity = style.opacity ?? 82
  useEffect(() => { onSurface?.(bg) }, [bg, onSurface])

  const railStyle = useMemo<CssVars>(() => ({
    '--resonator-accent': style.accent ?? build.rail.accent,
    '--bg': bg,
    '--text': style.text ?? inkForSurface(bg),
    '--rail-glass': `color-mix(in srgb, var(--bg) ${opacity}%, transparent)`,
    '--rail-glass-2': `color-mix(in srgb, var(--bg) ${Math.round(opacity * 0.67)}%, transparent)`,
    ...(style.displayFont ? { '--display-font': style.displayFont } : {}),
    ...(style.monoFont ? { '--mono-font': style.monoFont } : {}),
    ...(style.maskTop != null ? { '--mask-top': `${style.maskTop}%` } : {}),
    ...(style.maskRight != null ? { '--mask-right': `${style.maskRight}%` } : {}),
    '--mask-bottom': `${style.maskBottom ?? 45}%`,
    ...(style.maskLeft != null ? { '--mask-left': `${style.maskLeft}%` } : {}),
    ...(style.maskTopSharp != null ? { '--mask-top-sharp': style.maskTopSharp / 100 } : {}),
    ...(style.maskRightSharp != null ? { '--mask-right-sharp': style.maskRightSharp / 100 } : {}),
    ...(style.maskBottomSharp != null ? { '--mask-bottom-sharp': style.maskBottomSharp / 100 } : {}),
    ...(style.maskLeftSharp != null ? { '--mask-left-sharp': style.maskLeftSharp / 100 } : {}),
    ...buildTextSlotVars(style.textSlots ?? {}),
  }), [bg, build.rail.accent, opacity, style])

  // the showcase sets its card's look as inherited variables on the card itself; a look changed in place removes the
  // variables it does not set
  const applied = useRef<string[]>([])
  useLayoutEffect(() => {
    const card = cardRef.current
    if (!card) return
    for (const key of applied.current) if (!(key in railStyle)) card.style.removeProperty(key)
    for (const [key, value] of Object.entries(railStyle)) card.style.setProperty(key, String(value))
    applied.current = Object.keys(railStyle)
    card.dispatchEvent(new Event('showcase:appearance'))
  }, [railStyle])

  useEffect(() => {
    const families = collectCardFontFamilies({ displayFont: style.displayFont, monoFont: style.monoFont, textSlots: style.textSlots ?? {} })
    if (!families.length) return
    ensureShowcaseFonts()
    for (const family of families) ensureGoogleFamily(family)
    cardRef.current?.dispatchEvent(new Event('showcase:typography'))
  }, [style.displayFont, style.monoFont, style.textSlots])

  const backdropStyle = useMemo<CssVars>(() => ({
    '--asset-base-opacity': (style.backdropOpacity ?? 67) / 100,
    '--asset-base-filter': `blur(${(((style.backdropBlur ?? 30) / 100) * 20).toFixed(1)}px) saturate(1.3)`,
    ...(backdrop ? { backgroundImage: `url("${backdrop}")` } : {}),
    backgroundSize: `${(style.backdropScale ?? 67) * 3}%`,
    backgroundPosition: `${style.backdropX ?? (style.backdropY == null ? 20 : 50)}% ${style.backdropY ?? (style.backdropX == null ? 50 : 28)}%`,
  }), [backdrop, style.backdropBlur, style.backdropOpacity, style.backdropScale, style.backdropX, style.backdropY])

  // the sliders sit at 50 for the resonator's own spine placement
  const placement = useMemo(() => {
    const base = getEvaluationSpinePlacement(resId)
    return {
      x: base.x - (((style.portraitX ?? 50) - 50) / 50) * 800,
      y: base.y - (((style.portraitY ?? 50) - 50) / 50) * 800,
      scale: base.scale * (0.5 + (style.portraitScale ?? 50) / 100),
    }
  }, [resId, style.portraitX, style.portraitY, style.portraitScale])

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
        cardHidden={hidden}
        railStyle={railStyle}
        backdropStyle={backdropStyle}
        statsColumn={style.statsColumn ?? 'build'}
        portraitCredit={style.portraitCredit}
        backdropCredit={style.backdropCredit}
        resolvedPortrait={portrait}
        animatedPortraits
        editable={false}
        showcasePlacement={placement}
        score={score}
        grade={getBuildEvaluationGrade(score)}
        tone={tone}
        showcaseBuild={build.showcase}
        showcaseAvgDamage={damage}
        autoImageContrast={style.text == null}
        layout="seal"
        holder={holder}
      />
    </div></div></div>
  )
}
