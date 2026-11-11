import { describe, expect, it } from 'vitest'
import { readFixture } from './__fixtures__/load'
import { parseCpuTemperature } from './thermal'

function record(name: string, value: string) {
  return `\tTemperature{mValue=${value}, mType=0, mName=${name}, mStatus=0}`
}

const successes: [string, string, number][] = [
  [
    'a real capture',
    readFixture('mtk-tb8781p4', 'dumpsys-thermalservice.txt'),
    // "Cached temperatures" reports CPU=50.667 and "Current temperatures from
    // HAL" reports CPU=31.07. Zones are keyed by name, so the later record
    // replaces the earlier one and only 31.07 is averaged, to three
    // significant digits as the app has always done.
    31.1,
  ],
  [
    'a zone repeated in the dump, counted once',
    [record('CPU', '50'), record('CPU', '70')].join('\n'),
    70,
  ],
  [
    'every zone whose name starts with CPU',
    [
      record('CPU_BIG', '40'),
      record('CPU_LITTLE', '60'),
      record('GPU', '99'),
    ].join('\n'),
    50,
  ],
  [
    'three significant digits rather than three decimals',
    record('CPU', '100.5'),
    101,
  ],
  [
    'threshold lines, which carry no reading',
    [
      '\tTemperatureThreshold{mType=0, mName=CPU, mHotThrottlingThresholds=[85.0]}',
      record('CPU', '45'),
    ].join('\n'),
    45,
  ],
]

const failures: [string, string, string][] = [
  ['an empty dump', '', 'CPU'],
  ['a dump with no CPU zone', record('GPU', '55'), 'CPU'],
]

describe('parseCpuTemperature', () => {
  it.each(successes)('parses %s', (_case, dump, expected) => {
    expect(parseCpuTemperature(dump)).toEqual({ ok: true, value: expected })
  })

  it.each(failures)(
    'reports a readable error for %s',
    (_case, dump, reason) => {
      const result = parseCpuTemperature(dump)

      expect(result.ok).toBe(false)
      expect(result.ok === false && result.reason).toContain(reason)
    },
  )
})
