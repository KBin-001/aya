import type { ILogPathConfig } from './types'

/**
 * Pick the log path to pull from a platform's candidate list.
 *
 * Preference order: the path the user last selected (if it is still valid),
 * then the first valid candidate in list order. Returns null when every
 * candidate is invalid, so the caller can prompt for manual configuration.
 */
export function selectLogPath(
  config: ILogPathConfig,
  isValid: Record<string, boolean>,
): string | null {
  if (config.selected && isValid[config.selected]) {
    return config.selected
  }
  for (const path of config.paths) {
    if (isValid[path]) {
      return path
    }
  }
  return null
}
