import { Client } from '@devicefarmer/adbkit'
import { app } from 'electron'
import { handleEvent } from 'share/main/lib/util'
import * as window from 'share/main/lib/window'
import { getAdbPath, spawnAdb } from './base'
import { matchPlatform } from 'common/logexport'
import type { LogPlatform } from 'common/logexport'
import fs from 'fs-extra'
import path from 'node:path'
import childProcess from 'node:child_process'
import trim from 'licia/trim'
import sleep from 'licia/sleep'
import log from 'share/common/log'
import {
  IpcCancelLogExport,
  IpcDetectLogPaths,
  IpcDetectPlatform,
  IpcDiscoverLogPaths,
  IpcExportLog,
  IpcGetLogExportDefaultDir,
  ILogExportResult,
  ILogPathValidity,
} from 'common/types'

const logger = log('logexport')

let client: Client

// The adb pull process currently running, so an export can be cancelled.
let running: childProcess.ChildProcess | null = null
let killed = false

// Guards the whole export from concurrent starts; `running` alone would leave
// a gap during the `adb root` retry where the child process is not yet spawned.
let exporting = false

function sendProgress(message: string) {
  logger.debug(message)
  window.sendTo('main', 'logExportProgress', { message })
}

function formatTime(date: Date) {
  const pad = (num: number) => num.toString().padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate()
  )}-${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`
}

/**
 * Default local directory for exported logs. The Downloads folder is always an
 * ASCII, writable path, unlike the legacy hardcoded desktop path which broke
 * `adb pull` on systems whose desktop is a non-ASCII path.
 */
function getDefaultLogOutputDir() {
  return path.join(app.getPath('downloads'), 'AYA_LOG')
}

const getLogExportDefaultDir: IpcGetLogExportDefaultDir = async function () {
  return getDefaultLogOutputDir()
}

/**
 * Classify the device platform from its system properties. Returns the
 * platform plus the keyword that decided it, so the UI can explain a match.
 */
const detectPlatform: IpcDetectPlatform = async function (deviceId) {
  const device = await client.getDevice(deviceId)
  const properties = await device.getProperties()
  return matchPlatform(properties as Record<string, string>)
}

/**
 * Probe each candidate path: does it exist, and can its contents be listed
 * (read)? `ls -d` distinguishes a missing path from one that is present but
 * unreadable (SELinux / root-only), then `ls -A` checks readability.
 */
const detectLogPaths: IpcDetectLogPaths = async function (deviceId, paths) {
  const results: ILogPathValidity[] = []
  for (const path of paths) {
    results.push(await probePath(deviceId, path))
  }
  return results
}

async function probePath(
  deviceId: string,
  path: string
): Promise<ILogPathValidity> {
  const stat = await spawnAdb(['-s', deviceId, 'shell', 'ls', '-d', path])
  const output = `${stat.stdout}\n${stat.stderr}`.toLowerCase()
  if (stat.code === 0) {
    const read = await spawnAdb(['-s', deviceId, 'shell', 'ls', '-A', path])
    return { path, exists: true, readable: read.code === 0 }
  }
  if (output.includes('no such file') || output.includes('not found')) {
    return { path, exists: false, readable: false }
  }
  return { path, exists: true, readable: false }
}

// Where each vendor writes its logs, and the user-accessible roots to scan for
// those directory names. `/storage/emulated/0` is the canonical spelling,
// `/sdcard` its usual symlink; both are scanned because some builds lack the
// symlink.
const LOG_DIR_PARENTS = ['/storage/emulated/0', '/sdcard']
const LOG_DIR_KEYWORDS: Record<LogPlatform, string[]> = {
  mtk: ['debuglogger', 'mtklog'],
  unisoc: ['ylog'],
}

/**
 * Discover where the device actually writes its logs by scanning the storage
 * roots for the platform's log-directory names. This finds the real path even
 * when the configured candidates are stale, e.g. a MediaTek build that uses
 * /storage/emulated/0/debuglogger instead of /sdcard/debuglogger.
 */
const discoverLogPaths: IpcDiscoverLogPaths = async function (
  deviceId,
  platform
) {
  const keywords = LOG_DIR_KEYWORDS[platform]
  const found: string[] = []
  const seen = new Set<string>()
  for (const parent of LOG_DIR_PARENTS) {
    const listing = await spawnAdb([
      '-s',
      deviceId,
      'shell',
      'ls',
      '-1',
      parent,
    ])
    if (listing.code !== 0) {
      continue
    }
    for (const line of listing.stdout.split('\n')) {
      const name = line.trim()
      if (!name || seen.has(name)) {
        continue
      }
      if (keywords.some((keyword) => name.toLowerCase().includes(keyword))) {
        seen.add(name)
        found.push(`${parent}/${name}`)
      }
    }
  }
  return found
}

/**
 * Pull one device path into an absolute local destination, streaming adb's own
 * output as progress and remembering the child process for cancellation.
 */
function pullContents(
  deviceId: string,
  sourcePath: string,
  dest: string
): Promise<{
  code: number | null
  stdout: string
  stderr: string
  killed: boolean
}> {
  return new Promise((resolve, reject) => {
    killed = false
    const cp = childProcess.spawn(
      getAdbPath(),
      ['-s', deviceId, 'pull', sourcePath, dest],
      { env: { ...process.env } }
    )
    running = cp
    let stdout = ''
    let stderr = ''
    cp.stdout?.on('data', (data: Buffer) => {
      const text = data.toString()
      stdout += text
      for (const line of text.split('\n')) {
        const trimmed = line.trim()
        if (trimmed) {
          sendProgress(trimmed)
        }
      }
    })
    cp.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString()
    })
    cp.on('error', (err) => {
      running = null
      reject(err)
    })
    cp.on('close', (code) => {
      running = null
      const wasKilled = killed
      killed = false
      resolve({ code, stdout, stderr, killed: wasKilled })
    })
  })
}

function cancelledResult(outputDir: string): ILogExportResult {
  return { status: 'cancelled', outputDir, files: [], log: '已取消导出' }
}

/**
 * Export a device log directory into a fresh timestamped folder, bound to the
 * device serial. Falls back to `adb root` once when the first pull fails.
 */
const exportLog: IpcExportLog = async function (
  deviceId,
  sourcePath,
  outputDir,
  platform
) {
  sourcePath = trim(sourcePath)
  if (!sourcePath) {
    throw new Error('日志源路径为空')
  }
  outputDir = trim(outputDir) || DEFAULT_LOG_OUTPUT_DIR

  if (exporting) {
    throw new Error('已有导出任务正在进行')
  }
  exporting = true

  try {
    await fs.ensureDir(outputDir)
    const folderName = `${formatTime(new Date())}-${platform}`
    const dest = path.join(outputDir, folderName)

    sendProgress('开始导出')
    sendProgress(`拉取 ${sourcePath} ...`)

    const first = await pullContents(deviceId, sourcePath, dest)
    if (first.killed) {
      return cancelledResult(dest)
    }

    if (first.code !== 0) {
      sendProgress('拉取失败，尝试 adb root 后重试')
      await spawnAdb(['-s', deviceId, 'root'])
      await sleep(1500)
      await spawnAdb(['-s', deviceId, 'wait-for-device'])
      const retry = await pullContents(deviceId, sourcePath, dest)
      if (retry.killed) {
        return cancelledResult(dest)
      }
      if (retry.code !== 0) {
        throw new Error(retry.stderr || retry.stdout || '导出日志失败')
      }
    }

    const files = await fs.readdir(dest).catch(() => [] as string[])
    sendProgress(`导出完成: ${dest}`)
    return {
      status: 'success',
      outputDir: dest,
      files,
      log: `导出完成: ${dest}`,
    }
  } finally {
    exporting = false
  }
}

const cancelLogExport: IpcCancelLogExport = function () {
  if (running) {
    killed = true
    running.kill()
  }
}

export function init(c: Client) {
  client = c

  handleEvent('detectPlatform', detectPlatform)
  handleEvent('detectLogPaths', detectLogPaths)
  handleEvent('discoverLogPaths', discoverLogPaths)
  handleEvent('exportLog', exportLog)
  handleEvent('cancelLogExport', cancelLogExport)
}
