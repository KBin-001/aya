import { describe, expect, it } from 'vitest'
import { readFixture } from './__fixtures__/load'
import {
  attachCpuSpeeds,
  parseBattery,
  parseCpuFrequencies,
  parseCpuStat,
  parseMemInfo,
} from '.'
import { parseCpuTemperature } from './thermal'

/**
 * One row per captured device. Adding a device variant is a fixture directory
 * plus a row here - no parser changes.
 */
const devices = [
  {
    fixture: 'mtk-tb8781p4',
    cores: 8,
    cpuTemperature: 31.1,
    memTotal: 6155370496,
    memUsed: 1945440256,
    battery: { levelPct: 100, temperatureDeciC: 281, voltageMv: 4294 },
  },
  {
    fixture: 'qcom-reference',
    cores: 8,
    cpuTemperature: 52.5,
    memTotal: 7894204416,
    memUsed: 2651324416,
    battery: { levelPct: 62, temperatureDeciC: 305, voltageMv: 3901 },
  },
]

describe.each(devices)('$fixture', (device) => {
  it('parses the cpu rows with one frequency per core', () => {
    const stat = parseCpuStat(readFixture(device.fixture, 'proc-stat.txt'))
    const speeds = parseCpuFrequencies(
      JSON.parse(readFixture(device.fixture, 'cpufreq.json')),
    )
    if (!stat.ok || !speeds.ok) throw new Error('fixture should parse')

    const cpus = attachCpuSpeeds(stat.value, speeds.value)

    expect(cpus).toHaveLength(device.cores)
    expect(cpus.every((cpu) => typeof cpu.speed === 'number')).toBe(true)
  })

  it('parses the cpu temperature', () => {
    expect(
      parseCpuTemperature(
        readFixture(device.fixture, 'dumpsys-thermalservice.txt'),
      ),
    ).toEqual({ ok: true, value: device.cpuTemperature })
  })

  it('parses memory', () => {
    expect(
      parseMemInfo(readFixture(device.fixture, 'proc-meminfo.txt')),
    ).toEqual({
      ok: true,
      value: { memTotal: device.memTotal, memUsed: device.memUsed },
    })
  })

  it('parses the battery', () => {
    expect(
      parseBattery(readFixture(device.fixture, 'dumpsys-battery.txt')),
    ).toEqual({ ok: true, value: device.battery })
  })
})
