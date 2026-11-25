/*
  Author: Runor Ewhro
  description: re-exports the shared rotation cleanup for the program editor.
*/

export {
  applyRotationCleanup,
  cleanupCounts,
  describeRotationCleanup,
  planRotationCleanup,
} from '@/engine/rotation/cleanup.ts'
export type {
  CleanupCounts,
  CleanupPlan,
  CleanupReason,
  CleanupSourceContext,
  CleanupTarget,
} from '@/engine/rotation/cleanup.ts'
