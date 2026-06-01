/*
  Author: Runor Ewhro
  Description: Backward-compatible wrapper around the shared legacy echo
               import helpers used by the full v1 app-state importer.
*/

export type {
  LegInvEchoMp as LegacyInventoryEchoImportResult,
} from '@/domain/services/legacyAppStateImport/echoes'
export {
  mprtLegInvEc as importLegacyInventoryEchoJson,
} from '@/domain/services/legacyAppStateImport/echoes'
