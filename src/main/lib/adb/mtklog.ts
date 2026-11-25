import { Client } from '@devicefarmer/adbkit'
import { handleEvent } from 'share/main/lib/util'
import * as window from 'share/main/lib/window'
import { isRooted, shell, spawnAdb } from './base'
import contain from 'licia/contain'
import trim from 'licia/trim'
import isEmpty from 'licia/isEmpty'
import sleep from 'licia/sleep'
import fs from 'fs-extra'
import path from 'node:path'
import log from 'share/common/log'
import {
  IpcStartMtkLog,
  IpcStopMtkLog,
  IMtkLogCaptureResult,
  IMtkLogStartResult,
} from 'common/types'

const logger = log('mtklog')

let client: Client

// MTKLogger (DebugLoggerUI) package
const MTK_LOGGER_PACKAGE = 'com.debug.loggerui'
const MTK_LOGGER_SERVICE = `${MTK_LOGGER_PACKAGE}/.framework.DebugLoggerUIService`
const MTK_LOGGER_ADB_CMD = `${MTK_LOGGER_PACKAGE}.ADB_CMD`

// MTK log folders on device. Recent MTK daemons write to /data/debuglogger
// (requires adb root); older builds used /sdcard/debuglogger or /sdcard/mtklog.
const MTK_LOG_PATHS = [
  '/data/debuglogger',
  '/sdcard/debuglogger',
  '/sdcard/mtklog',
]
// AEE (kernel exception / panic) dumps
const AEE_PATHS = ['/data/vendor/aee_exp', '/data/aee_exp']

function pad(num: number) {
  return num.toString().padStart(2, '0')
}

function formatTime(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate()
  )}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`
}

function formatClock(date: Date) {
  return `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

function sendProgress(stage: string, message: string) {
  logger.debug(stage, message)
  window.sendTo('main', 'mtklogProgress', { stage, message })
}

/**
 * Use the highest permission available. On userdebug builds `adb root`
 * restarts adbd as root, which is required to read /dev/kmsg fully and to
 * pull /data/debuglogger.
 */
async function ensureRoot(deviceId: string): Promise<boolean> {
  if (await isRooted(deviceId)) {
    return true
  }
  await spawnAdb(['-s', deviceId, 'root'])
  await spawnAdb(['-s', deviceId, 'wait-for-device'])
  await sleep(1500)
  return isRooted(deviceId)
}

async function detectMtkLogger(deviceId: string): Promise<boolean> {
  const packages = await shell(deviceId, `pm list packages ${MTK_LOGGER_PACKAGE}`)
  if (contain(packages, MTK_LOGGER_PACKAGE)) {
    return true
  }
  const path = await shell(deviceId, `pm path ${MTK_LOGGER_PACKAGE}`)
  return contain(path, 'package:')
}

/**
 * Drive the on-device DebugLoggerUI via its ADB_CMD broadcast (best effort).
 * Reads the extras `cmd_name` (start/stop) and `cmd_target` (MOBILE_LOG/...).
 */
async function broadcastAdbCmd(
  deviceId: string,
  cmdName: string,
  cmdTarget: string
): Promise<string> {
  const result = await spawnAdb([
    '-s',
    deviceId,
    'shell',
    'am',
    'broadcast',
    '-a',
    MTK_LOGGER_ADB_CMD,
    '--es',
    'cmd_name',
    cmdName,
    '--es',
    'cmd_target',
    cmdTarget,
  ])
  return `${result.stdout}${result.stderr}`
}

/** Pull a device directory's *contents* into dest (flattened, `adb pull src/.`). */
async function pullContents(
  deviceId: string,
  devicePath: string,
  dest: string
): Promise<boolean> {
  const result = await spawnAdb(['-s', deviceId, 'pull', `${devicePath}/.`, dest])
  return result.code === 0
}

/** Pull a single device path (dir or file) into destDir/<subName>. */
async function pullDevicePath(
  deviceId: string,
  devicePath: string,
  destDir: string,
  subName: string
): Promise<boolean> {
  const result = await spawnAdb([
    '-s',
    deviceId,
    'pull',
    devicePath,
    path.join(destDir, subName),
  ])
  return result.code === 0
}

/**
 * Kick off the on-device MTK capture (best effort, never required): the live
 * kernel stream shown in the UI does not depend on it, but when MTKLogger is
 * present this also lets its daemons write rich logs into /data/debuglogger.
 */
const startMtkLog: IpcStartMtkLog = async function (
  deviceId
): Promise<IMtkLogStartResult> {
  sendProgress('root', '获取最高权限 (adb root)')
  const rooted = await ensureRoot(deviceId)

  sendProgress('detect', '检测 MTKLogger...')
  const hasMtkLogger = await detectMtkLogger(deviceId)

  if (hasMtkLogger) {
    // Best effort: start the service + Mobile Log capture on the device.
    await spawnAdb([
      '-s',
      deviceId,
      'shell',
      'am',
      'startservice',
      '-n',
      MTK_LOGGER_SERVICE,
    ])
    sendProgress('start', '启动设备端 Mobile Log (DebugLoggerUI)')
    await broadcastAdbCmd(deviceId, 'start', 'MOBILE_LOG')
    sendProgress('running', '● MobileLog Running')
    return {
      hasMtkLogger: true,
      rooted,
      message: '已启动设备端 Mobile Log (DebugLoggerUI) 作为辅助采集',
    }
  }

  sendProgress('running', '● 内核日志采集中 (未检测到 MTKLogger)')
  return {
    hasMtkLogger: false,
    rooted,
    message: '未检测到 MTKLogger，内核日志由 AYA 直接采集',
  }
}

const stopMtkLog: IpcStopMtkLog = async function (
  deviceId,
  outputDir,
  text
): Promise<IMtkLogCaptureResult> {
  outputDir = trim(outputDir)
  if (isEmpty(outputDir)) {
    throw new Error('MTK log output directory is empty')
  }

  const now = new Date()
  const dest = path.join(outputDir, formatTime(now))
  await fs.ensureDir(dest)

  const logLines: string[] = []
  const files: string[] = []
  let hasMtkLogger = false

  // 1) Always write the kernel log captured live in the UI first. This
  // guarantees the export is never empty, even if the device disconnects.
  const kernelName = `kernel_log_${formatClock(now)}.txt`
  await fs.writeFile(path.join(dest, kernelName), text || '(empty)')
  files.push(kernelName)
  logLines.push(`已保存实时内核日志: ${kernelName} (${text.length} chars)`)

  // 2) Best effort, never fatal: stop the on-device capture and pull whatever
  // MTKLogger/daemons wrote on the device.
  try {
    hasMtkLogger = await detectMtkLogger(deviceId)
    if (hasMtkLogger) {
      sendProgress('stop', '停止设备端 Mobile Log')
      logLines.push(await broadcastAdbCmd(deviceId, 'stop', 'MOBILE_LOG'))
    }

    sendProgress('pull', '尝试拉取设备端 MTK_LOG (best effort)')
    for (const devicePath of MTK_LOG_PATHS) {
      if (await pullContents(deviceId, devicePath, dest)) {
        files.push(devicePath)
        logLines.push(`已拉取: ${devicePath}`)
        break
      }
    }
    for (const devicePath of AEE_PATHS) {
      if (await pullDevicePath(deviceId, devicePath, dest, 'aee_exp')) {
        files.push('aee_exp')
        logLines.push(`已拉取: ${devicePath}`)
        break
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logLines.push(`设备端采集拉取失败（不影响已保存的实时日志）: ${message}`)
  }

  sendProgress('done', `导出完成: ${dest}`)
  return {
    method: hasMtkLogger ? 'mtklogger' : 'fallback',
    outputDir: dest,
    files,
    hasMtkLogger,
    log: logLines.join('\n'),
  }
}

export function init(c: Client) {
  client = c

  handleEvent('startMtkLog', startMtkLog)
  handleEvent('stopMtkLog', stopMtkLog)
}

export { detectMtkLogger }
