/*
  Author: Runor Ewhro
  Description: Executes saved rotation simulations outside the main thread.
*/

import {
  runSavedRotationJob,
  type SavedRotationJob,
} from './simulation.ts'

interface SavedRotationWorkerRequest {
  requests: Array<{
    id: number
    job: SavedRotationJob
  }>
}

interface SavedRotationWorkerResult {
  id: number
  value?: ReturnType<typeof runSavedRotationJob>
  error?: string
}

self.onmessage = (event: MessageEvent<SavedRotationWorkerRequest>) => {
  const results: SavedRotationWorkerResult[] = event.data.requests.map(({ id, job }) => {
    try {
      const value = runSavedRotationJob(job)
      return { id, value }
    } catch (error) {
      return {
        id,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  })
  self.postMessage({ results })
}
