import sleep from 'licia/sleep'
import each from 'licia/each'
import map from 'licia/map'
import { shell } from './base'
import {
  attachCpuSpeeds,
  cpuLoadBetween,
  parseCpuFrequencies,
  parseCpuStat,
  parseCpuTemperature,
} from 'common/metrics'

const DEFAULT_PERIOD = 50

/** Shell command that reads the current frequency of one core. */
function cpuFrequencyPath(index: number): string {
  return `cat /sys/devices/system/cpu/cpu${index}/cpufreq/scaling_cur_freq`
}

export async function getCpuLoads(
  deviceId: string,
  allCpus: any[],
  period = 0,
) {
  const cpuLoads: number[] = []
  if (!period) {
    period = DEFAULT_PERIOD
  }

  return new Promise(function (resolve) {
    sleep(period).then(async () => {
      const newAllCpus = await getCpus(deviceId, false)
      each(allCpus, (cpu, idx) => {
        cpuLoads[idx] = cpuLoadBetween(cpu.times, newAllCpus[idx].times)
      })
      resolve(cpuLoads)
    })
  })
}

export async function getCpus(deviceId: string, speed = true) {
  const stat: string = await shell(deviceId, 'cat /proc/stat')

  const cpus = parseCpuStat(stat)
  if (!cpus.ok) {
    // A device that reports no cpu rows has always yielded an empty list here.
    // The parser keeps the reason; surfacing it is the metrics snapshot's job.
    return []
  }

  if (!speed) {
    return cpus.value
  }

  const freqs: string[] = await shell(
    deviceId,
    map(cpus.value, (cpu, idx) => cpuFrequencyPath(idx)),
  )
  const speeds = parseCpuFrequencies(freqs)

  return speeds.ok ? attachCpuSpeeds(cpus.value, speeds.value) : cpus.value
}

export async function getCpuTemperature(deviceId: string) {
  const thermal: string = await shell(deviceId, 'dumpsys thermalservice')

  const temperature = parseCpuTemperature(thermal)
  // The panel reads NaN as "no value" and formats it as is; turning this into
  // an explicit unsupported status belongs to the thermal ticket.
  return temperature.ok ? temperature.value : NaN
}
