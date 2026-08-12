/**
 * Media file type rules — the single source of truth for what the SDK will
 * upload, so consumers can pre-flight a file (for a fast inline error) without
 * reimplementing the rules and drifting from them.
 *
 * @see https://github.com/cc-consulting-nv/ccsdk/issues/157
 * @module
 */

export type MediaType = "audio" | "image" | "video" | "file";

/**
 * Extension → MIME, used only when the browser reports an empty `File.type`.
 *
 * iOS/WKWebView routinely hands back an empty type for camera-roll and
 * share-sheet files, which is why this fallback exists at all.
 */
const EXTENSION_MIME: Record<string, string> = {
  // video
  mp4: "video/mp4",
  // .m4v is Apple's MPEG-4 container variant. video/x-m4v is the widely-seen
  // convention but is unregistered; video/mp4 is the registered type and is
  // what gets sent to R2 as Content-Type for files with no reported type.
  m4v: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  mpeg: "video/mpeg",
  mpg: "video/mpeg",
  "3gp": "video/3gpp",
  avi: "video/x-msvideo",
  mkv: "video/x-matroska",
  // image
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
  // audio
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  wav: "audio/wav",
  flac: "audio/flac",
  ogg: "audio/ogg",
  aac: "audio/aac",
  // file
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

/**
 * `accept` attribute values for file inputs, per media type. Bind these to
 * pickers rather than hardcoding `video/*` — extensions are included so iOS
 * offers camera-roll items whose MIME it will later report as empty.
 */
export const MEDIA_ACCEPT: Record<MediaType, string> = {
  video: "video/*,.mp4,.m4v,.mov,.webm,.3gp,.avi,.mkv",
  image: "image/*,.jpg,.jpeg,.png,.gif,.webp,.heic,.heif",
  audio: "audio/*,.mp3,.m4a,.wav,.flac,.ogg,.aac",
  file: ".pdf,.doc,.docx",
};

/** Default upload size caps in bytes, per media type. */
export const MEDIA_MAX_BYTES: Record<MediaType, number> = {
  audio: 100 * 1024 * 1024,
  image: 20 * 1024 * 1024,
  video: 500 * 1024 * 1024,
  file: 100 * 1024 * 1024,
};

/** MIME prefix each media type must match, once a type has been resolved. */
const MEDIA_PREFIX: Record<Exclude<MediaType, "file">, string> = {
  audio: "audio/",
  image: "image/",
  video: "video/",
};

/**
 * Resolve a file's MIME type, falling back to its extension when the browser
 * reports nothing. Returns `""` when neither source yields a type.
 */
export function resolveMimeType(file: File): string {
  if (file.type) return file.type;
  const ext = file.name.split(".").pop()?.toLowerCase();
  return (ext && EXTENSION_MIME[ext]) || "";
}

/**
 * Infer the media type of a file from its (possibly extension-derived) MIME.
 * Returns `null` when the type is unrecognised.
 */
export function detectMediaType(file: File): MediaType | null {
  const mime = resolveMimeType(file);
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("application/pdf") || mime.includes("document")) return "file";
  return null;
}

function formatBytes(bytes: number): string {
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(gb >= 10 ? 0 : 1)}GB`;
  const mb = bytes / (1024 * 1024);
  return `${Math.round(mb)}MB`;
}

/**
 * Validate a file against the SDK's upload rules.
 *
 * Call this to reject a bad file before `uploadMediaFile` — the upload path
 * runs the same check internally, so this is purely for a faster, inline error
 * message. Returns `null` when the file is acceptable, or a human-readable
 * reason when it is not.
 *
 * @param file - The file to check.
 * @param mediaType - Expected type. Omit to infer it from the file.
 * @param maxBytesOverride - Server-driven cap (e.g. `/v1/settings.maxVideoSize`)
 *   replacing the default for this media type.
 */
export function validateMediaFile(
  file: File,
  mediaType?: MediaType,
  maxBytesOverride?: number
): string | null {
  const resolvedType = mediaType ?? detectMediaType(file);
  if (!resolvedType) {
    return "Unsupported file type";
  }

  const max =
    typeof maxBytesOverride === "number" && maxBytesOverride > 0
      ? maxBytesOverride
      : MEDIA_MAX_BYTES[resolvedType];

  if (file.size > max) {
    const label =
      resolvedType === "video"
        ? "Video"
        : resolvedType === "file"
          ? "File"
          : `${resolvedType[0].toUpperCase()}${resolvedType.slice(1)} file`;
    return `${label} exceeds the ${formatBytes(max)} upload limit`;
  }

  // `file` accepts anything that resolved to a known type above.
  if (resolvedType !== "file") {
    const mime = resolveMimeType(file);
    if (!mime.startsWith(MEDIA_PREFIX[resolvedType])) {
      return `Please select a valid ${resolvedType} file`;
    }
  }

  return null;
}

/** Convenience boolean wrapper around {@link validateMediaFile}. */
export function isAllowedMediaFile(
  file: File,
  mediaType?: MediaType,
  maxBytesOverride?: number
): boolean {
  return validateMediaFile(file, mediaType, maxBytesOverride) === null;
}
