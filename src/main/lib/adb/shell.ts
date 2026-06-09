import types from 'licia/types'
import Emitter from 'licia/Emitter'
import uniqId from 'licia/uniqId'
import * as window from 'share/main/lib/window'
import { Client } from '@devicefarmer/adbkit'
import { handleEvent } from 'share/main/lib/util'
import {
  IpcCreateShell,
  IpcKillShell,
  IpcResizeShell,
  IpcWriteShell,
} from 'common/types'

let client: Client

class ShellProtocol {
  static STDIN = 0
  static STDOUT = 1
  static STDERR = 2
  static EXIT = 3
  static CLOSE_STDIN = 4
  static WINDOW_SIZE_CHANGE = 5

  static encodeData(id, data) {
    data = Buffer.from(data, 'utf8')
    const buf = Buffer.alloc(5 + data.length)
    buf.writeUInt8(id, 0)
    buf.writeUInt32LE(data.length, 1)
    data.copy(buf, 5)

    return buf
  }

  static decodeData(buf) {
    const result: Array<{
      id: number
      data: Buffer
    }> = []

    for (let i = 0, len = buf.length; i < len; ) {
      if (len - i < 5) {
        break
      }
      const id = buf.readUInt8(i)
      const dataLen = buf.readUInt32LE(i + 1)
      if (len - i - 5 < dataLen) {
        break
      }
      const data = buf.slice(i + 5, i + 5 + dataLen)
      result.push({
        id,
        data,
      })
      i += 5 + dataLen
    }

    return result
  }

  static getPacketLength(buf) {
    if (buf.length < 5) {
      return 0
    }
    return 5 + buf.readUInt32LE(1)
  }
}

class Protocol {
  static OKAY = 'OKAY'

  static encodeLength(length) {
    return length.toString(16).padStart(4, '0').toUpperCase()
  }

  static encodeData(data) {
    const len = Protocol.encodeLength(data.length)
    return Buffer.concat([Buffer.from(len), data])
  }
}

class AdbPty extends Emitter {
  private connection: any
  private useV2 = true
  private readBuffer = Buffer.alloc(0)
  private killed = false
  constructor(connection: any) {
    super()

    this.connection = connection
  }
  async init(useV2 = true) {
    const { connection } = this

    this.useV2 = useV2
    const protocol = useV2 ? 'shell,v2:' : 'shell:'
    connection.write(Protocol.encodeData(Buffer.from(protocol)))
    const result = await connection.parser.readAscii(4)
    if (result !== Protocol.OKAY) {
      throw new Error('Failed to create shell')
    }

    if (useV2) {
      const { socket } = connection
      socket.on('readable', () => {
        const buf = socket.read()
        if (buf) {
          this.readBuffer = Buffer.concat([this.readBuffer, buf])
          const packetEnd = this.getPacketEnd()
          if (packetEnd === 0) {
            return
          }

          const packets = ShellProtocol.decodeData(
            this.readBuffer.slice(0, packetEnd)
          )
          this.readBuffer = this.readBuffer.slice(packetEnd)
          for (let i = 0, len = packets.length; i < len; i++) {
            const { id, data } = packets[i]
            if (id === ShellProtocol.STDOUT || id === ShellProtocol.STDERR) {
              this.emit('data', data.toString('utf8'))
            } else if (id === ShellProtocol.EXIT) {
              this.kill()
            }
          }
        }
      })
    } else {
      const { socket } = connection
      socket.on('readable', () => {
        const buf = socket.read()
        if (buf) {
          this.emit('data', buf.toString('utf8'))
        }
      })
    }

    connection.socket.on('close', () => {
      this.killed = true
      this.emit('close')
    })
    connection.socket.on('error', () => {
      this.killed = true
      this.emit('close')
    })
  }
  private getPacketEnd() {
    let end = 0
    while (end < this.readBuffer.length) {
      const packetLen = ShellProtocol.getPacketLength(this.readBuffer.slice(end))
      if (!packetLen || this.readBuffer.length - end < packetLen) {
        break
      }
      end += packetLen
    }
    return end
  }
  resize(cols: number, rows: number) {
    if (this.killed) {
      return
    }
    if (this.useV2) {
      this.connection.socket.write(
        ShellProtocol.encodeData(
          ShellProtocol.WINDOW_SIZE_CHANGE,
          Buffer.from(`${rows}x${cols},0x0\0`)
        )
      )
    }
  }
  write(data: string) {
    if (this.killed) {
      return
    }
    if (this.useV2) {
      this.connection.socket.write(
        ShellProtocol.encodeData(ShellProtocol.STDIN, Buffer.from(data))
      )
    } else {
      this.connection.socket.write(Buffer.from(data))
    }
  }
  kill() {
    if (this.killed) {
      return
    }
    this.killed = true
    this.connection.end()
  }
}

const ptys: types.PlainObj<AdbPty> = {}

const createShell: IpcCreateShell = async function (deviceId) {
  const device = await client.getDevice(deviceId)

  const transport = await device.transport()
  let adbPty = new AdbPty(transport)
  try {
    await adbPty.init()
  } catch {
    adbPty.kill()
    const transport = await device.transport()
    adbPty = new AdbPty(transport)
    await adbPty.init(false)
  }
  const sessionId = uniqId('shell')
  adbPty.on('data', (data) => {
    window.sendTo('main', 'shellData', sessionId, data)
  })
  adbPty.on('close', () => {
    delete ptys[sessionId]
  })
  ptys[sessionId] = adbPty

  return sessionId
}

const writeShell: IpcWriteShell = async function (sessionId, data) {
  ptys[sessionId]?.write(data)
}

const resizeShell: IpcResizeShell = async function (sessionId, cols, rows) {
  ptys[sessionId]?.resize(cols, rows)
}

const killShell: IpcKillShell = async function (sessionId) {
  ptys[sessionId]?.kill()
  delete ptys[sessionId]
}

export function init(c: Client) {
  client = c

  handleEvent('createShell', createShell)
  handleEvent('writeShell', writeShell)
  handleEvent('resizeShell', resizeShell)
  handleEvent('killShell', killShell)
}
