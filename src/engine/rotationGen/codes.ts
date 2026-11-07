/*
  Author: Runor Ewhro
  description: defines event, cast, and damage codes shared with authored rules.
*/

import type { RuntimeValue } from './types.ts'
// stable codes shared by authored kits and their editor projection.
export const codes: RuntimeValue = {
  event: { cast: 0, hit: 1, mechanic: 2, heal: 3 },
  cast: {
    basic: 0, heavy: 1, skill: 2, liberation: 3, intro: 4, outro: 5,
    echo: 6, dodgeCounter: 7, tuneBreak: 8, dodge: 9, dash: 10,
  },
  damage: {
    basic: 0, heavy: 1, skill: 2, liberation: 3, intro: 4, outro: 5,
    echo: 6, tuneBreak: 7, tuneRupture: 8, tuneHack: 9, utility: 10,
    status: 11,
  },
}
