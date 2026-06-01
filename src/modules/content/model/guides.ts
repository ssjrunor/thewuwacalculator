/*
  Author: Runor Ewhro
  Description: Shared guide-page helpers for resolving category targets and
               building stable lookup keys for authored guide content.
*/

import type { GuideCategory } from '@/data/content/guidesContent'

function normGdKey(value: string): string {
  // category ids, titles, and aliases all collapse through the same slugging
  // path so route params and search hits resolve against one stable key space.
  return value
    .trim()
    .toLowerCase()
    .replace(/layer/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function mkGdCtgrLkp(categories: GuideCategory[]): Record<string, GuideCategory> {
  const entries: Array<[string, GuideCategory]> = []

  for (const category of categories) {
    // accept both authored ids and human-facing titles so links can remain
    // stable even if callers mix canonical and display-oriented inputs.
    entries.push([normGdKey(category.id), category])
    entries.push([normGdKey(category.title), category])

    for (const alias of category.aliases ?? []) {
      entries.push([normGdKey(alias), category])
    }
  }

  return Object.fromEntries(entries)
}

export function resGdCtgr(categories: GuideCategory[], rawCategory: string | null | undefined) {
  if (!rawCategory) return null

  const lookup = mkGdCtgrLkp(categories)
  return lookup[normGdKey(rawCategory)] ?? null
}
