import { observer } from 'mobx-react-lite'
import LunaToolbar, { LunaToolbarSpace } from 'luna-toolbar/react'
import Term from './Term'
import LunaTab, { LunaTabItem } from 'luna-tab/react'
import { t } from 'common/util'
import ToolbarIcon from 'share/renderer/components/ToolbarIcon'
import store from '../../store'
import Style from './Shell.module.scss'
import className from 'licia/className'
import { CSSProperties, useEffect, useRef, useState } from 'react'
import uuid from 'licia/uuid'
import map from 'licia/map'
import filter from 'licia/filter'
import LunaCommandPalette from 'luna-command-palette/react'
import find from 'licia/find'
import idxOf from 'licia/idxOf'
import truncate from 'licia/truncate'
import { Terminal } from '@xterm/xterm'
import { notify } from 'share/renderer/lib/util'
import copy from 'licia/copy'
import LunaModal from 'luna-modal'
import contextMenu from 'share/renderer/lib/contextMenu'
import { IUnlockRemountResult, IUnlockRemountStep } from 'common/types'

const HISTORY_LIMIT = 50
const HISTORY_STORAGE_KEY = 'aya.shell.history'
const DEFAULT_MTK_LOG_SOURCE = '/sdcard/debuglogger'
const MTK_LOG_SOURCE_STORAGE_KEY = 'aya.shell.mtkLogSource'
const MTK_LOG_SOURCE2_STORAGE_KEY = 'aya.shell.mtkLogSource2'
const MTK_LOG_ACTIVE_STORAGE_KEY = 'aya.shell.mtkLogActive'
const WIFI_STORAGE_KEY = 'aya.shell.wifi'

interface IShell {
  id: string
  name: string
  sessionId: string
  terminal?: Terminal
  setInput?: (value: string) => void
}

export default observer(function Shell() {
  const [shells, setShells] = useState<Array<IShell>>([])
  const [commandPaletteVisible, setCommandPaletteVisible] = useState(false)
  const [selectedShell, setSelectedShell] = useState<IShell>({
    id: '',
    name: '',
    sessionId: '',
  })
  const [history, setHistory] = useState<string[]>(loadHistory)
  const [mtkLogSource, setMtkLogSource] = useState(loadMtkLogSource)
  const [mtkLogSource2, setMtkLogSource2] = useState(loadMtkLogSource2)
  const [mtkLogActive, setMtkLogActive] = useState(loadMtkLogActive)
  const [wifi, setWifi] = useState<IWifiConfig>(loadWifi)
  const [runningScript, setRunningScript] = useState('')
  const [unlockRemountVisible, setUnlockRemountVisible] = useState(false)
  const [unlockRunningStep, setUnlockRunningStep] =
    useState<IUnlockRemountStep | null>(null)
  const [unlockConfirmed, setUnlockConfirmed] = useState(false)
  const [unlockLogs, setUnlockLogs] = useState<string[]>([])
  const [unlockAutoRunning, setUnlockAutoRunning] = useState(false)
  const [unlockPausedMessage, setUnlockPausedMessage] = useState('')
  const [unlockResumeIndex, setUnlockResumeIndex] = useState(0)
  const [unlockCurrentStep, setUnlockCurrentStep] = useState('')
  const [unlockStepStatus, setUnlockStepStatus] = useState<
    Record<string, IUnlockFlowStatus>
  >({})
  const numRef = useRef(1)
  const { device } = store

  useEffect(() => add(), [])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (unlockRemountVisible && unlockPausedMessage && e.key === 'Enter') {
        e.preventDefault()
        continueUnlockAuto()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [unlockRemountVisible, unlockPausedMessage, unlockResumeIndex, device])

  function add() {
    const id = uuid()
    const shell = {
      id,
      name: `${t('shell')} ${numRef.current++}`,
      sessionId: '',
    }
    setShells([...shells, shell])
    setSelectedShell(shell)
  }

  function close(id: string) {
    const closedShell = find(shells, (shell) => shell.id === id)
    let closedIdx = idxOf(shells, closedShell)
    const newShells = filter(shells, (shell) => shell.id !== id)
    setShells(newShells)

    if (closedShell === selectedShell) {
      if (closedIdx >= newShells.length) {
        closedIdx = newShells.length - 1
      }
      setSelectedShell(newShells[closedIdx])
    }
  }

  const tabItems = map(shells, (shell) => {
    return (
      <LunaTabItem
        key={shell.id}
        id={shell.id}
        title={shell.name}
        closable={true}
        selected={selectedShell.id === shell.id}
      />
    )
  })

  const terms = map(shells, (shell) => {
    return (
      <Term
        key={shell.id}
        history={history}
        onSessionIdChange={(id) => {
          shell.sessionId = id
        }}
        onCreate={(terminal) => {
          shell.terminal = terminal
        }}
        onCreateInputSetter={(setter) => {
          shell.setInput = setter
        }}
        onCommand={addHistory}
        visible={selectedShell.id === shell.id && store.panel === 'shell'}
      />
    )
  })

  function addHistory(command: string) {
    setHistory((history) => {
      const next = [command, ...filter(history, (item) => item !== command)]
      const savedHistory = next.slice(0, HISTORY_LIMIT)
      saveHistory(savedHistory)
      return savedHistory
    })
  }

  function clearHistory() {
    setHistory([])
    localStorage.removeItem(HISTORY_STORAGE_KEY)
  }

  const commands = map(getCommands(), ([title, command]) => {
    return {
      title: `${title} (${truncate(command, 95 - title.length)})`,
      handler: () => {
        main.writeShell(selectedShell.sessionId, command)
        setTimeout(() => {
          if (selectedShell.terminal) {
            selectedShell.terminal.focus()
          }
        }, 500)
      },
    }
  })

  async function runScript(script: IShellScript) {
    if (!device || runningScript) {
      return
    }
    setRunningScript(script.id)
    try {
      if (script.action === 'exportMtkLog') {
        const source = mtkLogActive === '1' ? mtkLogSource : mtkLogSource2
        const dest = await main.exportMtkLog(device.id, source)
        notify(`${script.title} completed: ${dest}`, { icon: 'success' })
      } else if (script.action === 'unlockRemount') {
        setUnlockRemountVisible(true)
      } else if (script.action === 'connectWifi') {
        const config = wifi.ssid ? wifi : await promptWifiConfig()
        if (!config?.ssid) {
          return
        }
        notify(`检测WiFi状态: ${config.ssid}`, { icon: 'info' })
        const result = await main.connectWifi(
          device.id,
          config.ssid,
          config.password
        )
        notify(
          result.wasEnabled
            ? `检测到WiFi已开启，连接完成: ${config.ssid}`
            : `检测到WiFi已关闭，已开启并连接: ${config.ssid}`,
          {
            icon: 'success',
          }
        )
      } else {
        await main.runAdbScript(device.id, script.commands!)
        notify(`${script.title} completed`, { icon: 'success' })
      }
      selectedShell.terminal?.focus()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      notify(`${script.title} failed: ${message}`, { icon: 'error' })
    } finally {
      setRunningScript('')
    }
  }

  const scriptButtons = map(getShellScripts(), (script) => {
    const running = runningScript === script.id
    const isExportMtkLog = script.action === 'exportMtkLog'
    const isConnectWifi = script.action === 'connectWifi'
    let title = script.description
    if (isExportMtkLog) {
      title = `${script.description}\n路径1：${mtkLogSource}\n路径2：${mtkLogSource2}\n当前使用：路径${mtkLogActive}\n右键切换 / 修改路径`
    } else if (isConnectWifi) {
      title = `${script.description}\n当前WiFi：${wifi.ssid || '未配置'}\n右键修改名称和密码`
    }
    return (
      <button
        key={script.id}
        className={Style.scriptButton}
        style={{ '--tag-color': script.color } as CSSProperties}
        title={title}
        disabled={!device || !!runningScript}
        onClick={() => runScript(script)}
        onContextMenu={(e) => {
          if (isExportMtkLog) {
            showMtkLogMenu(e)
          } else if (isConnectWifi) {
            showWifiMenu(e)
          }
        }}
      >
        {running ? 'Running...' : script.title}
      </button>
    )
  })

  const unlockStepButtons = map(getUnlockRemountSteps(), (step) => {
    const running = unlockRunningStep === step.id
    const disabled =
      !device ||
      unlockAutoRunning ||
      !!unlockRunningStep ||
      ((step.id === 'flashingUnlock' || step.id === 'oemUnlock') &&
        !unlockConfirmed)
    return (
      <button
        key={step.id}
        className={Style.unlockStepButton}
        disabled={disabled}
        title={step.description}
        onClick={() => runUnlockRemountStep(step.id)}
      >
        {running ? '\u6267\u884c\u4e2d...' : step.title}
      </button>
    )
  })

  async function runUnlockRemountCheck() {
    if (!device || unlockRunningStep) {
      return
    }
    setUnlockRunningStep('checkAdb')
    appendUnlockLog('\n[CHECK] \u68c0\u67e5 ADB / Fastboot \u73af\u5883')
    try {
      const env = await main.checkUnlockRemountEnv(device.id)
      appendUnlockLog(
        [
          `adb: ${env.adbPath}`,
          `adb state: ${env.adbReady ? env.adbState || 'ready' : 'failed'}`,
          `fastboot: ${env.fastbootPath}`,
          `fastboot: ${env.fastbootReady ? 'ready' : 'failed'}`,
          `sys.oem_unlock_allowed: ${env.oemUnlockAllowed || '-'}`,
          `fastboot devices: ${
            env.fastbootDevices.length ? env.fastbootDevices.join(', ') : '-'
          }`,
        ].join('\n')
      )
    } catch (err) {
      appendUnlockLog(formatUnlockError(err))
    } finally {
      setUnlockRunningStep(null)
    }
  }

  async function startUnlockAuto() {
    if (!device || unlockAutoRunning || unlockRunningStep) {
      return
    }
    setUnlockLogs([])
    setUnlockStepStatus({})
    setUnlockPausedMessage('')
    setUnlockResumeIndex(0)
    await runUnlockAuto(0)
  }

  function continueUnlockAuto() {
    if (!device || unlockAutoRunning || !unlockPausedMessage) {
      return
    }
    const index = unlockResumeIndex
    setUnlockPausedMessage('')
    setTimeout(() => runUnlockAuto(index), 0)
  }

  async function runUnlockAuto(startIndex: number) {
    if (!device) {
      return
    }

    const flow = getUnlockAutoFlow()
    setUnlockAutoRunning(true)
    try {
      for (let i = startIndex; i < flow.length; i++) {
        const item = flow[i]
        setUnlockCurrentStep(item.title)

        if (item.kind === 'pause') {
          setUnlockStepStatus((status) => ({
            ...status,
            [item.id]: 'paused',
          }))
          setUnlockPausedMessage(item.message || '')
          setUnlockResumeIndex(i + 1)
          appendUnlockLog(`\n[PAUSE] ${item.title}\n${item.message || ''}`)
          return
        }

        setUnlockStepStatus((status) => ({
          ...status,
          [item.id]: 'running',
        }))
        appendUnlockLog(`\n[AUTO] ${item.title}`)

        let result: IUnlockRemountResult
        if (item.kind === 'check') {
          result = await checkUnlockAutoEnv(item.id)
        } else if (item.kind === 'unlock') {
          if (!unlockConfirmed) {
            setUnlockStepStatus((status) => ({
              ...status,
              [item.id]: 'paused',
            }))
            setUnlockPausedMessage(
              '\u8bf7\u5148\u52fe\u9009\u98ce\u9669\u786e\u8ba4\uff0c\u7136\u540e\u6309 Enter \u6216\u70b9\u51fb\u7ee7\u7eed\u3002'
            )
            setUnlockResumeIndex(i)
            return
          }
          result = await runUnlockCommandWithFallback()
        } else if (item.kind === 'remount') {
          result = await runRemountWithFallback()
        } else {
          result = await main.runUnlockRemountStep(device.id, item.step!)
        }

        appendUnlockResult(result)
        setUnlockStepStatus((status) => ({
          ...status,
          [item.id]: result.success ? 'success' : 'failed',
        }))
        if (!result.success) {
          notify(`${item.title} failed`, { icon: 'error' })
          return
        }
      }

      setUnlockCurrentStep('\u5168\u90e8\u5b8c\u6210')
      appendUnlockLog('\n[DONE] \u89e3\u9501 Remount \u6d41\u7a0b\u5df2\u5b8c\u6210')
      notify('\u89e3\u9501Remount\u6d41\u7a0b\u5b8c\u6210', {
        icon: 'success',
      })
    } catch (err) {
      appendUnlockLog(formatUnlockError(err))
      notify('\u81ea\u52a8\u6d41\u7a0b\u5931\u8d25', { icon: 'error' })
    } finally {
      setUnlockAutoRunning(false)
      setUnlockRunningStep(null)
    }
  }

  async function checkUnlockAutoEnv(id: string): Promise<IUnlockRemountResult> {
    if (!device) {
      return failedUnlockResult('No device')
    }
    const env = await main.checkUnlockRemountEnv(device.id)
    appendUnlockLog(
      [
        `adb: ${env.adbPath}`,
        `adb state: ${env.adbReady ? env.adbState || 'ready' : 'failed'}`,
        `fastboot: ${env.fastbootPath}`,
        `fastboot: ${env.fastbootReady ? 'ready' : 'failed'}`,
        `sys.oem_unlock_allowed: ${env.oemUnlockAllowed || '-'}`,
        `fastboot devices: ${
          env.fastbootDevices.length ? env.fastbootDevices.join(', ') : '-'
        }`,
      ].join('\n')
    )

    if (!env.adbReady) {
      return failedUnlockResult('ADB device is not ready')
    }
    if (!env.fastbootReady) {
      return failedUnlockResult('Fastboot is not available')
    }

    setUnlockStepStatus((status) => ({
      ...status,
      [id]: 'success',
    }))
    return {
      success: true,
      stdout: '',
      stderr: '',
      code: 0,
      message: 'OK',
    }
  }

  async function runUnlockCommandWithFallback() {
    if (!device) {
      return failedUnlockResult('No device')
    }
    const flashing = await main.runUnlockRemountStep(
      device.id,
      'flashingUnlock'
    )
    if (flashing.success) {
      return flashing
    }

    const fallbackMessage =
      '\n[FALLBACK] fastboot flashing unlock \u5931\u8d25\uff0c\u5c1d\u8bd5 fastboot oem unlock\n'
    const oem = await main.runUnlockRemountStep(device.id, 'oemUnlock')
    return {
      ...oem,
      stdout: `${flashing.stdout}${fallbackMessage}${oem.stdout}`,
      stderr: `${flashing.stderr}${oem.stderr}`,
    }
  }

  async function runRemountWithFallback() {
    if (!device) {
      return failedUnlockResult('No device')
    }
    const remount = await main.runUnlockRemountStep(device.id, 'remount')
    if (remount.success) {
      return remount
    }

    const fallbackMessage =
      '\n[FALLBACK] adb remount \u5931\u8d25\uff0c\u5c1d\u8bd5 disable-verity + reboot + remount\n'
    const disableVerity = await main.runUnlockRemountStep(
      device.id,
      'disableVerityRemount'
    )
    return {
      ...disableVerity,
      stdout: `${remount.stdout}${fallbackMessage}${disableVerity.stdout}`,
      stderr: `${remount.stderr}${disableVerity.stderr}`,
    }
  }

  function failedUnlockResult(message: string): IUnlockRemountResult {
    return {
      success: false,
      stdout: '',
      stderr: message,
      code: 1,
      message,
    }
  }

  async function runUnlockRemountStep(step: IUnlockRemountStep) {
    if (!device || unlockRunningStep) {
      return
    }
    const meta = find(getUnlockRemountSteps(), (item) => item.id === step)
    setUnlockRunningStep(step)
    appendUnlockLog(`\n[STEP] ${meta?.title || step}`)
    try {
      const result = await main.runUnlockRemountStep(device.id, step)
      appendUnlockResult(result)
      notify(result.success ? '\u6267\u884c\u5b8c\u6210' : '\u6267\u884c\u5931\u8d25', {
        icon: result.success ? 'success' : 'error',
      })
    } catch (err) {
      appendUnlockLog(formatUnlockError(err))
      notify('\u6267\u884c\u5931\u8d25', { icon: 'error' })
    } finally {
      setUnlockRunningStep(null)
    }
  }

  function appendUnlockResult(result: IUnlockRemountResult) {
    appendUnlockLog(
      [
        result.stdout.trimEnd(),
        result.stderr.trimEnd(),
        `status: ${result.success ? 'success' : 'failed'}${
          result.code === null ? '' : `, code=${result.code}`
        }`,
      ]
        .filter(Boolean)
        .join('\n')
    )
  }

  function appendUnlockLog(log: string) {
    setUnlockLogs((logs) => [...logs, log])
  }

  function formatUnlockError(err: unknown) {
    return err instanceof Error ? err.message : String(err)
  }

  function closeUnlockRemount() {
    if (!unlockRunningStep && !unlockAutoRunning) {
      setUnlockRemountVisible(false)
    }
  }

  function updateMtkLogSource(source: string) {
    setMtkLogSource(source)
    localStorage.setItem(MTK_LOG_SOURCE_STORAGE_KEY, source)
  }

  function updateMtkLogSource2(source: string) {
    setMtkLogSource2(source)
    localStorage.setItem(MTK_LOG_SOURCE2_STORAGE_KEY, source)
  }

  function switchMtkLogPath(active: '1' | '2') {
    if (active === mtkLogActive) {
      return
    }
    setMtkLogActive(active)
    localStorage.setItem(MTK_LOG_ACTIVE_STORAGE_KEY, active)
    notify(`已切换为路径${active}`, { icon: 'info' })
  }

  function showMtkLogMenu(e: React.MouseEvent) {
    e.preventDefault()
    const pathLabel = (index: '1' | '2', source: string) =>
      `${mtkLogActive === index ? '✓' : '○'} 路径${index}${
        mtkLogActive === index ? '（当前使用）' : ''
      }: ${source}`
    contextMenu(e, [
      {
        label: pathLabel('1', mtkLogSource),
        click() {
          switchMtkLogPath('1')
        },
      },
      {
        label: pathLabel('2', mtkLogSource2),
        click() {
          switchMtkLogPath('2')
        },
      },
      {
        type: 'separator',
      },
      {
        label: '修改路径1',
        async click() {
          const source = await LunaModal.prompt('MTKLog路径1', mtkLogSource)
          if (source) {
            updateMtkLogSource(source)
          }
        },
      },
      {
        label: '修改路径2',
        async click() {
          const source = await LunaModal.prompt('MTKLog路径2', mtkLogSource2)
          if (source) {
            updateMtkLogSource2(source)
          }
        },
      },
      {
        type: 'separator',
      },
      {
        label: '恢复默认路径',
        click() {
          if (mtkLogActive === '1') {
            updateMtkLogSource(DEFAULT_MTK_LOG_SOURCE)
          } else {
            updateMtkLogSource2(DEFAULT_MTK_LOG_SOURCE)
          }
        },
      },
    ])
  }

  async function promptWifiConfig() {
    const ssid = await LunaModal.prompt('WiFi名称', wifi.ssid)
    if (!ssid) {
      return
    }

    const password = await LunaModal.prompt('WiFi密码', wifi.password)
    if (!password) {
      return
    }

    const config = {
      ssid: ssid.trim(),
      password,
    }
    saveWifi(config)
    return config
  }

  function saveWifi(config: IWifiConfig) {
    setWifi(config)
    localStorage.setItem(WIFI_STORAGE_KEY, JSON.stringify(config))
  }

  function clearWifi() {
    const config = {
      ssid: '',
      password: '',
    }
    setWifi(config)
    localStorage.removeItem(WIFI_STORAGE_KEY)
  }

  function showWifiMenu(e: React.MouseEvent) {
    e.preventDefault()
    contextMenu(e, [
      {
        label: `当前WiFi: ${wifi.ssid || '未配置'}`,
      },
      {
        type: 'separator',
      },
      {
        label: '修改WiFi名称和密码',
        click: promptWifiConfig,
      },
      {
        label: '清除已保存WiFi',
        click: clearWifi,
      },
    ])
  }

  const historyItems = map(history, (command) => {
    return (
      <div className={Style.historyItem} key={command}>
        <button
          className={Style.historyCommand}
          title={command}
          onClick={() => selectedShell.setInput?.(command)}
        >
          {command}
        </button>
        <button
          className={Style.historyCopy}
          onClick={() => {
            copy(command)
            notify('Copied', { icon: 'success' })
          }}
        >
          复制
        </button>
      </div>
    )
  })

  const unlockProgressItems = map(getUnlockAutoFlow(), (item, idx) => {
    const status = unlockStepStatus[item.id] || 'pending'
    return (
      <div
        key={item.id}
        className={className(Style.unlockProgressItem, Style[status])}
      >
        <div className={Style.unlockProgressIndex}>{idx + 1}</div>
        <div className={Style.unlockProgressText}>
          <div className={Style.unlockProgressTitle}>{item.title}</div>
          <div className={Style.unlockProgressDesc}>{item.description}</div>
        </div>
      </div>
    )
  })

  return (
    <div className="panel-with-toolbar">
      <div className={className('panel-toolbar', Style.toolbar)}>
        <LunaTab
          className={Style.tabs}
          height={31}
          onSelect={(id) => {
            const shell = find(shells, (shell) => shell.id === id)
            if (shell) {
              setSelectedShell(shell)
            }
          }}
          onClose={close}
        >
          {tabItems}
        </LunaTab>
        <LunaToolbar className={Style.control}>
          <ToolbarIcon
            icon="add"
            title={t('add')}
            onClick={add}
            disabled={!device}
          />
          <LunaToolbarSpace />
          <ToolbarIcon
            icon="list"
            title={t('shortcut')}
            onClick={() => setCommandPaletteVisible(true)}
            disabled={!device}
          />
        </LunaToolbar>
      </div>
      <div className={className('panel-body', Style.body)}>
        <div className={Style.workspace}>
          <div className={Style.termContainer}>{terms}</div>
          <div className={Style.historyPanel}>
            <div className={Style.historyHeader}>
              <span>历史记录</span>
              <div className={Style.historyActions}>
                <span>{history.length}/{HISTORY_LIMIT}</span>
                <button
                  className={Style.historyClear}
                  disabled={!history.length}
                  onClick={clearHistory}
                >
                  清空
                </button>
              </div>
            </div>
            <div className={Style.historyList}>{historyItems}</div>
          </div>
        </div>
        <div className={Style.scriptBar}>{scriptButtons}</div>
        {unlockRemountVisible && (
          <div className={Style.unlockOverlay}>
            <div className={Style.unlockDialog}>
              <div className={Style.unlockHeader}>
                <div>
                  <div className={Style.unlockTitle}>
                    {'\u89e3\u9501Bootloader + Remount'}
                  </div>
                  <div className={Style.unlockSubtitle}>
                    {
                      '\u8fd9\u4e2a\u6d41\u7a0b\u4f1a\u5207\u6362 ADB/Fastboot\uff0c\u89e3\u9501\u6b65\u9aa4\u53ef\u80fd\u6e05\u7a7a\u8bbe\u5907\u6570\u636e\u3002'
                    }
                  </div>
                </div>
                <button
                  className={Style.unlockClose}
                  disabled={!!unlockRunningStep}
                  onClick={closeUnlockRemount}
                >
                  x
                </button>
              </div>
              <div className={Style.unlockCommandBar}>
                <button
                  className={Style.unlockPrimaryButton}
                  disabled={!device || unlockAutoRunning || !!unlockRunningStep}
                  onClick={startUnlockAuto}
                >
                  {unlockAutoRunning
                    ? '\u81ea\u52a8\u6267\u884c\u4e2d...'
                    : '\u5f00\u59cb\u81ea\u52a8\u6267\u884c'}
                </button>
                <button
                  className={Style.unlockContinueButton}
                  disabled={!unlockPausedMessage || unlockAutoRunning}
                  onClick={continueUnlockAuto}
                >
                  {'\u7ee7\u7eed / Enter'}
                </button>
                <label className={Style.unlockConfirm}>
                  <input
                    type="checkbox"
                    checked={unlockConfirmed}
                    onChange={(e) => setUnlockConfirmed(e.target.checked)}
                  />
                  {
                    '\u5141\u8bb8\u6267\u884c\u89e3\u9501\u547d\u4ee4\uff08\u53ef\u80fd\u6e05\u7a7a\u6570\u636e\uff09'
                  }
                </label>
              </div>
              {unlockPausedMessage && (
                <div className={Style.unlockPause}>
                  <div className={Style.unlockPauseTitle}>
                    {'\u7b49\u5f85\u4eba\u5de5\u786e\u8ba4'}
                  </div>
                  <div>{unlockPausedMessage}</div>
                </div>
              )}
              <div className={Style.unlockMain}>
                <div className={Style.unlockProgress}>
                  <div className={Style.unlockPanelTitle}>
                    {'\u6267\u884c\u6d41\u7a0b'}
                  </div>
                  <div className={Style.unlockProgressList}>
                    {unlockProgressItems}
                  </div>
                </div>
                <div className={Style.unlockLogPanel}>
                  <div className={Style.unlockPanelTitle}>
                    {unlockCurrentStep || '\u7b49\u5f85\u5f00\u59cb'}
                  </div>
                  <pre className={Style.unlockLog}>
                    {unlockLogs.join('\n') ||
                      '\u70b9\u51fb\u201c\u5f00\u59cb\u81ea\u52a8\u6267\u884c\u201d\u540e\uff0c\u6d41\u7a0b\u4f1a\u81ea\u52a8\u8dd1\u5230\u9700\u8981\u4f60\u786e\u8ba4\u7684\u8282\u70b9\u3002'}
                  </pre>
                </div>
              </div>
              <div className={Style.unlockManual}>
                <span>{'\u5355\u6b65\u91cd\u8bd5'}</span>
                <button
                  className={Style.unlockCheckButton}
                  disabled={!device || !!unlockRunningStep || unlockAutoRunning}
                  onClick={runUnlockRemountCheck}
                >
                  {'\u68c0\u67e5\u73af\u5883'}
                </button>
                {unlockStepButtons}
              </div>
              <div className={Style.unlockFooter}>
                <button
                  className={Style.unlockSecondaryButton}
                  disabled={
                    (!!unlockRunningStep || !unlockLogs.length) &&
                    !unlockPausedMessage
                  }
                  onClick={() => {
                    setUnlockLogs([])
                    setUnlockStepStatus({})
                    setUnlockPausedMessage('')
                    setUnlockCurrentStep('')
                  }}
                >
                  {'\u91cd\u7f6e\u7a97\u53e3'}
                </button>
                <button
                  className={Style.unlockSecondaryButton}
                  disabled={!!unlockRunningStep || unlockAutoRunning}
                  onClick={closeUnlockRemount}
                >
                  {'\u5173\u95ed'}
                </button>
              </div>
            </div>
          </div>
        )}
        <LunaCommandPalette
          placeholder={t('typeCmd')}
          visible={commandPaletteVisible}
          onClose={() => setCommandPaletteVisible(false)}
          commands={commands}
        />
      </div>
    </div>
  )
})

interface IShellScript {
  id: string
  title: string
  description: string
  color: string
  commands?: string[][]
  action?: 'exportMtkLog' | 'connectWifi' | 'unlockRemount'
}

interface IWifiConfig {
  ssid: string
  password: string
}

type IUnlockFlowStatus =
  | 'pending'
  | 'running'
  | 'success'
  | 'failed'
  | 'paused'

interface IUnlockAutoFlowItem {
  id: string
  title: string
  description: string
  kind: 'check' | 'step' | 'pause' | 'unlock' | 'remount'
  step?: IUnlockRemountStep
  message?: string
}

function getShellScripts(): IShellScript[] {
  return [
    {
      id: 'setSimplifiedChinese',
      title: '\u8bbe\u7f6e\u7b80\u4f53\u4e2d\u6587',
      color: '#32d583',
      description:
        'adb root; adb shell settings put system system_locales zh-CN; ' +
        'adb shell setprop persist.sys.locale zh-CN; ' +
        'adb shell stop; adb shell start',
      commands: [
        ['root'],
        ['shell', 'settings', 'put', 'system', 'system_locales', 'zh-CN'],
        ['shell', 'setprop', 'persist.sys.locale', 'zh-CN'],
        ['shell', 'stop'],
        ['shell', 'start'],
      ],
    },
    {
      id: 'enablePointer',
      title: '\u6253\u5f00\u6307\u9488',
      color: '#f97066',
      description:
        'adb shell settings put system pointer_location 1; ' +
        'adb shell settings put system show_touches 1',
      commands: [
        ['shell', 'settings', 'put', 'system', 'pointer_location', '1'],
        ['shell', 'settings', 'put', 'system', 'show_touches', '1'],
      ],
    },
    {
      id: 'reboot',
      title: '\u91cd\u542f',
      color: '#fdb022',
      description: 'adb reboot',
      commands: [['reboot']],
    },
    {
      id: 'connectWifi',
      title: '\u8fde\u63a5WiFi',
      color: '#b692f6',
      description: 'adb shell cmd wifi connect-network <ssid> wpa2 <password>',
      action: 'connectWifi',
    },
    {
      id: 'exportMtkLog',
      title: '\u5bfc\u51faMTKLog',
      color: '#53b1fd',
      description: 'adb pull <MTKLog路径> D:\\桌面\\MTK_LOG',
      action: 'exportMtkLog',
    },
  ]
}

function getUnlockAutoFlow(): IUnlockAutoFlowItem[] {
  return [
    {
      id: 'env',
      title: '\u68c0\u67e5\u73af\u5883',
      description: 'ADB / Fastboot / OEM unlock',
      kind: 'check',
    },
    {
      id: 'enableOemUnlock',
      title: '\u542f\u7528OEM\u89e3\u9501',
      description: 'adb root + svc oem_unlock enable',
      kind: 'step',
      step: 'enableOemUnlock',
    },
    {
      id: 'rebootBootloader',
      title: '\u8fdb\u5165Bootloader',
      description: 'adb reboot bootloader',
      kind: 'step',
      step: 'rebootBootloader',
    },
    {
      id: 'confirmUnlock',
      title: '\u786e\u8ba4\u89e3\u9501',
      description: '\u8bbe\u5907\u7aef\u51c6\u5907\u786e\u8ba4',
      kind: 'pause',
      message:
        '\u8bf7\u786e\u8ba4\u8bbe\u5907\u5df2\u5728 Bootloader \u754c\u9762\uff0c\u52fe\u9009\u89e3\u9501\u98ce\u9669\u786e\u8ba4\u540e\uff0c\u6309 Enter \u6216\u70b9\u51fb\u7ee7\u7eed\u3002\u6267\u884c\u89e3\u9501\u547d\u4ee4\u540e\uff0c\u8bbe\u5907\u7aef\u53ef\u80fd\u8fd8\u9700\u8981\u7528\u97f3\u91cf\u952e/\u7535\u6e90\u952e\u786e\u8ba4\u3002',
    },
    {
      id: 'unlock',
      title: '\u6267\u884c\u89e3\u9501',
      description: 'fastboot flashing unlock / oem unlock',
      kind: 'unlock',
    },
    {
      id: 'fastbootReboot',
      title: '\u91cd\u542f\u56de\u7cfb\u7edf',
      description: 'fastboot reboot',
      kind: 'step',
      step: 'fastbootReboot',
    },
    {
      id: 'confirmAndroid',
      title: '\u7b49\u5f85\u56de\u5230\u7cfb\u7edf',
      description: '\u5f00\u542fUSB\u8c03\u8bd5\u5e76\u6388\u6743',
      kind: 'pause',
      message:
        '\u8bf7\u7b49\u8bbe\u5907\u56de\u5230 Android\uff0c\u5b8c\u6210\u5f00\u673a\u8bbe\u7f6e\uff0c\u91cd\u65b0\u5f00\u542f USB \u8c03\u8bd5\u5e76\u70b9\u51fb\u6388\u6743\uff0c\u7136\u540e\u6309 Enter \u6216\u70b9\u51fb\u7ee7\u7eed\u3002',
    },
    {
      id: 'waitForAndroid',
      title: '\u7b49\u5f85ADB',
      description: 'adb wait-for-device',
      kind: 'step',
      step: 'waitForAndroid',
    },
    {
      id: 'remount',
      title: '\u6267\u884cRemount',
      description: 'adb remount, failed then disable-verity',
      kind: 'remount',
    },
    {
      id: 'finalReboot',
      title: '\u6700\u540e\u91cd\u542f',
      description: 'adb reboot',
      kind: 'step',
      step: 'finalReboot',
    },
  ]
}

function getUnlockRemountSteps(): Array<{
  id: IUnlockRemountStep
  title: string
  description: string
}> {
  return [
    {
      id: 'enableOemUnlock',
      title: '\u542f\u7528OEM\u89e3\u9501',
      description: 'adb root + svc oem_unlock enable',
    },
    {
      id: 'rebootBootloader',
      title: '\u8fdb\u5165Bootloader',
      description: 'adb reboot bootloader',
    },
    {
      id: 'checkFastboot',
      title: '\u68c0\u67e5Fastboot',
      description: 'fastboot devices',
    },
    {
      id: 'flashingUnlock',
      title: '\u89e3\u9501flashing',
      description: 'fastboot flashing unlock',
    },
    {
      id: 'oemUnlock',
      title: '\u5907\u7528OEM\u89e3\u9501',
      description: 'fastboot oem unlock',
    },
    {
      id: 'fastbootReboot',
      title: '\u91cd\u542f\u56de\u7cfb\u7edf',
      description: 'fastboot reboot',
    },
    {
      id: 'waitForAndroid',
      title: '\u7b49\u5f85ADB',
      description: 'adb wait-for-device',
    },
    {
      id: 'remount',
      title: '\u6267\u884cRemount',
      description: 'adb root + adb remount',
    },
    {
      id: 'disableVerityRemount',
      title: '\u5173\u95edVerity\u5e76Remount',
      description: 'adb disable-verity + reboot + remount',
    },
    {
      id: 'finalReboot',
      title: '\u6700\u540e\u91cd\u542f',
      description: 'adb reboot',
    },
  ]
}

function loadMtkLogSource() {
  const source = localStorage.getItem(MTK_LOG_SOURCE_STORAGE_KEY)
  return source || DEFAULT_MTK_LOG_SOURCE
}

function loadMtkLogSource2() {
  const source = localStorage.getItem(MTK_LOG_SOURCE2_STORAGE_KEY)
  return source || DEFAULT_MTK_LOG_SOURCE
}

function loadMtkLogActive(): '1' | '2' {
  const active = localStorage.getItem(MTK_LOG_ACTIVE_STORAGE_KEY)
  return active === '2' ? '2' : '1'
}

function loadWifi(): IWifiConfig {
  try {
    const value = localStorage.getItem(WIFI_STORAGE_KEY)
    if (!value) {
      return {
        ssid: '',
        password: '',
      }
    }
    const config = JSON.parse(value)
    return {
      ssid: typeof config.ssid === 'string' ? config.ssid : '',
      password: typeof config.password === 'string' ? config.password : '',
    }
  } catch {
    return {
      ssid: '',
      password: '',
    }
  }
}

function loadHistory() {
  try {
    const value = localStorage.getItem(HISTORY_STORAGE_KEY)
    if (!value) {
      return []
    }

    const history = JSON.parse(value)
    if (!Array.isArray(history)) {
      return []
    }

    return filter(history, (item) => typeof item === 'string').slice(
      0,
      HISTORY_LIMIT
    )
  } catch {
    return []
  }
}

function saveHistory(history: string[]) {
  localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history))
}

function getCommands() {
  const commands = [
    [t('reboot'), 'reboot\n'],
    [t('rebootRecovery'), 'reboot recovery\n'],
    [t('rebootBootloader'), 'reboot bootloader\n'],
    [t('memInfo'), 'dumpsys meminfo\n'],
    [t('batteryInfo'), 'dumpsys battery\n'],
    [
      `${t('start')} shizuku`,
      'sh /sdcard/Android/data/moe.shizuku.privileged.api/start.sh\n',
    ],
  ]

  if (store.language === 'zh-CN') {
    commands.push([
      '授权 GKD',
      'pm grant li.songe.gkd android.permission.WRITE_SECURE_SETTINGS; appops set li.songe.gkd ACCESS_RESTRICTED_SETTINGS allow\n',
    ])
  }

  return commands
}
