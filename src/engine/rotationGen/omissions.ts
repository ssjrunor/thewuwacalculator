/*
  Author: Runor Ewhro
  description: records optional mechanics omitted by partial scoring without
               weakening strict authoring or package integrity checks.
*/

import type { RuntimeRecord, RuntimeValue } from './types'

// records an omission once per distinct code and detail; true when partial scoring is allowed and the caller skips
// the mechanic, false when the caller reports it as a failure
export function omit(context: RuntimeValue, code: string, detail: RuntimeRecord = {}): boolean {
  if (!context?.allowPartial) return false
  const entry = { code, ...detail }
  const omissions = context.omissions ??= []
  const key = JSON.stringify(entry)
  if (!omissions.some((prior: RuntimeRecord) => JSON.stringify(prior) === key)) omissions.push(entry)
  return true
}
