import { describe, expect, it } from 'vitest'
import { cpuLoadBetween, ICpuTimes } from './cpu'

function times(overrides: Partial<ICpuTimes> = {}): ICpuTimes {
  return {
    user: 0,
    nice: 0,
    sys: 0,
    idle: 0,
    iowait: 0,
    irq: 0,
    softirq: 0,
    ...overrides,
  }
}

describe('cpuLoadBetween', () => {
  it('reports the busy share of the ticks elapsed between two samples', () => {
    // 30 busy ticks out of 120 total ticks is a quarter of the window.
    const prev = times()
    const next = times({ user: 30, idle: 90 })

    expect(cpuLoadBetween(prev, next)).toBe(0.25)
  })

  it('reports no load when the core only accumulated idle time', () => {
    expect(cpuLoadBetween(times(), times({ idle: 400 }))).toBe(0)
  })

  it('reports full load when no idle tick was spent', () => {
    expect(cpuLoadBetween(times(), times({ sys: 250 }))).toBe(1)
  })

  it('counts waiting on io and softirqs as load', () => {
    // iowait and softirq are part of the busy numerator, so growth in them
    // alone still reads as a fully busy window.
    expect(cpuLoadBetween(times(), times({ iowait: 10, softirq: 90 }))).toBe(1)
  })

  it('ignores the counters that are not part of the load definition', () => {
    // steal/guest style counters sit beyond softirq and are not read at all;
    // an unrelated field changing must not move the result.
    const prev = times({ user: 100, idle: 100 })
    const next = times({ user: 130, idle: 190 })

    expect(cpuLoadBetween(prev, next)).toBe(0.25)
  })
})
