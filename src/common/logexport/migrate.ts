import type { ILegacyMtkLogConfig, ILogExportConfig } from './types'
import {
  DEFAULT_LOG_OUTPUT_DIR,
  DEFAULT_MTK_PATHS,
  DEFAULT_UNISOC_PATHS,
} from './defaults'

function normalize(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed || null
}

/**
 * Turn the legacy shell-panel keys (`mtkLogSource` / `mtkLogSource2` /
 * `mtkLogActive` / `mtkLogOutputDir`) into the per-platform configuration.
 *
 * The two legacy "path" slots were both MediaTek sources, so they merge into
 * the MTK candidate list and the active slot becomes the selected path; UNISOC
 * starts from its defaults. The function is deterministic and reads its input
 * only, so applying it twice yields the same result.
 */
export function migrateLogExportConfig(
  legacy: ILegacyMtkLogConfig,
): ILogExportConfig {
  const source = normalize(legacy.source)
  const source2 = normalize(legacy.source2)

  const paths: string[] = []
  for (const candidate of [source, source2]) {
    if (candidate && !paths.includes(candidate)) {
      paths.push(candidate)
    }
  }
  if (paths.length === 0) {
    paths.push(...DEFAULT_MTK_PATHS)
  }

  const selected = legacy.active === '2' ? source2 : source

  return {
    autoDetect: true,
    manualPlatform: null,
    platforms: {
      mtk: { paths, selected },
      unisoc: { paths: [...DEFAULT_UNISOC_PATHS], selected: null },
    },
    outputDir: normalize(legacy.outputDir) || DEFAULT_LOG_OUTPUT_DIR,
  }
}
