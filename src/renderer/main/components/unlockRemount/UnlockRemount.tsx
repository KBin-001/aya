import { observer } from 'mobx-react-lite'
import { useEffect, useState } from 'react'
import className from 'licia/className'
import find from 'licia/find'
import map from 'licia/map'
import { notify } from 'share/renderer/lib/util'
import store from '../../store'
import {
  IUnlockRemountResult,
  IUnlockRemountStep,
} from 'common/types'
import Style from '../shell/Shell.module.scss'

const OPEN_EVENT = 'aya:openUnlockRemount'

export function openUnlockRemount() {
  window.dispatchEvent(new Event(OPEN_EVENT))
}

export default observer(function UnlockRemount() {
  const [visible, setVisible] = useState(false)
  const [targetDeviceId, setTargetDeviceId] = useState('')
  const [runningStep, setRunningStep] = useState<IUnlockRemountStep | null>(
    null
  )
  const [confirmed, setConfirmed] = useState(false)
  const [logs, setLogs] = useState<string[]>([])
  const [autoRunning, setAutoRunning] = useState(false)
  const [pausedMessage, setPausedMessage] = useState('')
  const [resumeIndex, setResumeIndex] = useState(0)
  const [currentStep, setCurrentStep] = useState('')
  const [stepStatus, setStepStatus] = useState<
    Record<string, IUnlockFlowStatus>
  >({})

  useEffect(() => {
    function open() {
      if (store.device) {
        setTargetDeviceId(store.device.id)
      }
      setVisible(true)
    }

    window.addEventListener(OPEN_EVENT, open)
    return () => window.removeEventListener(OPEN_EVENT, open)
  }, [])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (visible && pausedMessage && e.key === 'Enter') {
        e.preventDefault()
        continueAuto()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [visible, pausedMessage, resumeIndex, targetDeviceId])

  if (!visible) {
    return null
  }

  const stepButtons = map(getManualSteps(), (step) => {
    const running = runningStep === step.id
    const disabled =
      !targetDeviceId ||
      autoRunning ||
      !!runningStep ||
      ((step.id === 'flashingUnlock' || step.id === 'oemUnlock') &&
        !confirmed)
    return (
      <button
        key={step.id}
        className={Style.unlockStepButton}
        disabled={disabled}
        title={step.description}
        onClick={() => runStep(step.id)}
      >
        {running ? '\u6267\u884c\u4e2d...' : step.title}
      </button>
    )
  })

  const progressItems = map(getAutoFlow(), (item, idx) => {
    const status = stepStatus[item.id] || 'pending'
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

  async function checkEnv() {
    if (!targetDeviceId || runningStep) {
      return
    }
    setRunningStep('checkAdb')
    appendLog('\n[CHECK] \u68c0\u67e5 ADB / Fastboot \u73af\u5883')
    try {
      const env = await main.checkUnlockRemountEnv(targetDeviceId)
      appendEnvLog(env)
    } catch (err) {
      appendLog(formatError(err))
    } finally {
      setRunningStep(null)
    }
  }

  async function startAuto() {
    if (!targetDeviceId || autoRunning || runningStep) {
      return
    }
    setLogs([])
    setStepStatus({})
    setPausedMessage('')
    setResumeIndex(0)
    await runAuto(0)
  }

  function continueAuto() {
    if (!targetDeviceId || autoRunning || !pausedMessage) {
      return
    }
    const index = resumeIndex
    setPausedMessage('')
    setTimeout(() => runAuto(index), 0)
  }

  async function runAuto(startIndex: number) {
    const flow = getAutoFlow()
    setAutoRunning(true)
    try {
      for (let i = startIndex; i < flow.length; i++) {
        const item = flow[i]
        setCurrentStep(item.title)

        if (item.kind === 'pause') {
          setStepStatus((status) => ({ ...status, [item.id]: 'paused' }))
          setPausedMessage(item.message || '')
          setResumeIndex(i + 1)
          appendLog(`\n[PAUSE] ${item.title}\n${item.message || ''}`)
          return
        }

        setStepStatus((status) => ({ ...status, [item.id]: 'running' }))
        appendLog(`\n[AUTO] ${item.title}`)

        let result: IUnlockRemountResult
        if (item.kind === 'check') {
          result = await checkAutoEnv(item.id)
        } else if (item.kind === 'unlock') {
          if (!confirmed) {
            setStepStatus((status) => ({ ...status, [item.id]: 'paused' }))
            setPausedMessage(
              '\u8bf7\u5148\u52fe\u9009\u98ce\u9669\u786e\u8ba4\uff0c\u7136\u540e\u6309 Enter \u6216\u70b9\u51fb\u7ee7\u7eed\u3002'
            )
            setResumeIndex(i)
            return
          }
          result = await runUnlockWithFallback()
        } else if (item.kind === 'remount') {
          result = await runRemountWithFallback()
        } else {
          result = await main.runUnlockRemountStep(targetDeviceId, item.step!)
        }

        appendResult(result)
        setStepStatus((status) => ({
          ...status,
          [item.id]: result.success ? 'success' : 'failed',
        }))
        if (!result.success) {
          notify(`${item.title} failed`, { icon: 'error' })
          return
        }
      }

      setCurrentStep('\u5168\u90e8\u5b8c\u6210')
      appendLog('\n[DONE] \u89e3\u9501 Remount \u6d41\u7a0b\u5df2\u5b8c\u6210')
      notify('\u89e3\u9501Remount\u6d41\u7a0b\u5b8c\u6210', {
        icon: 'success',
      })
    } catch (err) {
      appendLog(formatError(err))
      notify('\u81ea\u52a8\u6d41\u7a0b\u5931\u8d25', { icon: 'error' })
    } finally {
      setAutoRunning(false)
      setRunningStep(null)
    }
  }

  async function checkAutoEnv(id: string): Promise<IUnlockRemountResult> {
    const env = await main.checkUnlockRemountEnv(targetDeviceId)
    appendEnvLog(env)
    if (!env.adbReady) {
      return failedResult('ADB device is not ready')
    }
    if (!env.fastbootReady) {
      return failedResult('Fastboot is not available')
    }
    setStepStatus((status) => ({ ...status, [id]: 'success' }))
    return { success: true, stdout: '', stderr: '', code: 0, message: 'OK' }
  }

  async function runUnlockWithFallback() {
    const flashing = await main.runUnlockRemountStep(
      targetDeviceId,
      'flashingUnlock'
    )
    if (flashing.success) {
      return flashing
    }

    const fallbackMessage =
      '\n[FALLBACK] fastboot flashing unlock \u5931\u8d25\uff0c\u5c1d\u8bd5 fastboot oem unlock\n'
    const oem = await main.runUnlockRemountStep(targetDeviceId, 'oemUnlock')
    return {
      ...oem,
      stdout: `${flashing.stdout}${fallbackMessage}${oem.stdout}`,
      stderr: `${flashing.stderr}${oem.stderr}`,
    }
  }

  async function runRemountWithFallback() {
    const remount = await main.runUnlockRemountStep(targetDeviceId, 'remount')
    if (remount.success) {
      return remount
    }

    const fallbackMessage =
      '\n[FALLBACK] adb remount \u5931\u8d25\uff0c\u5c1d\u8bd5 disable-verity + reboot + remount\n'
    const disableVerity = await main.runUnlockRemountStep(
      targetDeviceId,
      'disableVerityRemount'
    )
    return {
      ...disableVerity,
      stdout: `${remount.stdout}${fallbackMessage}${disableVerity.stdout}`,
      stderr: `${remount.stderr}${disableVerity.stderr}`,
    }
  }

  async function runStep(step: IUnlockRemountStep) {
    if (!targetDeviceId || runningStep) {
      return
    }
    const meta = find(getManualSteps(), (item) => item.id === step)
    setRunningStep(step)
    appendLog(`\n[STEP] ${meta?.title || step}`)
    try {
      const result = await main.runUnlockRemountStep(targetDeviceId, step)
      appendResult(result)
      notify(result.success ? '\u6267\u884c\u5b8c\u6210' : '\u6267\u884c\u5931\u8d25', {
        icon: result.success ? 'success' : 'error',
      })
    } catch (err) {
      appendLog(formatError(err))
      notify('\u6267\u884c\u5931\u8d25', { icon: 'error' })
    } finally {
      setRunningStep(null)
    }
  }

  function appendEnvLog(env: {
    adbPath: string
    fastbootPath: string
    adbReady: boolean
    fastbootReady: boolean
    adbState: string
    oemUnlockAllowed: string
    fastbootDevices: string[]
  }) {
    appendLog(
      [
        `device: ${targetDeviceId || '-'}`,
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
  }

  function appendResult(result: IUnlockRemountResult) {
    appendLog(
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

  function appendLog(log: string) {
    setLogs((logs) => [...logs, log])
  }

  function failedResult(message: string): IUnlockRemountResult {
    return { success: false, stdout: '', stderr: message, code: 1, message }
  }

  function formatError(err: unknown) {
    return err instanceof Error ? err.message : String(err)
  }

  function reset() {
    setLogs([])
    setStepStatus({})
    setPausedMessage('')
    setCurrentStep('')
  }

  function close() {
    if (!runningStep && !autoRunning) {
      setVisible(false)
    }
  }

  return (
    <div className={Style.unlockOverlay}>
      <div className={Style.unlockDialog}>
        <div className={Style.unlockHeader}>
          <div>
            <div className={Style.unlockTitle}>
              {'\u89e3\u9501Bootloader + Remount'}
            </div>
            <div className={Style.unlockSubtitle}>
              {targetDeviceId
                ? `\u9501\u5b9a\u8bbe\u5907: ${targetDeviceId}`
                : '\u5f00\u59cb\u524d\u8bf7\u5148\u8fde\u63a5\u5e76\u9009\u62e9\u8bbe\u5907'}
            </div>
          </div>
          <button
            className={Style.unlockClose}
            disabled={!!runningStep || autoRunning}
            onClick={close}
          >
            x
          </button>
        </div>
        <div className={Style.unlockCommandBar}>
          <button
            className={Style.unlockPrimaryButton}
            disabled={!targetDeviceId || autoRunning || !!runningStep}
            onClick={startAuto}
          >
            {autoRunning
              ? '\u81ea\u52a8\u6267\u884c\u4e2d...'
              : '\u5f00\u59cb\u81ea\u52a8\u6267\u884c'}
          </button>
          <button
            className={Style.unlockContinueButton}
            disabled={!pausedMessage || autoRunning}
            onClick={continueAuto}
          >
            {'\u7ee7\u7eed / Enter'}
          </button>
          <label className={Style.unlockConfirm}>
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            {'\u5141\u8bb8\u6267\u884c\u89e3\u9501\u547d\u4ee4\uff08\u53ef\u80fd\u6e05\u7a7a\u6570\u636e\uff09'}
          </label>
        </div>
        {pausedMessage && (
          <div className={Style.unlockPause}>
            <div className={Style.unlockPauseTitle}>
              {'\u7b49\u5f85\u4eba\u5de5\u786e\u8ba4'}
            </div>
            <div>{pausedMessage}</div>
          </div>
        )}
        <div className={Style.unlockMain}>
          <div className={Style.unlockProgress}>
            <div className={Style.unlockPanelTitle}>{'\u6267\u884c\u6d41\u7a0b'}</div>
            <div className={Style.unlockProgressList}>{progressItems}</div>
          </div>
          <div className={Style.unlockLogPanel}>
            <div className={Style.unlockPanelTitle}>
              {currentStep || '\u7b49\u5f85\u5f00\u59cb'}
            </div>
            <pre className={Style.unlockLog}>
              {logs.join('\n') ||
                '\u70b9\u51fb\u201c\u5f00\u59cb\u81ea\u52a8\u6267\u884c\u201d\u540e\uff0c\u6d41\u7a0b\u4f1a\u81ea\u52a8\u8dd1\u5230\u9700\u8981\u4f60\u786e\u8ba4\u7684\u8282\u70b9\u3002'}
            </pre>
          </div>
        </div>
        <div className={Style.unlockManual}>
          <span>{'\u5355\u6b65\u91cd\u8bd5'}</span>
          <button
            className={Style.unlockCheckButton}
            disabled={!targetDeviceId || !!runningStep || autoRunning}
            onClick={checkEnv}
          >
            {'\u68c0\u67e5\u73af\u5883'}
          </button>
          {stepButtons}
        </div>
        <div className={Style.unlockFooter}>
          <button
            className={Style.unlockSecondaryButton}
            disabled={(!!runningStep || !logs.length) && !pausedMessage}
            onClick={reset}
          >
            {'\u91cd\u7f6e\u7a97\u53e3'}
          </button>
          <button
            className={Style.unlockSecondaryButton}
            disabled={!!runningStep || autoRunning}
            onClick={close}
          >
            {'\u5173\u95ed'}
          </button>
        </div>
      </div>
    </div>
  )
})

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

function getAutoFlow(): IUnlockAutoFlowItem[] {
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
        '\u8bf7\u786e\u8ba4\u8bbe\u5907\u5df2\u5728 Bootloader \u754c\u9762\uff0c\u52fe\u9009\u89e3\u9501\u98ce\u9669\u786e\u8ba4\u540e\uff0c\u6309 Enter \u6216\u70b9\u51fb\u7ee7\u7eed\u3002',
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

function getManualSteps(): Array<{
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
