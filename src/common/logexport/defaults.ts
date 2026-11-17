/**
 * Platform default log directories, matching each chip vendor's on-device
 * layout. MediaTek writes to /sdcard/debuglogger; UNISOC / Spreadtrum writes to
 * the emulated-storage ylog directory.
 */
export const DEFAULT_MTK_PATHS = ['/sdcard/debuglogger/']

export const DEFAULT_UNISOC_PATHS = ['/storage/emulated/0/ylog/']

/**
 * Local directory where exported logs land, kept identical to the legacy
 * shell-panel default so migration does not surprise existing users.
 */
export const DEFAULT_LOG_OUTPUT_DIR = 'D:\\桌面\\MTK_LOG'
