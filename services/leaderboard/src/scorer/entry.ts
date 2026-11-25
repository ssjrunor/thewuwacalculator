/*
  Author: Runor Ewhro
  description: the scorer worker's module entry. workerd treats every named
               export of the entry as an entrypoint, so this exports only the
               handler, and worker.ts exports its helpers for tests.
*/

export { default } from './worker.ts'
