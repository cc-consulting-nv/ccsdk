/** The `sub` claim of a JWT bearer, or null when the token is not a decodable JWT. */
export function tokenSubject(token: string | null | undefined): string | null {
  const payload = token?.split(".")[1];
  if (!payload) return null;
  try {
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(payload.length / 4) * 4, "="));
    const sub = (JSON.parse(json) as { sub?: unknown }).sub;
    return sub == null ? null : String(sub);
  } catch {
    return null;
  }
}

/**
 * Whether two bearers belong to the same user. Opaque or missing tokens can't
 * be compared and count as a match, so callers keep their old behavior for them.
 */
export function sameSubject(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = tokenSubject(a);
  const y = tokenSubject(b);
  return x === null || y === null || x === y;
}
