import toNum from 'licia/toNum'
import { fail, ok, ParseResult } from './result'
import { readField } from './text'

export interface IBatteryReadings {
  /** Charge level in percent. */
  levelPct: number
  /**
   * Battery temperature in tenths of a degree Celsius, exactly as the battery
   * service reports it (281 is 28.1 degrees). Kept in device units so the
   * legacy IPC payload stays byte-identical; conversion belongs to the view.
   */
  temperatureDeciC: number
  /** Battery voltage in millivolts. */
  voltageMv: number
}

/**
 * Parse the fields of `dumpsys battery` that the performance panel shows.
 *
 * A field the device does not report stays at zero, which is the value the app
 * has always produced for it. Only a dump with none of them is treated as a
 * parse failure.
 */
export function parseBattery(
  dumpsysBatteryText: string,
): ParseResult<IBatteryReadings> {
  const level = readField('level', dumpsysBatteryText)
  const temperature = readField('temperature', dumpsysBatteryText)
  const voltage = readField('voltage', dumpsysBatteryText)

  if (!level && !temperature && !voltage) {
    return fail('dumpsys battery reported no battery fields')
  }

  return ok({
    levelPct: toNum(level),
    temperatureDeciC: toNum(temperature),
    voltageMv: toNum(voltage),
  })
}
