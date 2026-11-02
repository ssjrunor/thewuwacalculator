/*
  Author: Runor Ewhro
  description: consolidates the retired Nameless Explorer stack counter into
               shared Tune Strain at persistence and rotation import boundaries.
*/

const LEGACY_TUNE_STRAIN = 'tuneStrainInterfered'

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function migrateLegacyEnemyProfile<T>(value: T): T {
  if (!isRecord(value) || !isRecord(value.status)
    || !Object.hasOwn(value.status, LEGACY_TUNE_STRAIN)) return value

  const status = { ...value.status }
  const legacy = status[LEGACY_TUNE_STRAIN]
  const count = typeof legacy === 'number' || (typeof legacy === 'string' && legacy.trim() !== '')
    ? Number(legacy) : 0
  const legacyStacks = Number.isFinite(count) ? Math.max(0, count) : 0
  const current = status.tuneStrain
  // both fields store the same count; retain the larger valid value and let the
  // persistence schema reject an invalid canonical field.
  status.tuneStrain = current === undefined ? legacyStacks
    : typeof current === 'number' && Number.isFinite(current)
      ? Math.max(current, legacyStacks) : current
  delete status[LEGACY_TUNE_STRAIN]
  return { ...value, status } as T
}

/** rewrite exact legacy paths throughout nested rotation and effect data. */
export function migrateLegacyEnemyStatePaths<T>(value: T): T {
  if (Array.isArray(value)) return value.map(migrateLegacyEnemyStatePaths) as T
  if (!isRecord(value)) return value
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [
    key,
    key === 'path' && typeof child === 'string'
      ? child.replace(/^(context\.)?enemy\.status\.tuneStrainInterfered$/, '$1enemy.status.tuneStrain')
      : migrateLegacyEnemyStatePaths(child),
  ])) as T
}
