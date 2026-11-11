import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * Read a captured device dump. Test-only helper: the fixtures directory is
 * never imported by application code, so this stays out of every bundle.
 *
 * Fixture layout and provenance are documented in ./README.md.
 */
export function readFixture(device: string, name: string): string {
  return readFileSync(
    fileURLToPath(new URL(`./${device}/${name}`, import.meta.url)),
    'utf8',
  )
}
