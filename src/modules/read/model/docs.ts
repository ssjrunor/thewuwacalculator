/*
  Author: Runor Ewhro
  Description: shared docs-page helpers for resolving method topics from route
               params and search hits against a stable, slugged key space.
*/

import type { DocTopic } from '@/data/content/docsContent'

function normDocKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function mkDocTopicLkp(topics: DocTopic[]): Record<string, DocTopic> {
  const entries: Array<[string, DocTopic]> = []

  for (const topic of topics) {
    entries.push([normDocKey(topic.id), topic])
    entries.push([normDocKey(topic.title), topic])
    for (const alias of topic.aliases ?? []) {
      entries.push([normDocKey(alias), topic])
    }
  }

  return Object.fromEntries(entries)
}

export function resDocTopic(topics: DocTopic[], rawTopic: string | null | undefined) {
  if (!rawTopic) return null
  const lookup = mkDocTopicLkp(topics)
  return lookup[normDocKey(rawTopic)] ?? null
}
