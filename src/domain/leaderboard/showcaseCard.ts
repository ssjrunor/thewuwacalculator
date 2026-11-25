/*
  Author: Runor Ewhro
  description: showcase card customization: its style (colours, fonts, portrait
               and backdrop framing, per-text slots) and hidden parts. the app
               stores one per resonator, as does the leaderboard (documents.ts
               lists the allowed values).
*/

import * as z from 'zod/mini'

export const showcaseCardSchema = z.lazy(() => z.object({
  style: z.object({
    accent: z._default(z.nullable(z.string()), null),
    surface: z._default(z.nullable(z.string()), null),
    text: z._default(z.nullable(z.string()), null),
    opacity: z._default(z.nullable(z.number()), null),
    displayFont: z._default(z.nullable(z.string()), null),
    monoFont: z._default(z.nullable(z.string()), null),
    portraitX: z._default(z.nullable(z.number()), null),
    portraitY: z._default(z.nullable(z.number()), null),
    portraitScale: z._default(z.nullable(z.number()), null),
    maskTop: z._default(z.nullable(z.number()), null),
    maskRight: z._default(z.nullable(z.number()), null),
    maskBottom: z._default(z.nullable(z.number()), null),
    maskLeft: z._default(z.nullable(z.number()), null),
    maskTopSharp: z._default(z.nullable(z.number()), null),
    maskRightSharp: z._default(z.nullable(z.number()), null),
    maskBottomSharp: z._default(z.nullable(z.number()), null),
    maskLeftSharp: z._default(z.nullable(z.number()), null),
    backdropBlur: z._default(z.nullable(z.number()), null),
    backdropOpacity: z._default(z.nullable(z.number()), null),
    backdropX: z._default(z.nullable(z.number()), null),
    backdropY: z._default(z.nullable(z.number()), null),
    backdropScale: z._default(z.nullable(z.number()), null),
    portraitImage: z._default(z.nullable(z.string()), null),
    backdropImage: z._default(z.nullable(z.string()), null),
    portraitCredit: z._default(z.nullable(z.string()), null),
    backdropCredit: z._default(z.nullable(z.string()), null),
    statsColumn: z._default(z.nullable(z.enum(['build', 'combat', 'both'])), null),
    textSlots: z._default(z.record(
      z.string(),
      z.object({
        color: z._default(z.nullable(z.string()), null),
        font: z._default(z.nullable(z.string()), null),
        size: z._default(z.nullable(z.number()), null),
        weight: z._default(z.nullable(z.number()), null),
        spacing: z._default(z.nullable(z.number()), null),
        transform: z._default(z.nullable(z.enum(['none', 'uppercase', 'lowercase', 'capitalize'])), null),
      }),
    ), {}),
    customCss: z._default(z.nullable(z.string()), null),
  }),
  hidden: z.object({
    score: z._default(z.boolean(), false),
    damage: z._default(z.boolean(), false),
    cv: z._default(z.boolean(), false),
    team: z._default(z.boolean(), false),
    brand: z._default(z.boolean(), false),
    portraitCredit: z._default(z.boolean(), false),
    backdropCredit: z._default(z.boolean(), false),
    seqRail: z._default(z.boolean(), false),
    subVal: z._default(z.boolean(), false),
    subColor: z._default(z.boolean(), false),
    relStats: z._default(z.boolean(), true),
  }),
}))
