import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * Read a captured property map. Test-only helper: the fixtures directory is
 * never imported by application code, so this stays out of every bundle.
 *
 * Fixture layout and provenance are documented in ./README.md.
 */
export function readPropsFixture(name: string): Record<string, string> {
  const text = readFileSync(
    fileURLToPath(new URL(`./${name}`, import.meta.url)),
    'utf8',
  )
  return JSON.parse(text)
}
