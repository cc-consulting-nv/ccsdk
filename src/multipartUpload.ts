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
  /** Callback for upload progress updates */
  onProgress?: (percentage: number, uploadedParts: number, totalParts: number) => void;
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
  private onProgress: (percentage: number, uploadedParts: number, totalParts: number) => void;
  private onComplete: (location: string) => void;
  private onError: (error: Error) => void;
  private onPartComplete: (partNumber: number, etag: string) => void;

  private totalParts: number;
  private uploadedParts: Set<number> = new Set();
  private uploading: boolean = false;
  private aborted: boolean = false;
  private uploadUrls: { [partNumber: number]: string } = {};
  private etags: { [partNumber: number]: string } = {};

  /**
   * Create a new MultipartUpload instance.
   *
   * @param client - The HttpClient instance for API calls
   * @param options - Upload configuration options
   */
  constructor(client: HttpClient, options: MultipartUploadOptions) {
    this.client = client;
    this.file = options.file;
    this.uploadId = null;
    this.key = options.key || null;
    this.partSize = options.partSize || 10 * 1024 * 1024; // 10MB
    this.maxConcurrentUploads = options.maxConcurrentUploads || 3;
    this.onProgress = options.onProgress || (() => {});
    this.onComplete = options.onComplete || (() => {});
    this.onError = options.onError || (() => {});
    this.onPartComplete = options.onPartComplete || (() => {});

    this.totalParts = Math.ceil(this.file.size / this.partSize);
    this.uploadedParts = new Set();
    this.uploading = false;
    this.aborted = false;
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

    this.uploading = true;
    this.aborted = false;

    // Initialize progress
    this.updateProgress();

    // Create upload queue
    const partsToUpload: number[] = [];
    for (let i = 1; i <= this.totalParts; i++) {
      if (!this.uploadedParts.has(i)) {
        partsToUpload.push(i);
      }
    }

    // Upload parts with concurrency limit
    const uploadPromises: Promise<void>[] = [];
    const uploadQueue = [...partsToUpload];

    const uploadNextPart = async (): Promise<void> => {
      if (this.aborted || uploadQueue.length === 0) return;

      const partNumber = uploadQueue.shift();
      if (!partNumber) return;

      try {
        await this.uploadPart(partNumber);
        this.uploadedParts.add(partNumber);

        // Notify backend that part is complete
        await this.completePart(partNumber, this.etags[partNumber]);

        this.onPartComplete(partNumber, this.etags[partNumber]);
        this.updateProgress();

        // Start next part
        if (uploadQueue.length > 0) {
          await uploadNextPart();
        }
      } catch (error) {
        if (!this.aborted) {
          // Retry logic
          console.error(`Failed to upload part ${partNumber}, retrying...`, error);
          uploadQueue.push(partNumber);
          await new Promise(resolve => setTimeout(resolve, 5000));
          await uploadNextPart();
        }
      }
    };

    // Start initial concurrent uploads
    for (let i = 0; i < Math.min(this.maxConcurrentUploads, partsToUpload.length); i++) {
      uploadPromises.push(uploadNextPart());
    }

    try {
      await Promise.all(uploadPromises);

      if (!this.aborted && this.uploadedParts.size === this.totalParts) {
        const location = await this.complete();
        this.onComplete(location);
      }
    } catch (error) {
      if (!this.aborted) {
        this.onError(error as Error);
      }
    } finally {
      this.uploading = false;
    }
  }

  private async uploadPart(partNumber: number): Promise<void> {
    const start = (partNumber - 1) * this.partSize;
    const end = Math.min(start + this.partSize, this.file.size);
    const blob = this.file.slice(start, end);

    const { etag } = await this.uploadWithRetry(this.uploadUrls[partNumber], blob, 3);

    if (!etag) {
      throw new Error(`No ETag received for part ${partNumber}`);
    }

    this.etags[partNumber] = etag;
  }

  private async uploadWithRetry(url: string, blob: Blob, maxRetries: number): Promise<{ etag: string }> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      if (this.aborted) break;

      try {
        // Use XMLHttpRequest instead of fetch for better iOS Safari compatibility
        // Safari has CORS issues with fetch() PUT requests to presigned URLs
        const etag = await this.uploadWithXHR(url, blob);
        return { etag };
      } catch (error) {
        lastError = error as Error;
        console.warn(`Upload attempt ${attempt + 1} failed:`, error);

        // Check for CORS issues
        if (lastError.message && lastError.message.includes("CORS")) {
          console.error("CORS Error: Make sure the S3 bucket has proper CORS configuration");
          break; // Don't retry CORS errors
        }

        if (attempt < maxRetries - 1) {
          // Exponential backoff
          await new Promise((resolve) => setTimeout(resolve, Math.pow(2, attempt) * 1000));
        }
      }
    }

    throw lastError || new Error("Upload failed");
  }

  /**
   * Upload a blob using XMLHttpRequest (more reliable on iOS Safari)
   */
  private uploadWithXHR(url: string, blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();

      xhr.open("PUT", url, true);

      // Set Content-Type header - must match what was used when generating presigned URL
      xhr.setRequestHeader("Content-Type", "application/octet-stream");

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          // Extract ETag from response headers
          const etag = xhr.getResponseHeader("ETag")?.replace(/"/g, "");
          if (etag) {
            resolve(etag);
          } else {
            reject(new Error("No ETag received in response"));
          }
        } else {
          reject(new Error(`Upload failed with status ${xhr.status}: ${xhr.responseText}`));
        }
      };

      xhr.onerror = () => {
        reject(new Error("Network error during upload"));
      };

      xhr.onabort = () => {
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

  private updateProgress(): void {
    const percentage = (this.uploadedParts.size / this.totalParts) * 100;
    this.onProgress(percentage, this.uploadedParts.size, this.totalParts);
  }

  /**
   * Pause the current upload.
   *
   * Stops uploading new parts but doesn't abort. Can be resumed later
   * using the resume() method with the current uploadId and key.
   */
  pause(): void {
    this.aborted = true;
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
  getProgress(): {
    percentage: number;
    uploadedParts: number;
    totalParts: number;
    uploadedBytes: number;
    totalBytes: number;
  } {
    return {
      percentage: (this.uploadedParts.size / this.totalParts) * 100,
      uploadedParts: this.uploadedParts.size,
      totalParts: this.totalParts,
      uploadedBytes: this.uploadedParts.size * this.partSize,
      totalBytes: this.file.size,
    };
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
