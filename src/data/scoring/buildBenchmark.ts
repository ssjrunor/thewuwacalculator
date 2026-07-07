/*
  Author: Runor Ewhro
  Description: exposes the build benchmark entry points from one stable import
               surface so ui code does not need to know the benchmark folder
               layout.
*/

export * from './benchmark/types.ts'
export { GRADE_LADDER } from './benchmark/stats.ts'
export { buildBenchmark } from './benchmark/search.ts'
export { buildBenchmarkFeatureBreakdown } from './benchmark/features.ts'
export {
  buildBenchmarkAlternatives, buildBenchmarkReport,
  rotationBuildBenchmark, rotationBuildBenchmarkReport, getDefaultRotationBenchmarkScore,
  getRotScore, logBuildBenchmarkResult, logActiveBuildBenchmark,
  ensureAnchorStoreHydrated,
} from './benchmark/report.ts'
export type { DefaultRotationBenchmarkResult } from './benchmark/report.ts'
