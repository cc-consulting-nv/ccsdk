/**
 * Blob persistence for resumable uploads.
 *
 * Persists File/Blob alongside upload metadata so a multipart upload can
 * resume across browser refreshes without forcing the user to re-pick the
 * same file.
 *
 * @module blobStore
 * @category Uploads
 */

/**
 * Storage backend for upload blobs.
 *
 * Implementations must return the same File (name, type, size) on get()
 * that was passed to put().
 *
 * @category Uploads
 */
export interface BlobStore {
  put(id: string, file: File): Promise<void>;
  get(id: string): Promise<File | null>;
  delete(id: string): Promise<void>;
  list(): Promise<string[]>;
}

interface StoredBlobRecord {
  id: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  blob: Blob;
  storedAt: number;
}

/**
 * IndexedDB-backed BlobStore. Default for browser environments.
 *
 * @category Uploads
 */
export class IndexedDBBlobStore implements BlobStore {
  private readonly dbName: string;
  private readonly storeName: string;
  private readonly dbVersion: number;

  constructor(options: { dbName?: string; storeName?: string; dbVersion?: number } = {}) {
    this.dbName = options.dbName ?? "ccsdk_upload_blobs";
    this.storeName = options.storeName ?? "blobs";
    this.dbVersion = options.dbVersion ?? 1;
  }

  private isAvailable(): boolean {
    return typeof indexedDB !== "undefined";
  }

  private openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.dbName, this.dbVersion);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName, { keyPath: "id" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error("Failed to open IDB"));
    });
  }

  async put(id: string, file: File): Promise<void> {
    if (!this.isAvailable()) return;
    try {
      const db = await this.openDb();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(this.storeName, "readwrite");
        const record: StoredBlobRecord = {
          id,
          fileName: file.name,
          fileType: file.type,
          fileSize: file.size,
          blob: file,
          storedAt: Date.now(),
        };
        tx.objectStore(this.storeName).put(record);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error("IDB put failed"));
      });
      db.close();
    } catch (err) {
      console.warn("[IndexedDBBlobStore] put failed:", err);
    }
  }

  async get(id: string): Promise<File | null> {
    if (!this.isAvailable()) return null;
    try {
      const db = await this.openDb();
      const record = await new Promise<StoredBlobRecord | undefined>((resolve, reject) => {
        const tx = db.transaction(this.storeName, "readonly");
        const req = tx.objectStore(this.storeName).get(id);
        req.onsuccess = () => resolve(req.result as StoredBlobRecord | undefined);
        req.onerror = () => reject(req.error ?? new Error("IDB get failed"));
      });
      db.close();
      if (!record) return null;
      return new File([record.blob], record.fileName, {
        type: record.fileType,
        lastModified: record.storedAt,
      });
    } catch (err) {
      console.warn("[IndexedDBBlobStore] get failed:", err);
      return null;
    }
  }

  async delete(id: string): Promise<void> {
    if (!this.isAvailable()) return;
    try {
      const db = await this.openDb();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(this.storeName, "readwrite");
        tx.objectStore(this.storeName).delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error("IDB delete failed"));
      });
      db.close();
    } catch (err) {
      console.warn("[IndexedDBBlobStore] delete failed:", err);
    }
  }

  async list(): Promise<string[]> {
    if (!this.isAvailable()) return [];
    try {
      const db = await this.openDb();
      const ids = await new Promise<string[]>((resolve, reject) => {
        const tx = db.transaction(this.storeName, "readonly");
        const req = tx.objectStore(this.storeName).getAllKeys();
        req.onsuccess = () => resolve((req.result as IDBValidKey[]).map((k) => String(k)));
        req.onerror = () => reject(req.error ?? new Error("IDB list failed"));
      });
      db.close();
      return ids;
    } catch (err) {
      console.warn("[IndexedDBBlobStore] list failed:", err);
      return [];
    }
  }
}

/**
 * In-memory BlobStore. Useful for tests or environments without IndexedDB.
 *
 * @category Uploads
 */
export class MemoryBlobStore implements BlobStore {
  private readonly entries = new Map<string, File>();

  async put(id: string, file: File): Promise<void> {
    this.entries.set(id, file);
  }

  async get(id: string): Promise<File | null> {
    return this.entries.get(id) ?? null;
  }

  async delete(id: string): Promise<void> {
    this.entries.delete(id);
  }

  async list(): Promise<string[]> {
    return Array.from(this.entries.keys());
  }
}
