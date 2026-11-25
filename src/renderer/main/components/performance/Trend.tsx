import { useEffect, useRef, useState } from 'react'
import { t } from 'common/util'
import Style from './Performance.module.scss'

export type Tone = 'mint' | 'blue' | 'orange' | 'purple'

interface Props<T> {
  samples: T[]
  series: {
    label: string
    tone: Tone
    value: (sample: T) => number | null | undefined
  }[]
  unit?: string
  range?: [number, number]
  variant?: 'spark' | 'compact'
  markerTime?: number
  dark: boolean
}

export function Trend<T extends { timestamp: number }>({
  samples,
  series,
  unit = '',
  range,
  variant,
  markerTime,
  dark,
}: Props<T>) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [pointer, setPointer] = useState<number | null>(null)
  const spark = variant === 'spark'
  const left = spark ? 2 : unit === ' MB' || unit === ' MHz' ? 68 : 48
  const right = spark ? 2 : 22
  const top = spark ? 3 : 14
  const bottom = spark ? 4 : 28
  const end = samples.at(-1)?.timestamp ?? 0
  const start = end - 180_000

  useEffect(() => {
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    function draw() {
      if (!ctx) return
      const { clientWidth: width, clientHeight: height } = canvas
      const plotWidth = width - left - right
      const plotHeight = height - top - bottom
      if (plotWidth <= 0 || plotHeight <= 0) return

      const scale = window.devicePixelRatio || 1
      canvas.width = width * scale
      canvas.height = height * scale
      ctx.scale(scale, scale)

      const css = getComputedStyle(canvas)
      const values = samples.flatMap((sample) =>
        series.map(({ value }) => value(sample)).filter(isReading),
      )
      const minimum = Math.min(...values, range?.[0] ?? 0)
      const maximum = Math.max(...values, range?.[1] ?? 1)
      const x = (time: number) =>
        left + ((time - start) / (end - start)) * plotWidth
      const y = (value: number) =>
        top + ((maximum - value) / (maximum - minimum)) * plotHeight
      const baseline = top + plotHeight

      if (!spark) {
        ctx.strokeStyle = css.getPropertyValue('--chart-grid')
        ctx.fillStyle = css.getPropertyValue('--muted')
        ctx.font = '11px system-ui'
        ctx.textBaseline = 'middle'
        const steps = variant === 'compact' ? 2 : 4
        for (let index = 0; index <= steps; index++) {
          const ratio = index / steps
          const row = top + ratio * plotHeight
          const column = left + ratio * plotWidth
          const reading = maximum - ratio * (maximum - minimum)
          ctx.beginPath()
          ctx.moveTo(left, row)
          ctx.lineTo(width - right, row)
          ctx.moveTo(column, top)
          ctx.lineTo(column, baseline)
          ctx.stroke()
          ctx.textAlign = 'right'
          ctx.fillText(`${Number(reading.toFixed(1))}${unit}`, left - 8, row)
          if (end) {
            ctx.textAlign =
              index === 0 ? 'left' : index === steps ? 'right' : 'center'
            ctx.fillText(
              clock(start + ratio * (end - start)),
              column,
              baseline + 15,
            )
          }
        }
      }

      for (const { tone, value } of series) {
        const color = css.getPropertyValue(`--${tone}`).trim()
        ctx.strokeStyle = color
        ctx.lineWidth = spark ? 1.5 : 2
        let segment: { x: number; y: number }[] = []
        function paintSegment() {
          if (!ctx || !segment.length) return
          const first = segment[0]
          const last = segment[segment.length - 1]
          if (segment.length === 1) {
            ctx.fillStyle = color
            ctx.beginPath()
            ctx.arc(first.x, first.y, 2.5, 0, 2 * Math.PI)
            ctx.fill()
          } else {
            const line = new Path2D()
            line.moveTo(first.x, first.y)
            for (const point of segment.slice(1)) line.lineTo(point.x, point.y)
            ctx.stroke(line)
            if (!spark) {
              line.lineTo(last.x, baseline)
              line.lineTo(first.x, baseline)
              line.closePath()
              ctx.globalAlpha = 0.1
              ctx.fillStyle = color
              ctx.fill(line)
              ctx.globalAlpha = 1
            }
          }
          segment = []
        }

        for (const sample of samples) {
          const reading = value(sample)
          if (isReading(reading))
            segment.push({ x: x(sample.timestamp), y: y(reading) })
          else paintSegment()
        }
        paintSegment()
      }
    }

    draw()
    const resize = new ResizeObserver(draw)
    resize.observe(canvas)
    return () => resize.disconnect()
  }, [
    samples,
    series,
    dark,
    unit,
    range,
    variant,
    spark,
    start,
    end,
    left,
    right,
    top,
    bottom,
  ])

  const hasReading = samples.some((sample) =>
    series.some(({ value }) => isReading(value(sample))),
  )
  const selectedTime = pointer === null ? null : start + pointer * (end - start)
  const selected =
    selectedTime === null || selectedTime < (samples[0]?.timestamp ?? 0) - 1000
      ? null
      : samples.reduce<T | null>(
          (closest, sample) =>
            !closest ||
            Math.abs(sample.timestamp - selectedTime) <
              Math.abs(closest.timestamp - selectedTime)
              ? sample
              : closest,
          null,
        )
  const marker = selected?.timestamp ?? markerTime
  const markerFraction =
    marker !== undefined && marker >= start && marker <= end
      ? (marker - start) / (end - start)
      : null

  return (
    <div className={variant ? Style[variant] : Style.trend}>
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        onPointerLeave={() => setPointer(null)}
        onPointerMove={
          variant
            ? undefined
            : (event) => {
                const bounds = event.currentTarget.getBoundingClientRect()
                const fraction =
                  (event.clientX - bounds.left - left) /
                  (bounds.width - left - right)
                setPointer(fraction >= 0 && fraction <= 1 ? fraction : null)
              }
        }
      />
      {markerFraction !== null && (
        <span
          className={Style.marker}
          aria-hidden="true"
          style={{
            left: `calc(${markerFraction * 100}% + ${left - markerFraction * (left + right)}px)`,
          }}
        />
      )}
      {!hasReading && !spark && (
        <div className={Style.chartEmpty}>{t('performancePage.noSamples')}</div>
      )}
      {selected && hasReading && (
        <div
          className={Style.tooltip}
          style={{ [pointer! > 0.5 ? 'left' : 'right']: 28 }}
        >
          <strong>{clock(selected.timestamp)}</strong>
          {series.map(({ label, tone, value }) => {
            const reading = value(selected)
            return (
              <span key={label} data-tone={tone}>
                {label}{' '}
                {isReading(reading)
                  ? `${Number(reading.toFixed(2))}${unit}`
                  : '—'}
              </span>
            )
          })}
        </div>
      )}
    </div>
  )
}

function isReading(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function clock(time: number) {
  return new Date(time).toLocaleTimeString([], { hour12: false })
}
