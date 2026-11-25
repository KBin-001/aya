import { observer } from 'mobx-react-lite'
import { useEffect, useRef, useState } from 'react'
import { t } from 'common/util'
import download from 'licia/download'
import durationFormat from 'licia/durationFormat'
import store from '../../store'
import { clock, Tone, Trend } from './Trend'
import Style from './Performance.module.scss'
import { IMetricsSnapshot } from 'common/metrics'
import ThermalSection, { invalidZone } from './ThermalSection'
import BatterySection from './BatterySection'
import DdrSection from './DdrSection'
import DisplaySection from './DisplaySection'
import GpuSection from './GpuSection'

const views = [
  ['overview', 'grid'],
  ['cpu', 'processor'],
  ['thermal', 'info'],
  ['battery', 'power'],
  ['frequencies', 'memory'],
  ['display', 'screen-on'],
] as const

type View = (typeof views)[number][0]
type Sample = IMetricsSnapshot
type Event = { time: number; label: string; detail: string; warning: boolean }

const copy = (key: string) => t('performancePage.' + key)
const format = (value: number | null | undefined, unit = '', digits = 0) =>
  typeof value === 'number' && Number.isFinite(value)
    ? value.toFixed(digits) + unit
    : '—'
const load = (sample: Sample, index: number) => sample.cpu.loads[index] * 100
const cpuLoad = (sample: Sample) => {
  const loads = sample.cpu.loads.filter(Number.isFinite)
  return loads.length
    ? (loads.reduce((total, value) => total + value, 0) * 100) / loads.length
    : null
}
const memory = (sample: Sample) =>
  sample.memory.status === 'supported'
    ? sample.memory.memUsed / 1024 / 1024
    : null
const memoryPercent = (sample: Sample) =>
  sample.memory.status === 'supported' && sample.memory.memTotal
    ? (sample.memory.memUsed / sample.memory.memTotal) * 100
    : null
const temperature = (sample: Sample, name: string) =>
  sample.thermal.zones.find((zone) =>
    zone.name.toLowerCase().includes(name.toLowerCase()),
  )?.temperatureC
const cpuTemperature = (sample: Sample) => sample.cpu.temperatureC
const batteryTemperature = (sample: Sample) => sample.battery.temperatureC
const voltage = (sample: Sample) => sample.battery.voltageV
const power = (sample: Sample) => {
  const watts = sample.battery.powerW
  return watts === null ? null : Math.abs(watts)
}
const refreshRate = (sample: Sample) => sample.display.refreshRateHz
const restricted = (reading?: Sample['ddr'] | Sample['gpu']) =>
  !!reading &&
  reading.status !== 'supported' &&
  /permission|without root/i.test(reading.reason ?? '')

export default observer(function Performance() {
  const { device, theme, panel } = store
  const deviceId = device?.id
  const dark = theme === 'dark'
  const [view, setView] = useState<View>('overview')
  const [samples, setSamples] = useState<Sample[]>([])
  const [foreground, setForeground] = useState<{
    name: string
    label: string
  }>()
  const metricsRef = useRef<Sample | null>(null)
  const topPackageRef = useRef('')
  const [paused, setPaused] = useState(false)
  const [failed, setFailed] = useState(false)
  const [recording, setRecording] = useState(false)
  const [events, setEvents] = useState<Event[]>([])
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null)
  const recordingSamples = useRef<Sample[]>([])
  const activeRecording = useRef(false)
  const previous = useRef<Sample | undefined>(undefined)
  const workspace = useRef<HTMLElement>(null)
  const active = panel === 'performance' || recording

  useEffect(() => {
    if (!deviceId || !active || paused) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout>

    async function poll() {
      const started = Date.now()
      try {
        const sample = await main.getMetrics(deviceId!)
        if (stopped) return

        const nextEvents = performanceEvents(sample, previous.current)
        previous.current = sample
        metricsRef.current = sample
        setSamples((history) => [
          ...history.filter(
            ({ timestamp }) => timestamp >= sample.timestamp - 180_000,
          ),
          sample,
        ])
        if (nextEvents.length)
          setEvents((history) => [...nextEvents, ...history].slice(0, 16))
        if (activeRecording.current) recordingSamples.current.push(sample)
        setFailed(false)

        const name = sample.topPackage?.name ?? ''
        if (name !== topPackageRef.current) {
          topPackageRef.current = name
          if (name) {
            main
              .getPackageInfos(deviceId!, [name])
              .then((packages) => {
                if (!stopped && topPackageRef.current === name) {
                  setForeground({ name, label: packages[0]?.label || name })
                }
              })
              .catch(() => {
                // The process package name remains available in the snapshot.
              })
          }
        }
      } catch {
        if (!stopped) setFailed(true)
      } finally {
        if (!stopped)
          timer = setTimeout(poll, Math.max(0, 1000 - (Date.now() - started)))
      }
    }

    poll()
    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [deviceId, active, paused])

  function exportSamples(data: Sample[], kind: string) {
    download(
      new Blob(
        [JSON.stringify({ device: device?.name, samples: data }, null, 2)],
        { type: 'application/json' },
      ),
      `aya-${kind}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
      'application/json',
    )
  }

  function toggleRecording() {
    if (activeRecording.current) {
      if (recordingSamples.current.length)
        exportSamples(recordingSamples.current, 'recording')
      recordingSamples.current = []
    }
    activeRecording.current = !activeRecording.current
    setRecording(activeRecording.current)
  }

  function openView(next: View) {
    setView(next)
    workspace.current?.scrollTo(0, 0)
  }

  const latest = samples.at(-1)
  const uptime = latest?.uptimeMs ?? null
  const app =
    foreground && foreground.name === latest?.topPackage?.name
      ? foreground.label
      : latest?.topPackage?.name
  const value = (
    read: (sample: Sample) => number | null | undefined,
    unit?: string,
    digits?: number,
  ) => format(latest ? read(latest) : null, unit, digits)
  const status = !device
    ? t('deviceNotConnected')
    : failed
      ? copy('sampleFailed')
      : paused
        ? copy('paused')
        : latest
          ? copy('online')
          : copy('waiting')
  const titles = {
    overview: 'overviewTitle',
    cpu: 'cpuTitle',
    thermal: 'thermalTitle',
    battery: 'battery',
    frequencies: 'frequencies',
    display: 'display',
  }
  const temperatureSeries = [
    { label: 'CPU', tone: 'mint' as const, value: cpuTemperature },
    {
      label: 'GPU',
      tone: 'blue' as const,
      value: (sample: Sample) => temperature(sample, 'GPU'),
    },
    {
      label: copy('batteryTemp'),
      tone: 'orange' as const,
      value: batteryTemperature,
    },
    {
      label: copy('skin'),
      tone: 'purple' as const,
      value: (sample: Sample) => temperature(sample, 'SKIN'),
    },
  ]
  const overviewMetrics: {
    label: string
    icon: string
    tone: Tone
    read: (sample: Sample) => number | null | undefined
    unit: string
    digits?: number
    sub: string
    target: View
  }[] = [
    {
      label: 'CPU ' + copy('temperature'),
      icon: 'processor',
      tone: 'mint',
      read: cpuTemperature,
      unit: ' °C',
      digits: 1,
      sub: copy('cpuLoad') + ' ' + value(cpuLoad, '%'),
      target: 'cpu',
    },
    {
      label: 'GPU ' + copy('temperature'),
      icon: 'info',
      tone: 'blue',
      read: temperatureSeries[1].value,
      unit: ' °C',
      digits: 1,
      sub: copy('thermalLevel') + ' ' + format(latest?.thermal.thermalStatus),
      target: 'thermal',
    },
    {
      label: copy('power'),
      icon: 'power',
      tone: 'orange',
      read: power,
      unit: ' W',
      digits: 2,
      sub:
        value(voltage, ' V', 2) +
        ' · ' +
        value((sample) => sample.battery.currentA, ' A', 2),
      target: 'battery',
    },
    {
      label: t('memory'),
      icon: 'memory',
      tone: 'purple',
      read: memoryPercent,
      unit: '%',
      sub: value(memory, ' MB'),
      target: 'cpu',
    },
    {
      label: copy('refreshRate'),
      icon: 'screen-on',
      tone: 'purple',
      read: refreshRate,
      unit: ' Hz',
      sub:
        copy('brightness') + ' ' + format(latest?.display.brightnessPct, '%'),
      target: 'display',
    },
  ]

  const cores = (compact: boolean) => (
    <div className={Style.cores}>
      {latest?.cpu.cpus.map((_, index) => (
        <div key={index} className={Style.core}>
          <div className={Style.coreHeader}>
            <strong>CPU{index}</strong>
            {!compact && (
              <span>{format(latest.cpu.cpus[index]?.speed, ' MHz')}</span>
            )}
            <b data-tone="mint">
              {value((sample) => load(sample, index), '%')}
            </b>
          </div>
          <Trend
            samples={samples}
            dark={dark}
            variant={compact ? 'spark' : 'compact'}
            unit="%"
            range={[0, 100]}
            series={[
              {
                label: `CPU${index}`,
                tone: 'mint',
                value: (sample) => load(sample, index),
              },
            ]}
          />
        </div>
      ))}
    </div>
  )

  const thermalChart = (overview: boolean) => (
    <section className={Style.card}>
      <h2>{copy('temperatureTrend')}</h2>
      <div className={Style.legend}>
        {temperatureSeries
          .slice(0, overview ? 2 : 4)
          .map(({ label, value: read, tone }) => (
            <span key={label} data-tone={tone}>
              {label} <strong>{value(read, ' °C', 1)}</strong>
            </span>
          ))}
      </div>
      <Trend
        samples={samples}
        dark={dark}
        series={temperatureSeries.slice(0, overview ? 2 : 4)}
        unit="°"
        range={[20, 40]}
        markerTime={overview ? undefined : selectedEvent?.time}
      />
      <div className={Style.note}>
        {copy('thermalLevel')} {format(latest?.thermal.thermalStatus)}
      </div>
    </section>
  )

  const powerCard = (
    <section className={Style.card}>
      <div className={Style.cardHeader}>
        <h2>{copy('battery')}</h2>
        <strong data-tone="orange">{value(power, ' W', 2)}</strong>
      </div>
      <p>
        {copy('batteryLevel')} {format(latest?.battery.levelPct, '%')}
        {latest?.battery.state
          ? ' · ' + batteryStatus(latest.battery.state)
          : ''}
      </p>
      <dl className={Style.miniStats}>
        <div>
          <dt>{copy('voltage')}</dt>
          <dd>{value(voltage, ' V', 2)}</dd>
        </div>
        <div>
          <dt>{copy('current')}</dt>
          <dd>{value((sample) => sample.battery.currentA, ' A', 2)}</dd>
        </div>
        <div>
          <dt>{copy('batteryTemp')}</dt>
          <dd>{value(batteryTemperature, ' °C', 1)}</dd>
        </div>
      </dl>
      {view !== 'thermal' && (
        <Trend
          samples={samples}
          dark={dark}
          unit=" W"
          range={[-2, 2]}
          series={[{ label: copy('power'), tone: 'orange', value: power }]}
        />
      )}
    </section>
  )

  const frequencyCard = (
    <section className={Style.card}>
      <div className={Style.cardHeader}>
        <h2>DDR / GPU</h2>
        {(restricted(latest?.ddr) || restricted(latest?.gpu)) && (
          <span className={Style.warning}>{copy('restricted')}</span>
        )}
      </div>
      <p>MTK Devfreq</p>
      {(['ddr', 'gpu'] as const).map((key) => (
        <div className={Style.frequency} key={key}>
          <strong>
            {key.toUpperCase()} {copy('frequency')}
          </strong>
          <span data-tone={restricted(latest?.[key]) ? 'orange' : 'blue'}>
            {latest ? frequencyStatus(latest[key]) : '—'}
          </span>
        </div>
      ))}
    </section>
  )

  const displayCard = (
    <section className={Style.card}>
      <div className={Style.cardHeader}>
        <h2>{copy('display')}</h2>
        {latest?.display.screenOn != null && (
          <span className={Style.note}>
            {screenStatus(latest.display.screenOn)}
          </span>
        )}
      </div>
      <dl className={Style.displayStats}>
        <div>
          <dt>{copy('refreshRate')}</dt>
          <dd data-tone="purple">{value(refreshRate, ' Hz')}</dd>
        </div>
        <div>
          <dt>{copy('brightness')}</dt>
          <dd>{format(latest?.display.brightnessPct, '%')}</dd>
          {latest?.display.brightnessPct != null && (
            <progress
              max={100}
              value={latest.display.brightnessPct}
              aria-label={copy('brightness')}
            />
          )}
        </div>
      </dl>
      {view !== 'thermal' && (
        <Trend
          samples={samples}
          dark={dark}
          unit=" Hz"
          range={[0, 60]}
          variant={view === 'overview' ? 'compact' : undefined}
          series={[
            { label: copy('refreshRate'), tone: 'purple', value: refreshRate },
          ]}
        />
      )}
    </section>
  )

  const eventCard = (
    <section className={Style.card}>
      <h2>{copy('events')}</h2>
      {events.length === 0 && <p>{copy('noEvents')}</p>}
      <div className={Style.eventList}>
        {events.map((event) => (
          <button
            type="button"
            key={event.time + event.label}
            aria-pressed={(selectedEvent ?? events[0]) === event}
            data-warning={event.warning || undefined}
            onClick={() => setSelectedEvent(event)}
          >
            <span>{event.label}</span>
            <time>{clock(event.time)}</time>
          </button>
        ))}
      </div>
      {(selectedEvent ?? events[0])?.detail && (
        <p className={Style.eventDetail}>
          {(selectedEvent ?? events[0]).detail}
        </p>
      )}
    </section>
  )

  return (
    <div className={Style.dashboard} data-theme={dark ? 'dark' : 'light'}>
      <aside className={Style.sidebar}>
        <span className={Style.sectionLabel}>{copy('device')}</span>
        <div className={Style.device} title={device?.name}>
          <strong>{device?.name ?? t('deviceNotConnected')}</strong>
          {device?.androidVersion && (
            <span>Android {device.androidVersion}</span>
          )}
        </div>
        <span className={Style.sectionLabel}>{copy('workspace')}</span>
        <nav aria-label={t('performance')}>
          {views.map(([key, icon]) => (
            <button
              type="button"
              key={key}
              onClick={() => openView(key)}
              aria-current={view === key ? 'page' : undefined}
            >
              <i className={`icon-${icon}`} aria-hidden="true" />
              {copy(key)}
            </button>
          ))}
        </nav>
        <div
          className={Style.sidebarStatus}
          data-tone={failed ? 'orange' : 'mint'}
        >
          {status}
        </div>
      </aside>

      <main ref={workspace} className={Style.workspace}>
        <header className={Style.header}>
          <div>
            <h1>{copy(titles[view])}</h1>
            <p>
              {uptime === null
                ? status
                : `${t('uptime')} ${durationFormat(uptime, 'd:hh:mm:ss')} · ${status}`}
            </p>
          </div>
          <div className={Style.actions}>
            <button
              type="button"
              disabled={!device || recording}
              aria-pressed={paused}
              onClick={() => setPaused(!paused)}
            >
              <i
                className={paused ? 'icon-play' : 'icon-pause'}
                aria-hidden="true"
              />
              {copy(paused ? 'resume' : 'pause')}
            </button>
            <button
              type="button"
              disabled={!samples.length}
              onClick={() => exportSamples(samples, 'performance')}
            >
              <i className="icon-save" aria-hidden="true" />
              {copy('export')}
            </button>
            <button
              type="button"
              className={Style.primary}
              disabled={!device || paused}
              aria-pressed={recording}
              onClick={toggleRecording}
            >
              <i
                className={recording ? 'icon-square' : 'icon-circle'}
                aria-hidden="true"
              />
              {copy(recording ? 'stopRecording' : 'record')}
            </button>
          </div>
        </header>

        {view === 'overview' && (
          <>
            <div className={Style.metrics}>
              {overviewMetrics.map(
                ({ label, icon, tone, read, unit, digits, sub, target }) => (
                  <button
                    type="button"
                    className={Style.metric}
                    key={label}
                    onClick={() => openView(target)}
                  >
                    <span>
                      <i
                        className={`icon-${icon}`}
                        aria-hidden="true"
                        data-tone={tone}
                      />
                      {label}
                    </span>
                    <div>
                      <strong data-tone={tone}>
                        {value(read, unit, digits)}
                      </strong>
                      <Trend
                        samples={samples}
                        dark={dark}
                        variant="spark"
                        series={[{ label, tone, value: read }]}
                      />
                    </div>
                    <small>{sub}</small>
                  </button>
                ),
              )}
            </div>
            <div className={Style.pair}>
              {thermalChart(true)}
              {powerCard}
            </div>
            <div className={Style.trio}>
              <section className={Style.card}>
                <div className={Style.cardHeader}>
                  <h2>{copy('cpu')}</h2>
                  <button
                    type="button"
                    className={Style.link}
                    onClick={() => openView('cpu')}
                  >
                    {copy('details')}
                  </button>
                </div>
                <p>
                  {copy('cpuLoad')} {value(cpuLoad, '%')}
                </p>
                {cores(true)}
              </section>
              {frequencyCard}
              {displayCard}
            </div>
          </>
        )}

        {view === 'cpu' && (
          <div className={Style.cpuLayout}>
            <div className={Style.stack}>
              <section className={Style.card}>
                <div className={Style.cardHeader}>
                  <h2>{copy('cpuLoad')}</h2>
                  <strong data-tone="mint">{value(cpuLoad, '%')}</strong>
                </div>
                <Trend
                  samples={samples}
                  dark={dark}
                  unit="%"
                  range={[0, 100]}
                  series={[{ label: 'CPU', tone: 'mint', value: cpuLoad }]}
                />
              </section>
              {cores(false)}
              <div className={Style.pair}>
                <section className={Style.card}>
                  <div className={Style.cardHeader}>
                    <h2>{t('memory')}</h2>
                    <strong data-tone="purple">{value(memory, ' MB')}</strong>
                  </div>
                  <Trend
                    samples={samples}
                    dark={dark}
                    unit=" MB"
                    range={[
                      0,
                      Math.ceil(
                        (latest?.memory.memTotal || 4 * 1024 ** 3) / 1024 ** 3,
                      ) * 1024,
                    ]}
                    series={[
                      { label: t('memory'), tone: 'purple', value: memory },
                    ]}
                  />
                </section>
                <section className={Style.card}>
                  <div className={Style.cardHeader}>
                    <h2 title={app}>FPS {app && '· ' + app}</h2>
                    <strong data-tone="orange">
                      {value((sample) => sample.fps)}
                    </strong>
                  </div>
                  <Trend
                    samples={samples}
                    dark={dark}
                    range={[0, 60]}
                    series={[
                      {
                        label: 'FPS',
                        tone: 'orange',
                        value: (sample) => sample.fps,
                      },
                    ]}
                  />
                </section>
              </div>
            </div>
            <section className={Style.card}>
              <h2>{copy('currentReadings')}</h2>
              {overviewMetrics.map(({ label, read, unit, digits, tone }) => (
                <div className={Style.reading} key={label}>
                  <span>{label}</span>
                  <strong data-tone={tone}>{value(read, unit, digits)}</strong>
                </div>
              ))}
              <div className={Style.reading}>
                <span>DDR</span>
                <strong data-tone="orange">
                  {latest ? frequencyStatus(latest.ddr) : '—'}
                </strong>
              </div>
            </section>
          </div>
        )}

        {view === 'thermal' && (
          <div className={Style.thermalLayout}>
            <div className={Style.stack}>
              {thermalChart(false)}
              <section className={Style.card}>
                <ThermalSection metricsRef={metricsRef} />
              </section>
            </div>
            <div className={Style.stack}>
              {eventCard}
              {frequencyCard}
              {powerCard}
              {displayCard}
            </div>
          </div>
        )}

        {view === 'battery' && (
          <section className={Style.card}>
            <BatterySection metricsRef={metricsRef} />
          </section>
        )}
        {view === 'frequencies' && (
          <div className={Style.pair}>
            <section className={Style.card}>
              <DdrSection metricsRef={metricsRef} />
            </section>
            <section className={Style.card}>
              <GpuSection metricsRef={metricsRef} />
            </section>
          </div>
        )}
        {view === 'display' && (
          <section className={Style.card}>
            <DisplaySection metricsRef={metricsRef} />
          </section>
        )}
      </main>
    </div>
  )
})

function frequencyStatus(frequency: Sample['ddr'] | Sample['gpu']) {
  if (restricted(frequency)) return copy('restricted')
  if (frequency.status === 'error') return t('unreadable')
  if (frequency.status === 'unsupported') return t('notSupported')
  return format(frequency.frequencyMhz, ' MHz')
}

function screenStatus(on: boolean) {
  return t(on ? 'screenOn' : 'screenOff')
}

function batteryStatus(status: NonNullable<Sample['battery']['state']>) {
  const keys = {
    charging: 'batteryCharging',
    discharging: 'batteryDischarging',
    'not-charging': 'batteryNotCharging',
    full: 'batteryFull',
    unknown: 'batteryUnknown',
  }
  return t(keys[status])
}

function performanceEvents(sample: Sample, last?: Sample): Event[] {
  const result: Event[] = []
  function add(label: string, detail = '', warning = false) {
    result.push({ time: sample.timestamp, label, detail, warning })
  }

  for (const key of ['ddr', 'gpu'] as const) {
    const reading = sample[key]
    if (
      reading.status === 'error' &&
      (last?.[key].status !== reading.status ||
        last[key].reason !== reading.reason)
    ) {
      add(
        key.toUpperCase() + ' · ' + frequencyStatus(reading),
        reading.reason,
        true,
      )
    }
  }
  for (const zone of sample.thermal.zones) {
    if (
      invalidZone(zone) &&
      !last?.thermal.zones.some(
        (previousZone) =>
          previousZone.name === zone.name && invalidZone(previousZone),
      )
    ) {
      add(zone.name + ' · ' + copy('invalid'), '', true)
    }
  }
  const level = sample.thermal.thermalStatus
  if (last && level !== null && level !== last.thermal.thermalStatus) {
    add(copy('thermalLevel') + ' ' + level, '', level > 0)
  }
  const screen = sample.display.screenOn
  if (
    last?.display.screenOn != null &&
    screen !== null &&
    screen !== last.display.screenOn
  )
    add(screenStatus(screen))
  const battery = sample.battery.state
  if (last?.battery.state && battery && battery !== last.battery.state)
    add(batteryStatus(battery))
  return result
}
