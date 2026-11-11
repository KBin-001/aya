import average from 'licia/average'
import each from 'licia/each'
import isEmpty from 'licia/isEmpty'
import map from 'licia/map'
import identity from 'licia/identity'
import stripNum from 'licia/stripNum'
import toNum from 'licia/toNum'
import startWith from 'licia/startWith'
import trim from 'licia/trim'
import types from 'licia/types'
import { fail, ok, ParseResult } from './result'
import { ICoolingDevice, IThermalZone } from './types'

const regTemperature =
  /Temperature\{mValue=([\d.]+),\s*mType=(\d+),\s*mName=(\w+)/

const regCoolingDevice =
  /CoolingDevice\{mValue=(-?[\d.]+),\s*mType=(\d+),\s*mName=([^,}]+)/

const regThermalStatus = /Thermal Status:\s*(-?\d+)/

/**
 * The zone listing keeps negative readings, which some HALs use as a "sensor
 * unavailable" marker. The CPU card average deliberately keeps the original
 * unsigned pattern so its numbers stay exactly as they were.
 */
const regZoneTemperature =
  /Temperature\{mValue=(-?[\d.]+),\s*mType=(\d+),\s*mName=(\w+)/

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

/**
 * Zip the two glob reads of `/sys/class/thermal/thermal_zone*` into zones.
 *
 * The shell expands both globs in the same sorted order, so line i of the types
 * belongs to line i of the temperatures. Reading them as two globs rather than
 * one `cat` per zone keeps the per-tick cost to two processes instead of two
 * per zone, which matters when a device has thirty of them.
 *
 * A length mismatch means the zone set changed between the two reads, or a file
 * went unreadable: the pairing would be wrong, so the read is refused rather
 * than reported as garbage.
 */
export function parseThermalZones(
  typesText: string,
  temperaturesText: string,
): ParseResult<IThermalZone[]> {
  const names = typesText
    .split('\n')
    .map((name) => trim(name))
    .filter(Boolean)
  const temperatures = temperaturesText
    .split('\n')
    .map((temperature) => trim(temperature))
    .filter(Boolean)

  if (!names.length) {
    return fail('no thermal zone could be read from /sys/class/thermal')
  }
  if (names.length !== temperatures.length) {
    return fail(
      `thermal zone reads disagree: ${names.length} names, ${temperatures.length} temperatures`,
    )
  }

  const zones: IThermalZone[] = []
  names.forEach((name, index) => {
    const temperature = toNum(temperatures[index])
    if (!Number.isNaN(temperature)) {
      zones.push({ name, temperatureC: temperature / 1000 })
    }
  })

  if (isEmpty(zones)) {
    return fail('no thermal zone reported a usable temperature')
  }

  return ok(zones)
}

export interface IThermalServiceReading {
  thermalStatus: number | null
  coolingDevices: ICoolingDevice[]
  /** Zones the thermal HAL reports, when the device exposes them. */
  zones: IThermalZone[]
}

/**
 * Read the parts of `dumpsys thermalservice` that sysfs cannot answer: the
 * Android thermal status level, the cooling devices, and the HAL's own zone
 * list.
 *
 * The dump prints a stale "Cached temperatures" block before the live
 * "Current temperatures from HAL" one. When the live block exists it wins;
 * the cached block is only a fallback for devices that print nothing else.
 */
export function parseThermalService(
  thermalServiceText: string,
): ParseResult<IThermalServiceReading> {
  const cached: types.PlainObj<number> = {}
  const current: types.PlainObj<number> = {}
  const coolingDevices: ICoolingDevice[] = []
  let thermalStatus: number | null = null
  let section: 'cached' | 'current' | 'cooling' | 'other' = 'other'

  each(thermalServiceText.split('\n'), (line) => {
    if (line.includes('Cached temperatures')) {
      section = 'cached'
      return
    }
    if (line.includes('Current temperatures from HAL')) {
      section = 'current'
      return
    }
    if (line.includes('Current cooling devices')) {
      section = 'cooling'
      return
    }
    if (line.includes('Temperature static thresholds')) {
      section = 'other'
      return
    }

    const statusMatch = line.match(regThermalStatus)
    if (statusMatch) {
      thermalStatus = toNum(statusMatch[1])
      return
    }

    const temperatureMatch = line.match(regZoneTemperature)
    if (temperatureMatch) {
      const name = temperatureMatch[3]
      const value = toNum(temperatureMatch[1])
      if (section === 'current') {
        current[name] = value
      } else if (section === 'cached') {
        cached[name] = value
      }
      return
    }

    const coolingMatch = line.match(regCoolingDevice)
    if (coolingMatch) {
      coolingDevices.push({
        name: trim(coolingMatch[3]),
        value: toNum(coolingMatch[1]),
      })
    }
  })

  const zoneSource = isEmpty(current) ? cached : current
  const zones: IThermalZone[] = map(zoneSource, (temperatureC, name) => ({
    name,
    temperatureC,
  }))

  if (thermalStatus === null && isEmpty(zones) && isEmpty(coolingDevices)) {
    return fail('dumpsys thermalservice reported no status, zone or cooler')
  }

  return ok({ thermalStatus, coolingDevices, zones })
}

/**
 * True while the system is limiting performance to stay cool.
 *
 * Derived rather than read: a device is throttling when Android has raised the
 * thermal status above none, or when any cooling device is being driven.
 */
export function isThrottling(
  thermalStatus: number | null,
  coolingDevices: ICoolingDevice[],
): boolean {
  if (thermalStatus !== null && thermalStatus > 0) {
    return true
  }

  return coolingDevices.some((device) => device.value > 0)
}