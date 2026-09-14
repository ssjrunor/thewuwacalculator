/*
  Author: Runor Ewhro
  Description: Shared comma-token search helpers for echo-facing picker and
               inventory surfaces.
*/

function normSrchTxt(value: string): string {
  return value.toLowerCase().replace(/\s+/g, '')
}

export function mkSrchTkns(value: string): string[] {
  return value
    .split(',')
    .map(normSrchTxt)
    .filter(Boolean)
}

export function mtchSrchTkns(tokens: readonly string[], fields: readonly string[]): boolean {
  if (tokens.length === 0) {
    return true
  }

  const normalizedFields = fields.map(normSrchTxt).filter(Boolean)
  return tokens.every((token) => normalizedFields.some((field) => field.includes(token)))
}
