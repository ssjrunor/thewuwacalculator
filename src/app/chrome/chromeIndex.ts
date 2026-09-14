/*
  Author: Runor Ewhro
  Description: What a route can reach back into the chrome for. It is one
               thing: the head's stamp. The stamp reads the app's condition on
               every route and opens the report to say the rest, but a page that
               carries that report itself would be opening a copy of what it is
               already showing you, so it takes the stamp for the length of the
               route and sends you to its own account instead.

               The state belongs to the chrome that draws it, so the page
               registers here rather than owning a head of its own, and hands it
               back when it leaves.
*/

import { useOutletContext } from 'react-router-dom'

export interface ChromeIndexCtx {
  // what the head's stamp does on this route. null gives it back to the report.
  setStamp: (run: (() => void) | null) => void
}

export function useChromeIndex(): ChromeIndexCtx {
  return useOutletContext<ChromeIndexCtx>()
}
