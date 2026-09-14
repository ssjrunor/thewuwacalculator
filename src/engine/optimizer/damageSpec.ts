/*
  Author: Runor Ewhro
  Description: Implements the damageSpec logic for the optimizer module.
*/

/* Canonical scalar damage primitives mirrored into generated WGSL source. */

export function optimizerAverageDamage(normal: number, critRate: number, critDamage: number): number {
  const rate = Math.max(0, Math.min(1, critRate))
  return normal * (1 + rate * (critDamage - 1))
}

const OPTIMIZER_DAMAGE_SPEC_WGSL = /* wgsl */ `
fn optimizerAverageDamage(normal: f32, critRate: f32, critDamage: f32) -> f32 {
    let rate = clamp(critRate, 0.0, 1.0);
    return normal * (1.0 + rate * (critDamage - 1.0));
}
`

export function withOptimizerDamageSpec(shader: string): string {
  return `${OPTIMIZER_DAMAGE_SPEC_WGSL}\n${shader}`
}
