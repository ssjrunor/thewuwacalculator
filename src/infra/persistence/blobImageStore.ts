const DB_NAME = 'WuWaCalculatorImageStore'
const STORE_NAME = 'images'
const DB_VERSION = 1

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME)
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

// stores an image blob under a stable key for later reuse.
export async function saveImageBlob(key: string, blob: Blob): Promise<void> {
  const database = await openDatabase()

  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    const store = transaction.objectStore(STORE_NAME)
    store.put(blob, key)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
  })
}

// loads an image blob by key and returns null when no cached entry exists.
export async function loadImageBlob(key: string): Promise<Blob | null> {
  const database = await openDatabase()

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readonly')
    const store = transaction.objectStore(STORE_NAME)
    const request = store.get(key)
    request.onsuccess = () => resolve((request.result as Blob | undefined) ?? null)
    request.onerror = () => reject(request.error)
  })
}
