/*
  Author: Runor Ewhro
  Description: Loads and exposes the enemy catalog through a shared React
               hook with loading and error state handling.
*/

import { useEffect, useState } from 'react'
import type { EnemyCatalogEntry } from '@/domain/entities/enemy.ts'
import { loadEnemyCatalog } from '@/domain/services/enemyCatalogService.ts'

// load enemy catalog data for ui consumers
export function useEnemyCatalog() {
  const [catalog, setCatalog] = useState<EnemyCatalogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    loadEnemyCatalog()
        .then((entries) => {
          if (!cancelled) {
            setCatalog(entries)
          }
        })
        .catch((loadError) => {
          if (!cancelled) {
            setError(loadError instanceof Error ? loadError.message : 'Unable to load enemy catalog.')
          }
        })
        .finally(() => {
          if (!cancelled) {
            setLoading(false)
          }
        })

    return () => {
      cancelled = true
    }
  }, [])

  return { catalog, loading, error }
}