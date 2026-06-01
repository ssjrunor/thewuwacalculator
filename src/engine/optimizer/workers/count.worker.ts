/*
  Author: Runor Ewhro
  Description: Worker entrypoint for counting optimizer combinations
               off the main thread and returning the total count.
*/

import type { EchoInstance } from '@/domain/entities/runtime.ts'
import { countOptCombos, type OptCntMode } from '../search/counting.ts'

// message sent from the main thread to start a count job
export interface CntWrkrStart {
  type: 'start'
  payload: {
    echoes: EchoInstance[]
    lockedMainId: string | null
    countMode?: OptCntMode
  }
}

// message sent back to the main thread once counting is complete
export interface CntWrkrDoneM {
  type: 'done'
  payload: {
    total: number
  }
}

// all supported inbound worker messages
export type CntWrkrInMsg = CntWrkrStart

// handle one count request and immediately return the computed total
self.onmessage = (event: MessageEvent<CntWrkrInMsg>) => {
  const message = event.data

  const response: CntWrkrDoneM = {
    type: 'done',
    payload: {
      total: countOptCombos(
          message.payload.echoes,
          message.payload.lockedMainId,
          message.payload.countMode ?? 'rows',
      ),
    },
  }

  self.postMessage(response)
}
