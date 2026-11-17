/**
 * The chip platform a device belongs to. Log-export configuration is stored
 * per platform, so this is the key that separates MTK from UNISOC devices.
 */
export type LogPlatform = 'mtk' | 'unisoc'

/**
 * A platform's log-directory configuration: an ordered list of candidate paths
 * plus the path the user last picked. `selected` may point at a path that is no
 * longer valid; selection logic falls back to the candidates in that case.
 */
export interface ILogPathConfig {
  paths: string[]
  selected: string | null
}

/**
 * Persisted log-export configuration. Both platforms always exist; the
 * effective platform is resolved from `autoDetect` + `manualPlatform` at
 * runtime (see the platform resolution seam, ticket 03).
 */
export interface ILogExportConfig {
  autoDetect: boolean
  manualPlatform: LogPlatform | null
  platforms: Record<LogPlatform, ILogPathConfig>
  outputDir: string
}

/**
 * The legacy shell-panel keys (`aya.shell.mtkLogSource` / `mtkLogSource2` /
 * `mtkLogActive` / `mtkLogOutputDir`), read once for migration.
 */
export interface ILegacyMtkLogConfig {
  source?: string | null
  source2?: string | null
  active?: '1' | '2' | null
  outputDir?: string | null
}
