import Toolbar from './components/toolbar/Toolbar'
import Logcat from './components/logcat/Logcat'
import Shell from './components/shell/Shell'
import Overview from './components/overview/Overview'
import Screenshot from './components/screenshot/Screenshot'
import Process from './components/process/Process'
import Performance from './components/performance/Performance'
import Webview from './components/webview/Webview'
import Application from './components/application/Application'
import File from './components/file/File'
import Layout from './components/layout/Layout'
import UnlockRemount from './components/unlockRemount/UnlockRemount'
import Style from './App.module.scss'
import { useState, useRef, PropsWithChildren, FC } from 'react'
import store from './store'
import { observer } from 'mobx-react-lite'
import { useCheckUpdate } from 'share/renderer/lib/hooks'

export default observer(function App() {
  useCheckUpdate('https://aya.liriliri.io')

  const deviceId = store.device ? store.device.id : ''
  // Panels are remounted when the active device changes so they reload their
  // per-device data. The shell panel is the exception: throwing it away when the
  // device merely drops off the bus would erase the terminal scrollback, so it
  // is keyed on the last device it was opened for instead.
  const shellDeviceRef = useRef('')
  if (deviceId && deviceId !== shellDeviceRef.current) {
    shellDeviceRef.current = deviceId
  }

  return (
    <>
      <Toolbar />
      {store.ready && (
        <div className={Style.workspace}>
          <div className={Style.panels}>
            <Panel panel="overview" key={`overview:${deviceId}`}>
              <Overview />
            </Panel>
            <Panel panel="application" key={`application:${deviceId}`}>
              <Application />
            </Panel>
            <Panel panel="screenshot" key={`screenshot:${deviceId}`}>
              <Screenshot />
            </Panel>
            <Panel panel="logcat" key={`logcat:${deviceId}`}>
              <Logcat />
            </Panel>
            <Panel panel="shell" key={`shell:${shellDeviceRef.current}`}>
              <Shell />
            </Panel>
            <Panel panel="process" key={`process:${deviceId}`}>
              <Process />
            </Panel>
            <Panel panel="performance" key={`performance:${deviceId}`}>
              <Performance />
            </Panel>
            <Panel panel="webview" key={`webview:${deviceId}`}>
              <Webview />
            </Panel>
            <Panel panel="file" key={`file:${deviceId}`}>
              <File />
            </Panel>
            <Panel panel="layout" key={`layout:${deviceId}`}>
              <Layout />
            </Panel>
          </div>
        </div>
      )}
      <UnlockRemount />
    </>
  )
})

interface IPanelProps {
  panel: string
}

const Panel: FC<PropsWithChildren<IPanelProps>> = observer(function Panel(
  props
) {
  const [used, setUsed] = useState(false)

  let visible = false

  if (store.panel === props.panel) {
    if (!used) {
      setUsed(true)
    }
    visible = true
  }

  const style: React.CSSProperties = {}
  if (!visible) {
    style.opacity = 0
    style.pointerEvents = 'none'
  }

  return (
    <div className={Style.panel} style={style}>
      {used ? props.children : null}
    </div>
  )
})
