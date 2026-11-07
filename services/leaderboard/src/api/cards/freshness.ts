/*
  Author: Runor Ewhro
  description: decides whether a card is fresh enough to act as a login. the
               bot only draws cards for the bound account, so a card first drawn
               minutes ago proves current control of the uid. kuro reuses the
               file for an unchanged build, so an old date proves nothing either
               way; the user must make the bot draw a new card.
*/

/** allowance for kuro's clock running ahead of ours. */
export const CLOCK_SKEW_MS = 60_000

export function cardAgeMs(lastModified: number, now: number): number {
  return now - lastModified
}

export function isFreshCard(lastModified: number, now: number, maxAgeSeconds: number): boolean {
  const age = cardAgeMs(lastModified, now)
  return age >= -CLOCK_SKEW_MS && age <= maxAgeSeconds * 1000
}
