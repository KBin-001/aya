import { describe, expect, it } from 'vitest'
import { readFixture } from './__fixtures__/load'
import {
  attachCpuSpeeds,
  parseCpuFrequencies,
  parseCpuStat,
  ICpuReading,
} from './cpu'

const statText = readFixture('mtk-tb8781p4', 'proc-stat.txt')
const frequencyReadings: string[] = JSON.parse(
  readFixture('mtk-tb8781p4', 'cpufreq.json'),
)

function mustParseCpus(text: string): ICpuReading[] {
  const result = parseCpuStat(text)
  if (!result.ok)
    throw new Error('expected the dump to parse: ' + result.reason)
  return result.value
}

describe('parseCpuStat', () => {
  it('returns one reading per core of a real dump', () => {
    expect(mustParseCpus(statText)).toHaveLength(8)
  })

  it('skips the device-wide cpu row', () => {
    // The aggregate reports user=4703; no single core may surface it.
    expect(mustParseCpus(statText).map((cpu) => cpu.times.user)).not.toContain(
      4703,
    )
  })

  it('reads every tick counter of a core in /proc/stat order', () => {
    // Ground truth: "cpu0 540 58 1607 77546 50 1169 183" in the capture.
    expect(mustParseCpus(statText)[0].times).toEqual({
      user: 540,
      nice: 58,
      sys: 1607,
      idle: 77546,
      iowait: 50,
      irq: 1169,
      softirq: 183,
    })
  })

  it.each([
    ['empty dump', ''],
    ['no cpu rows at all', 'intr 1234\nctxt 42\nbtime 1793979467\n'],
    [
      'only the device-wide row',
      'cpu  4703 383 10059 633043 556 3014 604 0 0 0\n',
    ],
  ])('reports a readable error for an %s', (_case, text) => {
    const result = parseCpuStat(text)

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.reason).toContain('cpu')
  })

  it('drops a row too short to carry every counter', () => {
    // A truncated line must not be filled with zeroes: that would report a
    // busy core as idle. It is skipped, the rest of the dump still parses.
    const dump = 'cpu0 540 58 1607 77546 50 1169 183 0\ncpu1 491 55\n'
    const cpus = mustParseCpus(dump)

    expect(cpus).toHaveLength(1)
    expect(cpus[0].times.user).toBe(540)
  })
})

describe('parseCpuFrequencies', () => {
  it('turns the per-core reads in kHz into MHz', () => {
    expect(parseCpuFrequencies(frequencyReadings)).toEqual({
      ok: true,
      value: [500, 500, 500, 900, 500, 750, 2200, 2200],
    })
  })

  it('drops a read that came back empty', () => {
    expect(parseCpuFrequencies(['500000', '', '  ', '900000'])).toEqual({
      ok: true,
      value: [500, 900],
    })
  })

  it.each([
    ['every read came back empty', ['', '  ']],
    ['no core was read at all', []],
  ])('reports a readable error when %s', (_case, readings) => {
    const result = parseCpuFrequencies(readings as string[])

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.reason).toContain('scaling_cur_freq')
  })
})

describe('attachCpuSpeeds', () => {
  it('gives every core its own frequency', () => {
    const speeds = parseCpuFrequencies(frequencyReadings)
    if (!speeds.ok) throw new Error('fixture should parse')

    expect(
      attachCpuSpeeds(mustParseCpus(statText), speeds.value).map(
        (cpu) => cpu.speed,
      ),
    ).toEqual([500, 500, 500, 900, 500, 750, 2200, 2200])
  })

  it('leaves speed absent when no frequency was passed', () => {
    expect(
      attachCpuSpeeds(mustParseCpus(statText), [])[0].speed,
    ).toBeUndefined()
  })

  it('known defect: an unreadable frequency shifts the rest up', () => {
    // A core that is offline prints nothing. The app has always compacted the
    // remaining values and assigned them by position, so core 1 takes core 2's
    // frequency. Locked here so the defect is deliberate and visible; see
    // issues/09-cpu-frequency-alignment.md for the fix.
    const speeds = parseCpuFrequencies(['500000', '', '900000'])
    if (!speeds.ok) throw new Error('two reads should parse')

    expect(
      attachCpuSpeeds(mustParseCpus(statText), speeds.value).map(
        (cpu) => cpu.speed,
      ),
    ).toEqual([
      500,
      900,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ])
  })

  it('does not mutate the readings it is given', () => {
    const cpus = mustParseCpus(statText)

    attachCpuSpeeds(cpus, [500])

    expect(cpus[0].speed).toBeUndefined()
  })
})
