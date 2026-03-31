/*
  Author: Runor Ewhro
  Description: Backward-compatible wrapper around the shared legacy echo
               import helpers used by the full v1 app-state importer.
*/

export type {
  LegacyInventoryEchoImportResult,
} from '@/domain/services/legacyAppStateImport/echoes'
export {
  importLegacyInventoryEchoJson,
} from '@/domain/services/legacyAppStateImport/echoes'
