import { describe, expect, it } from 'vitest'
import { readFixture } from 'common/metrics/__fixtures__/load'
import { collectMetrics, forgetDevices, RunShell } from './metrics'

/**
 * A shell that answers from a table instead of talking to a device, and records
 * every call, so tests can assert both the readings and the cost of reading
 * them.
 */
function fakeShell(outputs: Record<string, string>) {
  const calls: string[][] = []

  const run: RunShell = async (commands) => {
    calls.push(commands)
    return commands.map((command) => {
      if (command.includes('ls /sys/class/thermal')) {
        return outputs['probe:thermal'] ?? ''
      }
      if (command.includes('ls /sys/class/power_supply')) {
        return outputs['probe:power'] ?? ''
      }
      if (command.includes('scaling_cur_freq')) {
        const core = /cpu(\d+)/.exec(command)?.[1]
        return outputs['freq:' + core] ?? ''
      }
      if (command.includes('thermal_zone*/type')) {
        return outputs['thermal:types'] ?? ''
      }
      if (command.includes('thermal_zone*/temp')) {
        return outputs['thermal:temps'] ?? ''
      }
      if (command.includes('dumpsys thermalservice')) {
        return outputs['thermal:service'] ?? ''
      }
      if (command.includes('power_supply/battery')) {
        return outputs['battery:node'] ?? ''
      }
      if (command.includes('dumpsys battery')) {
        return outputs['battery:dumpsys'] ?? ''
      }
      if (command.includes('/proc/meminfo')) {
        return outputs.memory ?? ''
      }
      if (command.includes('/proc/uptime')) {
        return outputs.uptime ?? ''
      }
      if (command.includes('top-activity')) {
        return outputs.top ?? ''
      }
      if (command.includes('flips=')) {
        return outputs.fps ?? ''
      }
      if (command.includes('sleep 0.05')) {
        return outputs['stat:b'] ?? ''
      }
      if (command.includes('/proc/stat')) {
        return outputs['stat:a'] ?? ''
      }
      return ''
    })
  }

  return { run, calls }
}

const stat = readFixture('mtk-tb8781p4', 'proc-stat.txt')
const thermalService = readFixture('mtk-tb8781p4', 'dumpsys-thermalservice.txt')
const memoryInfo = readFixture('mtk-tb8781p4', 'proc-meminfo.txt')
const batteryDump = readFixture('mtk-tb8781p4', 'dumpsys-battery.txt')
const zoneTypes = readFixture('mtk-sysfs-reference', 'thermal-zones-types.txt')
const zoneTemps = readFixture('mtk-sysfs-reference', 'thermal-zones-temps.txt')
const powerNode = readFixture('mtk-sysfs-reference', 'power-supply-battery.txt')

// The upstream parser takes the second-to-last token and splits it on ':' to
// read "<pid>:<package>". The parsing is unchanged; only the command that feeds
// it is (a grep of the same line instead of the whole activity dump).
const topLine = '  top-activity 4242:com.example.player'

function healthyOutputs(): Record<string, string> {
  const outputs: Record<string, string> = {
    'probe:thermal': 'cooling_device0 cooling_device1 thermal_zone0 thermal_zone1',
    'probe:power': 'capacity current_now status temp voltage_now',
    'stat:a': stat,
    'stat:b': stat,
    'thermal:types': zoneTypes,
    'thermal:temps': zoneTemps,
    'thermal:service': thermalService,
    'battery:node': powerNode,
    'battery:dumpsys': batteryDump,
    memory: memoryInfo,
    uptime: '12345.67 98765.43',
    top: topLine,
    fps: 'flips=9241',
  }
  for (let i = 0; i < 8; i++) {
    outputs['freq:' + i] = '1800000'
  }
  return outputs
}

describe('collectMetrics', () => {
  it('costs one batch round trip per tick, after a single probe', async () => {
    const shell = fakeShell(healthyOutputs())
    const cache = new Map()

    await collectMetrics('device', shell.run, cache)
    expect(shell.calls).toHaveLength(2) // probe + tick

    await collectMetrics('device', shell.run, cache)
    await collectMetrics('device', shell.run, cache)

    expect(shell.calls).toHaveLength(4) // exactly one more per tick
  })

  it('reports the five domains, with the unimplemented ones pending', async () => {
    const shell = fakeShell(healthyOutputs())
    const snapshot = await collectMetrics('device', shell.run, new Map())

    expect(snapshot.thermal.status).toBe('supported')
    expect(snapshot.battery.status).toBe('supported')
    expect(snapshot.ddr.status).toBe('pending')
    expect(snapshot.display.status).toBe('pending')
    expect(snapshot.gpu.status).toBe('pending')
  })

  it('reads the cpu, memory, uptime, fps and top package it always has', async () => {
    const shell = fakeShell(healthyOutputs())
    const snapshot = await collectMetrics('device', shell.run, new Map())

    expect(snapshot.cpu.status).toBe('supported')
    expect(snapshot.cpu.cpus).toHaveLength(8)
    expect(snapshot.cpu.cpus[0].speed).toBe(1800)
    expect(snapshot.cpu.loads).toHaveLength(8)
    expect(snapshot.cpu.temperatureC).toBe(31.1)
    expect(snapshot.memory).toMatchObject({
      status: 'supported',
      memTotal: 6155370496,
      memUsed: 1945440256,
    })
    expect(snapshot.uptimeMs).toBe(12345670)
    expect(snapshot.topPackage).toEqual({
      name: 'com.example.player',
      pid: 4242,
    })
    expect(typeof snapshot.fps).toBe('number')
  })

  it('reads thermal zones from sysfs and the status from the service', async () => {
    const shell = fakeShell(healthyOutputs())
    const snapshot = await collectMetrics('device', shell.run, new Map())

    expect(snapshot.thermal.source).toBe('sysfs')
    expect(snapshot.thermal.zones).toHaveLength(16)
    expect(snapshot.thermal.zones[0]).toEqual({
      name: 'cpu-0-0',
      temperatureC: 52,
    })
    expect(snapshot.thermal.thermalStatus).toBe(0)
    expect(snapshot.thermal.coolingDevices).toHaveLength(4)
    expect(snapshot.thermal.throttling).toBe(false)
  })

  it('prefers the power_supply node and names the source it used', async () => {
    const shell = fakeShell(healthyOutputs())
    const snapshot = await collectMetrics('device', shell.run, new Map())

    expect(snapshot.battery.source).toBe('power_supply')
    expect(snapshot.battery.voltageV).toBe(4.301)
    expect(snapshot.battery.currentA).toBe(-1.25)
    expect(snapshot.battery.powerW).toBe(-5.37625)
  })

  it('falls back to the battery service dump when the node is unreadable', async () => {
    const outputs = healthyOutputs()
    outputs['battery:node'] = ''
    const shell = fakeShell(outputs)

    const snapshot = await collectMetrics('device', shell.run, new Map())

    expect(snapshot.battery.source).toBe('dumpsys')
    expect(snapshot.battery.voltageV).toBe(4.294)
    expect(snapshot.battery.state).toBe('full')
  })

  it('falls back to the thermal HAL zones when sysfs exposes none', async () => {
    const outputs = healthyOutputs()
    outputs['probe:thermal'] = ''
    const shell = fakeShell(outputs)

    const snapshot = await collectMetrics('device', shell.run, new Map())

    expect(snapshot.thermal.status).toBe('supported')
    expect(snapshot.thermal.source).toBe('dumpsys_hal')
    expect(snapshot.thermal.zones).toHaveLength(8)
    expect(snapshot.thermal.thermalStatus).toBe(0)
  })

  it('falls back to the thermal HAL zones when the sysfs scan is unreadable', async () => {
    const outputs = healthyOutputs()
    outputs['thermal:temps'] = ''
    const shell = fakeShell(outputs)

    const snapshot = await collectMetrics('device', shell.run, new Map())

    expect(snapshot.thermal.status).toBe('supported')
    expect(snapshot.thermal.source).toBe('dumpsys_hal')
  })

  it('says a device exposes no thermal zones when neither source answers', async () => {
    const outputs = healthyOutputs()
    outputs['probe:thermal'] = ''
    outputs['thermal:service'] = ''
    const shell = fakeShell(outputs)

    const snapshot = await collectMetrics('device', shell.run, new Map())

    expect(snapshot.thermal.status).toBe('unsupported')
    expect(snapshot.thermal.reason).toContain('no thermal')
  })

  it('tells an unreadable zone apart from a device without zones', async () => {
    const outputs = healthyOutputs()
    // The kernel lists zones, but every read was refused and the HAL is silent:
    // that is a permissions problem, not a device without sensors.
    outputs['thermal:temps'] = ''
    outputs['thermal:service'] = ''
    const shell = fakeShell(outputs)

    const snapshot = await collectMetrics('device', shell.run, new Map())

    expect(snapshot.thermal.status).toBe('error')
    // Distinct from "no zones at all": the kernel has them, the reads were
    // refused, which is a permissions problem the user can act on (root).
    expect(snapshot.thermal.reason).toContain('not readable without root')
  })

  it.each([
    ['upstream token order', '  top-activity 4242:com.example.player'],
    [
      'a token the dump placed elsewhere',
      '  top-activity ActivityRecord{e4f2a3f u0 4242:com.example.player t42}',
    ],
  ])('reads the focused package from %s', async (_case, line) => {
    const outputs = healthyOutputs()
    outputs.top = line
    const shell = fakeShell(outputs)

    const snapshot = await collectMetrics('device', shell.run, new Map())

    expect(snapshot.topPackage).toEqual({
      name: 'com.example.player',
      pid: 4242,
    })
  })

  it('keeps the other domains alive when one of them cannot be read', async () => {
    const outputs = healthyOutputs()
    outputs['stat:a'] = ''
    outputs['stat:b'] = ''
    const shell = fakeShell(outputs)

    const snapshot = await collectMetrics('device', shell.run, new Map())

    expect(snapshot.cpu.status).toBe('error')
    expect(snapshot.cpu.reason).toContain('cpu')
    expect(snapshot.memory.status).toBe('supported')
    expect(snapshot.thermal.status).toBe('supported')
    expect(snapshot.battery.status).toBe('supported')
  })

  it('probes again after the device list changed', async () => {
    const shell = fakeShell(healthyOutputs())
    const cache = new Map()

    await collectMetrics('device', shell.run, cache)
    await collectMetrics('device', shell.run, cache)
    forgetDevices() // drops the module-level state production uses
    await collectMetrics('device', shell.run, new Map())

    // 2 (probe+tick) + 1 (tick) + 2 (probe+tick after the reset)
    expect(shell.calls).toHaveLength(5)
  })

  it('reports no uptime rather than NaN when /proc/uptime is unreadable', async () => {
    const outputs = healthyOutputs()
    outputs['uptime'] = ''
    const shell = fakeShell(outputs)

    const snapshot = await collectMetrics('device', shell.run, new Map())

    expect(snapshot.uptimeMs).toBeNull()
  })

  it('re-probes when the probed battery node stops answering', async () => {
    const outputs = healthyOutputs()
    const cache = new Map()
    const shell = fakeShell(outputs)

    await collectMetrics('device', shell.run, cache)
    expect(cache.size).toBe(1)

    // The node goes away mid-session: the reading degrades and the probe is
    // dropped so the next tick asks again and brings the fallback back.
    outputs['battery:node'] = ''
    outputs['battery:dumpsys'] = ''
    const degraded = await collectMetrics('device', shell.run, cache)

    expect(degraded.battery.status).toBe('error')
    expect(cache.size).toBe(0)
  })

  it('reports no top package when nothing is focused', async () => {
    const outputs = healthyOutputs()
    outputs.top = ''
    const shell = fakeShell(outputs)

    const snapshot = await collectMetrics('device', shell.run, new Map())

    expect(snapshot.topPackage).toBeNull()
  })

  it('marks the battery unsupported only when no source answered at all', async () => {
    const outputs = healthyOutputs()
    outputs['probe:power'] = ''
    outputs['battery:dumpsys'] = ''
    const shell = fakeShell(outputs)

    const snapshot = await collectMetrics('device', shell.run, new Map())

    expect(snapshot.battery.status).toBe('unsupported')
    expect(snapshot.battery.reason).toContain('no battery')
  })
})