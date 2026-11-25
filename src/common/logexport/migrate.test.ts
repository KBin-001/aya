import { describe, expect, it } from 'vitest'
import { DEFAULT_MTK_PATHS, DEFAULT_UNISOC_PATHS } from './defaults'
import { migrateLogExportConfig } from './migrate'

const TEST_OUTPUT_DIR = 'D:\\AYA_LOG'

describe('migrateLogExportConfig', () => {
  it('turns an empty legacy config into platform defaults', () => {
    expect(migrateLogExportConfig({}, TEST_OUTPUT_DIR)).toEqual({
      autoDetect: true,
      manualPlatform: null,
      platforms: {
        mtk: { paths: [...DEFAULT_MTK_PATHS], selected: null },
        unisoc: { paths: [...DEFAULT_UNISOC_PATHS], selected: null },
      },
      outputDir: TEST_OUTPUT_DIR,
    })
  })

  it('keeps two legacy sources and the active path', () => {
    const result = migrateLogExportConfig(
      {
        source: '/data/debuglogger',
        source2: '/sdcard/mtklog',
        active: '2',
      },
      TEST_OUTPUT_DIR,
    )

    expect(result.platforms.mtk.paths).toEqual([
      '/data/debuglogger',
      '/sdcard/mtklog',
    ])
    expect(result.platforms.mtk.selected).toBe('/sdcard/mtklog')
  })

  it('deduplicates identical sources', () => {
    const result = migrateLogExportConfig(
      {
        source: '/sdcard/debuglogger',
        source2: '/sdcard/debuglogger',
        active: '1',
      },
      TEST_OUTPUT_DIR,
    )

    expect(result.platforms.mtk.paths).toEqual(['/sdcard/debuglogger'])
    expect(result.platforms.mtk.selected).toBe('/sdcard/debuglogger')
  })

  it('trims whitespace and drops empty sources', () => {
    const result = migrateLogExportConfig(
      {
        source: '  /sdcard/mtklog  ',
        source2: '   ',
      },
      TEST_OUTPUT_DIR,
    )

    expect(result.platforms.mtk.paths).toEqual(['/sdcard/mtklog'])
    expect(result.platforms.mtk.selected).toBe('/sdcard/mtklog')
  })

  it('keeps the legacy output directory', () => {
    expect(
      migrateLogExportConfig({ outputDir: 'C:\\logs' }, TEST_OUTPUT_DIR)
        .outputDir,
    ).toBe('C:\\logs')
  })

  it('falls back to the default output directory when empty', () => {
    expect(
      migrateLogExportConfig({ outputDir: '  ' }, TEST_OUTPUT_DIR).outputDir,
    ).toBe(TEST_OUTPUT_DIR)
  })

  it('is deterministic for the same input', () => {
    const legacy = { source: '/a', source2: '/b', active: '2' as const }
    expect(migrateLogExportConfig(legacy, TEST_OUTPUT_DIR)).toEqual(
      migrateLogExportConfig(legacy, TEST_OUTPUT_DIR),
    )
  })
})
