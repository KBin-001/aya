import trim from 'licia/trim'
import find from 'licia/find'
import startWith from 'licia/startWith'

/**
 * Read the value of a `key: value` line out of a dumpsys or procfs dump.
 *
 * This is the single reader every metric parser uses, and it reproduces the
 * behaviour the app has always had: the first line whose trimmed form starts
 * with the key wins, and the value is whatever follows the last colon on that
 * line. Returning '' rather than throwing keeps a missing field a data problem
 * for the caller to classify, not an exception.
 */
export function readField(key: string, text: string): string {
  const line = find(text.split('\n'), (line) => startWith(trim(line), key))

  return line ? trim(line.replace(/.*:/, '')) : ''
}
