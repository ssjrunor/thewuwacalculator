/*
  Author: Runor Ewhro
  Description: Keeps configuration edits in a local reducer-backed draft until
               the owning transient surface has finished closing.
*/

import { useCallback, useEffect, useRef, useState } from 'react'

export type ConfigurationReducer<T> = (current: T) => T

export interface ConfigurationTransaction<T> {
  read: () => T
  update: (reducer: ConfigurationReducer<T>) => T
  /** Full replacement; unlike update reducers, it does not merge later source changes. */
  replace: (next: T) => T
  finish: () => void
  reset: (source: T) => T
  isDirty: () => boolean
}

interface ConfigurationSessionOptions<T> {
  source: T
  active?: boolean
  clone?: (source: T) => T
  commit: (reducer: ConfigurationReducer<T>) => void
}

function identity<T>(value: T): T {
  return value
}

export function createConfigurationTransaction<T>(
  source: T,
  commit: (reducer: ConfigurationReducer<T>) => void,
  clone: (source: T) => T = structuredClone,
): ConfigurationTransaction<T> {
  let draft = clone(source)
  let reducer: ConfigurationReducer<T> = identity
  let dirty = false
  let finished = false

  const update = (nextReducer: ConfigurationReducer<T>) => {
    if (finished) return draft

    const next = nextReducer(draft)
    if (Object.is(draft, next)) return draft

    // Compose edits for replay against the latest committed source, rather than
    // replacing that source with a draft cloned before unrelated updates.
    const previousReducer = reducer
    reducer = (current) => nextReducer(previousReducer(current))
    draft = next
    dirty = true
    return draft
  }

  return {
    read: () => draft,
    update,
    replace: (next) => update(() => next),
    finish: () => {
      // Close callbacks and unmount cleanup may both finish the same transaction.
      if (finished) return
      finished = true
      if (dirty) commit(reducer)
    },
    reset: (nextSource) => {
      draft = clone(nextSource)
      reducer = identity
      dirty = false
      finished = false
      return draft
    },
    isDirty: () => dirty,
  }
}

export function useConfigurationSession<T>({
  source,
  active = true,
  clone = structuredClone,
  commit,
}: ConfigurationSessionOptions<T>) {
  // Keep the transaction stable while its eventual commit uses the latest owner.
  const commitRef = useRef(commit)
  commitRef.current = commit

  const transactionRef = useRef<ConfigurationTransaction<T> | null>(null)
  if (!transactionRef.current) {
    transactionRef.current = createConfigurationTransaction(
      source,
      (reducer) => commitRef.current(reducer),
      clone,
    )
  }
  const transaction = transactionRef.current
  const [draft, setDraft] = useState<T>(() => transaction.read())
  const activeRef = useRef(active)
  const mountGenerationRef = useRef(0)

  const update = useCallback((reducer: ConfigurationReducer<T>) => {
    setDraft(transaction.update(reducer))
  }, [transaction])

  const replace = useCallback((next: T) => {
    setDraft(transaction.replace(next))
  }, [transaction])

  const finish = useCallback(() => {
    transaction.finish()
  }, [transaction])

  useEffect(() => {
    const wasActive = activeRef.current
    activeRef.current = active

    if (!active && wasActive) {
      finish()
      return
    }
    // Source updates do not overwrite an active draft. Reopening seeds a new one.
    if (!active || wasActive) return

    setDraft(transaction.reset(source))
  }, [active, finish, source, transaction])

  useEffect(() => {
    mountGenerationRef.current += 1

    return () => {
      const cleanupGeneration = ++mountGenerationRef.current
      queueMicrotask(() => {
        // React Strict Mode immediately re-establishes effects after its
        // development cleanup. A genuine owner unmount has no later setup,
        // so it still flushes an open draft instead of silently discarding it.
        if (
          mountGenerationRef.current === cleanupGeneration
          && activeRef.current
        ) {
          transaction.finish()
        }
      })
    }
  }, [transaction])

  return {
    draft,
    update,
    replace,
    finish,
    get dirty() {
      return transaction.isDirty()
    },
  }
}
