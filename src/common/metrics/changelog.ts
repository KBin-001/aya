/** One value change, stamped with the time of the sample that saw it. */
export interface IChangeRecord<T> {
  at: number
  from: T
  to: T
}

const DEFAULT_LIMIT = 20

/**
 * Append a change to a log, keeping only real transitions.
 *
 * A value that stays put must not fill the log, and neither must a value that
 * could not be read this tick: an unreadable sample is not evidence of a
 * change. The returned array is new, so callers can keep it in observable state
 * without risking mutation.
 */
export function recordChange<T>(
  log: readonly IChangeRecord<T>[],
  at: number,
  from: T | null,
  to: T | null,
  limit = DEFAULT_LIMIT,
): IChangeRecord<T>[] {
  if (from === null || to === null || from === to) {
    return log.slice()
  }

  const next = [...log, { at, from, to }]

  return next.length > limit ? next.slice(next.length - limit) : next
}
