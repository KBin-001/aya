import { describe, expect, it } from 'vitest'
import type { ILogPathConfig } from './types'
import { selectLogPath } from './paths'

function config(
  paths: string[],
  selected: string | null = null,
): ILogPathConfig {
  return { paths, selected }
}

const cases: [string, ILogPathConfig, Record<string, boolean>, string | null][] =
  [
    [
      'the last selected path while still valid',
      config(['/a', '/b'], '/b'),
      { '/b': true, '/a': false },
      '/b',
    ],
    [
      'the first valid candidate when selected is invalid',
      config(['/a', '/b'], '/b'),
      { '/a': true, '/b': false },
      '/a',
    ],
    [
      'the first valid candidate when nothing is selected',
      config(['/a', '/b'], null),
      { '/a': false, '/b': true },
      '/b',
    ],
    [
      'null when no candidate is valid',
      config(['/a', '/b'], '/b'),
      { '/a': false, '/b': false },
      null,
    ],
    ['null for an empty candidate list', config([], null), {}, null],
    [
      'a selected path that is not in the candidate list',
      config(['/a'], '/orphan'),
      { '/orphan': true },
      '/orphan',
    ],
  ]

describe('selectLogPath', () => {
  it.each(cases)('selects %s', (_case, cfg, validity, expected) => {
    expect(selectLogPath(cfg, validity)).toBe(expected)
  })
})
