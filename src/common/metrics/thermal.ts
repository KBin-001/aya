import average from 'licia/average'
import each from 'licia/each'
import isEmpty from 'licia/isEmpty'
import map from 'licia/map'
import identity from 'licia/identity'
import stripNum from 'licia/stripNum'
import toNum from 'licia/toNum'
import startWith from 'licia/startWith'
import types from 'licia/types'
import { fail, ok, ParseResult } from './result'

const regTemperature =
  /Temperature\{mValue=([\d.]+),\s*mType=(\d+),\s*mName=(\w+)/

/**
 * Average temperature of the CPU zones reported by `dumpsys thermalservice`.
 *
 * Zones are keyed by name, so a dump that repeats a zone (the service prints a
 * cached block and a HAL block) keeps the last record only. The result carries
 * the three significant digits the CPU card has always shown.
 */
export function parseCpuTemperature(
  thermalServiceText: string,
): ParseResult<number> {
  const cpuTemperatures: types.PlainObj<number> = {}

  each(thermalServiceText.split('\n'), (line) => {
    const match = line.match(regTemperature)
    if (match && startWith(match[3], 'CPU')) {
      cpuTemperatures[match[3]] = toNum(match[1])
    }
  })

  if (isEmpty(cpuTemperatures)) {
    return fail('dumpsys thermalservice reported no CPU temperature zone')
  }

  return ok(stripNum(average(...map(cpuTemperatures, identity)), 3))
}
