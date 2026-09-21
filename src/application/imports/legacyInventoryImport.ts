/*
  Author: Runor Ewhro
  Description: Backward-compatible wrapper around the shared legacy echo
               import helpers used by the full v1 app-state importer.
*/

export type {
  LegInvEchoMp as LegacyInventoryEchoImportResult,
} from '@/application/imports/legacy/echoes'
export {
  mprtLegInvEc as importLegacyInventoryEchoJson,
} from '@/application/imports/legacy/echoes'
