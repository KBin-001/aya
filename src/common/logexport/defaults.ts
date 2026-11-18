/**
 * Platform default log directories, matching each chip vendor's on-device
 * layout. MediaTek writes to /sdcard/debuglogger; UNISOC / Spreadtrum writes to
 * the emulated-storage ylog directory. `/storage/emulated/0` and `/sdcard` are
 * usually the same directory (symlink), so both spellings are listed for
 * devices where the symlink is absent.
 */
export const DEFAULT_MTK_PATHS = [
  '/storage/emulated/0/debuglogger/',
  '/sdcard/debuglogger/',
]

export const DEFAULT_UNISOC_PATHS = [
  '/storage/emulated/0/ylog/',
  '/sdcard/ylog/',
]

/**
 * Local directory where exported logs land, kept identical to the legacy
 * shell-panel default so migration does not surprise existing users.
 */
export const DEFAULT_LOG_OUTPUT_DIR = 'D:\\桌面\\MTK_LOG'
