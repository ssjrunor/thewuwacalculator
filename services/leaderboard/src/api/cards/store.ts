/*
  Author: Runor Ewhro
  description: keeps card images in the private CARDS bucket, content-addressed
               by their sha-256 so two links to one image store it once.
*/

export async function storeCardImage(bucket: R2Bucket, key: string, bytes: Uint8Array<ArrayBuffer>,
  contentType: string): Promise<void> {
  if (await bucket.head(key)) return
  await bucket.put(key, bytes, { httpMetadata: { contentType } })
}

export async function loadCardImage(bucket: R2Bucket, key: string): Promise<Uint8Array<ArrayBuffer> | null> {
  const object = await bucket.get(key)
  return object ? new Uint8Array(await object.arrayBuffer()) : null
}

export async function deleteCardImages(bucket: R2Bucket, keys: string[]): Promise<void> {
  for (let start = 0; start < keys.length; start += 1000) await bucket.delete(keys.slice(start, start + 1000))
}
