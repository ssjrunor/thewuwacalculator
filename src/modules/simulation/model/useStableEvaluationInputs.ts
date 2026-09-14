/*
  Author: Runor Ewhro
  Description: Retains evaluation input references while their normalized
               values are unchanged so unrelated scenario edits do not restart
               deferred scoring work.
*/

import { useMemo } from 'react'
import { makeEvaluationKey } from '@/data/scoring/buildEvaluationKey.ts'

export function useStableEvaluationInputs<T>(value: T): T {
  const key = useMemo(() => makeEvaluationKey(value), [value])
  // The normalized key deliberately owns this memo boundary. Fresh scenario
  // projection objects with the same key must not become hook dependencies.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => value, [key])
}
