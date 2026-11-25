import { IMetricsSnapshot } from './metrics/types'
import type { IPlatformMatch, LogPlatform } from './logexport'

export interface IDevice {
  id: string
  name: string
  serialno: string
  androidVersion: string
  sdkVersion: string
  type: 'emulator' | 'device' | 'offline' | 'unauthorized' | 'unknown'
}

export interface IAvd {
  id: string
  name: string
  abi: string
  sdkVersion: string
  memory: number
  internalStorage: number
  resolution: string
  folder: string
  pid: number
}

export interface IPackageInfo {
  icon: string
  label: string
  enabled: boolean
  packageName: string
  versionName: string
  apkPath: string
  apkSize: number
  system: boolean
  firstInstallTime: number
  lastUpdateTime: number
  minSdkVersion?: number
  targetSdkVersion?: number
  dataSize: number
  cacheSize: number
  appSize: number
  signatures: string[]
}

export interface IFileStat {
  size?: number
  mtime: Date
  directory: boolean
  mode: string
}

export interface IFile extends IFileStat {
  name: string
  mime?: string
}

export interface IWebview {
  title: string
  url: string
  devtoolsFrontendUrl: string
  webSocketDebuggerUrl: string
  faviconUrl?: string
}

export interface IProcess {
  name: string
  pid: string
}

export enum TransferType {
  Upload,
  Download,
}

export type IpcGetFps = (deviceId: string, pkg: string) => Promise<number>
/** One call per tick returns everything the performance panel shows. */
export type IpcGetMetrics = (deviceId: string) => Promise<IMetricsSnapshot>
export type IpcGetDevices = () => Promise<IDevice[]>
export type IpcSetScreencastAlwaysOnTop = (alwaysOnTop: boolean) => void
export type IpcListForwards = (
  deviceId: string
) => Promise<Array<{ local: string; remote: string }>>
export type IpcListReverses = IpcListForwards
export type IpcForward = (
  deviceId: string,
  local: string,
  remote: string
) => void
export type IpcReverse = (
  deviceId: string,
  remote: string,
  local: string
) => void
export type IpcDumpWindowHierarchy = (deviceId: string) => Promise<string>
export type IpcGetPackageInfos = (
  deviceId: string,
  packageNames: string[]
) => Promise<IPackageInfo[]>
export type IpcGetAvds = (forceRefresh?: boolean) => Promise<IAvd[]>
export type IpcStartAvd = (avdId: string) => Promise<void>
export type IpcStopAvd = IpcStartAvd
export type IpcWipeAvdData = (avdId: string) => Promise<void>
export type IpcPairDevice = (
  host: string,
  port: number,
  password: string
) => Promise<void>
export type IpcRunAdbScript = (
  deviceId: string,
  commands: string[][]
) => Promise<void>
export type IpcConnectWifi = (
  deviceId: string,
  ssid: string,
  password: string
) => Promise<{
  wasEnabled: boolean
  enabled: boolean
}>
export type IpcDetectPlatform = (
  deviceId: string
) => Promise<IPlatformMatch>

export interface ILogPathValidity {
  path: string
  exists: boolean
  readable: boolean
}

export type IpcDetectLogPaths = (
  deviceId: string,
  paths: string[]
) => Promise<ILogPathValidity[]>

export type IpcDiscoverLogPaths = (
  deviceId: string,
  platform: LogPlatform
) => Promise<string[]>

export type IpcGetLogExportDefaultDir = () => Promise<string>

export interface ILogExportProgress {
  message: string
}

export type ILogExportStatus = 'success' | 'cancelled'

export interface ILogExportResult {
  status: ILogExportStatus
  outputDir: string
  files: string[]
  log: string
}

export type IpcExportLog = (
  deviceId: string,
  sourcePath: string,
  outputDir: string,
  platform: LogPlatform
) => Promise<ILogExportResult>

export type IpcCancelLogExport = () => void

export type IMtkLogMethod = 'mtklogger' | 'fallback'

export interface IMtkLogCaptureResult {
  /** Which capture path was used */
  method: IMtkLogMethod
  /** Local folder where the collected logs were written */
  outputDir: string
  /** Relative file/folder names collected under outputDir */
  files: string[]
  /** Whether the on-device DebugLoggerUI (MTKLogger) was detected */
  hasMtkLogger: boolean
  /** Human-readable summary of what happened */
  log: string
}

export interface IMtkLogStartResult {
  hasMtkLogger: boolean
  rooted: boolean
  message: string
}

/**
 * Start an MTK kernel-log capture session. Elevates to root (userdebug) and,
 * when MTKLogger is present, kicks its Mobile Log capture as a best effort —
 * but the live kernel stream itself does not depend on MTKLogger.
 */
export type IpcStartMtkLog = (deviceId: string) => Promise<IMtkLogStartResult>

/**
 * Stop the capture and export. `text` is the kernel log accumulated in the
 * renderer while the session was running; it is always written to a local
 * file so the export is never empty. On-device MTK_LOG folders are pulled as
 * a best effort on top of that.
 */
export type IpcStopMtkLog = (
  deviceId: string,
  outputDir: string,
  text: string
) => Promise<IMtkLogCaptureResult>
export interface IUnlockRemountEnv {
  adbPath: string
  fastbootPath: string
  adbReady: boolean
  fastbootReady: boolean
  adbState: string
  oemUnlockAllowed: string
  fastbootDevices: string[]
}
export type IUnlockRemountStep =
  | 'checkAdb'
  | 'enableOemUnlock'
  | 'rebootBootloader'
  | 'checkFastboot'
  | 'flashingUnlock'
  | 'oemUnlock'
  | 'fastbootReboot'
  | 'waitForAndroid'
  | 'remount'
  | 'disableVerityRemount'
  | 'finalReboot'
export interface IUnlockRemountResult {
  success: boolean
  stdout: string
  stderr: string
  code: number | null
  message: string
}
export type IpcCheckUnlockRemountEnv = (
  deviceId: string
) => Promise<IUnlockRemountEnv>
export type IpcRunUnlockRemountStep = (
  deviceId: string,
  step: IUnlockRemountStep
) => Promise<IUnlockRemountResult>
export type IpcCreateShell = (deviceId: string) => Promise<string>
export type IpcWriteShell = (sessionId: string, data: string) => void
export type IpcResizeShell = (
  sessionId: string,
  cols: number,
  rows: number
) => void
export type IpcKillShell = (sessionId: string) => void
export type IpcScreencap = (deviceId: string) => Promise<string>
export type IpcLogSource = 'logcat' | 'kernel' | 'mtklog'
export type IpcOpenLogcat = (
  deviceId: string,
  source?: IpcLogSource
) => Promise<string>
export type IpcCloseLogcat = (logcatId: string) => Promise<void>
export type IpcPauseLogcat = IpcCloseLogcat
export type IpcResumeLogcat = IpcCloseLogcat
export type IpcInputKey = (deviceId: string, keyCode: number) => Promise<void>
export type IpcReverseTcp = (
  deviceId: string,
  remote: string
) => Promise<number>
export type IpcStartScrcpy = (deviceId: string, args: string[]) => Promise<void>
export type IpcConnectDevice = (host: string, port?: number) => Promise<void>
export type IpcDisconnectDevice = IpcConnectDevice
export type IpcMoveFile = (
  deviceId: string,
  src: string,
  dest: string
) => Promise<void>
export type IpcStatFile = (deviceId: string, path: string) => Promise<IFileStat>
export type IpcReadDir = (deviceId: string, path: string) => Promise<IFile[]>
export type IpcCreateDir = (deviceId: string, path: string) => Promise<void>
export type IpcDeleteDir = IpcCreateDir
export type IpcDeleteFile = IpcCreateDir
export type IpcOpenFile = IpcCreateDir
export type IpcPushFile = (
  deviceId: string,
  src: string,
  dest: string
) => Promise<void>
export type IpcPullFile = (
  deviceId: string,
  src: string,
  dest: string
) => Promise<void>
export type IpcEnablePackage = (deviceId: string, pkg: string) => Promise<void>
export type IpcDisablePackage = IpcEnablePackage
export type IpcGetPackages = (
  deviceId: string,
  system?: boolean
) => Promise<string[]>
export type IpcInstallPackage = (
  deviceId: string,
  apkPath: string
) => Promise<void>
export type IpcUninstallPackage = (
  deviceId: string,
  pkg: string
) => Promise<void>
export type IpcStartPackage = (deviceId: string, pkg: string) => Promise<void>
export type IpcStopPackage = IpcStartPackage
export type IpcClearPackage = IpcStartPackage
export type IpcGetTopPackage = (deviceId: string) => Promise<{
  name: string
  pid: number
}>
export type IpcGetWebviews = (
  deviceId: string,
  pid: number
) => Promise<IWebview[]>
export type IpcGetProcesses = (deviceId: string) => Promise<IProcess[]>
export type IpcGetFileUrl = (
  deviceId: string,
  path: string,
  port?: number
) => Promise<string>

// Quick scenes (快捷场景)
export type ISceneStepType =
  | 'wait-device'
  | 'install'
  | 'push'
  | 'shell'
  | 'start'
  | 'input'
  | 'sleep'

export interface ISceneStep {
  type: ISceneStepType
  /** Display title of the step */
  title?: string
  /** install: apk file name relative to scene folder */
  apk?: string
  /** install: extra adb install args, e.g. ['-r'] */
  args?: string[]
  /** push: local file path relative to scene folder */
  src?: string
  /** push: destination path on device */
  dest?: string
  /** shell: shell command to run on device */
  command?: string
  /** start: package name to launch */
  package?: string
  /** start: optional activity name (package/activity) */
  activity?: string
  /** input: keycode number or name, e.g. 27 or 'KEYCODE_CAMERA' */
  keyCode?: string | number
  /** sleep: milliseconds to wait */
  ms?: number
  /** If true, a step failure will not abort the scene */
  optional?: boolean
}

export interface IScene {
  id: string
  /** Display name of the scene */
  name: string
  /** Emoji or icon text, e.g. '🔊' */
  icon?: string
  description?: string
  steps: ISceneStep[]
}

export interface ISceneStepResult {
  index: number
  type: string
  title: string
  command: string
  success: boolean
  code: number | null
  stdout: string
  stderr: string
  message: string
  duration: number
}

export interface ISceneRunResult {
  sceneId: string
  success: boolean
  steps: ISceneStepResult[]
}

export type IpcGetScenes = () => Promise<IScene[]>
export type IpcRunScene = (
  deviceId: string,
  sceneId: string
) => Promise<ISceneRunResult>
export type IpcSaveScene = (scene: IScene) => Promise<void>
export type IpcOpenSceneFolder = (sceneId: string) => Promise<void>
