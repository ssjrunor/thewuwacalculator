/*
  Author: Runor Ewhro
  description: counts distinct Echo identities within each equipped Sonata set.
*/

// count equipped pieces per sonata, with a repeated echo id counted once within a sonata and once toward each sonata
// it is assigned to; e.g. hyvatia+glamoth on set a plus hyvatia+glamoth on set b yields 2pc + 2pc
export function countEchoSets(echoes: ReadonlyArray<{ id: string | number; set: number } | null>): Record<string, number> {
  const counts: Record<string, number> = {}
  const seenIdsBySet: Record<string, Set<string>> = {}

  for (const echo of echoes) {
    if (!echo) continue

    const key = String(echo.set)
    const seenIds = seenIdsBySet[key] ?? (seenIdsBySet[key] = new Set<string>())
    const id = String(echo.id)
    if (seenIds.has(id)) continue

    seenIds.add(id)
    counts[key] = (counts[key] ?? 0) + 1
  }

  return counts
}
