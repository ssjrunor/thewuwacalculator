import { WPNTYPETOKEY } from '@/modules/calculator/features/resonator/lib/resonator.ts'

export function getWpnVisKey(weaponType: number | null | undefined): string | null {
  if (weaponType == null) {
    return null
  }

  return WPNTYPETOKEY[weaponType as keyof typeof WPNTYPETOKEY] ?? null
}
