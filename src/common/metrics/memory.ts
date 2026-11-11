import { fail, ok, ParseResult } from './result'
import { readField } from './text'

export interface IMemoryReading {
  /** Total physical memory in bytes. */
  memTotal: number
  /** Memory in use in bytes: total minus what the kernel can hand out. */
  memUsed: number
}

/**
 * Parse `/proc/meminfo` into total and used bytes.
 *
 * Used is derived from what is still available rather than from what is free,
 * because reclaimable page cache counts as used by the naive free/total pair
 * but not by the kernel. MemAvailable is missing on older kernels, so MemFree
 * is the fallback.
 */
export function parseMemInfo(memInfoText: string): ParseResult<IMemoryReading> {
  const total = readField('MemTotal', memInfoText)
  if (!total) {
    return fail('no MemTotal line in /proc/meminfo')
  }

  let free = readField('MemAvailable', memInfoText)
  if (!free) {
    free = readField('MemFree', memInfoText)
  }
  if (!free) {
    return fail(
      'no free memory line (MemAvailable or MemFree) in /proc/meminfo',
    )
  }

  const memTotal = parseInt(total, 10) * 1024
  const memFree = parseInt(free, 10) * 1024

  return ok({ memTotal, memUsed: memTotal - memFree })
}
