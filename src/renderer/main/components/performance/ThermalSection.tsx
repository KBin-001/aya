import { useCallback, useEffect, useRef, useState } from 'react'
import LunaPerformanceMonitor from 'luna-performance-monitor/react'
import { orange6, orange6Dark } from 'common/theme'
import { t } from 'common/util'
import { IMetricsSnapshot } from 'common/metrics'
import store from '../../store'
import Style from './Performance.module.scss'

/** Rows shown before the list has to be expanded. */
const COLLAPSED_ZONE_ROWS = 12

interface IThermalSectionProps {
  metricsRef: React.MutableRefObject<IMetricsSnapshot | null>
}

/**
 * Thermal zones, the Android thermal status and the cooling devices.
 *
 * Zones come from the kernel; the status and the coolers come from the thermal
 * service. Either can be missing without taking the other down.
 */
/**
 * Not an `observer`: the section reads a ref that the panel refreshes through a
 * revision bump. Wrapping it in observer/memo would compare its (stable) props,
 * decide nothing changed, and freeze the section on its first, empty render.
 */
export default function ThermalSection(props: IThermalSectionProps) {
  // Zones are picked by position, not by name: the kernel repeats zone types
  // (several `cpu-0-x` entries can share a name), so a name is not an identity.
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [expanded, setExpanded] = useState(false)
  const selectedIndexRef = useRef(0)

  useEffect(() => {
    selectedIndexRef.current = selectedIndex
  }, [selectedIndex])

  const metrics = props.metricsRef.current
  const thermal = metrics ? metrics.thermal : null
  const zones = thermal ? thermal.zones : []
  const activeZone = zones[selectedIndex] || zones[0]

  const zoneData = useCallback(() => {
    const current = props.metricsRef.current
    if (!current) {
      return 0
    }
    const zone = current.thermal.zones[selectedIndexRef.current]
    return zone ? zone.temperatureC : 0
  }, [])

  const isDark = store.theme === 'dark'
  const hasZones = zones.length > 0

  return (
    <div className={Style.section}>
      <div className={Style.sectionHeader}>
        <span className={Style.sectionTitle}>
          {t('thermal')}
          {hasZones ? ` (${zones.length})` : ''}
        </span>
        {thermal && thermal.throttling ? (
          <span className={Style.throttleBadge}>{t('throttling')}</span>
        ) : null}
        {thermal && thermal.thermalStatus !== null ? (
          <span className={Style.sectionMeta}>
            {t('thermalStatus')} {thermal.thermalStatus}
          </span>
        ) : null}
      </div>

      {!thermal ? null : hasZones ? (
        <div className={Style.zoneList}>
          {(expanded ? zones : zones.slice(0, COLLAPSED_ZONE_ROWS)).map((zone, index) => (
            <div
              key={`${zone.name}-${index}`}
              className={
                index === zones.indexOf(activeZone)
                  ? `${Style.zoneRow} ${Style.zoneRowActive}`
                  : Style.zoneRow
              }
              onClick={() => setSelectedIndex(index)}
            >
              <span className={Style.zoneName}>{zone.name}</span>
              <span className={Style.zoneValue}>
                {zone.temperatureC.toFixed(1)}°C
              </span>
            </div>
          ))}
          {zones.length > COLLAPSED_ZONE_ROWS ? (
            <div
              className={Style.zoneToggle}
              onClick={() => setExpanded(!expanded)}
            >
              {expanded
                ? t('collapseZones')
                : `${t('showAllZones')} (${zones.length})`}
            </div>
          ) : null}
        </div>
      ) : (
        <div className={Style.sectionNote} title={thermal.reason}>
          {thermal.status === 'unsupported' ? t('notSupported') : t('unreadable')}
        </div>
      )}

      {thermal && thermal.coolingDevices.length > 0 ? (
        <div className={Style.coolerList}>
          <span className={Style.sectionMeta}>{t('coolingDevices')}</span>
          {thermal.coolingDevices.map((device) => (
            <span key={device.name} className={Style.coolerItem}>
              {device.name} {device.value}
            </span>
          ))}
        </div>
      ) : null}

      {hasZones ? (
        <LunaPerformanceMonitor
          title={`${t('thermal')} ${activeZone ? activeZone.name : ''}`}
          data={zoneData}
          theme={store.theme}
          smooth={false}
          height={60}
          unit="°C"
          color={isDark ? orange6Dark : orange6}
        />
      ) : null}
    </div>
  )
}