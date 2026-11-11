import { useCallback, useEffect, useRef } from 'react'
import LunaPerformanceMonitor from 'luna-performance-monitor/react'
import { blue6, blue6Dark, green6, green6Dark } from 'common/theme'
import dateFormat from 'licia/dateFormat'
import { t } from 'common/util'
import {
  IChangeRecord,
  IDisplayReading,
  IMetricsSnapshot,
  recordChange,
} from 'common/metrics'
import store from '../../store'
import Style from './Performance.module.scss'

interface IDisplaySectionProps {
  metricsRef: React.MutableRefObject<IMetricsSnapshot | null>
}

function brightnessText(display: IDisplayReading | null) {
  if (!display || display.brightnessRaw === null) {
    return '--'
  }
  if (display.brightnessPct !== null) {
    return `${display.brightnessPct}%`
  }

  // No published range: the level is still real information, so show it as the
  // platform numbers it rather than inventing a percentage.
  return `${display.brightnessRaw} (${t('platformLevel')})`
}

/**
 * Backlight, refresh rate and whether the panel is on.
 */
export default function DisplaySection(props: IDisplaySectionProps) {
  const previousRefreshRef = useRef<number | null>(null)
  const previousScreenRef = useRef<string | null>(null)
  const refreshChangesRef = useRef<IChangeRecord<number>[]>([])
  const screenChangesRef = useRef<IChangeRecord<string>[]>([])
  const lastBrightnessRef = useRef(0)
  const lastRefreshRef = useRef(0)

  const metrics = props.metricsRef.current
  const display = metrics ? metrics.display : null

  useEffect(() => {
    if (!metrics) {
      return
    }

    const current = metrics.display
    refreshChangesRef.current = recordChange(
      refreshChangesRef.current,
      metrics.timestamp,
      previousRefreshRef.current,
      current.refreshRateHz,
    )
    previousRefreshRef.current = current.refreshRateHz

    const screenState =
      current.screenOn === null ? null : current.screenOn ? 'on' : 'off'
    screenChangesRef.current = recordChange(
      screenChangesRef.current,
      metrics.timestamp,
      previousScreenRef.current,
      screenState,
    )
    previousScreenRef.current = screenState
  }, [metrics])

  const brightnessData = useCallback(() => {
    const pct = props.metricsRef.current
      ? props.metricsRef.current.display.brightnessPct
      : null
    if (pct !== null) {
      lastBrightnessRef.current = pct
    }
    return lastBrightnessRef.current
  }, [])

  const refreshData = useCallback(() => {
    const rate = props.metricsRef.current
      ? props.metricsRef.current.display.refreshRateHz
      : null
    if (rate !== null) {
      lastRefreshRef.current = rate
    }
    return lastRefreshRef.current
  }, [])

  const isDark = store.theme === 'dark'
  const hasRange = display !== null && display.brightnessPct !== null

  if (
    display &&
    display.status !== 'supported' &&
    display.status !== 'pending'
  ) {
    return (
      <div className={Style.section}>
        <div className={Style.sectionHeader}>
          <span className={Style.sectionTitle}>{t('display')}</span>
        </div>
        <div className={Style.sectionNote} title={display.reason}>
          {display.status === 'error' ? t('unreadable') : t('notSupported')}
        </div>
      </div>
    )
  }

  return (
    <div className={Style.section}>
      <div className={Style.sectionHeader}>
        <span className={Style.sectionTitle}>{t('display')}</span>
        {display && display.screenOn !== null ? (
          <span className={Style.sectionMeta}>
            {display.screenOn ? t('screenOn') : t('screenOff')}
          </span>
        ) : null}
      </div>

      <div className={Style.valueGrid}>
        <div className={Style.valueItem}>
          <span className={Style.valueLabel}>{t('brightness')}</span>
          <span className={Style.valueText}>{brightnessText(display)}</span>
        </div>
        <div className={Style.valueItem}>
          <span className={Style.valueLabel}>{t('refreshRate')}</span>
          <span className={Style.valueText}>
            {display && display.refreshRateHz !== null
              ? `${display.refreshRateHz} Hz`
              : '--'}
          </span>
        </div>
      </div>

      {!hasRange && display && display.brightnessRaw !== null ? (
        <div className={Style.sectionNote}>{t('brightnessRangeUnknown')}</div>
      ) : null}
      {hasRange ? (
        <LunaPerformanceMonitor
          title={`${t('brightness')} %`}
          data={brightnessData}
          theme={store.theme}
          smooth={false}
          height={60}
          unit="%"
          color={isDark ? blue6Dark : blue6}
        />
      ) : null}
      <LunaPerformanceMonitor
        title={`${t('refreshRate')} Hz`}
        data={refreshData}
        theme={store.theme}
        smooth={false}
        height={60}
        unit="Hz"
        color={isDark ? green6Dark : green6}
      />

      <div className={Style.changeList}>
        {screenChangesRef.current.length > 0 ? (
          <>
            <span className={Style.sectionMeta}>{t('screenChanges')}</span>
            {screenChangesRef.current.map((change) => (
              <div
                key={`screen-${change.at}-${change.to}`}
                className={Style.changeRow}
              >
                <span className={Style.changeTime}>
                  {dateFormat(new Date(change.at), 'HH:MM:ss')}
                </span>
                <span>
                  {change.from === 'on' ? t('screenOn') : t('screenOff')} →{' '}
                  {change.to === 'on' ? t('screenOn') : t('screenOff')}
                </span>
              </div>
            ))}
          </>
        ) : null}
        {refreshChangesRef.current.length > 0 ? (
          <>
            <span className={Style.sectionMeta}>{t('refreshRateChanges')}</span>
            {refreshChangesRef.current.map((change) => (
              <div
                key={`refresh-${change.at}-${change.to}`}
                className={Style.changeRow}
              >
                <span className={Style.changeTime}>
                  {dateFormat(new Date(change.at), 'HH:MM:ss')}
                </span>
                <span>
                  {change.from} → {change.to} Hz
                </span>
              </div>
            ))}
          </>
        ) : null}
      </div>
    </div>
  )
}
