import { describe, expect, it } from 'vitest'
import { readFixture } from './__fixtures__/load'
import { IBatteryReadings, parseBattery } from './battery'

const successes: [string, string, IBatteryReadings][] = [
  [
    'a real capture',
    readFixture('mtk-tb8781p4', 'dumpsys-battery.txt'),
    // level: 100, temperature: 281, voltage: 4294.
    { levelPct: 100, temperatureDeciC: 281, voltageMv: 4294 },
  ],
  [
    'an unreported field, which stays at zero',
    'Current Battery Service state:\n  voltage: 4200\n',
    { levelPct: 0, temperatureDeciC: 0, voltageMv: 4200 },
  ],
]

const failures: [string, string, string][] = [
  ['an empty dump', '', 'battery'],
  ['a dump with only a header', 'Current Battery Service state:\n', 'battery'],
]

describe('parseBattery', () => {
  it.each(successes)('parses %s', (_case, dump, expected) => {
    expect(parseBattery(dump)).toEqual({ ok: true, value: expected })
  })

  it.each(failures)(
    'reports a readable error for %s',
    (_case, dump, reason) => {
      const result = parseBattery(dump)

      expect(result.ok).toBe(false)
      expect(result.ok === false && result.reason).toContain(reason)
    },
  )
})
