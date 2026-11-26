import contain from 'licia/contain'
import isEmpty from 'licia/isEmpty'
import map from 'licia/map'
import now from 'licia/now'
import toNum from 'licia/toNum'
import trim from 'licia/trim'
import {
  attachCpuSpeeds,
  cpuLoadBetween,
  isGpuThrottled,
  isThrottling,
  parseBrightness,
  parseDevfreqReadings,
  parseDisplayInfo,
  selectDevfreqNode,
  parseCpuFrequencies,
  parseCpuStat,
  parseCpuTemperature,
  parseDumpsysBatteryPower,
  parseMemInfo,
  parsePowerSupplyBattery,
  parseThermalService,
  parseThermalZones,
  IBatteryReading,
  ICpuSnapshot,
  IDevfreqReading,
  IDdrReading,
  IDisplayReading,
  IGpuReading,
  IMemorySnapshot,
  IMetricsSnapshot,
  IThermalReading,
  ITopPackage,
} from 'common/metrics'

/**
 * Runs a batch of device shell commands. Injected so the collector can be
 * exercised without an adb connection.
 */
export type RunShell = (commands: string[]) => Promise<string[]>

/**
 * Thermal zones, read as two globs.
 *
 * The shell expands both globs in the same sorted order, so the names and the
 * temperatures line up. One `cat` per zone would spawn two processes per zone
 * - around three seconds on a device with thirty of them.
 */
const THERMAL_ZONE_TYPES =
  'cat /sys/class/thermal/thermal_zone*/type 2>/dev/null'
const THERMAL_ZONE_TEMPS =
  'cat /sys/class/thermal/thermal_zone*/temp 2>/dev/null'

type DevfreqAccess = 'shell' | 'su'

/** Use the same devfreq read command for probing and sampling. */
function devfreqScan(
  node: string,
  access: DevfreqAccess = 'shell',
  kind?: 'gpu',
): string {
  // MediaTek Mali can publish GPU load through GED instead of devfreq.
  const fallback =
    kind === 'gpu'
      ? ' || { [ "$f" = load ] && cat /sys/module/ged/parameters/gpu_loading 2>/dev/null; }'
      : ''
  const scan = `for f in cur_freq available_frequencies governor load; do echo "$f|$(cat "/sys/class/devfreq/${node}/$f" 2>/dev/null${fallback})"; done`
  return access === 'su' ? `su 0 sh -c '${scan}' 2>/dev/null` : scan
}

/** One field per line, so the parser keeps the boundaries between files. */
const POWER_SUPPLY_SCAN =
  'for f in voltage_now current_now temp status capacity; do echo "$f|$(cat /sys/class/power_supply/battery/$f 2>/dev/null)"; done'

interface IDeviceProbe {
  /** How many per-core frequency files to read each tick. */
  cores: number
  /** The kernel lists thermal zones at all. */
  thermalZones: boolean
  /**
   * The zone files answered a read. On most production builds SELinux refuses
   * them to the shell user, and probing once keeps a refused 30-zone scan from
   * costing three seconds on every single tick.
   */
  thermalZonesReadable: boolean
  powerSupplyBattery: boolean
  /** The node answered a read, so the battery service dump is not needed. */
  powerSupplyReadable: boolean
  /** devfreq node carrying the DDR clock, when the device has one. */
  ddrNode: string | null
  /** devfreq node carrying the GPU clock, when the device has one. */
  gpuNode: string | null
  /** Unreadable nodes are skipped on subsequent samples. */
  ddrAccess?: DevfreqAccess
  gpuAccess?: DevfreqAccess
  /** Range of the backlight scale, when a backlight node publishes one. */
  brightnessMax: number | null
}

interface IRead {
  key: string
  command: string
}

/** What each device exposes; filled on first use and dropped on reconnect. */
const probes = new Map<string, IDeviceProbe>()

const PENDING_REASON = 'not sampled yet'

function pendingDisplay(): IDisplayReading {
  return {
    source: '',
    status: 'pending',
    reason: PENDING_REASON,
    brightnessPct: null,
    brightnessRaw: null,
    brightnessMax: null,
    refreshRateHz: null,
    screenOn: null,
  }
}

function emptyBattery(
  status: IBatteryReading['status'],
  source: string,
  reason: string,
): IBatteryReading {
  return {
    source,
    status,
    reason,
    levelPct: null,
    voltageV: null,
    currentA: null,
    powerW: null,
    state: null,
    temperatureC: null,
  }
}

/**
 * Work out once per device what it exposes, so the per-tick batch only reads
 * paths that exist. A device that gains or loses a node needs a reconnect,
 * which is exactly when the cache is dropped.
 */
async function probeDevice(runShell: RunShell): Promise<IDeviceProbe> {
  const [
    stat,
    thermalDir,
    thermalTemps,
    powerSupply,
    powerSupplyFields,
    devfreqNodes,
    backlightMax,
    debuggable,
  ] = await runShell([
    'cat /proc/stat',
    'ls /sys/class/thermal 2>/dev/null',
    THERMAL_ZONE_TEMPS,
    'ls /sys/class/power_supply/battery 2>/dev/null',
    POWER_SUPPLY_SCAN,
    'ls -1 /sys/class/devfreq 2>/dev/null',
    'cat /sys/class/backlight/*/max_brightness 2>/dev/null',
    'getprop ro.debuggable',
  ])

  const cpus = parseCpuStat(stat)
  const nodeNames = (devfreqNodes || '')
    .split(/\s+/)
    .filter((node) => /^[\w.-]+$/.test(node))
  const ddrNode = selectDevfreqNode(nodeNames, 'ddr')
  const gpuNode = selectDevfreqNode(nodeNames, 'gpu')

  // A node that exists but refuses reads would cost a useless command on every
  // tick, so the probe settles readability once, here.
  const nodesToVerify = [ddrNode, gpuNode].filter(
    (node): node is string => node !== null,
  )
  const verifications = nodesToVerify.length
    ? await runShell(nodesToVerify.map((node) => devfreqScan(node)))
    : []
  const verified = new Map<string, DevfreqAccess>()
  const unreadable = nodesToVerify.filter((node, index) => {
    if (!parseDevfreqReadings(verifications[index] || '').ok) return true
    verified.set(node, 'shell')
    return false
  })

  if (trim(debuggable || '') === '1' && unreadable.length) {
    const privileged = await runShell(
      unreadable.map((node) => devfreqScan(node, 'su')),
    )
    unreadable.forEach((node, index) => {
      if (parseDevfreqReadings(privileged[index] || '').ok)
        verified.set(node, 'su')
    })
  }
  // Several backlight nodes would print several maxima on one line, which is
  // not a range; only a single number is usable.
  const backlightMaxText = trim(backlightMax || '')
  const backlightMaxValue = toNum(backlightMaxText)
  const brightnessMax =
    /^\d+$/.test(backlightMaxText) && Number.isFinite(backlightMaxValue)
      ? backlightMaxValue
      : null

  return {
    cores: cpus.ok ? cpus.value.length : 0,
    thermalZones: contain(thermalDir || '', 'thermal_zone'),
    thermalZonesReadable: /^-?\d+/.test(trim(thermalTemps || '')),
    powerSupplyBattery: !isEmpty(trim(powerSupply || '')),
    powerSupplyReadable: parsePowerSupplyBattery(powerSupplyFields || '').ok,
    ddrNode,
    gpuNode,
    ddrAccess: ddrNode ? verified.get(ddrNode) : undefined,
    gpuAccess: gpuNode ? verified.get(gpuNode) : undefined,
    brightnessMax,
  }
}

/**
 * The reads of one tick, in a single batch.
 *
 * Everything the panel shows is read here in one shell round trip: the cost of
 * a tick stays flat as the panel grows, instead of one round trip per chart.
 * The cpu load needs two samples a moment apart, so the second `/proc/stat`
 * read sleeps inside the batch rather than in the main process.
 */
function buildReads(probe: IDeviceProbe): IRead[] {
  const reads: IRead[] = [
    { key: 'stat:first', command: 'cat /proc/stat' },
    { key: 'stat:second', command: 'sleep 0.05; cat /proc/stat' },
  ]

  for (let core = 0; core < probe.cores; core++) {
    reads.push({
      key: `freq:${core}`,
      command: `cat /sys/devices/system/cpu/cpu${core}/cpufreq/scaling_cur_freq`,
    })
  }

  if (probe.thermalZones && probe.thermalZonesReadable) {
    reads.push({ key: 'thermal:types', command: THERMAL_ZONE_TYPES })
    reads.push({ key: 'thermal:temps', command: THERMAL_ZONE_TEMPS })
  }
  reads.push({ key: 'thermal:service', command: 'dumpsys thermalservice' })

  // Read the battery node when it answered at probe time, and the service dump
  // otherwise. The node is detected by reading its fields rather than by
  // listing the directory: some boards refuse `ls` to the shell user but still
  // allow `cat`.
  if (probe.powerSupplyReadable) {
    reads.push({ key: 'battery:node', command: POWER_SUPPLY_SCAN })
  } else {
    reads.push({ key: 'battery:dumpsys', command: 'dumpsys battery' })
  }

  if (probe.ddrAccess && probe.ddrNode) {
    reads.push({
      key: 'ddr',
      command: devfreqScan(probe.ddrNode, probe.ddrAccess),
    })
  }
  if (probe.gpuAccess && probe.gpuNode) {
    reads.push({
      key: 'gpu',
      command: devfreqScan(probe.gpuNode, probe.gpuAccess, 'gpu'),
    })
  }

  // The panel state line and the device info line come back together, grepped
  // out of a dump that runs to hundreds of kilobytes.
  reads.push({
    key: 'display',
    command: 'dumpsys display | grep -m2 -E "DisplayDeviceInfo|Display State="',
  })
  // The kernel backlight node reports the level and its range in the same
  // units, so the percentage is read from it. The Android `screen_brightness`
  // setting is a 0-255 software level that does not match a 0-4095 panel (which
  // would show 5% where the panel is really at 75%), so it is only a fallback
  // for devices that publish no backlight node at all.
  reads.push({
    key: 'brightness',
    command:
      probe.brightnessMax === null
        ? 'settings get system screen_brightness'
        : 'cat /sys/class/backlight/*/brightness 2>/dev/null',
  })

  reads.push({ key: 'memory', command: 'cat /proc/meminfo' })
  reads.push({ key: 'uptime', command: 'cat /proc/uptime' })

  // Both of these dumps run to megabytes. Only the line the parser reads is
  // requested, which is the same line it would have found in the full dump.
  reads.push({
    key: 'top',
    command: 'dumpsys activity | grep -m1 top-activity',
  })
  reads.push({
    key: 'fps',
    command: 'dumpsys SurfaceFlinger | grep -m1 flips=',
  })

  return reads
}

function readCpu(
  outputs: Record<string, string>,
  probe: IDeviceProbe,
): ICpuSnapshot {
  const first = parseCpuStat(outputs['stat:first'] || '')
  const second = parseCpuStat(outputs['stat:second'] || '')
  const temperature = parseCpuTemperature(outputs['thermal:service'] || '')
  const temperatureC = temperature.ok ? temperature.value : null

  if (!first.ok || !second.ok) {
    const reason = first.ok ? (second.ok ? '' : second.reason) : first.reason
    return {
      source: 'proc_stat',
      status: 'error',
      reason,
      cpus: [],
      loads: [],
      temperatureC,
    }
  }

  const frequencies: string[] = []
  for (let core = 0; core < probe.cores; core++) {
    frequencies.push(outputs[`freq:${core}`] || '')
  }
  const speeds = parseCpuFrequencies(frequencies)

  // A window with no elapsed ticks (a device that ignored the fractional
  // sleep) would divide by zero; report no load for it instead of NaN.
  const loads = map(second.value, (cpu, index) => {
    const previous = first.value[index]
    if (!previous) {
      return 0
    }
    const load = cpuLoadBetween(previous.times, cpu.times)
    return Number.isFinite(load) ? load : 0
  })

  return {
    source: 'proc_stat',
    status: 'supported',
    cpus: speeds.ok ? attachCpuSpeeds(first.value, speeds.value) : first.value,
    loads,
    temperatureC,
  }
}

function readMemory(outputs: Record<string, string>): IMemorySnapshot {
  const memory = parseMemInfo(outputs.memory || '')
  if (!memory.ok) {
    return {
      source: 'proc_meminfo',
      status: 'error',
      reason: memory.reason,
      memTotal: 0,
      memUsed: 0,
    }
  }

  return { source: 'proc_meminfo', status: 'supported', ...memory.value }
}

function readThermal(
  outputs: Record<string, string>,
  probe: IDeviceProbe,
): IThermalReading {
  const service = parseThermalService(outputs['thermal:service'] || '')
  const thermalStatus = service.ok ? service.value.thermalStatus : null
  const coolingDevices = service.ok ? service.value.coolingDevices : []
  const throttling = isThrottling(thermalStatus, coolingDevices)

  if (probe.thermalZones && probe.thermalZonesReadable) {
    const zones = parseThermalZones(
      outputs['thermal:types'] || '',
      outputs['thermal:temps'] || '',
    )
    if (zones.ok) {
      return {
        source: 'sysfs',
        status: 'supported',
        zones: zones.value,
        thermalStatus,
        throttling,
        coolingDevices,
      }
    }
  }

  // Zones the thermal HAL reports are a reasonable stand-in when the kernel
  // zone scan is empty (some devices hide /sys/class/thermal from the shell).
  if (service.ok && !isEmpty(service.value.zones)) {
    return {
      source: 'dumpsys_hal',
      status: 'supported',
      zones: service.value.zones,
      thermalStatus,
      throttling,
      coolingDevices,
    }
  }

  if (!probe.thermalZones) {
    return {
      source: '',
      status: 'unsupported',
      reason: 'this device exposes no thermal zones',
      zones: [],
      thermalStatus,
      throttling,
      coolingDevices,
    }
  }

  return {
    source: 'sysfs',
    status: 'error',
    reason: probe.thermalZonesReadable
      ? 'the thermal zone reads disagreed with each other'
      : 'thermal zones are not readable without root (permission denied)',
    zones: [],
    thermalStatus,
    throttling,
    coolingDevices,
  }
}

type DevfreqOutcome =
  | { status: 'supported'; reading: IDevfreqReading }
  | { status: 'error' | 'unsupported'; source: string; reason: string }

/**
 * Read one devfreq-backed domain.
 *
 * DDR and GPU differ only in their node and their wording, so they share this:
 * the three ways a domain can fail (no node, a node that refuses reads, a node
 * that stopped answering) must read the same in both sections.
 */
function readDevfreqSource(
  node: string | null,
  access: DevfreqAccess | undefined,
  nodeText: string,
  domain: 'DDR' | 'GPU',
): DevfreqOutcome {
  if (node && access) {
    const reading = parseDevfreqReadings(nodeText)
    if (reading.ok) {
      return { status: 'supported', reading: reading.value }
    }

    return {
      status: 'error',
      source: node,
      reason: `the devfreq node ${node} stopped reporting a frequency`,
    }
  }

  if (node) {
    return {
      status: 'error',
      source: node,
      reason: `the devfreq node ${node} is not readable without root`,
    }
  }

  return {
    status: 'unsupported',
    source: '',
    reason: `this device exposes no ${domain} frequency node the shell may read`,
  }
}

function readDdr(
  outputs: Record<string, string>,
  probe: IDeviceProbe,
): IDdrReading {
  const outcome = readDevfreqSource(
    probe.ddrNode,
    probe.ddrAccess,
    outputs.ddr || '',
    'DDR',
  )

  if (outcome.status !== 'supported') {
    return {
      source: outcome.source,
      status: outcome.status,
      reason: outcome.reason,
      frequencyMhz: null,
      availableMhz: [],
    }
  }

  return {
    source: probe.ddrNode || '',
    status: 'supported',
    frequencyMhz: outcome.reading.frequencyMhz,
    availableMhz: outcome.reading.availableMhz,
  }
}

function readGpu(
  deviceId: string,
  outputs: Record<string, string>,
  probe: IDeviceProbe,
): IGpuReading {
  const outcome = readDevfreqSource(
    probe.gpuNode,
    probe.gpuAccess,
    outputs.gpu || '',
    'GPU',
  )

  if (outcome.status !== 'supported') {
    return {
      source: outcome.source,
      status: outcome.status,
      reason: outcome.reason,
      frequencyMhz: null,
      loadPct: null,
      governor: null,
      throttled: false,
    }
  }

  const { frequencyMhz, loadPct, governor } = outcome.reading
  // The top a GPU reaches is the honest reference for "held back": the
  // frequency table is not always published and some nodes lie in it.
  const observed = Math.max(maxGpuMhz[deviceId] || 0, frequencyMhz || 0)
  maxGpuMhz[deviceId] = observed

  return {
    source: probe.gpuNode || '',
    status: 'supported',
    frequencyMhz,
    loadPct,
    governor,
    throttled: isGpuThrottled(frequencyMhz, observed, governor),
  }
}

/** Highest GPU frequency each device has been seen running at. */
const maxGpuMhz: Record<string, number> = {}

function readDisplay(
  outputs: Record<string, string>,
  probe: IDeviceProbe,
): IDisplayReading {
  const info = parseDisplayInfo(outputs.display || '')
  const brightness = parseBrightness(
    outputs.brightness || '',
    probe.brightnessMax === null ? null : String(probe.brightnessMax),
  )

  if (!info.ok && !brightness.ok) {
    return {
      ...pendingDisplay(),
      status: 'unsupported',
      reason: 'dumpsys display and the brightness setting both went unreadable',
    }
  }

  return {
    source: 'dumpsys_display',
    status: 'supported',
    brightnessPct: brightness.ok ? brightness.value.brightnessPct : null,
    brightnessRaw: brightness.ok ? brightness.value.brightnessRaw : null,
    brightnessMax: brightness.ok ? brightness.value.brightnessMax : null,
    refreshRateHz: info.ok ? info.value.refreshRateHz : null,
    screenOn: info.ok ? info.value.screenOn : null,
  }
}

function readBattery(
  outputs: Record<string, string>,
  probe: IDeviceProbe,
): IBatteryReading {
  if (probe.powerSupplyReadable) {
    const node = parsePowerSupplyBattery(outputs['battery:node'] || '')
    if (node.ok) {
      return node.value
    }
  }

  const fallback = parseDumpsysBatteryPower(outputs['battery:dumpsys'] || '')
  if (fallback.ok) {
    return fallback.value
  }

  return probe.powerSupplyReadable
    ? emptyBattery(
        'error',
        'power_supply',
        'the battery node and the battery service both went unreadable',
      )
    : emptyBattery('unsupported', '', 'this device reported no battery state')
}

function readUptimeMs(outputs: Record<string, string>): number | null {
  const [seconds] = (outputs.uptime || '').split(' ')
  const value = toNum(seconds)

  // A missing or unparsable /proc/uptime is "no value", not zero and not NaN:
  // the toolbar would otherwise claim the device has just booted.
  if (!trim(seconds) || !Number.isFinite(value)) {
    return null
  }

  return Math.round(value * 1000)
}

/**
 * Parse the focused activity out of the `top-activity` line.
 *
 * The shape is upstream's: the second-to-last token is `<pid>:<package>`.
 */
function readTopPackage(outputs: Record<string, string>): ITopPackage | null {
  const line = trim(outputs.top || '')
  if (!line) {
    return null
  }

  const tokens = line.split(/\s+/)
  if (tokens.length < 2) {
    return null
  }

  // Upstream reads the second-to-last token as "<pid>:<package>". Older and
  // newer dumps put that token in different places, so fall back to whichever
  // token carries the shape rather than declaring the line unparsable.
  let parts = tokens[tokens.length - 2].split(':')
  if (parts.length < 2 || Number.isNaN(parseInt(parts[0], 10))) {
    const token = tokens.find((candidate) => /^\d+:[\w.]+/.test(candidate))
    if (!token) {
      return null
    }
    parts = token.split(':')
  }

  let name = parts[1]
  if (contain(name, '/')) {
    name = name.split('/')[0]
  }

  return { name, pid: parseInt(parts[0], 10) }
}

/**
 * Frames per second from the SurfaceFlinger flip counter.
 *
 * The counter is cumulative, so the rate comes from the difference against the
 * previous sample. Devices whose SurfaceFlinger prints no flip counter report
 * no rate here: the per-layer latency fallback needs a shell call per layer,
 * which would defeat the point of sampling everything in one batch.
 */
const lastFlips: Record<string, { time: number; flips: number }> = {}

function readFps(
  deviceId: string,
  outputs: Record<string, string>,
  timestamp: number,
): number | null {
  const match = (outputs.fps || '').match(/flips=(\d+)/)
  if (!match) {
    return null
  }

  const flips = toNum(match[1])
  const previous = lastFlips[deviceId]
  lastFlips[deviceId] = { time: timestamp, flips }

  if (!previous) {
    return 0
  }

  const elapsed = timestamp - previous.time
  if (elapsed <= 0) {
    return 0
  }

  return Math.round(((flips - previous.flips) * 1000) / elapsed)
}

/**
 * Drop the per-device state, so a reconnect starts from a clean slate.
 *
 * The device list changing is the one moment the cached probe can be wrong (a
 * different board behind the same serial, a node appearing after an update).
 */
export function forgetDevices() {
  probes.clear()
  Object.keys(lastFlips).forEach((deviceId) => {
    delete lastFlips[deviceId]
  })
  Object.keys(maxGpuMhz).forEach((deviceId) => {
    delete maxGpuMhz[deviceId]
  })
}

/**
 * Sample everything the performance panel shows, in one batched round trip.
 *
 * `probes` is per-device state and must outlive a single call; tests pass their
 * own map, production passes the module-level cache.
 */
export async function collectMetrics(
  deviceId: string,
  runShell: RunShell,
  probeCache: Map<string, IDeviceProbe> = probes,
): Promise<IMetricsSnapshot> {
  let probe = probeCache.get(deviceId)
  if (!probe) {
    probe = await probeDevice(runShell)
    probeCache.set(deviceId, probe)
  }

  const reads = buildReads(probe)
  const results = await runShell(map(reads, (read) => read.command))

  const outputs: Record<string, string> = {}
  reads.forEach((read, index) => {
    outputs[read.key] = results[index] === undefined ? '' : results[index]
  })

  const timestamp = now()
  const battery = readBattery(outputs, probe)
  const ddr = readDdr(outputs, probe)
  const gpu = readGpu(deviceId, outputs, probe)

  // The probe said the battery node was readable, so the battery service dump
  // was not even requested. If the node then failed, drop the probe: the next
  // tick probes again and brings the fallback command back with it.
  if (
    (battery.status === 'error' && probe.powerSupplyReadable) ||
    (ddr.status === 'error' && probe.ddrAccess) ||
    (gpu.status === 'error' && probe.gpuAccess)
  ) {
    probeCache.delete(deviceId)
  }

  return {
    timestamp,
    cpu: readCpu(outputs, probe),
    memory: readMemory(outputs),
    uptimeMs: readUptimeMs(outputs),
    fps: readFps(deviceId, outputs, timestamp),
    topPackage: readTopPackage(outputs),
    thermal: readThermal(outputs, probe),
    battery,
    ddr,
    display: readDisplay(outputs, probe),
    gpu,
  }
}
