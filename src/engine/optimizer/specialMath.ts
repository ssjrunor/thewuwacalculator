/*
  Author: Runor Ewhro
  Description: Implements the specialMath logic for the optimizer module.
*/

/* Scalar special-case math shared by every TypeScript optimizer evaluator. */

export function countOneBits(x: number): number {
  let value = x >>> 0
  value = value - ((value >>> 1) & 0x55555555)
  value = (value & 0x33333333) + ((value >>> 2) & 0x33333333)
  return (((value + (value >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24
}

export function calcErToAtk(charId: number, finalER: number, toggle0: number): number {
  if (charId !== 1206) return 0
  const erOver = Math.max(0, finalER - 150)
  return toggle0 ? Math.min(erOver * 20, 2600) : Math.min(erOver * 12, 1560)
}

export function calcCritConvert(charId: number, sequence: number, critRateTotal: number): number {
  if (charId !== 1306 || sequence < 2) return 0
  let bonusCd = 0
  if (critRateTotal >= 1) bonusCd += Math.min((critRateTotal - 1) * 2, 1)
  if (sequence >= 6 && critRateTotal >= 1.5) bonusCd += Math.min((critRateTotal - 1.5) * 2, 0.5)
  return bonusCd
}

export function calcConvert(charId: number, finalER: number): number {
  return charId === 1412 && finalER > 125 ? Math.min((finalER - 125) * 2, 50) / 100 : 0
}

export function calcShoreCritRate(charId: number, finalER: number, innerOn: boolean): number {
  return charId === 1505 && innerOn ? Math.min(Math.max(0, finalER * 0.05), 12.5) / 100 : 0
}

export function calcShoreCritDmg(
    charId: number,
    finalER: number,
    innerOn: boolean,
    supernalOn: boolean,
): number {
  return charId === 1505 && innerOn && supernalOn
    ? Math.min(Math.max(0, finalER * 0.1), 25) / 100
    : 0
}

export function calcJingranAtk(
    charId: number,
    sequence: number,
    finalHp: number,
    everflowOn: boolean,
): number {
  if (charId !== 1212) return 0
  return sequence >= 3 && everflowOn
    ? Math.min(Math.max(0, finalHp * 0.05), 2500)
    : Math.min(Math.max(0, finalHp * 0.036), 1800)
}

export function calcJingranFusion(
    charId: number,
    finalHp: number,
    fortuneStacks: number,
): number {
  if (charId !== 1212) return 0
  return (
    Math.min(Math.max(0, finalHp * 0.0015), 75)
    + Math.min(Math.max(0, finalHp * 0.00005), 2.5) * Math.max(0, fortuneStacks)
  ) / 100
}
