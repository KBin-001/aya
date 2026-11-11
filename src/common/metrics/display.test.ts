import { describe, expect, it } from 'vitest'
import { readFixture } from './__fixtures__/load'
import { parseBrightness, parseDisplayInfo } from './display'

const deviceInfo = readFixture(
  'mtk-tb8781p4',
  'dumpsys-display-device-info.txt',
)
const stateLine = readFixture('mtk-tb8781p4', 'dumpsys-display-state.txt')

describe('parseDisplayInfo', () => {
  it('reads the refresh rate and the panel state of a real display dump', () => {
    // The capture says renderFrameRate 60.0 … and Display State=OFF (asleep).
    expect(parseDisplayInfo(stateLine + deviceInfo)).toEqual({
      ok: true,
      value: { refreshRateHz: 60, screenOn: false },
    })
  })

  it.each([
    ['renderFrameRate', 'renderFrameRate 90.0,', 90],
    [
      'the peak rate when no render rate is published',
      'peakRefreshRate=120.0,',
      120,
    ],
    ['the mode fps as a last resort', 'fps=48.0,', 48],
  ])('falls back to %s', (_case, fragment, expected) => {
    const result = parseDisplayInfo(
      'DisplayDeviceInfo{' + fragment + ' state ON }',
    )

    expect(result.ok && result.value.refreshRateHz).toBe(expected)
  })

  it('still reports the panel state when the refresh rate is missing', () => {
    // A rate the app cannot read must not take the on/off state with it.
    const result = parseDisplayInfo(
      'Display State=ON\nDisplayDeviceInfo{ state ON }',
    )

    expect(result).toEqual({
      ok: true,
      value: { refreshRateHz: null, screenOn: true },
    })
  })

  it('prefers the dedicated state line over the adapter flag', () => {
    expect(
      parseDisplayInfo(
        'Display State=OFF\nDisplayDeviceInfo{ renderFrameRate 60.0, state ON }',
      ),
    ).toEqual({ ok: true, value: { refreshRateHz: 60, screenOn: false } })
  })

  it('reports a readable error when nothing at all could be read', () => {
    const result = parseDisplayInfo('')

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.reason).toContain('display')
  })
})

describe('parseBrightness', () => {
  it('turns the platform value into a share of the panel range', () => {
    expect(parseBrightness('103', '255')).toEqual({
      ok: true,
      value: { brightnessRaw: 103, brightnessMax: 255, brightnessPct: 40.4 },
    })
  })

  it('keeps the raw value when the range is unknown', () => {
    // No /sys/class/backlight on this device, so the percentage is unknown but
    // the setting is still worth showing.
    expect(parseBrightness('103', null)).toEqual({
      ok: true,
      value: { brightnessRaw: 103, brightnessMax: null, brightnessPct: null },
    })
  })

  it('treats the platform sentinel for "unknown" as unavailable', () => {
    // Android reports -1 while the panel is off.
    const result = parseBrightness('-1', '255')

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.reason).toContain('brightness')
  })

  it('reports a readable error for an unreadable setting', () => {
    expect(parseBrightness('', '255').ok).toBe(false)
  })
})
