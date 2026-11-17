import type { DetectedPlatform, ILogExportConfig } from './types'

/**
 * The four properties read to decide a device's chip platform, in the order
 * they are checked. The first match wins, mirroring how the main process reads
 * the properties before delegating to this pure classifier.
 */
const PLATFORM_PROP_KEYS = [
  'ro.board.platform',
  'ro.hardware',
  'ro.soc.manufacturer',
  'ro.product.board',
] as const

// MediaTek: the "mtk" / "mediatek" literals, or an "mt" + digits model name
// (mt6580, mt6765, mt6789, mt6983, mt8781, ...).
const MTK_MODEL_PATTERN = /mt\d+/

/**
 * A classification with the keyword that produced it, for troubleshooting.
 */
export interface IPlatformMatch {
  platform: DetectedPlatform
  keyword: string | null
}

function mtkKeyword(value: string): string | null {
  if (value.includes('mediatek')) {
    return 'mediatek'
  }
  if (value.includes('mtk')) {
    return 'mtk'
  }
  const match = value.match(MTK_MODEL_PATTERN)
  return match ? match[0] : null
}

function unisocKeyword(value: string): string | null {
  if (value.includes('unisoc')) {
    return 'unisoc'
  }
  if (value.includes('sprd')) {
    return 'sprd'
  }
  // The bare "ums" keyword also covers the UMS model prefix (ums9230, ...).
  if (value.includes('ums')) {
    return 'ums'
  }
  return null
}

/**
 * Classify a device from its `getprop` properties, case-insensitively, and
 * report the keyword that decided it. Returns `unknown` rather than guessing
 * when no property matches.
 */
export function matchPlatform(props: Record<string, string>): IPlatformMatch {
  for (const key of PLATFORM_PROP_KEYS) {
    const value = (props[key] || '').toLowerCase()
    if (!value) {
      continue
    }
    const mtk = mtkKeyword(value)
    if (mtk) {
      return { platform: 'mtk', keyword: mtk }
    }
    const unisoc = unisocKeyword(value)
    if (unisoc) {
      return { platform: 'unisoc', keyword: unisoc }
    }
  }
  return { platform: 'unknown', keyword: null }
}

/**
 * Classify a device from its `getprop` properties, returning only the platform.
 */
export function classifyPlatform(
  props: Record<string, string>,
): DetectedPlatform {
  return matchPlatform(props).platform
}

/**
 * Resolve the effective platform from the persisted config and the latest
 * detection. Auto-detection wins when it is on and produced a real platform;
 * otherwise the manually selected platform is used, and `unknown` when neither
 * applies.
 */
export function resolvePlatform(
  config: ILogExportConfig,
  detected: DetectedPlatform,
): DetectedPlatform {
  if (config.autoDetect && detected !== 'unknown') {
    return detected
  }
  return config.manualPlatform || 'unknown'
}

/**
 * Display label for a platform, shared by the shell button badge and the
 * management panel so the two never drift apart.
 */
export function platformLabel(platform: DetectedPlatform): string {
  return platform === 'mtk'
    ? 'MTK'
    : platform === 'unisoc'
      ? 'UNISOC'
      : '未知平台'
}
