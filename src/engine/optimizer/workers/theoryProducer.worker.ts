/*
  Author: Runor Ewhro
  description: boots the theory producer worker implemented by
               theoryProducerHandler.
*/

/// <reference lib="webworker" />

// Safari evaluates a module worker's entry a second time when one of its
// chunks imports from it, and that copy's module state starts empty. the entry
// imports nothing, so the handler and its data stores live in ordinary chunks.
const handler = import('./theoryProducerHandler')

// a failed import only rejects in here, where the owner never hears of it.
// rethrown from a task it reaches the owner's Worker as an error event, once
// per message so a waiting request is always there to receive it.
self.onmessage = (event) => {
  void handler.then(
    (module) => module.handleMessage(event),
    (error: unknown) => { setTimeout(() => { throw error }) },
  )
}
