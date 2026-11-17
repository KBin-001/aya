import type { LogPlatform } from './types'

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
const MTK_PATTERN = /(?:mtk|mediatek|mt\d+)/i

// UNISOC / Spreadtrum: the "unisoc" / "sprd" / "ums" literals. The bare "ums"
// keyword also matches the UMS model prefix (ums9230, ums9370, ...) as a
// substring.
const UNISOC_PATTERN = /(?:unisoc|sprd|ums)/i

/**
 * Classify a device from its `getprop` properties, case-insensitively. Returns
 * `unknown` rather than guessing when no property matches, so the caller can
 * fall back to manual platform selection.
 */
export function classifyPlatform(
  props: Record<string, string>,
): LogPlatform | 'unknown' {
  for (const key of PLATFORM_PROP_KEYS) {
    const value = (props[key] || '').toLowerCase()
    if (!value) {
      continue
    }
    if (MTK_PATTERN.test(value)) {
      return 'mtk'
    }
    if (UNISOC_PATTERN.test(value)) {
      return 'unisoc'
    }
  }
  return 'unknown'
}
