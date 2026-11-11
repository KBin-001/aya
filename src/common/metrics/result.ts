/**
 * Outcome of turning raw device text into structured data.
 *
 * Every parser in this module reports failure as data instead of throwing: a
 * device with an unreadable or unexpected dump is a normal condition (SELinux,
 * OEM differences, a half-written buffer), and the caller needs to turn that
 * into a status the UI can explain rather than into a crash.
 */
export type ParseResult<T> =
  { ok: true; value: T } | { ok: false; reason: string }

export function ok<T>(value: T): ParseResult<T> {
  return { ok: true, value }
}

export function fail<T = never>(reason: string): ParseResult<T> {
  return { ok: false, reason }
}
