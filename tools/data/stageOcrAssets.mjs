/*
  Author: Runor Ewhro
  description: stages the card reader's tesseract worker, core and language data
               under public/ so a card import doesn't depend on a cdn.
*/

import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const ocrDir = join(root, 'public', 'assets', 'app', 'ocr')

// the worker and core come from node_modules, so they always match the installed tesseract.js
const STAGED = [
  ['tesseract.js/dist/worker.min.js', 'worker.min.js'],
  ['tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js'],
  ['tesseract.js-core/tesseract-core-lstm.wasm.js', 'tesseract-core-lstm.wasm.js'],
]

// @tesseract.js-data/eng@1.0.0 4.0.0_best_int, the file tesseract.js fetched by default;
// a different model reads different text, so a swap has to pass the import bench first
const LANGUAGE_DATA = {
  file: 'eng.traineddata.gz',
  sha256: '45b4cb346724ac1774f1c36f42f182b887bcdb28ebe63e6fff90ac41f3fcff91',
}

export async function stageOcrAssets() {
  await mkdir(ocrDir, { recursive: true })
  for (const [from, to] of STAGED) {
    await copyFile(join(root, 'node_modules', from), join(ocrDir, to))
  }

  const data = await readFile(join(ocrDir, LANGUAGE_DATA.file))
  const digest = createHash('sha256').update(data).digest('hex')
  if (digest !== LANGUAGE_DATA.sha256) {
    throw new Error(`${LANGUAGE_DATA.file} sha256 ${digest} does not match the pinned ${LANGUAGE_DATA.sha256}`)
  }
}
