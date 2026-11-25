import { useEffect, useState } from 'react'
import { observer } from 'mobx-react-lite'
import { IScene, ISceneRunResult, ISceneStepResult } from 'common/types'
import { t } from 'common/util'
import { notify } from 'share/renderer/lib/util'
import store from '../../store'
import Style from './ScenePanel.module.scss'
import NewSceneModal from './NewSceneModal'
import contextMenu from 'share/renderer/lib/contextMenu'
import className from 'licia/className'

export default observer(function ScenePanel() {
  const [scenes, setScenes] = useState<IScene[]>([])
  const [running, setRunning] = useState(false)
  const [runningScene, setRunningScene] = useState<IScene | null>(null)
  const [steps, setSteps] = useState<ISceneStepResult[]>([])
  const [result, setResult] = useState<ISceneRunResult | null>(null)
  const [logVisible, setLogVisible] = useState(false)
  const [newSceneVisible, setNewSceneVisible] = useState(false)
  const [expandedSteps, setExpandedSteps] = useState<number[]>([])

  const { device } = store

  useEffect(() => {
    refresh()
    const off = main.on('sceneStep', (sceneId: string, step: ISceneStepResult) => {
      setSteps((prev) => [...prev, step])
    })
    return () => {
      off()
    }
  }, [])

  async function refresh() {
    const scenes = await main.getScenes()
    setScenes(scenes)
  }

  function findScene(sceneId: string) {
    return scenes.find((scene) => scene.id === sceneId)
  }

  function toggleStep(index: number) {
    setExpandedSteps((prev) =>
      prev.includes(index) ? prev.filter((i) => i !== index) : [...prev, index]
    )
  }

  async function run(scene: IScene) {
    if (running) {
      return
    }
    if (!device) {
      notify(t('sceneRequireDevice'), { icon: 'error' })
      return
    }
    setRunning(true)
    setRunningScene(scene)
    setSteps([])
    setResult(null)
    setLogVisible(true)
    setExpandedSteps([])
    try {
      const result = await main.runScene(device.id, scene.id)
      setResult(result)
      if (result.success) {
        notify(t('sceneRunSuccess', { name: scene.name }), { icon: 'success' })
      } else {
        notify(t('sceneRunFailed', { name: scene.name }), { icon: 'error' })
      }
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), { icon: 'error' })
    } finally {
      setRunning(false)
      setRunningScene(null)
    }
  }

  async function openFolder(sceneId: string) {
    try {
      await main.openSceneFolder(sceneId)
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), { icon: 'error' })
    }
  }

  const stepIcons: any = {
    'wait-device': '⟳',
    install: '⬇',
    push: '⇪',
    shell: '>_',
    start: '▶',
    input: '⌨',
    sleep: '⏱',
  }

  const stepIcon = (type: string) => stepIcons[type] || '●'

  return (
    <div className={Style.container}>
      <div className={Style.header}>
        <span className={Style.title}>{t('quickScenes')}</span>
        <div className={Style.scenes}>
          {scenes.map((scene) => (
            <button
              key={scene.id}
              className={className(Style.scene, {
                [Style.sceneRunning]: running && runningScene?.id === scene.id,
              })}
              disabled={running}
              onClick={() => run(scene)}
              onContextMenu={(e) => {
                e.preventDefault()
                showContextMenu(e, scene.id)
              }}
            >
              <span className={Style.sceneIcon}>
                {scene.icon || stepIcon(scene.steps[0]?.type)}
              </span>
              <span className={Style.sceneName}>{scene.name}</span>
            </button>
          ))}
          <button
            className={className(Style.scene, Style.newScene)}
            onClick={() => setNewSceneVisible(true)}
          >
            <span className={Style.sceneIcon}>＋</span>
            <span className={Style.sceneName}>{t('newScene')}</span>
          </button>
        </div>
      </div>
      {(logVisible || running) && steps.length > 0 && (
        <div className={Style.log}>
          <div className={Style.logHeader}>
            <span>
              {running
                ? t('sceneRunning', { name: runningScene?.name || '' })
                : t('sceneRunResult', {
                    name: (result && findScene(result.sceneId)?.name) || '',
                    status: result?.success ? t('sceneSuccess') : t('sceneFailed'),
                  })}
            </span>
            <span
              className={Style.logToggle}
              onClick={() => setLogVisible(!logVisible)}
            >
              {logVisible ? t('sceneCollapse') : t('sceneExpand')}
            </span>
          </div>
          {steps.map((step, i) => (
            <div key={i} className={Style.step}>
              <div
                className={Style.stepRow}
                onClick={() => toggleStep(i)}
              >
                <span
                  className={className(Style.stepStatus, {
                    [Style.stepSuccess]: !running && step.success,
                    [Style.stepFail]: !running && !step.success,
                    [Style.stepRunning]: running && i === steps.length - 1,
                  })}
                >
                  {running && i === steps.length - 1
                    ? '…'
                    : step.success
                    ? '✓'
                    : '✗'}
                </span>
                <span className={Style.stepIndex}>{i + 1}</span>
                <span className={Style.stepTitle}>{step.title}</span>
                <span className={Style.stepDuration}>
                  {((step.duration || 0) / 1000).toFixed(1)}s
                </span>
              </div>
              {step.command && (
                <div className={Style.stepCommand}>{step.command}</div>
              )}
              {!step.success && step.message && (
                <div className={Style.stepMessage}>{step.message}</div>
              )}
              {expandedSteps.includes(i) && (step.stdout || step.stderr) && (
                <pre className={Style.stepOutput}>
                  {step.stdout || ''}
                  {step.stderr ? (step.stdout ? '\n' : '') + step.stderr : ''}
                </pre>
              )}
            </div>
          ))}
        </div>
      )}
      <NewSceneModal
        visible={newSceneVisible}
        onClose={() => setNewSceneVisible(false)}
        onSaved={async () => {
          await refresh()
          setNewSceneVisible(false)
          notify(t('sceneSaved'), { icon: 'success' })
        }}
      />
    </div>
  )

  function showContextMenu(e: React.MouseEvent, sceneId: string) {
    contextMenu(e, [
      {
        label: t('sceneOpenFolder'),
        click: () => openFolder(sceneId),
      },
    ])
  }
})
