import toNum from 'licia/toNum'
import trim from 'licia/trim'
import { fail, ok, ParseResult } from './result'
import { parseKeyedLines } from './text'

export type DevfreqKind = 'ddr' | 'gpu'

/**
 * Node names that carry the DDR / memory-controller clock, in rough order of
 * preference.
 *
 * DVFS resource controllers (MTK dvfsrc) are included on the inference that the
 * node driving memory bandwidth reports the memory clock. That has not been
 * verified against a readable node, so a device whose dvfsrc publishes
 * something else would show a wrong number under a right-looking label.
 */
const DDR_NODE_PATTERNS = [
  /ddr/i,
  /dram/i,
  /emi/i,
  /memlat/i,
  /dvfsrc/i,
  // Spreadtrum/Unisoc drives the DDR clock through its `scene-frequency` node
  // (the sprd-ddr-dvfs driver), which is not named after memory at all.
  /scene-frequency/i,
  // Generic bandwidth last: `cpubw` is a CPU cache/DDR interconnect node whose
  // clock is not the memory clock, so an explicit ddr node must win over it.
  /bw/i,
]

/** Node names that carry the GPU clock, across MTK, Qualcomm and Mali. */
const GPU_NODE_PATTERNS = [/mali/i, /gpu/i, /kgsl/i, /3d0/i]

const KIND_PATTERNS: Record<DevfreqKind, RegExp[]> = {
  ddr: DDR_NODE_PATTERNS,
  gpu: GPU_NODE_PATTERNS,
}

/**
 * Choose the node a domain should read, from the device's node listing.
 *
 * The first match wins and the caller caches it, so a device that exposes
 * several candidates keeps reporting through the same one for the whole
 * session instead of hopping between them as the listing order changes.
 */
export function selectDevfreqNode(
  nodeNames: string[],
  kind: DevfreqKind,
): string | null {
  for (const pattern of KIND_PATTERNS[kind]) {
    const match = nodeNames.find((nodeName) => pattern.test(nodeName))
    if (match) {
      return match
    }
  }

  return null
}

export interface IDevfreqReading {
  frequencyMhz: number | null
  /** Every frequency the node can run at, ascending. Empty when unpublished. */
  availableMhz: number[]
  governor: string | null
  loadPct: number | null
}

/**
 * The kernel's devfreq interface reports clocks in Hz, but Spreadtrum's
 * `scene-frequency` node publishes the DDR clock already in MHz - its custom
 * `sprd-governor` does not follow the Hz convention. The two are told apart by
 * magnitude: no real memory or GPU clock runs below one megahertz, so a value
 * under 1e6 is already a megahertz reading rather than a sub-megahertz clock.
 */
const HZ_VS_MHZ_FLOOR = 1e6

function readFrequencyMhz(raw: string | undefined): number | null {
  if (!raw) {
    return null
  }
  const value = toNum(raw)
  if (!Number.isFinite(value) || value <= 0) {
    return null
  }
  return value < HZ_VS_MHZ_FLOOR ? value : Math.round(value / 1e6)
}

/**
 * Parse one devfreq node's fields.
 *
 * Frequencies are reported in Hz by the kernel and shown in MHz, except by a
 * few nodes (Spreadtrum scene-frequency) that already publish MHz. A node that
 * publishes no frequency is a parse failure rather than a reading of zero, and
 * table entries that do not parse are dropped instead of poisoning the list.
 */
export function parseDevfreqReadings(
  nodeText: string,
): ParseResult<IDevfreqReading> {
  const fields = parseKeyedLines(nodeText)
  const frequencyMhz = readFrequencyMhz(fields.cur_freq)
  if (frequencyMhz === null) {
    return fail('the devfreq node reported no readable cur_freq')
  }

  const availableMhz = (fields.available_frequencies || '')
    .split(/\s+/)
    .map((entry) => readFrequencyMhz(entry))
    .filter((entry): entry is number => entry !== null)
    .filter((entry, index, all) => all.indexOf(entry) === index)
    .sort((left, right) => left - right)

  // Load is the exception to "greater than zero": an idle GPU reports exactly
  // 0, which is a reading, while a missing one is not.
  const rawLoad =
    fields.load === undefined || fields.load === '' ? null : toNum(fields.load)
  const load = rawLoad !== null && Number.isFinite(rawLoad) ? rawLoad : null
  const governor = trim(fields.governor || '')

  return ok({
    frequencyMhz,
    availableMhz,
    governor: governor || null,
    // A load above 100 is a raw counter, not a percentage: drop it rather than
    // drawing a 4000% graph.
    loadPct: load !== null && load <= 100 ? load : null,
  })
}
