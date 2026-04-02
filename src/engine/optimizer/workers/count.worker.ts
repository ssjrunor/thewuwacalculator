/*
  Author: Runor Ewhro
  Description: Worker entrypoint for counting optimizer combinations
               off the main thread and returning the total count.
*/

import type { EchoInstance } from '@/domain/entities/runtime.ts'
import { countOptimizerCombinationsByMode, type OptimizerCountMode } from '../search/counting.ts'

// message sent from the main thread to start a count job
export interface CountWorkerStartMessage {
  type: 'start'
  payload: {
    echoes: EchoInstance[]
    lockedMainEchoId: string | null
    countMode?: OptimizerCountMode
  }
}

// message sent back to the main thread once counting is complete
export interface CountWorkerDoneMessage {
  type: 'done'
  payload: {
    total: number
  }
}

// all supported inbound worker messages
export type CountWorkerInMessage = CountWorkerStartMessage

// handle one count request and immediately return the computed total
self.onmessage = (event: MessageEvent<CountWorkerInMessage>) => {
  const message = event.data

  const response: CountWorkerDoneMessage = {
    type: 'done',
    payload: {
      total: countOptimizerCombinationsByMode(
          message.payload.echoes,
          message.payload.lockedMainEchoId,
          message.payload.countMode ?? 'rows',
      ),
    },
  }

  self.postMessage(response)
}
