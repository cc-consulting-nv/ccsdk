/**
 * Multipart upload support for large file uploads to S3.
 *
 * This module provides a robust multipart upload implementation that handles
 * large file uploads with progress tracking, resumability, and concurrent
 * part uploads for optimal performance.
 *
 * @example
 * ```typescript
 * import { MultipartUpload } from '@social/cc-platform-sdk';
 *
 * const upload = new MultipartUpload(httpClient, {
 *   file: largeVideoFile,
 *   onProgress: (percent, uploaded, total) => {
 *     console.log(`Upload progress: ${percent.toFixed(1)}%`);
 *   },
 *   onComplete: (url) => {
 *     console.log('Upload complete:', url);
 *   },
 *   onError: (error) => {
 *     console.error('Upload failed:', error);
 *   },
 * });
 *
 * await upload.start();
 * ```
 *
 * @module multipartUpload
 * @category Uploads
 */
import type { HttpClient } from "./httpClient";
import { sanitizeFileName } from "./utils/s3Key";
import type { BlobStore } from "./blobStore";

/**
 * Detailed progress information for a multipart upload.
 *
 * @category Uploads
 */
export interface MultipartProgress {
  percentage: number;
  uploadedParts: number;
  totalParts: number;
  uploadedBytes: number;
  totalBytes: number;
}

/**
 * Context passed to the errorReporter callback when an upload fails.
 *
 * @category Uploads
 */
export interface MultipartErrorContext {
  fileName: string;
  fileType: string;
  fileSize: number;
  uploadId: string | null;
  key: string | null;
  partsCompleted: number;
  totalParts: number;
  phase: "initialize" | "getUrls" | "uploadPart" | "complete" | "abort" | "resume" | "unknown";
}

/**
 * Configuration options for multipart uploads.
 *
 * @category Uploads
 */
export interface MultipartUploadOptions {
  /** The file to upload */
  file: File;
  /** Optional S3 key (path) for the uploaded file */
  key?: string;
  /** Resume from existing uploadId */
  uploadId?: string;
  /** Already-completed part numbers (for resume) */
  completedParts?: number[];
  /**
   * Callback for upload progress updates.
   * Legacy 3-arg signature is preserved; prefer onByteProgress for byte-level updates.
   */
  onProgress?: (percentage: number, uploadedParts: number, totalParts: number) => void;
  /** Byte-level progress (includes in-flight part data). */
  onByteProgress?: (progress: MultipartProgress) => void;
  /** Callback when a single part completes */
  onPartComplete?: (partNumber: number, etag: string) => void;
  /** Callback when the entire upload completes */
  onComplete?: (location: string) => void;
  /** Callback when an error occurs */
  onError?: (error: Error) => void;
  /** Size of each part in bytes (default: 10MB) */
  partSize?: number;
  /** Maximum number of concurrent part uploads (default: 3) */
  maxConcurrentUploads?: number;
  /** Maximum retries per part before failing (default: 6) */
  partRetryLimit?: number;
  /**
   * Optional blob store. When supplied, the SDK persists the file on
   * `start()` and clears it on completion/abort, enabling refresh-resume.
   */
  blobStore?: BlobStore;
  /** Stable id used as the BlobStore key. Defaults to a generated id. */
  jobId?: string;
  /**
   * Wait for `online` event before retrying parts when navigator.onLine is
   * false. Defaults to true in the browser.
   */
  awaitOnline?: boolean;
  /**
   * Reports terminal errors with structured context, e.g. for Sentry.
   * Called in addition to onError.
   */
  errorReporter?: (err: Error, ctx: MultipartErrorContext) => void;
  /**
   * Notified when a presigned URL expires (HTTP 403/401) and is about
   * to be refreshed.
   */
  onPartUrlExpired?: (partNumber: number) => void;
}

/**
 * Single-URL refresh response from the API.
 *
 * @category Uploads
 */
export interface RefreshedUploadUrlResponse {
  url: string;
}

/**
 * Error class for expired presigned URLs (HTTP 403/401 from S3).
 *
 * @category Uploads
 */
export class PresignedUrlExpiredError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "PresignedUrlExpiredError";
  }
}

/**
 * Response from initializing a multipart upload.
 *
 * @category Uploads
 */
export interface InitializeUploadResponse {
  /** Unique identifier for this upload session */
  uploadId: string;
  /** S3 key (path) for the file */
  key: string;
  /** Size of each part in bytes */
  partSize: number;
}

/**
 * Map of part numbers to presigned upload URLs.
 *
 * @category Uploads
 */
export interface UploadUrlsResponse {
  /** Part number (1-indexed) mapped to presigned S3 URL */
  [partNumber: number]: string;
}

/**
 * Response when resuming a previously started upload.
 *
 * @category Uploads
 */
export interface ResumeUploadResponse {
  /** Unique identifier for this upload session */
  uploadId: string;
  /** S3 key (path) for the file */
  key: string;
  /** Size of each part in bytes */
  partSize: number;
  /** Array of part numbers that have already been uploaded */
  completedParts: number[];
}

/**
 * Final result of a completed upload.
 *
 * @category Uploads
 */
export interface UploadResult {
  /** Public URL of the uploaded file */
  url: string;
  /** S3 key (path) of the uploaded file */
  key?: string;
}

/**
 * Multipart upload handler for large files.
 *
 * Provides a robust implementation for uploading large files to S3 using
 * multipart uploads. Features include:
 *
 * - **Progress tracking**: Real-time progress callbacks
 * - **Concurrent uploads**: Upload multiple parts simultaneously for speed
 * - **Resume support**: Resume interrupted uploads
 * - **Retry logic**: Automatic retry with exponential backoff
 * - **Abort support**: Cancel uploads in progress
 *
 * @example
 * ```typescript
 * const upload = new MultipartUpload(httpClient, {
 *   file: videoFile,
 *   partSize: 20 * 1024 * 1024, // 20MB parts
 *   maxConcurrentUploads: 5,
 *   onProgress: (percent) => updateProgressBar(percent),
 *   onComplete: (url) => handleUploadComplete(url),
 *   onError: (err) => showError(err.message),
 * });
 *
 * // Start the upload
 * await upload.start();
 *
 * // Or pause and resume later
 * upload.pause();
 * // ... later ...
 * await upload.resume(upload.getUploadId(), upload.getKey());
 * ```
 *
 * @category Uploads
 */
export class MultipartUpload {
  private file: File;
  private client: HttpClient;
  private uploadId: string | null = null;
  private key: string | null = null;
  private partSize: number = 10 * 1024 * 1024; // 10MB
  private maxConcurrentUploads: number = 3;
  private partRetryLimit: number;
  private blobStore: BlobStore | null;
  private jobId: string;
  private awaitOnline: boolean;
  private onProgress: (percentage: number, uploadedParts: number, totalParts: number) => void;
  private onByteProgress: (progress: MultipartProgress) => void;
  private onComplete: (location: string) => void;
  private onError: (error: Error) => void;
  private onPartComplete: (partNumber: number, etag: string) => void;
  private onPartUrlExpired: (partNumber: number) => void;
  private errorReporter: (err: Error, ctx: MultipartErrorContext) => void;

  private totalParts: number;
  private uploadedParts: Set<number> = new Set();
  private inflightBytes: Map<number, number> = new Map();
  private uploading: boolean = false;
  private aborted: boolean = false;
  private uploadUrls: { [partNumber: number]: string } = {};
  private etags: { [partNumber: number]: string } = {};
  private activeXhrs: Set<XMLHttpRequest> = new Set();

  /**
   * Create a new MultipartUpload instance.
   *
   * @param client - The HttpClient instance for API calls
   * @param options - Upload configuration options
   */
  constructor(client: HttpClient, options: MultipartUploadOptions) {
    this.client = client;
    this.file = options.file;
    this.uploadId = options.uploadId ?? null;
    this.key = options.key || null;
    this.partSize = options.partSize || 10 * 1024 * 1024; // 10MB
    this.maxConcurrentUploads = options.maxConcurrentUploads || 3;
    this.partRetryLimit = options.partRetryLimit ?? 6;
    this.blobStore = options.blobStore ?? null;
    this.jobId = options.jobId ?? `up_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    this.awaitOnline = options.awaitOnline ?? true;
    this.onProgress = options.onProgress || (() => {});
    this.onByteProgress = options.onByteProgress || (() => {});
    this.onComplete = options.onComplete || (() => {});
    this.onError = options.onError || (() => {});
    this.onPartComplete = options.onPartComplete || (() => {});
    this.onPartUrlExpired = options.onPartUrlExpired || (() => {});
    this.errorReporter = options.errorReporter || (() => {});

    this.totalParts = Math.ceil(this.file.size / this.partSize);
    if (options.completedParts?.length) {
      this.uploadedParts = new Set(options.completedParts);
    }
  }

  /** Stable identifier used as the BlobStore key. */
  getJobId(): string {
    return this.jobId;
  }

  /**
   * Initialize the multipart upload session with the server.
   *
   * Creates a new upload session and retrieves the uploadId and final key.
   * Called automatically by start() if not already initialized.
   *
   * @throws Error if initialization fails
   */
  async initialize(): Promise<void> {
    try {
      const response = await this.client.post<{ data: InitializeUploadResponse }>(
        "/v1/media/multipart/initialize",
        {
          body: {
            key: this.key || `media/uploads/${Date.now()}-${sanitizeFileName(this.file.name)}`,
            content_type: this.file.type,
            file_size: this.file.size,
          },
        }
      );

      // Handle wrapped response
      const data = (response as any).data || response;

      if (!data || !data.uploadId) {
        throw new Error("Invalid response from initialize endpoint - missing uploadId");
      }

      this.uploadId = data.uploadId;
      this.key = data.key;
      this.partSize = data.partSize || this.partSize;
      this.totalParts = Math.ceil(this.file.size / this.partSize);
    } catch (error) {
      throw new Error(`Failed to initialize upload: ${error}`);
    }
  }

  /**
   * Retrieve presigned URLs for all parts.
   *
   * Gets presigned S3 URLs for uploading each part of the file.
   * Called automatically by start().
   *
   * @throws Error if upload not initialized or URL retrieval fails
   */
  async getUploadUrls(): Promise<void> {
    if (!this.uploadId || !this.key) {
      throw new Error("Upload not initialized");
    }

    try {
      const response = await this.client.post<{ data: UploadUrlsResponse }>(
        "/v1/media/multipart/upload-urls",
        {
          body: {
            uploadId: this.uploadId,
            key: this.key,
            total_parts: this.totalParts,
          },
        }
      );

      // Handle wrapped response
      const urls = (response as any).data || response;

      if (!urls || typeof urls !== "object") {
        throw new Error("Invalid response from upload-urls endpoint");
      }

      this.uploadUrls = urls;
    } catch (error) {
      throw new Error(`Failed to get upload URLs: ${error}`);
    }
  }

  /**
   * Start the multipart upload.
   *
   * Initializes the upload session, retrieves URLs, and begins uploading
   * parts with the configured concurrency. Progress callbacks are invoked
   * as parts complete.
   *
   * @example
   * ```typescript
   * const upload = new MultipartUpload(client, { file, onComplete: console.log });
   * await upload.start();
   * ```
   */
  async start(): Promise<void> {
    if (this.uploading) {
      console.warn("Upload already in progress");
      return;
    }

    if (!this.uploadId || !this.key) {
      await this.initialize();
    }

    await this.getUploadUrls();

    // Persist file blob for refresh-resume if a BlobStore is configured.
    if (this.blobStore) {
      void this.blobStore.put(this.jobId, this.file);
    }

    this.uploading = true;
    this.aborted = false;
    this.updateProgress();

    const uploadQueue: number[] = [];
    for (let i = 1; i <= this.totalParts; i++) {
      if (!this.uploadedParts.has(i)) {
        uploadQueue.push(i);
      }
    }

    const uploadNextPart = async (): Promise<void> => {
      while (!this.aborted && uploadQueue.length > 0) {
        const partNumber = uploadQueue.shift();
        if (partNumber === undefined) return;

        let attempt = 0;
        let succeeded = false;
        while (attempt < this.partRetryLimit && !this.aborted && !succeeded) {
          await this.waitForOnline();
          if (this.aborted) return;
          try {
            await this.uploadPart(partNumber);
            this.uploadedParts.add(partNumber);
            this.inflightBytes.delete(partNumber);
            void this.completePart(partNumber, this.etags[partNumber]);
            this.onPartComplete(partNumber, this.etags[partNumber]);
            this.updateProgress();
            succeeded = true;
          } catch (error) {
            attempt++;
            this.inflightBytes.delete(partNumber);
            this.updateProgress();
            if (this.aborted) return;
            // Don't burn a retry on a known-dead network.
            if (typeof navigator !== "undefined" && navigator.onLine === false) {
              attempt--;
              await this.waitForOnline();
              continue;
            }
            const msg = (error as Error).message ?? "";
            if (msg.includes("CORS")) {
              console.error("CORS Error: ensure S3 bucket has proper CORS configuration");
              throw error;
            }
            if (attempt >= this.partRetryLimit) {
              throw error;
            }
            const delay = Math.min(30_000, 1000 * Math.pow(2, attempt));
            await new Promise((resolve) => setTimeout(resolve, delay));
          }
        }
      }
    };

    const workers: Promise<void>[] = [];
    const concurrency = Math.min(this.maxConcurrentUploads, uploadQueue.length);
    for (let i = 0; i < concurrency; i++) {
      workers.push(uploadNextPart());
    }

    try {
      await Promise.all(workers);

      if (!this.aborted && this.uploadedParts.size === this.totalParts) {
        const location = await this.complete();
        if (this.blobStore) {
          void this.blobStore.delete(this.jobId);
        }
        this.onComplete(location);
      } else if (!this.aborted) {
        throw new Error(
          `Upload incomplete: ${this.uploadedParts.size}/${this.totalParts} parts uploaded`
        );
      }
    } catch (error) {
      if (!this.aborted) {
        const err = error as Error;
        this.onError(err);
        this.errorReporter(err, this.errorContext("uploadPart"));
      }
      throw error;
    } finally {
      this.uploading = false;
    }
  }

  private waitForOnline(): Promise<void> {
    if (!this.awaitOnline) return Promise.resolve();
    if (typeof navigator === "undefined" || navigator.onLine !== false) {
      return Promise.resolve();
    }
    if (typeof window === "undefined") return Promise.resolve();
    return new Promise((resolve) => {
      const onOnline = () => {
        window.removeEventListener("online", onOnline);
        resolve();
      };
      window.addEventListener("online", onOnline);
    });
  }

  private errorContext(phase: MultipartErrorContext["phase"]): MultipartErrorContext {
    return {
      fileName: this.file.name,
      fileType: this.file.type,
      fileSize: this.file.size,
      uploadId: this.uploadId,
      key: this.key,
      partsCompleted: this.uploadedParts.size,
      totalParts: this.totalParts,
      phase,
    };
  }

  private async refreshPartUrl(partNumber: number): Promise<string> {
    if (!this.uploadId || !this.key) {
      throw new Error("Cannot refresh URL: upload not initialized");
    }
    this.onPartUrlExpired(partNumber);
    const response = await this.client.post<{ data: RefreshedUploadUrlResponse }>(
      "/v1/media/multipart/upload-url",
      {
        body: {
          uploadId: this.uploadId,
          key: this.key,
          part_number: partNumber,
        },
      }
    );
    const data = (response as any).data || response;
    if (!data?.url) {
      throw new Error("Invalid response from upload-url endpoint");
    }
    this.uploadUrls[partNumber] = data.url;
    return data.url;
  }

  private async uploadPart(partNumber: number): Promise<void> {
    const start = (partNumber - 1) * this.partSize;
    const end = Math.min(start + this.partSize, this.file.size);
    const blob = this.file.slice(start, end);

    let etag: string;
    try {
      etag = await this.uploadWithXHR(this.uploadUrls[partNumber], blob, partNumber);
    } catch (err) {
      // Retry once with a freshly-signed URL if S3 returned 403/401.
      if (err instanceof PresignedUrlExpiredError) {
        const fresh = await this.refreshPartUrl(partNumber);
        etag = await this.uploadWithXHR(fresh, blob, partNumber);
      } else {
        throw err;
      }
    }

    if (!etag) {
      throw new Error(`No ETag received for part ${partNumber}`);
    }
    this.etags[partNumber] = etag;
  }

  /**
   * Upload a blob using XMLHttpRequest (more reliable on iOS Safari).
   * Tracks active XHRs for abort, surfaces byte-level progress via
   * onByteProgress, and throws PresignedUrlExpiredError on 403/401 so the
   * caller can refresh the URL and retry.
   */
  private uploadWithXHR(url: string, blob: Blob, partNumber?: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      this.activeXhrs.add(xhr);

      xhr.open("PUT", url, true);
      xhr.setRequestHeader("Content-Type", "application/octet-stream");

      if (partNumber !== undefined) {
        xhr.upload.onprogress = (ev: ProgressEvent) => {
          if (ev.lengthComputable) {
            this.inflightBytes.set(partNumber, ev.loaded);
            this.updateProgress();
          }
        };
      }

      xhr.onload = () => {
        this.activeXhrs.delete(xhr);
        if (xhr.status >= 200 && xhr.status < 300) {
          const etag = xhr.getResponseHeader("ETag")?.replace(/"/g, "");
          if (etag) {
            resolve(etag);
          } else {
            reject(new Error("No ETag received in response"));
          }
        } else if (xhr.status === 403 || xhr.status === 401) {
          reject(new PresignedUrlExpiredError(xhr.status, `Presigned URL expired (status ${xhr.status})`));
        } else {
          reject(new Error(`Upload failed with status ${xhr.status}: ${xhr.responseText}`));
        }
      };

      xhr.onerror = () => {
        this.activeXhrs.delete(xhr);
        reject(new Error("Network error during upload"));
      };

      xhr.onabort = () => {
        this.activeXhrs.delete(xhr);
        reject(new Error("Upload aborted"));
      };

      xhr.send(blob);
    });
  }

  private async completePart(partNumber: number, etag: string): Promise<void> {
    if (!this.uploadId) {
      throw new Error("Upload not initialized");
    }

    try {
      await this.client.post("/v1/media/multipart/complete-part", {
        body: {
          uploadId: this.uploadId,
          part_number: partNumber,
          etag,
        },
      });
    } catch (error) {
      console.error("Failed to mark part as complete:", error);
      // Don't throw - this is not critical for the upload to succeed
    }
  }

  private async complete(): Promise<string> {
    if (!this.uploadId || !this.key) {
      throw new Error("Upload not initialized");
    }

    try {
      const response = await this.client.post<{ data: { location: string } }>(
        "/v1/media/multipart/complete",
        {
          body: {
            uploadId: this.uploadId,
            key: this.key,
          },
        }
      );

      // Handle wrapped response
      const data = (response as any).data || response;

      if (!data || !data.location) {
        throw new Error("Invalid response from complete endpoint - missing location");
      }

      return data.location;
    } catch (error) {
      throw new Error(`Failed to complete upload: ${error}`);
    }
  }

  /**
   * Abort the current upload.
   *
   * Cancels the upload in progress and notifies the server to clean up
   * any partially uploaded parts.
   *
   * @example
   * ```typescript
   * // Cancel on user request
   * cancelButton.onclick = () => upload.abort();
   * ```
   */
  async abort(): Promise<void> {
    this.aborted = true;
    this.activeXhrs.forEach((xhr) => {
      try { xhr.abort(); } catch { /* ignore */ }
    });
    this.activeXhrs.clear();

    if (this.blobStore) {
      void this.blobStore.delete(this.jobId);
    }

    if (!this.uploadId || !this.key) {
      return;
    }

    try {
      await this.client.post("/v1/media/multipart/abort", {
        body: {
          uploadId: this.uploadId,
          key: this.key,
        },
      });
    } catch (error) {
      console.error("Failed to abort upload:", error);
    }
  }

  /**
   * Resume a previously started upload.
   *
   * Retrieves the state of a prior upload session and continues from
   * where it left off. Useful for recovering from network failures or
   * app restarts.
   *
   * @param uploadId - The upload ID from a previous session
   * @param key - The S3 key from a previous session
   *
   * @example
   * ```typescript
   * // Save upload state before app closes
   * localStorage.setItem('pendingUpload', JSON.stringify({
   *   uploadId: upload.getUploadId(),
   *   key: upload.getKey(),
   * }));
   *
   * // Resume on next app launch
   * const saved = JSON.parse(localStorage.getItem('pendingUpload'));
   * if (saved) {
   *   await upload.resume(saved.uploadId, saved.key);
   * }
   * ```
   */
  async resume(uploadId: string, key: string): Promise<void> {
    try {
      const response = await this.client.get<{ data: ResumeUploadResponse }>(
        `/v1/media/multipart/resume?uploadId=${encodeURIComponent(uploadId)}&key=${encodeURIComponent(key)}`
      );

      // Handle wrapped response
      const data = (response as any).data || response;

      if (!data || !data.uploadId) {
        throw new Error("Invalid response from resume endpoint - missing uploadId");
      }

      this.uploadId = data.uploadId;
      this.key = data.key;
      this.partSize = data.partSize;
      this.uploadedParts = new Set(data.completedParts);

      await this.start();
    } catch (error) {
      throw new Error(`Failed to resume upload: ${error}`);
    }
  }

  private computeProgress(): MultipartProgress {
    const completedBytes = Array.from(this.uploadedParts).reduce((sum, partNumber) => {
      const start = (partNumber - 1) * this.partSize;
      const end = Math.min(start + this.partSize, this.file.size);
      return sum + (end - start);
    }, 0);
    let inflight = 0;
    this.inflightBytes.forEach((bytes) => { inflight += bytes; });
    const uploadedBytes = Math.min(this.file.size, completedBytes + inflight);
    const percentage = this.file.size > 0 ? (uploadedBytes / this.file.size) * 100 : 0;
    return {
      percentage,
      uploadedParts: this.uploadedParts.size,
      totalParts: this.totalParts,
      uploadedBytes,
      totalBytes: this.file.size,
    };
  }

  private updateProgress(): void {
    const progress = this.computeProgress();
    this.onProgress(progress.percentage, progress.uploadedParts, progress.totalParts);
    this.onByteProgress(progress);
  }

  /**
   * Pause the current upload.
   *
   * Stops uploading new parts but doesn't abort. Can be resumed later
   * using the resume() method with the current uploadId and key.
   */
  pause(): void {
    this.aborted = true;
    this.activeXhrs.forEach((xhr) => {
      try { xhr.abort(); } catch { /* ignore */ }
    });
    this.activeXhrs.clear();
    this.uploading = false;
  }

  /**
   * Get the list of successfully uploaded part numbers.
   *
   * @returns Array of 1-indexed part numbers that have been uploaded
   */
  getUploadedParts(): number[] {
    return Array.from(this.uploadedParts);
  }

  /**
   * Get detailed progress information.
   *
   * @returns Object with percentage, part counts, and byte counts
   *
   * @example
   * ```typescript
   * const progress = upload.getProgress();
   * console.log(`${progress.percentage.toFixed(1)}% complete`);
   * console.log(`${progress.uploadedParts}/${progress.totalParts} parts`);
   * console.log(`${progress.uploadedBytes}/${progress.totalBytes} bytes`);
   * ```
   */
  getProgress(): MultipartProgress {
    return this.computeProgress();
  }

  /**
   * Get the current upload ID.
   *
   * @returns The upload ID or null if not initialized
   */
  getUploadId(): string | null {
    return this.uploadId;
  }

  /**
   * Get the S3 key for this upload.
   *
   * @returns The S3 key or null if not initialized
   */
  getKey(): string | null {
    return this.key;
  }
}
