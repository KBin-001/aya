import Emitter from 'licia/Emitter'
import types from 'licia/types'
import isEmpty from 'licia/isEmpty'
import { Client } from '@devicefarmer/adbkit'
import { getAdbPath, getDeviceStore, getPidNames, setDeviceStore } from './base'
import uniqId from 'licia/uniqId'
import * as window from 'share/main/lib/window'
import { handleEvent } from 'share/main/lib/util'
import childProcess from 'node:child_process'
import {
  IpcCloseLogcat,
  IpcOpenLogcat,
  IpcPauseLogcat,
  IpcResumeLogcat,
} from 'common/types'

let client: Client

class Logcat extends Emitter {
  private reader: any
  private paused = false
  constructor(reader: any) {
    super()

    this.reader = reader
  }
  async init(deviceId: string) {
    const { reader } = this

    reader.on('entry', async (entry) => {
      if (this.paused) {
        return
      }
      if (entry.pid != 0) {
        let pidNames = getDeviceStore(deviceId, 'pidNames')
        if (!pidNames || !pidNames[entry.pid]) {
          pidNames = await getPidNames(deviceId)
          setDeviceStore(deviceId, 'pidNames', pidNames)
        }
        entry.package = pidNames[entry.pid] || `pid-${entry.pid}`
      }
      this.emit('entry', entry)
    })
  }
  close() {
    this.reader.end()
  }
  pause() {
    this.paused = true
  }
  resume() {
    this.paused = false
  }
}

class KernelLog extends Emitter {
  private cp?: childProcess.ChildProcessWithoutNullStreams
  private paused = false
  private commandIdx = 0
  private outputReceived = false
  private readonly commands = [
    ['shell', 'su', '0', 'cat', '/dev/kmsg'],
    ['shell', 'su', '-c', 'cat /dev/kmsg'],
    ['shell', 'dmesg', '-w'],
  ]
  constructor(private deviceId: string) {
    super()
  }
  init() {
    this.start()
  }
  close() {
    this.cp?.kill()
  }
  pause() {
    this.paused = true
  }
  resume() {
    this.paused = false
  }
  private start() {
    this.outputReceived = false
    const args = this.commands[this.commandIdx]
    this.cp = childProcess.spawn(getAdbPath(), ['-s', this.deviceId, ...args], {
      env: { ...process.env },
    })
    this.cp.stdout.on('data', (data) => this.onData(data))
    this.cp.stderr.on('data', (data) => this.onError(data))
    this.cp.on('close', () => {
      if (!this.outputReceived && this.commandIdx < this.commands.length - 1) {
        this.commandIdx++
        this.start()
      }
    })
  }
  private onError(data: Buffer) {
    if (this.commandIdx < this.commands.length - 1) {
      return
    }
    this.onData(data)
  }
  private onData(data: Buffer) {
    this.outputReceived = true
    if (this.paused) {
      return
    }
    const lines = data.toString().split(/\r?\n/)
    for (let i = 0, len = lines.length; i < len; i++) {
      const line = lines[i]
      if (!line) {
        continue
      }
      this.emit('entry', toKernelEntry(line))
    }
  }
}

/**
 * Kernel logs (and busy logcat tags) can emit thousands of lines per second.
 * Sending one IPC message per line saturates both the main process event loop
 * and the renderer, so entries are coalesced into small batches instead.
 */
const BATCH_INTERVAL = 50
const BATCH_SIZE = 200

class EntryBatcher {
  private buffer: any[] = []
  private timer: NodeJS.Timeout | null = null
  constructor(private send: (entries: any[]) => void) {}
  push(entry: any) {
    this.buffer.push(entry)
    if (this.buffer.length >= BATCH_SIZE) {
      this.flush()
    } else if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), BATCH_INTERVAL)
    }
  }
  flush() {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (isEmpty(this.buffer)) {
      return
    }
    const entries = this.buffer
    this.buffer = []
    this.send(entries)
  }
  dispose() {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.buffer = []
  }
}

interface ILogcatSession {
  logcat: Logcat | KernelLog
  batcher: EntryBatcher
}

const logcats: types.PlainObj<ILogcatSession> = {}

const openLogcat: IpcOpenLogcat = async function (deviceId, source = 'logcat') {
  let logcat: Logcat | KernelLog
  if (source === 'kernel') {
    logcat = new KernelLog(deviceId)
    logcat.init()
  } else {
    const device = await client.getDevice(deviceId)
    const reader = await device.openLogcat({
      clear: true,
    })
    logcat = new Logcat(reader)
    await logcat.init(deviceId)
  }
  const logcatId = uniqId('logcat')
  const batcher = new EntryBatcher((entries) => {
    window.sendTo('main', 'logcatEntries', logcatId, entries)
  })
  logcat.on('entry', (entry) => batcher.push(entry))
  logcats[logcatId] = { logcat, batcher }

  return logcatId
}

function toKernelEntry(line: string) {
  const match = line.match(/^(\d+),\d+,\d+,-;(.+)$/)
  const priority = match ? toLogcatPriority(parseInt(match[1], 10)) : 4
  return {
    date: new Date(),
    pid: 0,
    tid: 0,
    priority,
    tag: 'kernel',
    package: 'kernel',
    message: match ? match[2] : line,
  }
}

function toLogcatPriority(priority: number) {
  if (priority <= 3) {
    return 6
  }
  if (priority === 4) {
    return 5
  }
  if (priority === 5) {
    return 4
  }
  if (priority === 6) {
    return 3
  }
  return 2
}

const pauseLogcat: IpcPauseLogcat = async function (logcatId) {
  const session = logcats[logcatId]
  if (!session) {
    return
  }
  session.logcat.pause()
  // Flush whatever is already buffered so nothing is lost while paused.
  session.batcher.flush()
}

const resumeLogcat: IpcResumeLogcat = async function (logcatId) {
  const session = logcats[logcatId]
  if (session) {
    session.logcat.resume()
  }
}

const closeLogcat: IpcCloseLogcat = async function (logcatId) {
  const session = logcats[logcatId]
  if (!session) {
    return
  }
  session.logcat.close()
  session.batcher.dispose()
  delete logcats[logcatId]
}

export function init(c: Client) {
  client = c

  handleEvent('openLogcat', openLogcat)
  handleEvent('closeLogcat', closeLogcat)
  handleEvent('pauseLogcat', pauseLogcat)
  handleEvent('resumeLogcat', resumeLogcat)
}
