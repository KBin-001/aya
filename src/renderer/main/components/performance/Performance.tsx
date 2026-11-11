import { observer } from 'mobx-react-lite'
import { useCallback, useEffect, useRef, useState } from 'react'
import store from '../../store'
import LunaPerformanceMonitor from 'luna-performance-monitor/react'
import {
  green4,
  green4Dark,
  green6,
  green6Dark,
  orange6,
  orange6Dark,
  purple6,
  purple6Dark,
} from 'common/theme'
import { t } from 'common/util'
import sum from 'licia/sum'
import Style from './Performance.module.scss'
import durationFormat from 'licia/durationFormat'
import LunaToolbar, {
  LunaToolbarHtml,
  LunaToolbarSpace,
  LunaToolbarText,
} from 'luna-toolbar/react'
import isEmpty from 'licia/isEmpty'
import map from 'licia/map'
import className from 'licia/className'
import { IMetricsSnapshot } from 'common/metrics'
import ThermalSection from './ThermalSection'
import BatterySection from './BatterySection'

/** The device is sampled once a second; the charts redraw at their own pace. */
const SAMPLE_INTERVAL = 1000

type MetricsRef = React.MutableRefObject<IMetricsSnapshot | null>

export default observer(function Performance() {
  const metricsRef: MetricsRef = useRef(null)
  const [, setRevision] = useState(0)
  const [topLabel, setTopLabel] = useState('')
  const topPackageRef = useRef('')

  useEffect(() => {
    let disposed = false
    let timer = 0

    async function labelTopPackage(
      deviceId: string,
      snapshot: IMetricsSnapshot,
    ) {
      const topPackage = snapshot.topPackage
      if (
        !topPackage ||
        !topPackage.name ||
        topPackage.name === topPackageRef.current
      ) {
        return
      }

      topPackageRef.current = topPackage.name
      try {
        const packageInfos = await main.getPackageInfos(deviceId, [
          topPackage.name,
        ])
        if (!disposed && !isEmpty(packageInfos)) {
          setTopLabel(packageInfos[0].label)
        }
      } catch {
        if (!disposed) {
          setTopLabel(topPackage.name)
        }
      }
    }

    async function sample() {
      const device = store.device
      if (device && store.panel === 'performance') {
        try {
          const snapshot = await main.getMetrics(device.id)
          if (!disposed) {
            metricsRef.current = snapshot
            setRevision((revision) => revision + 1)
            // Not awaited: a slow package-name lookup must not stretch the
            // sampling cadence.
            labelTopPackage(device.id, snapshot)
          }
        } catch {
          // A device that dropped off the bus is not something to report here:
          // keep the last snapshot on screen and try again on the next tick.
        }
      }

      if (!disposed) {
        timer = window.setTimeout(sample, SAMPLE_INTERVAL)
      }
    }

    sample()

    return () => {
      disposed = true
      window.clearTimeout(timer)
    }
  }, [])

  const cpuData = useCallback(() => {
    const metrics = metricsRef.current
    if (!metrics || isEmpty(metrics.cpu.loads)) {
      return 0
    }
    const loads = metrics.cpu.loads
    return Math.floor((sum(...loads) / loads.length) * 100)
  }, [])

  const memData = useCallback(() => {
    const metrics = metricsRef.current
    return metrics ? Math.round(metrics.memory.memUsed / 1024 / 1024) : 0
  }, [])

  const fpsData = useCallback(() => {
    const metrics = metricsRef.current
    return metrics && metrics.fps !== null ? metrics.fps : 0
  }, [])

  const isDark = store.theme === 'dark'
  const metrics = metricsRef.current
  const battery = metrics ? metrics.battery : null
  const cpu = metrics ? metrics.cpu : null

  const batteryLevel =
    battery && battery.levelPct !== null ? `${battery.levelPct}%` : '--'
  const batteryVoltage =
    battery && battery.voltageV !== null ? `${battery.voltageV.toFixed(2)}V` : '--'
  const batteryTemperature =
    battery && battery.temperatureC !== null
      ? `${battery.temperatureC.toFixed(1)}°C`
      : '--'
  const batteryInfo = `${batteryVoltage} ${batteryTemperature}`
  const cpuTemperature = cpu && cpu.temperatureC !== null ? `${cpu.temperatureC}°C` : ''
  const memoryPercent =
    metrics && metrics.memory.memTotal
      ? `${Math.round((metrics.memory.memUsed / metrics.memory.memTotal) * 100)}%`
      : ''
  const cpus = cpu ? cpu.cpus : []

  return (
    <div className={className('panel-with-toolbar', Style.container)}>
      <LunaToolbar className="panel-toolbar">
        <LunaToolbarText
          text={`${t('uptime')} ${durationFormat(
            metrics && metrics.uptimeMs !== null ? metrics.uptimeMs : 0,
            'd:hh:mm:ss',
          )}`}
        />
        <LunaToolbarSpace />
        <LunaToolbarHtml>
          <div className={Style.batteryContainer}>
            <span className={Style.batteryInfo}>{batteryInfo}</span>
            <span className={Style.batteryLevel}>{batteryLevel}</span>
            <div className={Style.battery}>
              <div className={Style.batteryHead} />
              <div
                className={Style.batteryInside}
                style={{ width: batteryLevel }}
              />
            </div>
          </div>
        </LunaToolbarHtml>
      </LunaToolbar>
      <div className={className('panel-body', Style.charts)}>
        <LunaPerformanceMonitor
          title={`CPU ${cpuTemperature}`}
          data={cpuData}
          theme={store.theme}
          max={100}
          color={isDark ? green6Dark : green6}
          height={80}
          unit="%"
        />
        <div className={Style.cpuContainer}>
          {map(cpus, (cpu, idx) => (
            <Cpu key={idx} index={idx} metricsRef={metricsRef} />
          ))}
        </div>
        <LunaPerformanceMonitor
          title={`${t('memory')} ${memoryPercent}`}
          data={memData}
          theme={store.theme}
          smooth={false}
          color={isDark ? purple6Dark : purple6}
          height={80}
          unit="MB"
        />
        <LunaPerformanceMonitor
          title={`FPS ${topLabel}`}
          data={fpsData}
          theme={store.theme}
          smooth={false}
          height={80}
          color={isDark ? orange6Dark : orange6}
        />
        <ThermalSection metricsRef={metricsRef} />
        <BatterySection metricsRef={metricsRef} />
      </div>
    </div>
  )
})

interface ICpuProps {
  metricsRef: MetricsRef
  index: number
}

/** Plain component: it renders the ref the panel bumps, not an observable. */
function Cpu(props: ICpuProps) {
  const loadData = useCallback(() => {
    const metrics = props.metricsRef.current
    if (!metrics) {
      return 0
    }
    return Math.floor((metrics.cpu.loads[props.index] || 0) * 100)
  }, [])

  const isDark = store.theme === 'dark'
  const metrics = props.metricsRef.current
  const core = metrics ? metrics.cpu.cpus[props.index] : undefined
  const speed = core && core.speed !== undefined ? `${core.speed}MHz` : ''

  return (
    <LunaPerformanceMonitor
      title={`CPU${props.index} ${speed}`}
      data={loadData}
      theme={store.theme}
      max={100}
      height={50}
      color={isDark ? green4Dark : green4}
      unit="%"
    />
  )
}