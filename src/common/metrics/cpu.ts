import each from 'licia/each'
import trim from 'licia/trim'
import toNum from 'licia/toNum'
import startWith from 'licia/startWith'
import { fail, ok, ParseResult } from './result'

export interface ICpuTimes {
  user: number
  nice: number
  sys: number
  idle: number
  iowait: number
  irq: number
  softirq: number
}

export interface ICpuReading {
  times: ICpuTimes
  /** Current frequency in MHz. Absent when no frequency could be read. */
  speed?: number
}

/**
 * Busy share of the ticks between two samples of the same core, in 0..1.
 *
 * Busy is everything except idle: user, nice, sys, irq, iowait and softirq all
 * count as work. The formula is the one the app has always used, so the charts
 * keep reading the same numbers.
 */
export function cpuLoadBetween(prev: ICpuTimes, next: ICpuTimes): number {
  const busyOf = (times: ICpuTimes) =>
    times.user +
    times.sys +
    times.nice +
    times.irq +
    times.iowait +
    times.softirq

  const prevLoad = busyOf(prev)
  const prevTick = prevLoad + prev.idle
  const load = busyOf(next)
  const tick = load + next.idle

  return (load - prevLoad) / (tick - prevTick)
}

/** `cpuN` label plus the seven tick counters the load formula reads. */
const MIN_CPU_ROW_PARTS = 8

/**
 * Parse `/proc/stat` into one reading per core, times only.
 *
 * The device-wide `cpu` row is skipped: the panel charts per core, and mixing
 * the aggregate into that list would double count every tick. A row too short
 * to carry all seven counters is dropped rather than filled with zeroes, so a
 * truncated line cannot quietly report a busy core as idle.
 */
export function parseCpuStat(statText: string): ParseResult<ICpuReading[]> {
  const cpus: ICpuReading[] = []

  each(statText.split('\n'), (line) => {
    line = trim(line)
    if (!startWith(line, 'cpu')) {
      return
    }

    const parts = line.split(/\s+/)
    if (parts[0] === 'cpu' || parts.length < MIN_CPU_ROW_PARTS) {
      return
    }

    cpus.push({
      times: {
        user: toNum(parts[1]),
        nice: toNum(parts[2]),
        sys: toNum(parts[3]),
        idle: toNum(parts[4]),
        iowait: toNum(parts[5]),
        irq: toNum(parts[6]),
        softirq: toNum(parts[7]),
      },
    })
  })

  if (!cpus.length) {
    return fail('no cpu rows found in /proc/stat')
  }

  return ok(cpus)
}

/**
 * Turn the raw `scaling_cur_freq` reads (kHz) into MHz.
 *
 * A read that came back empty is dropped: that core is offline or unreadable.
 * If none of them produced a number the whole read failed, which the caller
 * reports as "no frequency for this device" rather than as zero hertz.
 */
export function parseCpuFrequencies(
  frequencyReadings: string[],
): ParseResult<number[]> {
  const speeds: number[] = []

  each(frequencyReadings, (reading) => {
    reading = trim(reading)
    if (!reading) {
      return
    }
    speeds.push(Math.floor(toNum(reading) / 1000))
  })

  if (!speeds.length) {
    return fail('no core reported a readable scaling_cur_freq')
  }

  return ok(speeds)
}

/**
 * Attach frequencies to cores, position by position.
 *
 * Known defect, preserved deliberately: a core that printed nothing loses its
 * entry, so later cores shift up and can take a neighbour's frequency. Fixing
 * it changes what the CPU cards show on a device with an offline core, which
 * this migration must not do. Tracked in issues/09-cpu-frequency-alignment.md.
 */
export function attachCpuSpeeds(
  cpus: ICpuReading[],
  speedsMhz: number[],
): ICpuReading[] {
  return cpus.map((cpu, idx) => ({ ...cpu, speed: speedsMhz[idx] }))
}
