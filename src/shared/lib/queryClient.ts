/*
  Author: Runor Ewhro
  description: the app's single query cache (TanStack Query). every service read
               goes through it, keyed by its request: in-flight reads are shared,
               responses are cached while fresh and shown while a newer one loads,
               writes invalidate the keys they touch, and pages draw each region
               from its own key without one combined load.
*/

import { QueryClient } from '@tanstack/react-query'
import { shareKeepingTiming, watchQueryTiming } from './requestTiming'

/** the status of a service error response; 4xx errors are the caller's and are not retried. */
const statusOf = (error: unknown): number | null =>
  typeof error === 'object' && error != null && typeof (error as { status?: unknown }).status === 'number' ? (error as { status: number }).status : null

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // fresh time of a response; a remounted view (tab switch, back press) shows it without a refetch
      staleTime: 30_000,
      gcTime: 10 * 60_000,
      // a refused read is not asked again; a slow or failing service is, twice, a little later each time.
      retry: (count, error) => {
        const status = statusOf(error)
        return (status == null || status >= 500) && count < 2
      },
      retryDelay: (count) => Math.min(8_000, 1_000 * 2 ** count),
      // default structural sharing that preserves each response's timing for the timing logs
      structuralSharing: shareKeepingTiming,
    },
  },
})

// dev (or localStorage lb.timing = 1): one console line per read, from asking to drawing.
watchQueryTiming(queryClient.getQueryCache())
