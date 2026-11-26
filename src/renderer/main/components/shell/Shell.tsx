import { observer } from 'mobx-react-lite'
import Term from './Term'
import type { ShellStatus } from './Term'
import ShellCommandPalette from './ShellCommandPalette'
import { isShellCommand } from './commands'
import LunaTab, { LunaTabItem } from 'luna-tab/react'
import { t } from 'common/util'
import store from '../../store'
import Style from './Shell.module.scss'
import className from 'licia/className'
import { CSSProperties, useEffect, useId, useRef, useState } from 'react'
import uuid from 'licia/uuid'
import map from 'licia/map'
import filter from 'licia/filter'
import find from 'licia/find'
import idxOf from 'licia/idxOf'
import { Terminal } from '@xterm/xterm'
import { notify } from 'share/renderer/lib/util'
import LunaModal from 'luna-modal'
import contextMenu from 'share/renderer/lib/contextMenu'
import { IUnlockRemountResult, IUnlockRemountStep } from 'common/types'
import {
  DEFAULT_MTK_PATHS,
  DEFAULT_UNISOC_PATHS,
  migrateLogExportConfig,
  platformLabel,
  resolvePlatform,
  selectLogPath,
} from 'common/logexport'
import type {
  DetectedPlatform,
  ILogExportConfig,
  ILogPathConfig,
  LogPlatform,
} from 'common/logexport'
import type {
  ILogExportProgress,
  ILogExportResult,
  ILogPathValidity,
} from 'common/types'
import LogExportPanel from './LogExportPanel'

const HISTORY_LIMIT = 50
const HISTORY_STORAGE_KEY = 'aya.shell.history'
const FAVORITES_STORAGE_KEY = 'aya.shell.favorites'
const LOG_EXPORT_CONFIG_STORAGE_KEY = 'aya.shell.logExportConfig'
const LEGACY_MTK_LOG_KEYS = {
  source: 'aya.shell.mtkLogSource',
  source2: 'aya.shell.mtkLogSource2',
  active: 'aya.shell.mtkLogActive',
  outputDir: 'aya.shell.mtkLogOutputDir',
}
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
  const [selectedShell, setSelectedShell] = useState<IShell>()
  const [history, setHistory] = useState(() => loadHistory(HISTORY_STORAGE_KEY))
  const [favorites, setFavorites] = useState(() => loadHistory(FAVORITES_STORAGE_KEY))
  const [statuses, setStatuses] = useState<Partial<Record<string, ShellStatus>>>({})
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyQuery, setHistoryQuery] = useState('')
  const historyId = useId()
  const historyButtonRef = useRef<HTMLButtonElement>(null)
  const [logConfig, setLogConfig] = useState(loadLogConfig)
  const [detected, setDetected] = useState<DetectedPlatform>('unknown')
  const [detectedKeyword, setDetectedKeyword] = useState<string | null>(null)
  const [pathValidity, setPathValidity] = useState<ILogPathValidity[]>([])
  const [logExporting, setLogExporting] = useState(false)
  const [logExportStatus, setLogExportStatus] = useState('')
  const [logExportResult, setLogExportResult] =
    useState<ILogExportResult | null>(null)
  const [logPanelVisible, setLogPanelVisible] = useState(false)
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
  const connected = device?.type === 'device' || device?.type === 'emulator'
  const status = selectedShell && statuses[selectedShell.id]

  const platform = resolvePlatform(logConfig, detected)
  const pathConfig: ILogPathConfig | null =
    platform === 'unknown' ? null : logConfig.platforms[platform]
  const validityByPath: Record<string, boolean> = {}
  for (const item of pathValidity) {
    validityByPath[item.path] = item.exists && item.readable
  }
  const effectiveLogPath = pathConfig
    ? selectLogPath(pathConfig, validityByPath)
    : null

  useEffect(() => saveHistory(HISTORY_STORAGE_KEY, history), [history])
  useEffect(() => saveHistory(FAVORITES_STORAGE_KEY, favorites), [favorites])

  useEffect(() => {
    if (store.panel !== 'shell' || unlockRemountVisible) return

    function onKeyDown(event: KeyboardEvent) {
      if (
        (event.ctrlKey || event.metaKey) &&
        event.shiftKey &&
        !event.altKey &&
        !event.isComposing &&
        event.code === 'KeyP'
      ) {
        event.preventDefault()
        event.stopPropagation()
        setHistoryOpen(false)
        setHistoryQuery('')
        setCommandPaletteVisible(true)
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [store.panel, unlockRemountVisible])

  useEffect(() => add(), [])

  // Re-detect the chip platform whenever the selected device changes.
  useEffect(() => {
    if (!device) {
      setDetected('unknown')
      setDetectedKeyword(null)
      return
    }
    let cancelled = false
    main
      .detectPlatform(device.id)
      .then((match) => {
        if (!cancelled) {
          setDetected(match.platform)
          setDetectedKeyword(match.keyword)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDetected('unknown')
          setDetectedKeyword(null)
          notify('平台识别失败，已按未知平台处理，可在管理面板手动选择', {
            icon: 'info',
          })
        }
      })
    return () => {
      cancelled = true
    }
  }, [device?.id])

  // Re-probe the current platform's candidate paths, discovering the real log
  // directory on the device and adopting any valid discovered path.
  useEffect(() => {
    if (!device || platform === 'unknown' || !pathConfig) {
      setPathValidity([])
      return
    }
    const target = platform
    let cancelled = false
    collectLogValidity(device.id, target)
      .then((result) => {
        if (cancelled) {
          return
        }
        setPathValidity(result.validity)
        const adopt = result.discovered.filter(
          (path) =>
            !pathConfig.paths.includes(path) &&
            result.validity.some(
              (item) => item.path === path && item.exists && item.readable
            )
        )
        if (adopt.length) {
          updateLogPathConfig(target, (pc) => ({
            ...pc,
            paths: [...pc.paths, ...adopt],
            selected: pc.selected ?? adopt[0],
          }))
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPathValidity([])
        }
      })
    return () => {
      cancelled = true
    }
  }, [device?.id, platform, pathConfig?.paths.join('|')])

  // Surface export progress pushed from the main process.
  useEffect(() => {
    const off = main.on('logExportProgress', (progress: ILogExportProgress) => {
      setLogExportStatus(progress.message)
    })
    return () => {
      off()
    }
  }, [])

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
    const number = numRef.current++
    const shell = {
      id,
      name: number === 1 ? 'Android Shell' : `Android Shell ${number}`,
      sessionId: '',
    }
    setShells((shells) => [...shells, shell])
    setSelectedShell(shell)
  }

  function close(id: string) {
    const closedShell = find(shells, (shell) => shell.id === id)
    let closedIdx = idxOf(shells, closedShell)
    const newShells = filter(shells, (shell) => shell.id !== id)
    setShells(newShells)
    setStatuses((previous) => {
      const next = { ...previous }
      delete next[id]
      return next
    })

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
        selected={selectedShell?.id === shell.id}
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
        onOpenCommandPalette={() => {
          setHistoryOpen(false)
          setHistoryQuery('')
          setCommandPaletteVisible(true)
        }}
        onCommand={addHistory}
        onStatus={(status) => setStatuses((previous) => ({
          ...previous,
          [shell.id]: status,
        }))}
        visible={selectedShell?.id === shell.id && store.panel === 'shell'}
      />
    )
  })

  function addHistory(command: string) {
    if (isShellCommand(command)) {
      setHistory((items) => [command, ...items.filter((item) => item !== command)].slice(0, HISTORY_LIMIT))
    }
  }

  async function editHistory(command: string) {
    const edited = (await LunaModal.prompt(t('edit'), command))?.trim()
    if (!isShellCommand(edited) || edited === command) return
    const replace = (items: string[]) => Array.from(
      new Set(items.map((item) => item === command ? edited : item))
    )
    setHistory(replace)
    setFavorites(replace)
  }

  function deleteHistory(command: string) {
    const remove = (items: string[]) => items.filter((item) => item !== command)
    setHistory(remove)
    setFavorites(remove)
  }

  function toggleFavorite(command: string) {
    setFavorites((items) => items.includes(command)
      ? items.filter((item) => item !== command)
      : [command, ...items])
  }

  async function copyHistory(command: string) {
    try {
      const copied = await preload.writeClipboardText(command)
      notify(t(copied ? 'shellHistory.copied' : 'shellHistory.copyFailed'), {
        icon: copied ? 'success' : 'error',
      })
    } catch {
      notify(t('shellHistory.copyFailed'), { icon: 'error' })
    }
  }

  function closeHistory() {
    setHistoryOpen(false)
    setHistoryQuery('')
    if (selectedShell?.terminal) {
      selectedShell.terminal.focus()
    } else {
      historyButtonRef.current?.focus()
    }
  }

  function closePalette() {
    setCommandPaletteVisible(false)
    requestAnimationFrame(() => selectedShell?.terminal?.focus())
  }

  function selectPaletteCommand(command: string) {
    if (!selectedShell?.sessionId || !selectedShell.setInput) {
      notify(t('deviceNotConnected'), { icon: 'error' })
      return
    }
    selectedShell.setInput(command)
    closePalette()
  }

  async function runScript(script: IShellScript) {
    if (!device || runningScript) {
      return
    }
    setRunningScript(script.id)
    try {
      if (script.action === 'unlockRemount') {
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
      selectedShell?.terminal?.focus()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      notify(`${script.title} failed: ${message}`, { icon: 'error' })
    } finally {
      setRunningScript('')
    }
  }

  const scriptButtons = map(getShellScripts(), (script) => {
    const running = runningScript === script.id
    const isExportLog = script.action === 'exportLog'
    const isConnectWifi = script.action === 'connectWifi'

    if (isExportLog) {
      return (
        <div className={Style.exportGroup} key={script.id}>
          <button
            className={Style.scriptButton}
            style={{ '--tag-color': script.color } as CSSProperties}
            title={`${script.description}\n当前路径：${
              effectiveLogPath || '未检测到有效路径'
            }\n导出路径：${logConfig.outputDir}\n右键打开管理面板`}
            disabled={!device || logExporting}
            onClick={runLogExport}
            onContextMenu={openLogPanel}
          >
            {logExporting ? '导出中...' : '导出日志'}
            <span className={Style.scriptBadge}>{platformLabel(platform)}</span>
          </button>
          <button
            className={Style.scriptGear}
            title="日志管理"
            aria-label="日志管理"
            disabled={!device}
            onClick={openLogPanel}
          >
            <span className="icon-setting" aria-hidden="true" />
          </button>
        </div>
      )
    }

    let title = script.description
    if (isConnectWifi) {
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
          if (isConnectWifi) {
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

  function currentLogPlatform(): LogPlatform {
    return platform === 'mtk' || platform === 'unisoc' ? platform : 'mtk'
  }

  function saveLogConfig(config: ILogExportConfig) {
    setLogConfig(config)
    localStorage.setItem(LOG_EXPORT_CONFIG_STORAGE_KEY, JSON.stringify(config))
  }

  function updateLogPathConfig(
    target: LogPlatform,
    updater: (pathConfig: ILogPathConfig) => ILogPathConfig
  ) {
    const next: ILogExportConfig = {
      ...logConfig,
      platforms: {
        ...logConfig.platforms,
        [target]: updater(logConfig.platforms[target]),
      },
    }
    saveLogConfig(next)
  }

  function addLogPath(path: string) {
    updateLogPathConfig(currentLogPlatform(), (pathConfig) => ({
      ...pathConfig,
      paths: pathConfig.paths.includes(path)
        ? pathConfig.paths
        : [...pathConfig.paths, path],
    }))
  }

  function removeLogPath(path: string) {
    updateLogPathConfig(currentLogPlatform(), (pathConfig) => ({
      ...pathConfig,
      paths: pathConfig.paths.filter((item) => item !== path),
      selected: pathConfig.selected === path ? null : pathConfig.selected,
    }))
  }

  function modifyLogPath(oldPath: string, newPath: string) {
    updateLogPathConfig(currentLogPlatform(), (pathConfig) => ({
      ...pathConfig,
      paths: pathConfig.paths.map((item) =>
        item === oldPath ? newPath : item
      ),
      selected:
        pathConfig.selected === oldPath ? newPath : pathConfig.selected,
    }))
  }

  function selectLogPathManually(path: string) {
    updateLogPathConfig(currentLogPlatform(), (pathConfig) => ({
      ...pathConfig,
      selected: path,
    }))
  }

  function toggleAutoDetect(on: boolean) {
    let manualPlatform = logConfig.manualPlatform
    if (!on && !manualPlatform) {
      manualPlatform = detected !== 'unknown' ? detected : 'mtk'
    }
    saveLogConfig({ ...logConfig, autoDetect: on, manualPlatform })
  }

  function selectManualPlatform(target: LogPlatform) {
    saveLogConfig({
      ...logConfig,
      autoDetect: false,
      manualPlatform: target,
    })
  }

  function restoreDefaultLogPaths() {
    const target = currentLogPlatform()
    const defaults = target === 'mtk' ? DEFAULT_MTK_PATHS : DEFAULT_UNISOC_PATHS
    updateLogPathConfig(target, () => ({
      paths: [...defaults],
      selected: null,
    }))
  }

  function setLogOutputDir(dir: string) {
    saveLogConfig({ ...logConfig, outputDir: dir })
  }

  function openLogPanel(e?: React.MouseEvent) {
    e?.preventDefault()
    setLogPanelVisible(true)
  }

  function closeLogPanel() {
    setLogPanelVisible(false)
  }

  async function runLogExport() {
    if (!device || logExporting) {
      return
    }
    if (platform === 'unknown' || !pathConfig) {
      notify('无法识别芯片平台，请在管理面板中手动选择', { icon: 'error' })
      setLogPanelVisible(true)
      return
    }

    const collected = await collectLogValidity(device.id, platform).catch(
      () => null
    )
    const validity = collected?.validity ?? []
    setPathValidity(validity)
    const validityMap: Record<string, boolean> = {}
    for (const item of validity) {
      validityMap[item.path] = item.exists && item.readable
    }
    const source = selectLogPath(
      {
        paths: collected?.paths ?? pathConfig.paths,
        selected: pathConfig.selected,
      },
      validityMap
    )
    if (!source) {
      notify('未找到可用的日志路径，请在管理面板中配置', { icon: 'error' })
      setLogPanelVisible(true)
      return
    }

    setLogExporting(true)
    setLogExportResult(null)
    setLogExportStatus('')
    try {
      const result = await main.exportLog(
        device.id,
        source,
        logConfig.outputDir,
        platform
      )
      setLogExportResult(result)
      if (result.status === 'cancelled') {
        notify('已取消导出', { icon: 'info' })
      } else {
        notify(`导出完成: ${result.outputDir}`, { icon: 'success' })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      notify(`导出失败: ${message}`, { icon: 'error' })
    } finally {
      setLogExporting(false)
    }
  }

  function openLogExportDir() {
    if (logExportResult?.status === 'success') {
      main.openPath(logExportResult.outputDir)
    }
  }

  function cancelLogExport() {
    main.cancelLogExport()
  }

  async function collectLogValidity(deviceId: string, target: LogPlatform) {
    const discovered = await main
      .discoverLogPaths(deviceId, target)
      .catch(() => [] as string[])
    const merged = [
      ...new Set([...logConfig.platforms[target].paths, ...discovered]),
    ]
    const validity = await main.detectLogPaths(deviceId, merged)
    return { paths: merged, discovered, validity }
  }

  function refreshLogPathValidity() {
    if (!device || platform === 'unknown' || !pathConfig) {
      return
    }
    collectLogValidity(device.id, platform)
      .then((result) => setPathValidity(result.validity))
      .catch(() => setPathValidity([]))
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

  const searchText = historyQuery.trim().toLowerCase()
  const historyItems = Array.from(new Set([...favorites, ...history])).filter(
    (command) => command.toLowerCase().includes(searchText)
  )

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
    <div
      className={className('panel-with-toolbar', Style.shell, {
        [Style.dark]: store.theme === 'dark',
      })}
      inert={store.panel !== 'shell'}
    >
      <div className={className('panel-toolbar', Style.toolbar)}>
        <LunaTab
          className={Style.tabs}
          height={42}
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
        <button
          type="button"
          className={Style.iconButton}
          title={t('add')}
          aria-label={t('add')}
          onClick={add}
          disabled={!device}
        >
          <span className="icon-add" aria-hidden="true" />
        </button>
      </div>
      <div className={className('panel-body', Style.body)}>
        <div className={Style.workspace}>
          <div className={Style.termContainer}>{terms}</div>
          <div className={Style.rail}>
            <button
              type="button"
              className={Style.iconButton}
              title={t('shellPalette.title') + ' (Ctrl+Shift+P)'}
              aria-label={t('shellPalette.title')}
              aria-keyshortcuts="Control+Shift+P"
              onClick={() => {
                setHistoryOpen(false)
                setHistoryQuery('')
                setCommandPaletteVisible(true)
              }}
            >
              <span className="icon-terminal" aria-hidden="true" />
            </button>
            <button
              type="button"
              className={Style.iconButton}
              title={t('shellHistory.title')}
              aria-label={t('shellHistory.title')}
              aria-expanded={historyOpen}
              aria-controls={historyOpen ? historyId : undefined}
              ref={historyButtonRef}
              onClick={() => (historyOpen ? closeHistory() : setHistoryOpen(true))}
            >
              <span className="icon-list" aria-hidden="true" />
            </button>
          </div>
          {historyOpen && (
            <aside
              className={Style.historyPanel}
              id={historyId}
              aria-labelledby={`${historyId}-title`}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault()
                  event.stopPropagation()
                  closeHistory()
                }
              }}
            >
              <div className={Style.historyHeader}>
                <h2 id={`${historyId}-title`}>{t('shellHistory.title')}</h2>
                <span className={Style.historyCount}>
                  {history.length}/{HISTORY_LIMIT}
                </span>
                <button
                  type="button"
                  className={Style.iconButton}
                  title={t('shellHistory.clear')}
                  aria-label={t('shellHistory.clear')}
                  disabled={!history.length}
                  onClick={() => setHistory([])}
                >
                  <span className="icon-clear" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className={Style.iconButton}
                  title={t('close')}
                  aria-label={t('close')}
                  onClick={closeHistory}
                >
                  <span className="icon-collapse" aria-hidden="true" />
                </button>
              </div>
              <label className={Style.historySearch}>
                <input
                  type="search"
                  aria-label={t('shellHistory.search')}
                  placeholder={t('shellHistory.search')}
                  value={historyQuery}
                  onChange={(event) => setHistoryQuery(event.currentTarget.value)}
                  autoFocus
                />
              </label>
              {historyItems.length ? (
                <ul className={Style.historyList}>
                  {historyItems.map((command) => (
                    <li className={Style.historyItem} key={command}>
                      <button
                        type="button"
                        className={Style.historyCommand}
                        title={command}
                        onClick={() => {
                          if (!selectedShell?.sessionId || !selectedShell.setInput) {
                            notify(t('deviceNotConnected'), { icon: 'error' })
                            return
                          }
                          closeHistory()
                          selectedShell.setInput(command)
                        }}
                      >
                        <code>{command}</code>
                      </button>
                      <div className={Style.historyRowActions}>
                        <button
                          type="button"
                          className={Style.iconButton}
                          title={t(favorites.includes(command) ? 'shellHistory.unfavorite' : 'shellHistory.favorite')}
                          aria-label={t('shellHistory.favorite') + ' ' + command}
                          aria-pressed={favorites.includes(command)}
                          onClick={() => toggleFavorite(command)}
                        >
                          <span className="icon-pin" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          className={Style.iconButton}
                          title={t('copy')}
                          aria-label={t('copy') + ' ' + command}
                          onClick={() => void copyHistory(command)}
                        >
                          <span className="icon-copy" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          title={t('edit')}
                          aria-label={t('edit') + ' ' + command}
                          onClick={() => void editHistory(command)}
                        >
                          {t('edit')}
                        </button>
                        <button
                          type="button"
                          className={Style.iconButton}
                          title={t('delete')}
                          aria-label={t('delete') + ' ' + command}
                          onClick={() => deleteHistory(command)}
                        >
                          <span className="icon-delete" aria-hidden="true" />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={Style.historyEmpty}>
                  {t(
                    history.length || favorites.length
                      ? 'shellHistory.noMatches'
                      : 'shellHistory.empty'
                  )}
                </p>
              )}
            </aside>
          )}
        </div>
        <div className={Style.scriptBar}>
          {scriptButtons}
          {logExportStatus && (
            <span className={Style.exportStatus} title={logExportStatus}>
              {logExportStatus}
            </span>
          )}
          {logExporting && (
            <button
              className={Style.exportCancelButton}
              onClick={cancelLogExport}
            >
              取消导出
            </button>
          )}
          {logExportResult?.status === 'success' && (
            <button
              className={Style.exportOpenButton}
              onClick={openLogExportDir}
            >
              打开目录
            </button>
          )}
        </div>
        <footer className={Style.status}>
          <span className={connected ? Style.connected : undefined}>
            <span className="icon-circle" aria-hidden="true" />
            {t(connected ? 'shellConnected' : 'deviceNotConnected')}
          </span>
          {device && <span title={device.id}>{device.name || device.id}</span>}
          <span>UID {status?.uid ?? '—'}</span>
          <span>Root {status ? t(status.root ? 'shellStatus.yes' : 'shellStatus.no') : '—'}</span>
          <span className={Style.cwd} title={status?.cwd}>
            <span>{t('shellStatus.cwd')} {status?.cwd || '—'}</span>
          </span>
          <span>UTF-8</span>
        </footer>
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
        {logPanelVisible && (
          <LogExportPanel
            deviceName={device ? device.name || device.id : null}
            platform={platform}
            detected={detected}
            autoDetect={logConfig.autoDetect}
            manualPlatform={logConfig.manualPlatform}
            pathConfig={pathConfig}
            pathValidity={pathValidity}
            outputDir={logConfig.outputDir}
            onClose={closeLogPanel}
            onToggleAutoDetect={toggleAutoDetect}
            onSelectPlatform={selectManualPlatform}
            onAddPath={addLogPath}
            onRemovePath={removeLogPath}
            onModifyPath={modifyLogPath}
            onSelectPath={selectLogPathManually}
            onRestoreDefaults={restoreDefaultLogPaths}
            onSetOutputDir={setLogOutputDir}
            onRefreshValidity={refreshLogPathValidity}
            detectedKeyword={detectedKeyword}
          />
        )}
        {commandPaletteVisible && store.panel === 'shell' && (
          <ShellCommandPalette
            builtins={getCommands()}
            onClose={closePalette}
            onSelect={selectPaletteCommand}
          />
        )}
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
  action?: 'exportLog' | 'connectWifi' | 'unlockRemount'
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
      id: 'exportLog',
      title: '\u5bfc\u51fa\u65e5\u5fd7',
      color: '#53b1fd',
      description: 'adb pull <日志路径> <导出路径>',
      action: 'exportLog',
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

function loadLogConfig(): ILogExportConfig {
  const stored = localStorage.getItem(LOG_EXPORT_CONFIG_STORAGE_KEY)
  if (stored) {
    try {
      const parsed = JSON.parse(stored)
      if (parsed && parsed.platforms?.mtk && parsed.platforms?.unisoc) {
        return parsed
      }
    } catch {
      // Fall through to migration.
    }
  }

  const legacy = {
    source: localStorage.getItem(LEGACY_MTK_LOG_KEYS.source),
    source2: localStorage.getItem(LEGACY_MTK_LOG_KEYS.source2),
    active: localStorage.getItem(LEGACY_MTK_LOG_KEYS.active) as
      | '1'
      | '2'
      | null,
    outputDir: localStorage.getItem(LEGACY_MTK_LOG_KEYS.outputDir),
  }
  const config = migrateLogExportConfig(legacy)
  localStorage.setItem(LOG_EXPORT_CONFIG_STORAGE_KEY, JSON.stringify(config))
  return config
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

function loadHistory(key: string): string[] {
  try {
    const value = localStorage.getItem(key)
    if (!value) {
      return []
    }

    const history = JSON.parse(value)
    if (!Array.isArray(history)) {
      return []
    }

    const commands = Array.from(new Set(history.filter(isShellCommand)))
    return key === HISTORY_STORAGE_KEY ? commands.slice(0, HISTORY_LIMIT) : commands
  } catch {
    return []
  }
}

function saveHistory(key: string, history: string[]) {
  if (history.length) {
    localStorage.setItem(key, JSON.stringify(history))
  } else {
    localStorage.removeItem(key)
  }
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
