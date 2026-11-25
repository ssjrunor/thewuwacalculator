/*
  Author: Runor Ewhro
  description: scorer thread count for a machine: one core is left for workerd
               and the api, and each thread gets 2 GB of the machine's memory, up
               to 6 threads. a thread measures about 0.5 GB at worst
               (2026-11-17: 30 MB heap with its session open, under 300 MB at the
               peak of the longest anchor search, the rest engine and isolate),
               with the margin for the browser, vite and workerd. an 8 GB, 8 core
               mac gets 4.
*/

export const THREAD_BYTES = 2 * 1024 ** 3
export const MAX_THREADS = 6

export const poolSize = (cores, memoryBytes) =>
  Math.max(1, Math.min(MAX_THREADS, cores - 1, Math.floor(memoryBytes / THREAD_BYTES)))
