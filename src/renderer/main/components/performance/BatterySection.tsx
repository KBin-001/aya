import { useCallback, useEffect, useRef } from 'react'
import LunaPerformanceMonitor from 'luna-performance-monitor/react'
import { blue6, blue6Dark, orange6, orange6Dark } from 'common/theme'
import dateFormat from 'licia/dateFormat'
import { t } from 'common/util'
import {
  IBatteryState,
  IChangeRecord,
  IMetricsSnapshot,
  recordChange,
} from 'common/metrics'
import store from '../../store'
import Style from './Performance.module.scss'

interface IBatterySectionProps {
  metricsRef: React.MutableRefObject<IMetricsSnapshot | null>
}

function stateLabel(state: IBatteryState | null) {
  switch (state) {
    case 'charging':
      return t('batteryCharging')
    case 'discharging':
      return t('batteryDischarging')
    case 'full':
      return t('batteryFull')
    case 'not-charging':
      return t('batteryNotCharging')
    case 'unknown':
      return t('batteryUnknown')
  }

  return '--'
}

function formatValue(value: number | null, unit: string, digits: number) {
  return value === null ? '--' : `${value.toFixed(digits)}${unit}`
}

/**
 * Battery and power: the instantaneous draw, the charge state and the history
 * of that state. A value the device does not report stays '--', never a zero
 * that would look like a measurement.
 */
/** Plain component for the same reason as ThermalSection: it renders a ref. */
export default function BatterySection(props: IBatterySectionProps) {
  const previousStateRef = useRef<IBatteryState | null>(null)
  const changesRef = useRef<IChangeRecord<IBatteryState>[]>([])
  const metrics = props.metricsRef.current
  const battery = metrics ? metrics.battery : null

  useEffect(() => {
    if (!metrics) {
      return
    }

    changesRef.current = recordChange(
      changesRef.current,
      metrics.timestamp,
      previousStateRef.current,
      metrics.battery.state,
    )
    previousStateRef.current = metrics.battery.state
  }, [metrics])

  const lastPowerRef = useRef(0)
  const lastTemperatureRef = useRef(0)

  // Hold the last known value across a dropout. Plotting 0 would draw a flat
  // line that looks like a real measurement of no power.
  const powerData = useCallback(() => {
    const powerW = props.metricsRef.current
      ? props.metricsRef.current.battery.powerW
      : null
    if (powerW !== null) {
      lastPowerRef.current = Number(powerW.toFixed(2))
    }
    return lastPowerRef.current
  }, [])

  const temperatureData = useCallback(() => {
    const temperatureC = props.metricsRef.current
      ? props.metricsRef.current.battery.temperatureC
      : null
    if (temperatureC !== null) {
      lastTemperatureRef.current = Number(temperatureC.toFixed(1))
    }
    return lastTemperatureRef.current
  }, [])

  const isDark = store.theme === 'dark'
  const changes = changesRef.current

  if (battery && battery.status !== 'supported' && battery.status !== 'pending') {
    return (
      <div className={Style.section}>
        <div className={Style.sectionHeader}>
          <span className={Style.sectionTitle}>{t('batteryAndPower')}</span>
        </div>
        <div className={Style.sectionNote} title={battery.reason}>
          {battery.status === 'error' ? t('unreadable') : t('notSupported')}
        </div>
      </div>
    )
  }

  return (
    <div className={Style.section}>
      <div className={Style.sectionHeader}>
        <span className={Style.sectionTitle}>{t('batteryAndPower')}</span>
        <span className={Style.sectionMeta}>{stateLabel(battery ? battery.state : null)}</span>
      </div>

      <div className={Style.valueGrid}>
        <div className={Style.valueItem}>
          <span className={Style.valueLabel}>{t('voltage')}</span>
          <span className={Style.valueText}>
            {formatValue(battery ? battery.voltageV : null, 'V', 2)}
          </span>
        </div>
        <div className={Style.valueItem}>
          <span className={Style.valueLabel}>{t('current')}</span>
          <span className={Style.valueText}>
            {formatValue(battery ? battery.currentA : null, 'A', 2)}
          </span>
        </div>
        <div className={Style.valueItem}>
          <span className={Style.valueLabel}>{t('power')}</span>
          <span className={Style.valueText}>
            {formatValue(battery ? battery.powerW : null, 'W', 2)}
          </span>
        </div>
        <div className={Style.valueItem}>
          <span className={Style.valueLabel}>{t('batteryTemperature')}</span>
          <span className={Style.valueText}>
            {formatValue(battery ? battery.temperatureC : null, '°C', 1)}
          </span>
        </div>
      </div>

      <LunaPerformanceMonitor
        title={`${t('power')} W`}
        data={powerData}
        theme={store.theme}
        smooth={false}
        height={60}
        unit="W"
        color={isDark ? blue6Dark : blue6}
      />
      <LunaPerformanceMonitor
        title={`${t('batteryTemperature')} °C`}
        data={temperatureData}
        theme={store.theme}
        smooth={false}
        height={60}
        unit="°C"
        color={isDark ? orange6Dark : orange6}
      />

      {changes.length > 0 ? (
        <div className={Style.changeList}>
          <span className={Style.sectionMeta}>{t('stateChanges')}</span>
          {changes.map((change) => (
            <div
              key={`${change.at}-${change.to}`}
              className={Style.changeRow}
            >
              <span className={Style.changeTime}>
                {dateFormat(new Date(change.at), 'HH:MM:ss')}
              </span>
              <span>
                {stateLabel(change.from)} → {stateLabel(change.to)}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}