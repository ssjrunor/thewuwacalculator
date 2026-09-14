/*
  Author: Runor Ewhro
  Description: Isolates the temporary legacy Optimizer presentation so its
               route can be removed without changing the canonical tool.
*/

import { Optimizer } from '@/modules/simulation/features/optimizer/Optimizer'

export function LegacyOptimizerPage() {
  return <Optimizer variant="legacy" />
}
