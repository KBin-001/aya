import { describe, expect, it } from 'vitest'
import { readFixture } from './__fixtures__/load'
import { parseDumpsysBatteryPower, parsePowerSupplyBattery } from './power'

describe('parsePowerSupplyBattery', () => {
  it('reads voltage, current, temperature, status and level from the battery node', () => {
    // voltage_now 4301000 uV, current_now -1250000 uA, temp 292 deciC.
    expect(
      parsePowerSupplyBattery(
        readFixture('mtk-sysfs-reference', 'power-supply-battery.txt'),
      ),
    ).toEqual({
      ok: true,
      value: {
        source: 'power_supply',
        status: 'supported',
        levelPct: 62,
        voltageV: 4.301,
        // Charging, so current flows into the battery and reads negative.
        currentA: -1.25,
        powerW: -5.37625,
        state: 'charging',
        temperatureC: 29.2,
      },
    })
  })

  it('reads a discharging current as positive when the driver reports it positive', () => {
    const dump = [
      'voltage_now|3800000',
      'current_now|500000',
      'status|Discharging',
      'temp|300',
      'capacity|40',
    ].join('\n')

    const result = parsePowerSupplyBattery(dump)
    if (!result.ok) throw new Error('fixture should parse')

    expect(result.value.currentA).toBe(0.5)
    expect(result.value.powerW).toBe(1.9)
    expect(result.value.state).toBe('discharging')
  })

  it('normalises a charging current the driver reported as positive', () => {
    // Some kernels report charging current as positive. The reading is
    // discharge-positive either way, so the sign follows the status.
    const dump = [
      'voltage_now|4000000',
      'current_now|1000000',
      'status|Charging',
    ].join('\n')

    const result = parsePowerSupplyBattery(dump)
    if (!result.ok) throw new Error('fixture should parse')

    expect(result.value.currentA).toBe(-1)
  })

  it('reports power as unavailable, not zero, when current is missing', () => {
    const dump = 'voltage_now|4000000\ntemp|300\ncapacity|55\n'

    const result = parsePowerSupplyBattery(dump)
    if (!result.ok) throw new Error('fixture should parse')

    expect(result.value.currentA).toBeNull()
    expect(result.value.powerW).toBeNull()
    expect(result.value.voltageV).toBe(4)
    expect(result.value.temperatureC).toBe(30)
  })

  it('reports power as unavailable when voltage is missing but current is not', () => {
    const dump = 'current_now|500000\nstatus|Discharging\n'

    const result = parsePowerSupplyBattery(dump)
    if (!result.ok) throw new Error('fixture should parse')

    expect(result.value.currentA).toBe(0.5)
    expect(result.value.powerW).toBeNull()
  })

  it('treats an unparsable field as unavailable, never as NaN', () => {
    // A node that answers with words would otherwise reach the formatters and
    // print "NaN V" on screen.
    const dump =
      'voltage_now|4300000\ncurrent_now|n/a\ntemp|n/a\nstatus|Charging\n'

    const result = parsePowerSupplyBattery(dump)
    if (!result.ok) throw new Error('the status alone is still a reading')

    expect(result.value.voltageV).toBe(4.3)
    expect(result.value.currentA).toBeNull()
    expect(result.value.powerW).toBeNull()
    expect(result.value.temperatureC).toBeNull()
    expect(result.value.state).toBe('charging')
  })

  it('reports a readable error when the node answered nothing', () => {
    const result = parsePowerSupplyBattery('voltage_now|\ncurrent_now|\n')

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.reason).toContain('power_supply')
  })
})

describe('parseDumpsysBatteryPower', () => {
  it('reads the battery service dump, converting its units', () => {
    // The capture reports level 100, voltage 4294 mV, temperature 281 deciC and
    // status 5 (full).
    expect(
      parseDumpsysBatteryPower(
        readFixture('mtk-tb8781p4', 'dumpsys-battery.txt'),
      ),
    ).toEqual({
      ok: true,
      value: {
        source: 'dumpsys',
        status: 'supported',
        levelPct: 100,
        voltageV: 4.294,
        currentA: null,
        powerW: null,
        state: 'full',
        temperatureC: 28.1,
      },
    })
  })

  it('reads the current when the ROM reports one', () => {
    const dump = [
      'Current Battery Service state:',
      '  level: 80',
      '  voltage: 4000',
      '  current now: -900000',
      '  status: 2',
      '  temperature: 300',
    ].join('\n')

    const result = parseDumpsysBatteryPower(dump)
    if (!result.ok) throw new Error('fixture should parse')

    expect(result.value.currentA).toBe(-0.9)
    expect(result.value.powerW).toBe(-3.6)
    expect(result.value.state).toBe('charging')
  })

  it('maps every battery service status code', () => {
    const states = [
      ['2', 'charging'],
      ['3', 'discharging'],
      ['4', 'not-charging'],
      ['5', 'full'],
      ['1', 'unknown'],
    ] as const

    for (const [code, expected] of states) {
      const result = parseDumpsysBatteryPower(`  status: ${code}\n  level: 50`)
      if (!result.ok) throw new Error('expected a reading')
      expect(result.value.state).toBe(expected)
    }
  })

  it('reports a readable error when the dump carries nothing', () => {
    expect(parseDumpsysBatteryPower('').ok).toBe(false)
  })
})
