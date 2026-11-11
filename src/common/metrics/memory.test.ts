import { describe, expect, it } from 'vitest'
import { readFixture } from './__fixtures__/load'
import { IMemoryReading, parseMemInfo } from './memory'

const successes: [string, string, IMemoryReading][] = [
  [
    'a real capture',
    readFixture('mtk-tb8781p4', 'proc-meminfo.txt'),
    // MemTotal 6011104 kB, MemAvailable 4111260 kB.
    { memTotal: 6155370496, memUsed: 1945440256 },
  ],
  [
    'MemFree when MemAvailable is missing',
    'MemTotal:        1000 kB\nMemFree:          400 kB\n',
    { memTotal: 1024000, memUsed: 614400 },
  ],
  [
    'MemAvailable over MemFree when both are present',
    'MemTotal:        1000 kB\nMemFree:          100 kB\nMemAvailable:     800 kB\n',
    { memTotal: 1024000, memUsed: 204800 },
  ],
]

const failures: [string, string, string][] = [
  ['an empty dump', '', 'MemTotal'],
  ['a dump without a single line', 'garbage\n', 'MemTotal'],
  ['a dump with only the total', 'MemTotal:        1000 kB\n', 'free'],
]

describe('parseMemInfo', () => {
  it.each(successes)('parses %s', (_case, dump, expected) => {
    expect(parseMemInfo(dump)).toEqual({ ok: true, value: expected })
  })

  it.each(failures)(
    'reports a readable error for %s',
    (_case, dump, reason) => {
      const result = parseMemInfo(dump)

      expect(result.ok).toBe(false)
      expect(result.ok === false && result.reason).toContain(reason)
    },
  )
})
