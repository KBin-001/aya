import { useCallback, useEffect, useRef } from 'react'
import LunaPerformanceMonitor from 'luna-performance-monitor/react'
import { cyan6, cyan6Dark } from 'common/theme'
import dateFormat from 'licia/dateFormat'
import { t } from 'common/util'
import { IChangeRecord, IMetricsSnapshot, recordChange } from 'common/metrics'
import store from '../../store'
import Style from './Performance.module.scss'

interface IDdrSectionProps {
  metricsRef: React.MutableRefObject<IMetricsSnapshot | null>
}

/**
 * DDR frequency and the moments it changed.
 *
 * The frequency curve is the point of this section: a stutter that lines up with
 * a step down in memory clock is the answer to a question the rest of the panel
 * cannot answer.
 */
export default function DdrSection(props: IDdrSectionProps) {
  const previousRef = useRef<number | null>(null)
  const changesRef = useRef<IChangeRecord<number>[]>([])
  const lastRef = useRef(0)

  const metrics = props.metricsRef.current
  const ddr = metrics ? metrics.ddr : null

  useEffect(() => {
    if (!metrics) {
      return
    }
    changesRef.current = recordChange(
      changesRef.current,
      metrics.timestamp,
      previousRef.current,
      metrics.ddr.frequencyMhz,
    )
    previousRef.current = metrics.ddr.frequencyMhz
  }, [metrics])

  const frequencyData = useCallback(() => {
    const current = props.metricsRef.current
    if (current && current.ddr.frequencyMhz !== null) {
      lastRef.current = current.ddr.frequencyMhz
    }
    return lastRef.current
  }, [])

  const isDark = store.theme === 'dark'
  const changes = changesRef.current

  if (ddr && ddr.status !== 'supported' && ddr.status !== 'pending') {
    return (
      <div className={Style.section}>
        <div className={Style.sectionHeader}>
          <span className={Style.sectionTitle}>{t('ddr')}</span>
        </div>
        <div className={Style.sectionNote} title={ddr.reason}>
          {ddr.status === 'error' ? t('unreadable') : t('notSupported')}
          {ddr.reason ? `: ${ddr.reason}` : ''}
        </div>
      </div>
    )
  }

  return (
    <div className={Style.section}>
      <div className={Style.sectionHeader}>
        <span className={Style.sectionTitle}>{t('ddr')}</span>
        <span className={Style.sectionMeta}>
          {ddr && ddr.frequencyMhz !== null ? `${ddr.frequencyMhz} MHz` : '--'}
        </span>
        {ddr && ddr.availableMhz.length > 0 ? (
          <span className={Style.sectionMeta}>
            {ddr.availableMhz.join(' / ')} MHz
          </span>
        ) : null}
      </div>

      <LunaPerformanceMonitor
        title={`${t('ddrFrequency')} MHz`}
        data={frequencyData}
        theme={store.theme}
        smooth={false}
        height={60}
        unit="MHz"
        color={isDark ? cyan6Dark : cyan6}
      />

      {changes.length > 0 ? (
        <div className={Style.changeList}>
          <span className={Style.sectionMeta}>{t('frequencyChanges')}</span>
          {changes.map((change) => (
            <div key={`${change.at}-${change.to}`} className={Style.changeRow}>
              <span className={Style.changeTime}>
                {dateFormat(new Date(change.at), 'HH:MM:ss')}
              </span>
              <span>
                {change.from} → {change.to} MHz
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
