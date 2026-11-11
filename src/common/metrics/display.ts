import toNum from 'licia/toNum'
import trim from 'licia/trim'
import { fail, ok, ParseResult } from './result'

export interface IDisplayInfo {
  refreshRateHz: number | null
  screenOn: boolean | null
}

const REG_RENDER_RATE = /renderFrameRate\s+(\d+(?:\.\d+)?)/
const REG_PEAK_RATE = /peakRefreshRate=(\d+(?:\.\d+)?)/
const REG_VSYNC_RATE = /vsyncRate=(\d+(?:\.\d+)?)/
const REG_MODE_FPS = /\bfps=(\d+(?:\.\d+)?)/
const REG_STATE_LINE = /Display State=(\w+)/
const REG_STATE_FLAG = /\bstate (ON|OFF)\b/

function readRate(fragment: string, reg: RegExp) {
  const match = fragment.match(reg)
  return match ? toNum(match[1]) : null
}

/**
 * Read the panel's refresh rate and whether it is on.
 *
 * `text` is the display service's dump, grepped down to the DisplayDeviceInfo
 * line and its own state line. The device info carries the rate the panel is
 * actually rendering at; the state line, when present, is authoritative about
 * whether the panel is on.
 *
 * The two are deliberately independent: a device that publishes no rate still
 * reports whether the screen is on, and that must keep working.
 */
export function parseDisplayInfo(text: string): ParseResult<IDisplayInfo> {
  const refreshRateHz =
    readRate(text, REG_RENDER_RATE) ??
    readRate(text, REG_PEAK_RATE) ??
    // fps= appears for every supported mode, so the active mode's own vsync
    // rate is a better last resort than the first mode in the list.
    readRate(text, REG_VSYNC_RATE) ??
    readRate(text, REG_MODE_FPS)

  const stateMatch = text.match(REG_STATE_LINE) || text.match(REG_STATE_FLAG)
  const screenOn = stateMatch
    ? trim(stateMatch[1]).toUpperCase() === 'ON'
    : null

  if (refreshRateHz === null && screenOn === null) {
    return fail('dumpsys display reported neither a rate nor a panel state')
  }

  return ok({ refreshRateHz, screenOn })
}

export interface IBrightnessReading {
  brightnessRaw: number | null
  brightnessMax: number | null
  /** Share of the range, in percent. Null when the range is unknown. */
  brightnessPct: number | null
}

function round(value: number, digits: number) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

/**
 * Read the backlight level.
 *
 * The platform reports the level in its own units and the range is only known
 * when a backlight node publishes it. Without the range the level is still real
 * information, so it is kept raw and the percentage is left out rather than
 * computed against a guessed maximum - and Android's -1, which means "no idea",
 * is not a level at all.
 */
export function parseBrightness(
  valueText: string,
  maxText: string | null,
): ParseResult<IBrightnessReading> {
  const raw = toNum(trim(valueText || ''))
  if (!trim(valueText || '') || !Number.isFinite(raw) || raw < 0) {
    return fail('the platform reported no usable brightness level')
  }

  const max = maxText === null ? NaN : toNum(trim(maxText))
  if (!Number.isFinite(max) || max <= 0) {
    return ok({ brightnessRaw: raw, brightnessMax: null, brightnessPct: null })
  }

  return ok({
    brightnessRaw: raw,
    brightnessMax: max,
    brightnessPct: round((raw / max) * 100, 1),
  })
}
