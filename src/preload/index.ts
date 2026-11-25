import { clipboard, contextBridge } from 'electron'
import mainObj from './main'
import nodeObj from 'share/preload/node'
import preloadObj from 'share/preload/preload'

const preloadApi = {
  ...preloadObj,
  writeClipboardText(text: string) {
    clipboard.writeText(text)
    return clipboard.readText() === text
  },
}

contextBridge.exposeInMainWorld('preload', preloadApi)
contextBridge.exposeInMainWorld('main', mainObj)
contextBridge.exposeInMainWorld('node', nodeObj)

declare global {
  const main: typeof mainObj
  const preload: typeof preloadApi
  const node: typeof nodeObj
}
