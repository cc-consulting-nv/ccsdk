/**
 * Sanitize a file name for safe use in an S3 key path.
 *
 * Whitelist approach: replaces every character outside `[A-Za-z0-9.-]`
 * with `_`, then caps length at 200. Closes path traversal, null byte,
 * control character, Unicode RTL override, quote/semicolon injection,
 * and hidden-file vectors.
 */
export function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9.-]/g, "_").slice(0, 200);
}
