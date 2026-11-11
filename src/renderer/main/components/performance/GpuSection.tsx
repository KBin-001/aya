import { useCallback, useRef } from 'react'
import LunaPerformanceMonitor from 'luna-performance-monitor/react'
import { purple6, purple6Dark, orange6, orange6Dark } from 'common/theme'
import { t } from 'common/util'
import { IMetricsSnapshot } from 'common/metrics'
import store from '../../store'
import Style from './Performance.module.scss'

interface IGpuSectionProps {
  metricsRef: React.MutableRefObject<IMetricsSnapshot | null>
}

/**
 * GPU clock, load and whether it is being held back.
 */
export default function GpuSection(props: IGpuSectionProps) {
  const lastFrequencyRef = useRef(0)
  const lastLoadRef = useRef(0)

  const metrics = props.metricsRef.current
  const gpu = metrics ? metrics.gpu : null

  const frequencyData = useCallback(() => {
    const frequency = props.metricsRef.current
      ? props.metricsRef.current.gpu.frequencyMhz
      : null
    if (frequency !== null) {
      lastFrequencyRef.current = frequency
    }
    return lastFrequencyRef.current
  }, [])

  const loadData = useCallback(() => {
    const load = props.metricsRef.current
      ? props.metricsRef.current.gpu.loadPct
      : null
    if (load !== null) {
      lastLoadRef.current = load
    }
    return lastLoadRef.current
  }, [])

  const isDark = store.theme === 'dark'

  if (gpu && gpu.status !== 'supported' && gpu.status !== 'pending') {
    return (
      <div className={Style.section}>
        <div className={Style.sectionHeader}>
          <span className={Style.sectionTitle}>{t('gpu')}</span>
        </div>
        <div className={Style.sectionNote} title={gpu.reason}>
          {gpu.status === 'error' ? t('unreadable') : t('notSupported')}
          {gpu.reason ? `: ${gpu.reason}` : ''}
        </div>
      </div>
    )
  }

  const hasLoad = gpu !== null && gpu.loadPct !== null

  return (
    <div className={Style.section}>
      <div className={Style.sectionHeader}>
        <span className={Style.sectionTitle}>{t('gpu')}</span>
        {gpu && gpu.throttled ? (
          <span className={Style.throttleBadge}>{t('throttled')}</span>
        ) : null}
        {gpu && gpu.governor ? (
          <span className={Style.sectionMeta}>
            {t('governor')} {gpu.governor}
          </span>
        ) : null}
      </div>

      <div className={Style.valueGrid}>
        <div className={Style.valueItem}>
          <span className={Style.valueLabel}>{t('gpuFrequency')}</span>
          <span className={Style.valueText}>
            {gpu && gpu.frequencyMhz !== null
              ? `${gpu.frequencyMhz} MHz`
              : '--'}
          </span>
        </div>
        <div className={Style.valueItem}>
          <span className={Style.valueLabel}>{t('load')}</span>
          <span className={Style.valueText}>
            {hasLoad ? `${gpu.loadPct}%` : '--'}
          </span>
        </div>
      </div>

      <LunaPerformanceMonitor
        title={`${t('gpuFrequency')} MHz`}
        data={frequencyData}
        theme={store.theme}
        smooth={false}
        height={60}
        unit="MHz"
        color={isDark ? purple6Dark : purple6}
      />
      {hasLoad ? (
        <LunaPerformanceMonitor
          title={`${t('load')} %`}
          data={loadData}
          theme={store.theme}
          smooth={false}
          height={60}
          unit="%"
          color={isDark ? orange6Dark : orange6}
        />
      ) : null}
    </div>
  )
}
