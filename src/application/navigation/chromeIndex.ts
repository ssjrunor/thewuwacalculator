/*
  Author: Runor Ewhro
  Description: Registers route-owned chrome stamp actions and restores the previous registration on cleanup.
*/

import { useOutletContext } from 'react-router-dom'

export interface ChromeIndexCtx {
  // what the head's stamp does on this route. null gives it back to the report.
  setStamp: (run: (() => void) | null) => void
}

export function useChromeIndex(): ChromeIndexCtx {
  return useOutletContext<ChromeIndexCtx>()
}
