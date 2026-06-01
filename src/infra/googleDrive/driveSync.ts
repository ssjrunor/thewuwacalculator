/*
  Author: Runor Ewhro
  Description: Uploads and restores persisted app snapshots through google
               drive appdata storage, including backup pruning.
*/

import { rfrsGglCcssT } from '@/infra/googleDrive/googleAuth'

const DRIVE_FILE_PRE = 'thewuwacalculator-snapshot-'
const DRIVE_SPACE = 'appDataFolder'
const MAX_DRIVE_FILES = 10

interface DrvFileEnt {
  id: string
  name: string
  createdTime?: string
}

interface DrvFileListR {
  files?: DrvFileEnt[]
}

interface DrvSyncRslt {
  fileName: string
  createdTime?: string
}

interface DrvRstrRslt extends DrvSyncRslt {
  raw: string
}

async function withCcssTkn(
  accessToken: string,
  action: (token: string) => Promise<Response>,
): Promise<Response> {
  // try with the caller's token first, then retry once with a freshly
  // refreshed token if the request comes back unauthorized.
  const rslvTkn = await rfrsGglCcssT(accessToken) ?? accessToken
  const response = await action(rslvTkn)

  if (response.status !== 401) {
    return response
  }

  const rfrsTkn = await rfrsGglCcssT()
  if (!rfrsTkn) {
    return response
  }

  return action(rfrsTkn)
}

async function listBckpFls(accessToken: string): Promise<DrvFileEnt[]> {
  const query = encodeURIComponent(`name contains '${DRIVE_FILE_PRE}' and '${DRIVE_SPACE}' in parents`)
  const response = await withCcssTkn(
    accessToken,
    (token) =>
      fetch(
        `https://www.googleapis.com/drive/v3/files?q=${query}&spaces=${DRIVE_SPACE}&fields=files(id,name,createdTime)&orderBy=createdTime desc`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      ),
  )

  if (!response.ok) {
    throw new Error('Failed to list Google Drive backups.')
  }

  const payload = await response.json() as DrvFileListR
  return payload.files ?? []
}

async function dltBckpFile(fileId: string, accessToken: string): Promise<void> {
  const response = await withCcssTkn(
    accessToken,
    (token) =>
      fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }),
  )

  if (!response.ok) {
    throw new Error('Failed to prune old Google Drive backups.')
  }
}

async function prnOldBckp(accessToken: string): Promise<void> {
  const files = await listBckpFls(accessToken)
  const staleFiles = files.slice(MAX_DRIVE_FILES)

  // prune oldest-first after the newest keep window so appdata storage does
  // not grow without bound.
  for (const file of staleFiles) {
    await dltBckpFile(file.id, accessToken)
  }
}

// uploads the current persisted snapshot into google drive appdata storage.
export async function pldSnapToDrv(accessToken: string, rawSnapshot: string): Promise<DrvSyncRslt> {
  const fileName = `${DRIVE_FILE_PRE}${new Date().toISOString()}.json`
  const metadata = {
    name: fileName,
    mimeType: 'application/json',
    parents: [DRIVE_SPACE],
  }

  const form = new FormData()
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }))
  form.append('file', new Blob([rawSnapshot], { type: 'application/json' }))

  const response = await withCcssTkn(
    accessToken,
    (token) =>
      fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: form,
      }),
  )

  if (!response.ok) {
    throw new Error('Failed to upload the snapshot to Google Drive.')
  }

  await prnOldBckp(accessToken)
  return { fileName }
}

// downloads the latest drive snapshot so the caller can validate and hydrate it.
export async function rstrLtstSnap(accessToken: string): Promise<DrvRstrRslt | null> {
  const [latestFile] = await listBckpFls(accessToken)
  if (!latestFile) {
    return null
  }

  const response = await withCcssTkn(
    accessToken,
    (token) =>
      fetch(`https://www.googleapis.com/drive/v3/files/${latestFile.id}?alt=media`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }),
  )

  if (!response.ok) {
    throw new Error('Failed to download the latest Google Drive snapshot.')
  }

  return {
    fileName: latestFile.name,
    createdTime: latestFile.createdTime,
    raw: await response.text(),
  }
}
