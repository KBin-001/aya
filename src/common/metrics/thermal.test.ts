import { describe, expect, it } from 'vitest'
import { readFixture } from './__fixtures__/load'
import {
  isThrottling,
  parseCpuTemperature,
  parseThermalService,
  parseThermalZones,
} from './thermal'

describe('parseThermalZones', () => {
  const types = readFixture('mtk-sysfs-reference', 'thermal-zones-types.txt')
  const temps = readFixture('mtk-sysfs-reference', 'thermal-zones-temps.txt')

  it('pairs each zone name with its temperature in degrees Celsius', () => {
    const result = parseThermalZones(types, temps)
    if (!result.ok) throw new Error('fixture should parse')

    expect(result.value).toHaveLength(16)
    expect(result.value[0]).toEqual({ name: 'cpu-0-0', temperatureC: 52 })
    expect(result.value[9]).toEqual({ name: 'mtktsbattery', temperatureC: 30 })
  })

  it('refuses a read whose halves disagree, rather than pairing the wrong rows', () => {
    const result = parseThermalZones(types, '52000\n51500\n')

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.reason).toContain('disagree')
  })

  it('reports a readable error when no zone could be read', () => {
    const result = parseThermalZones('', '')

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.reason).toContain('thermal zone')
  })

  it('skips a zone whose temperature is not a number', () => {
    const result = parseThermalZones('cpu-0-0\ncpu-0-1\n', '52000\nn/a\n')
    if (!result.ok) throw new Error('one zone should survive')

    expect(result.value).toEqual([{ name: 'cpu-0-0', temperatureC: 52 }])
  })
})

describe('parseThermalService', () => {
  it('reads the thermal status, the cooling devices and the HAL zones', () => {
    const result = parseThermalService(
      readFixture('mtk-tb8781p4', 'dumpsys-thermalservice.txt')
    )
    if (!result.ok) throw new Error('fixture should parse')

    expect(result.value.thermalStatus).toBe(0)
    expect(result.value.coolingDevices).toEqual([
      { name: 'devfreq-13000000.mali', value: 0 },
      { name: 'charger-cooler', value: 0 },
      { name: 'lcd-backlight', value: 0 },
      { name: 'flashlight_cooler', value: 0 },
    ])
    expect(result.value.zones).toHaveLength(8)
  })

  it('prefers the live HAL block over the cached one', () => {
    // The dump carries CPU=50.667 in "Cached temperatures" and CPU=31.07 in
    // "Current temperatures from HAL". The live block is the truth.
    const result = parseThermalService(
      readFixture('mtk-tb8781p4', 'dumpsys-thermalservice.txt')
    )
    if (!result.ok) throw new Error('fixture should parse')

    const cpu = result.value.zones.find((zone) => zone.name === 'CPU')
    expect(cpu).toEqual({ name: 'CPU', temperatureC: 31.07 })
  })

  it('reports a readable error when the service printed nothing usable', () => {
    const result = parseThermalService('ThermalEventListeners:\n\tcallbacks: 1\n')

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.reason).toContain('thermal')
  })
})

describe('isThrottling', () => {
  it('is false while the status is none and every cooler idles', () => {
    expect(
      isThrottling(0, [
        { name: 'charger-cooler', value: 0 },
        { name: 'lcd-backlight', value: 0 },
      ])
    ).toBe(false)
  })

  it('is true as soon as the thermal status rises', () => {
    expect(isThrottling(2, [])).toBe(true)
  })

  it('is true when a cooling device has been pulled', () => {
    expect(isThrottling(0, [{ name: 'devfreq-13000000.mali', value: 3 }])).toBe(
      true
    )
  })

  it('is false when the status could not be read and nothing is cooling', () => {
    expect(isThrottling(null, [])).toBe(false)
  })
})

describe('parseCpuTemperature', () => {
  it('averages the CPU zones of a real thermal service dump', () => {
    // "Cached temperatures" reports CPU=50.667, "Current temperatures from
    // HAL" reports CPU=31.07. Zones are keyed by name, so the later record
    // replaces the earlier one: only 31.07 is averaged, to three significant
    // digits as the app has always done for the CPU card.
    expect(
      parseCpuTemperature(
        readFixture('mtk-tb8781p4', 'dumpsys-thermalservice.txt')
      )
    ).toEqual({ ok: true, value: 31.1 })
  })

  it('keys by zone name, so a repeated zone counts once', () => {
    const record = (value: string) =>
      `\tTemperature{mValue=${value}, mType=0, mName=CPU, mStatus=0}`

    expect(parseCpuTemperature([record('50'), record('70')].join('\n'))).toEqual(
      { ok: true, value: 70 }
    )
  })

  it('averages every zone whose name starts with CPU', () => {
    const record = (name: string, value: string) =>
      `\tTemperature{mValue=${value}, mType=0, mName=${name}, mStatus=0}`

    expect(
      parseCpuTemperature(
        [
          record('CPU_BIG', '40'),
          record('CPU_LITTLE', '60'),
          record('GPU', '99'),
        ].join('\n')
      )
    ).toEqual({ ok: true, value: 50 })
  })

  it('rounds to three significant digits, not three decimals', () => {
    expect(
      parseCpuTemperature(
        '\tTemperature{mValue=100.5, mType=0, mName=CPU, mStatus=0}'
      )
    ).toEqual({ ok: true, value: 101 })
  })

  it('ignores threshold lines, which carry no reading', () => {
    const dump = [
      '\tTemperatureThreshold{mType=0, mName=CPU, mHotThrottlingThresholds=[85.0]}',
      '\tTemperature{mValue=45, mType=0, mName=CPU, mStatus=0}',
    ].join('\n')

    expect(parseCpuTemperature(dump)).toEqual({ ok: true, value: 45 })
  })

  it('reports a readable error when the device exposes no CPU zone', () => {
    const result = parseCpuTemperature(
      '\tTemperature{mValue=55, mType=1, mName=GPU, mStatus=0}'
    )

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.reason).toContain('CPU')
  })
})