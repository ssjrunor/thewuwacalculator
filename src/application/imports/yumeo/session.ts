/*
  Author: Runor Ewhro
  description: prepares Yumeo exports for review and applies selected changes.
*/

import { applyPreparedYumeoGameData, prepareYumeoGameData } from '@/application/imports/yumeoGameData'
import type { YumeoGameDataImportChoices, PreparedYumeoGameData } from '@/application/imports/yumeoGameData'
import { readAppFile } from '@/application/persistence/fileCodec'

export interface YumeoGameDataImportSession {
  kind: 'yumeoGameData'
  review: PreparedYumeoGameData['review']
  apply: (choices?: YumeoGameDataImportChoices) => ReturnType<typeof applyPreparedYumeoGameData>
}

export async function openYumeoGameDataImport(source: string | File): Promise<YumeoGameDataImportSession> {
  const prepared = await prepareYumeoGameData(typeof source === 'string' ? source : await readAppFile(source))
  return {
    kind: 'yumeoGameData',
    review: prepared.review,
    apply: (choices) => applyPreparedYumeoGameData(prepared, choices),
  }
}
