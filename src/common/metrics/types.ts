import { ICpuTimes } from './cpu'

/**
 * How much a metric reading can be trusted.
 *
 * `pending` is the honest default for a domain the app does not read yet, so the
 * UI can say "not available here" instead of drawing an empty chart that looks
 * like a real measurement of zero.
 */
export type MetricStatus = 'supported' | 'unsupported' | 'error' | 'pending'

export interface IReading {
  /** Which candidate source answered, for troubleshooting. */
  source: string
  status: MetricStatus
  /** Human-readable explanation when status is not supported. */
  reason?: string
}

export interface IThermalZone {
  /** Zone name as the kernel exposes it, e.g. `cpu-0-0` or `mtktsbattery`. */
  name: string
  temperatureC: number
}

export interface ICoolingDevice {
  name: string
  /** How hard the governor is currently driving this device; 0 means idle. */
  value: number
}

export interface IThermalReading extends IReading {
  zones: IThermalZone[]
  /** Android thermal status level, 0 (none) and up. */
  thermalStatus: number | null
  /** True while the system is limiting performance to stay cool. */
  throttling: boolean
  coolingDevices: ICoolingDevice[]
}

export type IBatteryState =
  | 'charging'
  | 'discharging'
  | 'full'
  | 'not-charging'
  | 'unknown'

export interface IBatteryReading extends IReading {
  levelPct: number | null
  voltageV: number | null
  /** Positive while the battery drains, negative while it charges. */
  currentA: number | null
  /** Voltage times current; null when either is unavailable. */
  powerW: number | null
  state: IBatteryState | null
  temperatureC: number | null
}

export interface IDdrReading extends IReading {
  frequencyMhz: number | null
  availableMhz: number[]
}

export interface IDisplayReading extends IReading {
  brightnessPct: number | null
  refreshRateHz: number | null
  screenOn: boolean | null
}

export interface IGpuReading extends IReading {
  frequencyMhz: number | null
  loadPct: number | null
  governor: string | null
  throttled: boolean
}

export interface ICpuSnapshot extends IReading {
  cpus: { times: ICpuTimes; speed?: number }[]
  /** Busy share of each core over the sampling window, 0..1. */
  loads: number[]
  /** Average of the CPU temperature zones, three significant digits. */
  temperatureC: number | null
}

export interface IMemorySnapshot extends IReading {
  memTotal: number
  memUsed: number
}

export interface ITopPackage {
  name: string
  pid: number
}

/**
 * Everything the performance panel shows, sampled in one go.
 *
 * One snapshot per tick keeps the device cost flat as the panel grows: the
 * collector batches every read into a single shell round trip and the renderer
 * makes a single call, instead of one call per chart.
 */
export interface IMetricsSnapshot {
  timestamp: number
  cpu: ICpuSnapshot
  memory: IMemorySnapshot
  uptimeMs: number | null
  fps: number | null
  topPackage: ITopPackage | null
  thermal: IThermalReading
  battery: IBatteryReading
  ddr: IDdrReading
  display: IDisplayReading
  gpu: IGpuReading
}
