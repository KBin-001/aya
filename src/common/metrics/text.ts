import trim from 'licia/trim'
import each from 'licia/each'
import types from 'licia/types'
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

/**
 * Read `key|value` lines into a record.
 *
 * The collector prints one such line per sysfs file it reads, because a batch
 * of `cat` calls gives no boundaries between the files. An empty value is kept
 * as '' so the caller can tell "the file answered nothing" from "the file does
 * not exist", which are different failures.
 */
export function parseKeyedLines(text: string): types.PlainObj<string> {
  const result: types.PlainObj<string> = {}

  each(text.split('\n'), (line) => {
    const separator = line.indexOf('|')
    if (separator === -1) {
      return
    }

    const key = trim(line.slice(0, separator))
    if (!key) {
      return
    }

    result[key] = trim(line.slice(separator + 1))
  })

  return result
}
