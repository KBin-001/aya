import toNum from 'licia/toNum'
import trim from 'licia/trim'
import stripNum from 'licia/stripNum'
import { fail, ok, ParseResult } from './result'
import { parseKeyedLines, readField } from './text'
import { IBatteryReading, IBatteryState } from './types'

const MICRO = 1e6

function toState(raw: string): IBatteryState | null {
  switch (trim(raw).toLowerCase()) {
    case 'charging':
      return 'charging'
    case 'discharging':
      return 'discharging'
    case 'full':
      return 'full'
    case 'not charging':
    case 'not-charging':
      return 'not-charging'
    case 'unknown':
      return 'unknown'
    default:
      return null
  }
}

/** Battery service status codes: 1 unknown, 2 charging, 3 discharging, 4 not
 * charging, 5 full. */
function toStateFromCode(code: string): IBatteryState | null {
  switch (trim(code)) {
    case '1':
      return 'unknown'
    case '2':
      return 'charging'
    case '3':
      return 'discharging'
    case '4':
      return 'not-charging'
    case '5':
      return 'full'
    default:
      return null
  }
}

/**
 * Put the current on the app's convention: positive while the battery drains.
 *
 * Kernels disagree about the sign of `current_now`, so the direction comes from
 * the charge state and only the magnitude is taken from the reading. A device
 * that reports no state keeps whatever sign its driver produced.
 */
function dischargePositive(currentA: number, state: IBatteryState | null) {
  if (state === 'charging' || state === 'full') {
    return -Math.abs(currentA)
  }
  if (state === 'discharging' || state === 'not-charging') {
    return Math.abs(currentA)
  }

  return currentA
}

/**
 * Read one sysfs field as a number.
 *
 * A field the kernel answered with something unparsable is unavailable, not
 * zero and not NaN: NaN would reach the formatters and the charts and turn into
 * "NaN V" on screen.
 */
function readNumber(raw: string | undefined, divisor: number) {
  if (!raw) {
    return null
  }
  const value = toNum(raw)
  return Number.isFinite(value) ? value / divisor : null
}

/** Power is a derived value, so trim the float noise the product carries. */
function roundPower(watts: number) {
  return stripNum(watts, 6)
}

function reading(
  source: string,
  levelPct: number | null,
  voltageV: number | null,
  rawCurrentA: number | null,
  state: IBatteryState | null,
  temperatureC: number | null,
): IBatteryReading {
  const currentA =
    rawCurrentA === null ? null : dischargePositive(rawCurrentA, state)

  return {
    source,
    status: 'supported',
    levelPct,
    voltageV,
    currentA,
    // Unavailable current or voltage makes the power unknown, not zero.
    powerW:
      voltageV !== null && currentA !== null
        ? roundPower(voltageV * currentA)
        : null,
    state,
    temperatureC,
  }
}

/**
 * Read the `power_supply` battery node.
 *
 * This is the preferred source: it reports the instantaneous current, which
 * `dumpsys battery` only carries on some ROMs.
 */
export function parsePowerSupplyBattery(
  nodeText: string,
): ParseResult<IBatteryReading> {
  const fields = parseKeyedLines(nodeText)
  const voltage = readNumber(fields.voltage_now, MICRO)
  const current = readNumber(fields.current_now, MICRO)
  const temperature = readNumber(fields.temp, 10)
  const level = readNumber(fields.capacity, 1)
  const state = fields.status ? toState(fields.status) : null

  if (voltage === null && current === null && temperature === null) {
    return fail('power_supply battery node reported nothing readable')
  }

  return ok(
    reading('power_supply', level, voltage, current, state, temperature),
  )
}

/**
 * Read the battery service dump, the fallback when no power_supply node is
 * readable. Units differ from sysfs: millivolts, tenths of a degree, and a
 * status code instead of a name.
 */
export function parseDumpsysBatteryPower(
  dumpsysBatteryText: string,
): ParseResult<IBatteryReading> {
  const level = readField('level', dumpsysBatteryText)
  const voltage = readField('voltage', dumpsysBatteryText)
  const temperature = readField('temperature', dumpsysBatteryText)
  const state = readField('status', dumpsysBatteryText)
  const current = readField('current now', dumpsysBatteryText)

  if (!level && !voltage && !temperature && !state) {
    return fail('dumpsys battery reported no battery state')
  }

  return ok(
    reading(
      'dumpsys',
      level ? toNum(level) : null,
      voltage ? toNum(voltage) / 1000 : null,
      current ? toNum(current) / MICRO : null,
      state ? toStateFromCode(state) : null,
      temperature ? toNum(temperature) / 10 : null,
    ),
  )
}
