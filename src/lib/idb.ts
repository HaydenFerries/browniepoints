// A tiny key-value store on IndexedDB, for what the app keeps on the phone
// (the last synced state and changes waiting to sync). Falls back to memory
// when IndexedDB isn't available (some private browsing modes).
const DB_NAME = 'brownie-points';
const STORE = 'kv';

let opening: Promise<IDBDatabase | null> | null = null;
const memory = new Map<string, unknown>();

function open(): Promise<IDBDatabase | null> {
  opening ??= new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return opening;
}

function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T | undefined> {
  return open().then(
    (db) =>
      db
        ? new Promise((resolve) => {
            try {
              const req = fn(db.transaction(STORE, mode).objectStore(STORE));
              req.onsuccess = () => resolve(req.result as T);
              req.onerror = () => resolve(undefined);
            } catch {
              resolve(undefined);
            }
          })
        : undefined,
  );
}

export async function idbGet<T>(key: string): Promise<T | undefined> {
  const v = await run<T>('readonly', (s) => s.get(key));
  return v === undefined ? (memory.get(key) as T | undefined) : v;
}

export async function idbSet(key: string, value: unknown): Promise<void> {
  memory.set(key, value);
  await run('readwrite', (s) => s.put(value, key));
}

export async function idbDel(key: string): Promise<void> {
  memory.delete(key);
  await run('readwrite', (s) => s.delete(key));
}
