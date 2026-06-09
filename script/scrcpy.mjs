import path from 'path'
import normalizePath from 'licia/normalizePath.js'
import fs from 'fs-extra'

const version = '3.1'
const url = `https://github.com/Genymobile/scrcpy/releases/download/v${version}/scrcpy-server-v${version}`

const scrcpyDir = normalizePath(path.resolve(__dirname, '../resources'))
const res = await fetch(url)
if (!res.ok) {
  throw new Error(`Failed to download scrcpy server: ${res.status} ${res.statusText}`)
}

await fs.ensureDir(scrcpyDir)
await fs.writeFile(
  path.resolve(scrcpyDir, 'scrcpy.jar'),
  Buffer.from(await res.arrayBuffer())
)
