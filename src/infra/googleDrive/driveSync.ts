import { refreshGoogleAccessTokenIfNeeded } from '@/infra/googleDrive/googleAuth'

const GOOGLE_DRIVE_BACKUP_PREFIX = 'thewuwacalculator-snapshot-'
const GOOGLE_DRIVE_SPACES = 'appDataFolder'
const MAX_DRIVE_BACKUPS = 10

interface DriveFileEntry {
  id: string
  name: string
  createdTime?: string
}

interface DriveFileListResponse {
  files?: DriveFileEntry[]
}

interface DriveSyncResult {
  fileName: string
  createdTime?: string
}

interface DriveRestoreResult extends DriveSyncResult {
  raw: string
}

async function withAccessToken(
  accessToken: string,
  action: (token: string) => Promise<Response>,
): Promise<Response> {
  const resolvedToken = await refreshGoogleAccessTokenIfNeeded(accessToken) ?? accessToken
  const response = await action(resolvedToken)

  if (response.status !== 401) {
    return response
  }

  const refreshedToken = await refreshGoogleAccessTokenIfNeeded()
  if (!refreshedToken) {
    return response
  }

  return action(refreshedToken)
}

async function listBackupFiles(accessToken: string): Promise<DriveFileEntry[]> {
  const query = encodeURIComponent(`name contains '${GOOGLE_DRIVE_BACKUP_PREFIX}' and '${GOOGLE_DRIVE_SPACES}' in parents`)
  const response = await withAccessToken(
    accessToken,
    (token) =>
      fetch(
        `https://www.googleapis.com/drive/v3/files?q=${query}&spaces=${GOOGLE_DRIVE_SPACES}&fields=files(id,name,createdTime)&orderBy=createdTime desc`,
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

  const payload = await response.json() as DriveFileListResponse
  return payload.files ?? []
}

async function deleteBackupFile(fileId: string, accessToken: string): Promise<void> {
  const response = await withAccessToken(
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

async function pruneOldBackups(accessToken: string): Promise<void> {
  const files = await listBackupFiles(accessToken)
  const staleFiles = files.slice(MAX_DRIVE_BACKUPS)

  for (const file of staleFiles) {
    await deleteBackupFile(file.id, accessToken)
  }
}

// uploads the current persisted snapshot into google drive appdata storage.
export async function uploadSnapshotToDrive(accessToken: string, rawSnapshot: string): Promise<DriveSyncResult> {
  const fileName = `${GOOGLE_DRIVE_BACKUP_PREFIX}${new Date().toISOString()}.json`
  const metadata = {
    name: fileName,
    mimeType: 'application/json',
    parents: [GOOGLE_DRIVE_SPACES],
  }

  const form = new FormData()
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }))
  form.append('file', new Blob([rawSnapshot], { type: 'application/json' }))

  const response = await withAccessToken(
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

  await pruneOldBackups(accessToken)
  return { fileName }
}

// downloads the latest drive snapshot so the caller can validate and hydrate it.
export async function restoreLatestSnapshotFromDrive(accessToken: string): Promise<DriveRestoreResult | null> {
  const [latestFile] = await listBackupFiles(accessToken)
  if (!latestFile) {
    return null
  }

  const response = await withAccessToken(
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
