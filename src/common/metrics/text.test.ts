import { describe, expect, it } from 'vitest'
import { readFixture } from './__fixtures__/load'
import { readField } from './text'

describe('readField', () => {
  it.each([
    ['level', '100'],
    ['voltage', '4294'],
    ['temperature', '281'],
    ['status', '5'],
  ])('reads %s out of a dumpsys battery dump', (key, expected) => {
    expect(
      readField(key, readFixture('mtk-tb8781p4', 'dumpsys-battery.txt')),
    ).toBe(expected)
  })

  it('keeps the unit of a procfs line', () => {
    expect(
      readField('MemTotal', readFixture('mtk-tb8781p4', 'proc-meminfo.txt')),
    ).toBe('6011104 kB')
  })

  it('takes the first matching line, not a later lookalike', () => {
    // "Capacity level: 5" also carries the word level, but the line does not
    // begin with it, and the real level: line comes first anyway.
    expect(readField('level', '  Capacity level: 5\n  level: 100')).toBe('100')
  })

  it('returns an empty string when the key is absent', () => {
    expect(readField('nonexistent', '  level: 100')).toBe('')
  })

  it('splits on the last colon, as the app always has', () => {
    expect(readField('cb', 'cb: was sent: +17s469ms')).toBe('+17s469ms')
  })
})
