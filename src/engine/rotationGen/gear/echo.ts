/*
  Author: Runor Ewhro
  description: selects equipped Echo actions and filters events by resonator.
*/

import type { RuntimeValue } from '../types'
export const echoAction = (echo: RuntimeValue, id: string | number): RuntimeValue => echo.actions?.[id] ?? null
// an event may name one owner or a list; both inclusion and exclusion constraints must pass.
export function eventAppliesToOwner(event: RuntimeValue, owner: number): boolean {
  const includes = (value: number | number[]) => Array.isArray(value) ? value.includes(owner) : value === owner
  return (event.ownerOnly == null || includes(event.ownerOnly)) && (event.ownerExcept == null || !includes(event.ownerExcept))
}
