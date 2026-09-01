import { app } from 'electron'
import Adb, { Client, Device } from '@devicefarmer/adbkit'
import androidDeviceList from 'android-device-list'
import {
  resolveResources,
  handleEvent,
  getUserDataPath,
} from 'share/main/lib/util'
import map from 'licia/map'
import types from 'licia/types'
import filter from 'licia/filter'
import isStrBlank from 'licia/isStrBlank'
import trim from 'licia/trim'
import startWith from 'licia/startWith'
import toNum from 'licia/toNum'
import contain from 'licia/contain'
import * as window from 'share/main/lib/window'
import fs from 'fs-extra'
import { getSettingsStore } from './store'
import isWindows from 'licia/isWindows'
import isEmpty from 'licia/isEmpty'
import * as base from './adb/base'
import { shell, getAdbPath, spawnAdb, isRooted } from './adb/base'
import * as logcat from './adb/logcat'
import * as shellAdb from './adb/shell'
import * as server from './adb/server'
import * as scrcpy from './adb/scrcpy'
import * as packageAdb from './adb/package'
import * as file from './adb/file'
import * as fps from './adb/fps'
import * as webview from './adb/webview'
import * as port from './adb/port'
import { getCpuLoads, getCpus, getCpuTemperature } from './adb/cpu'
import log from 'share/common/log'
import {
  IpcConnectDevice,
  IpcConnectWifi,
  IpcDisconnectDevice,
  IpcDumpWindowHierarchy,
  IpcExportMtkLog,
  IpcCheckUnlockRemountEnv,
  IpcGetDevices,
  IpcInputKey,
  IpcPairDevice,
  IpcRunAdbScript,
  IpcRunUnlockRemountStep,
  IUnlockRemountResult,
  IpcScreencap,
} from 'common/types'
import path from 'node:path'
import childProcess from 'node:child_process'
import isMac from 'licia/isMac'
import sleep from 'licia/sleep'

const logger = log('adb')

const settingsStore = getSettingsStore()

let client: Client

const getDevices: IpcGetDevices = async function () {
  const devices = await client.listDevices()

  return Promise.all(
    map(devices, async (device: Device) => {
      if (device.type !== 'emulator' && device.type !== 'device') {
        return getUnavailableDevice(device)
      }

      try {
        const properties = await client.getDevice(device.id).getProperties()

        let name = `${properties['ro.product.manufacturer']} ${properties['ro.product.model']}`
        const marketName = getMarketName(properties)
        if (marketName) {
          name = marketName
        }

        return {
          id: device.id,
          type: device.type,
          serialno: properties['ro.serialno'] || device.id,
          name,
          androidVersion: properties['ro.build.version.release'] || '',
          sdkVersion: properties['ro.build.version.sdk'] || '',
        }
      } catch {
        return getUnavailableDevice(device)
      }
    })
  ).catch(() => [])
}

function getUnavailableDevice(device: Device) {
  const type = device.type as 'offline' | 'unauthorized' | 'unknown'
  let name = `ADB ${device.type}`
  if (device.type === 'unauthorized') {
    name = 'ADB unauthorized'
  } else if (device.type === 'offline') {
    name = 'ADB offline'
  }

  return {
    id: device.id,
    type,
    serialno: device.id,
    name,
    androidVersion: '',
    sdkVersion: '',
  }
}

async function getOverview(deviceId: string) {
  const device = await client.getDevice(deviceId)
  const properties = await device.getProperties()
  const cpus = await getCpus(deviceId, false)
  const [kernelVersion, fontScale, wifi] = await shell(deviceId, [
    'uname -r',
    'settings get system font_scale',
    'dumpsys wifi',
  ])

  let ssidMatch = wifi.match(/mWifiInfo\s+SSID: "?(.+?)"?,/)
  if (ssidMatch && ssidMatch[1] === '<unknown ssid>') {
    ssidMatch = null
  }

  return {
    name: getMarketName(properties) || properties['ro.product.name'],
    processor: properties['ro.product.board'] || '',
    abi: properties['ro.product.cpu.abi'],
    brand: properties['ro.product.brand'],
    model: properties['ro.product.model'],
    serialno: properties['ro.serialno'] || '',
    cpuNum: cpus.length,
    kernelVersion,
    fontScale: fontScale === 'null' ? 0 : toNum(fontScale),
    wifi: ssidMatch ? ssidMatch[1] : '',
    root: await isRooted(deviceId),
    ...(await getIpAndMac(deviceId)),
    ...(await getStorage(deviceId)),
    ...(await getMemory(deviceId)),
    ...(await getScreen(deviceId)),
  }
}

async function getIpAndMac(deviceId: string) {
  let ip = ''
  let mac = ''
  const wlan0 = await shell(deviceId, 'ip addr show wlan0')
  const ipMatch = wlan0.match(/inet (\d+\.\d+\.\d+\.\d+)/)
  if (ipMatch) {
    ip = ipMatch[1]
  }
  const macMatch = wlan0.match(
    /link\/ether (([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2}))/
  )
  if (macMatch) {
    mac = macMatch[1]
  }

  return {
    ip,
    mac,
  }
}

async function setFontScale(deviceId: string, scale: number) {
  await shell(deviceId, `settings put system font_scale ${scale}`)
}

function getMarketName(properties: types.PlainObj<string>) {
  const keys = [
    // Oppo
    'ro.oppo.market.name',
    // Huawei, Honor
    'ro.config.marketing_name',
    // OnePlus, Realme
    'ro.vendor.oplus.market.enname',
    // Vivo
    'ro.vivo.market.name',
    // Xiaomi, Redmi
    'ro.product.marketname',
    // Asus
    'ro.asus.product.mkt_name',
  ]
  for (let i = 0, len = keys.length; i < len; i++) {
    const key = keys[i]
    if (properties[key]) {
      return properties[key]
    }
  }

  const device = properties['ro.product.device']
  const model = properties['ro.product.model']

  let marketName = ''

  const devices: any[] = androidDeviceList.getDevicesByDeviceId(device)
  if (!isEmpty(devices)) {
    const deviceFilter = filter(devices, (device) => device.model === model)
    if (!isEmpty(deviceFilter)) {
      marketName = deviceFilter[0].name
    } else {
      marketName = devices[0].name
    }
  }

  return marketName
}

async function getPerformance(deviceId: string) {
  const cpus = await getCpus(deviceId)

  return {
    cpus,
    cpuLoads: await getCpuLoads(deviceId, cpus),
    cpuTemperature: await getCpuTemperature(deviceId),
    ...(await getMemory(deviceId)),
    ...(await getBattery(deviceId)),
  }
}

async function getUptime(deviceId: string) {
  const result = await shell(deviceId, 'cat /proc/uptime')
  const [uptime] = result.split(' ')
  return Math.round(toNum(uptime) * 1000)
}

async function getBattery(deviceId: string) {
  const result = await shell(deviceId, 'dumpsys battery')

  return {
    batteryLevel: toNum(getPropValue('level', result)),
    batteryTemperature: toNum(getPropValue('temperature', result)),
    batteryVoltage: toNum(getPropValue('voltage', result)),
  }
}

const screencap: IpcScreencap = async function (deviceId) {
  const device = await client.getDevice(deviceId)
  const data = await device.screencap()
  const buf = await Adb.util.readAll(data)

  return buf.toString('base64')
}

const dumpWindowHierarchy: IpcDumpWindowHierarchy = async function (deviceId) {
  const path = '/data/local/tmp/aya_uidump.xml'
  await shell(deviceId, `uiautomator dump ${path}`)
  const data = await file.pullFileData(deviceId, path)
  return data.toString('utf8')
}

async function getScreen(deviceId: string) {
  const [wmSize, wmDensity] = await shell(deviceId, ['wm size', 'wm density'])

  const physicalResolution = getPropValue('Physical size', wmSize)
  const physicalDensity = getPropValue('Physical density', wmDensity)

  const hasOverrideResolution = contain(wmSize, 'Override')
  const hasOverrideDensity = contain(wmDensity, 'Override')
  const resolution = hasOverrideResolution
    ? getPropValue('Override size', wmSize)
    : physicalResolution
  const density = hasOverrideDensity
    ? getPropValue('Override density', wmDensity)
    : physicalDensity

  return {
    resolution,
    physicalResolution,
    density,
    physicalDensity,
  }
}

async function getMemory(deviceId: string) {
  const memInfo = await shell(deviceId, 'cat /proc/meminfo')
  let memTotal = 0
  let memFree = 0

  const totalMatch = getPropValue('MemTotal', memInfo)
  let freeMatch = getPropValue('MemAvailable', memInfo)
  if (!freeMatch) {
    freeMatch = getPropValue('MemFree', memInfo)
  }
  if (totalMatch && freeMatch) {
    memTotal = parseInt(totalMatch, 10) * 1024
    memFree = parseInt(freeMatch, 10) * 1024
  }

  return {
    memTotal,
    memUsed: memTotal - memFree,
  }
}

async function getStorage(deviceId: string) {
  const storageInfo = await shell(deviceId, 'dumpsys diskstats')
  let storageTotal = 0
  let storageFree = 0

  const match = storageInfo.match(new RegExp('Data-Free: (\\d+)K / (\\d+)K'))
  if (match) {
    storageFree = parseInt(match[1], 10) * 1024
    storageTotal = parseInt(match[2], 10) * 1024
  }

  return {
    storageTotal,
    storageUsed: storageTotal - storageFree,
  }
}

function getPropValue(key: string, str: string) {
  const lines = str.split('\n')
  for (let i = 0, len = lines.length; i < len; i++) {
    const line = trim(lines[i])
    if (startWith(line, key)) {
      return trim(line.replace(/.*:/, ''))
    }
  }

  return ''
}

const connectDevice: IpcConnectDevice = async function (host, port) {
  await client.connect(host, port)
}

const disconnectDevice: IpcDisconnectDevice = async function (host, port) {
  await client.disconnect(host, port)
}

const pairDevice: IpcPairDevice = async function (host, port, password) {
  const { stdout } = await spawnAdb(['pair', `${host}:${port}`, password])
  if (!contain(stdout, 'Successfully')) {
    throw new Error(`Pair device failed: ${stdout}`)
  }
}

const runAdbScript: IpcRunAdbScript = async function (deviceId, commands) {
  for (const command of commands) {
    const args = ['-s', deviceId, ...command]
    const { stdout, stderr, code } = await spawnAdb(args)
    if (code !== 0) {
      throw new Error(
        stderr || stdout || `ADB command failed: ${args.join(' ')}`
      )
    }
    if (command[0] === 'root') {
      await sleep(2000)
      const wait = await spawnAdb(['-s', deviceId, 'wait-for-device'])
      if (wait.code !== 0) {
        throw new Error(
          wait.stderr || wait.stdout || 'ADB command failed: wait-for-device'
        )
      }
    }
  }
}

const checkUnlockRemountEnv: IpcCheckUnlockRemountEnv = async function (
  deviceId
) {
  const fastbootPath = getFastbootPath()
  const adbState = await spawnAdb(['-s', deviceId, 'get-state']).catch((err) =>
    commandErrorResult(err)
  )
  const oemUnlockAllowed = await spawnAdb([
    '-s',
    deviceId,
    'shell',
    'getprop',
    'sys.oem_unlock_allowed',
  ]).catch((err) => commandErrorResult(err))
  const fastbootVersion = await spawnCommand(fastbootPath, [
    '--version',
  ]).catch((err) => commandErrorResult(err))
  const fastbootDevices = await spawnFastboot(['devices']).catch((err) =>
    commandErrorResult(err)
  )

  return {
    adbPath: getAdbPath(),
    fastbootPath,
    adbReady: adbState.code === 0,
    fastbootReady: fastbootVersion.code === 0,
    adbState: trim(adbState.stdout || adbState.stderr),
    oemUnlockAllowed: trim(oemUnlockAllowed.stdout || oemUnlockAllowed.stderr),
    fastbootDevices: parseFastbootDevices(fastbootDevices.stdout),
  }
}

const runUnlockRemountStep: IpcRunUnlockRemountStep = async function (
  deviceId,
  step
) {
  switch (step) {
    case 'checkAdb':
      return runAdbStep(deviceId, ['get-state'])
    case 'enableOemUnlock':
      return runUnlockSequence(deviceId, [
        ['adb', ['root']],
        ['wait', ['wait-for-device']],
        ['adb', ['shell', 'svc', 'oem_unlock', 'enable']],
        ['adb', ['shell', 'getprop', 'sys.oem_unlock_allowed']],
      ])
    case 'rebootBootloader':
      return runUnlockSequence(deviceId, [
        ['adb', ['reboot', 'bootloader']],
        ['sleep', ['5000']],
        ['fastboot', ['devices']],
      ])
    case 'checkFastboot':
      return runFastbootStep(['devices'])
    case 'flashingUnlock':
      return runFastbootStep(['flashing', 'unlock'])
    case 'oemUnlock':
      return runFastbootStep(['oem', 'unlock'])
    case 'fastbootReboot':
      return runFastbootStep(['reboot'])
    case 'waitForAndroid':
      return runAdbStep(deviceId, ['wait-for-device'])
    case 'remount':
      return runUnlockSequence(deviceId, [
        ['adb', ['root']],
        ['wait', ['wait-for-device']],
        ['adb', ['remount']],
      ])
    case 'disableVerityRemount':
      return runUnlockSequence(deviceId, [
        ['adb', ['root']],
        ['adb', ['disable-verity']],
        ['adb', ['reboot']],
        ['wait', ['wait-for-device']],
        ['adb', ['root']],
        ['wait', ['wait-for-device']],
        ['adb', ['remount']],
      ])
    case 'finalReboot':
      return runAdbStep(deviceId, ['reboot'])
  }
}

type UnlockCommandType = 'adb' | 'wait' | 'fastboot' | 'sleep'
type UnlockCommand = [UnlockCommandType, string[]]

async function runUnlockSequence(
  deviceId: string,
  commands: UnlockCommand[]
): Promise<IUnlockRemountResult> {
  let stdout = ''
  let stderr = ''
  let code: number | null = 0

  for (const [type, args] of commands) {
    let result: IUnlockRemountResult
    if (type === 'adb') {
      result = await runAdbStep(deviceId, args)
    } else if (type === 'wait') {
      result = await runAdbStep(deviceId, args)
    } else if (type === 'fastboot') {
      result = await runFastbootStep(args)
    } else {
      await sleep(toNum(args[0]))
      result = successResult(`sleep ${args[0]}ms`)
    }

    stdout += result.stdout
    stderr += result.stderr
    code = result.code
    if (!result.success) {
      return {
        success: false,
        stdout,
        stderr,
        code,
        message: result.message,
      }
    }
  }

  return {
    success: true,
    stdout,
    stderr,
    code,
    message: 'OK',
  }
}

async function runAdbStep(
  deviceId: string,
  args: string[]
): Promise<IUnlockRemountResult> {
  const fullArgs = ['-s', deviceId, ...args]
  const result = await spawnAdb(fullArgs).catch((err) => commandErrorResult(err))
  return toUnlockResult(`adb ${fullArgs.join(' ')}`, result)
}

async function runFastbootStep(args: string[]): Promise<IUnlockRemountResult> {
  const result = await spawnFastboot(args).catch((err) =>
    commandErrorResult(err)
  )
  return toUnlockResult(`fastboot ${args.join(' ')}`, result)
}

function toUnlockResult(
  command: string,
  result: { stdout: string; stderr: string; code: number | null }
): IUnlockRemountResult {
  const output = [
    `$ ${command}`,
    result.stdout ? result.stdout.trimEnd() : '',
  ]
    .filter(Boolean)
    .join('\n')
  const error = result.stderr ? result.stderr.trimEnd() : ''
  const success = result.code === 0
  return {
    success,
    stdout: output ? `${output}\n` : '',
    stderr: error ? `${error}\n` : '',
    code: result.code,
    message: success
      ? 'OK'
      : result.stderr || result.stdout || `Command failed: ${command}`,
  }
}

function successResult(message: string): IUnlockRemountResult {
  return {
    success: true,
    stdout: `${message}\n`,
    stderr: '',
    code: 0,
    message,
  }
}

function commandErrorResult(err: unknown) {
  return {
    stdout: '',
    stderr: err instanceof Error ? err.message : String(err),
    code: 1,
  }
}

function parseFastbootDevices(stdout: string) {
  return stdout
    .split('\n')
    .map((line) => trim(line))
    .filter(Boolean)
    .map((line) => line.split(/\s+/)[0])
}

function getFastbootPath() {
  const adbPath = getAdbPath()
  const adbDir = path.dirname(adbPath)
  const fastbootName = isWindows ? 'fastboot.exe' : 'fastboot'
  const bundledFastboot = path.join(adbDir, fastbootName)
  if (fs.existsSync(bundledFastboot)) {
    return bundledFastboot
  }

  const resourceFastboot = isWindows
    ? resolveResources('adb/fastboot.exe')
    : resolveResources('adb/fastboot')
  if (fs.existsSync(resourceFastboot)) {
    return resourceFastboot
  }

  return 'fastboot'
}

function spawnFastboot(args: string[]) {
  return spawnCommand(getFastbootPath(), args)
}

function spawnCommand(
  bin: string,
  args: string[]
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const cp = childProcess.spawn(bin, args, {
      env: { ...process.env },
    })

    let stdout = ''
    let stderr = ''

    cp.stdout?.on('data', (data) => {
      stdout += data.toString()
    })

    cp.stderr?.on('data', (data) => {
      stderr += data.toString()
    })

    cp.on('error', (err) => {
      reject(err)
    })

    cp.on('close', (code) => {
      resolve({ stdout, stderr, code })
    })
  })
}

const connectWifi: IpcConnectWifi = async function (deviceId, ssid, password) {
  ssid = trim(ssid)
  if (!ssid) {
    throw new Error('WiFi name is empty')
  }
  if (!password) {
    throw new Error('WiFi password is empty')
  }

  const wasEnabled = await isWifiEnabled(deviceId)
  let enabled = false

  if (!wasEnabled) {
    await enableWifi(deviceId)
    await waitWifiEnabled(deviceId)
    enabled = true
  }

  const result = await spawnAdb([
    '-s',
    deviceId,
    'shell',
    'cmd',
    'wifi',
    'connect-network',
    ssid,
    'wpa2',
    password,
  ])
  if (result.code !== 0) {
    throw new Error(result.stderr || result.stdout || 'Failed to connect WiFi')
  }

  return {
    wasEnabled,
    enabled,
  }
}

async function enableWifi(deviceId: string) {
  const commands = [
    ['-s', deviceId, 'shell', 'svc', 'wifi', 'enable'],
    ['-s', deviceId, 'shell', 'cmd', 'wifi', 'set-wifi-enabled', 'enabled'],
  ]

  for (const command of commands) {
    const result = await spawnAdb(command)
    if (result.code === 0) {
      return
    }
  }

  throw new Error('Failed to enable WiFi')
}

async function waitWifiEnabled(deviceId: string) {
  for (let i = 0; i < 10; i++) {
    await sleep(1000)
    if (await isWifiEnabled(deviceId)) {
      return
    }
  }

  throw new Error('WiFi enable timed out')
}

async function isWifiEnabled(deviceId: string) {
  const status = await spawnAdb(['-s', deviceId, 'shell', 'cmd', 'wifi', 'status'])
  if (status.code === 0) {
    const output = `${status.stdout}\n${status.stderr}`.toLowerCase()
    if (
      contain(output, 'wifi is disabled') ||
      contain(output, 'wi-fi is disabled') ||
      contain(output, 'wifi disabled') ||
      contain(output, 'disabled')
    ) {
      return false
    }
    if (
      contain(output, 'wifi is enabled') ||
      contain(output, 'wi-fi is enabled') ||
      contain(output, 'wifi enabled')
    ) {
      return true
    }
  }

  const dumpsys = await spawnAdb(['-s', deviceId, 'shell', 'dumpsys', 'wifi'])
  if (dumpsys.code === 0) {
    const output = `${dumpsys.stdout}\n${dumpsys.stderr}`.toLowerCase()
    if (
      contain(output, 'wifi is disabled') ||
      contain(output, 'wi-fi is disabled') ||
      contain(output, 'wifi disabled') ||
      contain(output, 'disabled')
    ) {
      return false
    }
    if (
      contain(output, 'wifi is enabled') ||
      contain(output, 'wi-fi is enabled') ||
      contain(output, 'wifi enabled') ||
      contain(output, 'wifi enabled state: enabled')
    ) {
      return true
    }
  }

  const setting = await spawnAdb([
    '-s',
    deviceId,
    'shell',
    'settings',
    'get',
    'global',
    'wifi_on',
  ])
  return trim(setting.stdout) === '1'
}

const MTK_LOG_OUTPUT_DIR = 'D:\\桌面\\MTK_LOG'

const exportMtkLog: IpcExportMtkLog = async function (
  deviceId,
  sourcePath,
  outputDir
) {
  sourcePath = trim(sourcePath)
  if (!sourcePath) {
    throw new Error('MTK log source path is empty')
  }
  outputDir = trim(outputDir) || MTK_LOG_OUTPUT_DIR

  await fs.ensureDir(outputDir)
  const folderName = `${formatTime(new Date())}-debuglogger`
  const dest = path.join(outputDir, folderName)
  const result = await pullMtkLog(deviceId, sourcePath, folderName, outputDir)
  if (result.code === 0) {
    return dest
  }

  await spawnAdb(['-s', deviceId, 'root'])
  await sleep(2000)
  await spawnAdb(['-s', deviceId, 'wait-for-device'])

  const retry = await pullMtkLog(deviceId, sourcePath, folderName, outputDir)
  if (retry.code !== 0) {
    throw new Error(retry.stderr || retry.stdout || 'Export MTK log failed')
  }

  return dest
}

function pullMtkLog(
  deviceId: string,
  sourcePath: string,
  folderName: string,
  outputDir: string
) {
  return spawnAdbWithCwd(
    ['-s', deviceId, 'pull', sourcePath, folderName],
    outputDir
  )
}

function spawnAdbWithCwd(args: string[], cwd: string) {
  return new Promise<{ stdout: string; stderr: string; code: number | null }>(
    (resolve, reject) => {
      const cp = childProcess.spawn(getAdbPath(), args, {
        cwd,
        env: { ...process.env },
      })
      let stdout = ''
      let stderr = ''
      cp.stdout?.on('data', (data) => {
        stdout += data.toString()
      })
      cp.stderr?.on('data', (data) => {
        stderr += data.toString()
      })
      cp.on('error', (err) => {
        reject(err)
      })
      cp.on('close', (code) => {
        resolve({ stdout, stderr, code })
      })
    }
  )
}

function formatTime(date: Date) {
  const pad = (num: number) => num.toString().padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate()
  )}-${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(
    date.getSeconds()
  )}`
}

const inputKey: IpcInputKey = async function (deviceId, keyCode) {
  await base.shell(deviceId, `input keyevent ${keyCode}`)
}

async function openAdbCli() {
  let cwd = resolveResources('adb')
  const adbPath = settingsStore.get('adbPath')
  if (!isStrBlank(adbPath) && fs.existsSync(adbPath)) {
    cwd = path.dirname(adbPath)
  } else if (isWindows) {
    // Microsoft store app permission issue workaround
    const newCwd = getUserDataPath('adb')
    if (!(await fs.existsSync(newCwd))) {
      await fs.copy(cwd, newCwd)
    }
    cwd = newCwd
  }

  if (isMac) {
    const child = childProcess.spawn('open', ['-a', 'Terminal', cwd], {
      stdio: 'ignore',
    })
    child.unref()
  } else if (isWindows) {
    const child = childProcess.exec('start cmd', {
      cwd,
    })
    child.unref()
  } else {
    const child = childProcess.spawn('x-terminal-emulator', ['-w', cwd], {
      stdio: 'ignore',
    })
    child.unref()
  }
}

async function root(deviceId: string) {
  const id = await shell(deviceId, 'id')
  if (contain(id, 'uid=0')) {
    return
  }
  const device = await client.getDevice(deviceId)
  await device.root()
}

async function startWireless(deviceId: string) {
  const device = await client.getDevice(deviceId)
  const { ip } = await getIpAndMac(deviceId)
  const port = await device.tcpip(5555)
  await sleep(500)
  await connectDevice(ip, port)
}

async function restartAdbServer() {
  await client.kill()
  await client.version()
}

export async function init() {
  logger.info('init')

  app.on('will-quit', async () => {
    if (settingsStore.get('killAdbWhenExit')) {
      logger.info('kill adb')
      await client.kill()
    }
  })

  client = Adb.createClient({
    bin: getAdbPath(),
  })
  async function track() {
    logger.info('track devices')
    try {
      const tracker = await client.trackDevices()
      tracker.on('add', onDeviceChange)
      tracker.on('change', onDeviceChange)
      tracker.on('remove', onDeviceChange)
      tracker.on('error', () => {
        logger.error('tracker error')
      })
      tracker.on('end', async () => {
        logger.info('tracker end')
        await sleep(2000)
        track()
      })
    } catch (e) {
      logger.error('track error', e)
    }
  }
  function onDeviceChange() {
    logger.info('device change')
    setTimeout(() => window.sendAll('changeDevice'), 2000)
  }
  track()

  base.init(client)
  logcat.init(client)
  shellAdb.init(client)
  server.init(client)
  scrcpy.init(client)
  packageAdb.init(client)
  file.init(client)
  fps.init()
  webview.init()
  port.init(client)

  handleEvent('getDevices', getDevices)
  handleEvent('getOverview', getOverview)
  handleEvent('setFontScale', setFontScale)
  handleEvent('screencap', screencap)
  handleEvent('getMemory', getMemory)
  handleEvent('getPerformance', getPerformance)
  handleEvent('getUptime', getUptime)
  handleEvent('connectDevice', connectDevice)
  handleEvent('disconnectDevice', disconnectDevice)
  handleEvent('inputKey', inputKey)
  handleEvent('openAdbCli', openAdbCli)
  handleEvent('dumpWindowHierarchy', dumpWindowHierarchy)
  handleEvent('root', root)
  handleEvent('startWireless', startWireless)
  handleEvent('restartAdbServer', restartAdbServer)
  handleEvent('pairDevice', pairDevice)
  handleEvent('runAdbScript', runAdbScript)
  handleEvent('connectWifi', connectWifi)
  handleEvent('exportMtkLog', exportMtkLog)
  handleEvent('checkUnlockRemountEnv', checkUnlockRemountEnv)
  handleEvent('runUnlockRemountStep', runUnlockRemountStep)
}
