import { useEffect, useState } from 'react'
import { platformLabel } from 'common/logexport'
import type {
  DetectedPlatform,
  ILogPathConfig,
  LogPlatform,
} from 'common/logexport'
import type { ILogPathValidity } from 'common/types'
import LunaModal from 'luna-modal'
import Style from './LogExportPanel.module.scss'
import className from 'licia/className'

interface ILogExportPanelProps {
  deviceName: string | null
  platform: DetectedPlatform
  detected: DetectedPlatform
  autoDetect: boolean
  manualPlatform: LogPlatform | null
  pathConfig: ILogPathConfig | null
  pathValidity: ILogPathValidity[]
  outputDir: string
  onClose: () => void
  onToggleAutoDetect: (on: boolean) => void
  onSelectPlatform: (platform: LogPlatform) => void
  onAddPath: (path: string) => void
  onRemovePath: (path: string) => void
  onModifyPath: (oldPath: string, newPath: string) => void
  onSelectPath: (path: string) => void
  onRestoreDefaults: () => void
  onSetOutputDir: (dir: string) => void
  onRefreshValidity: () => void
  detectedKeyword: string | null
}

function pathState(
  path: string,
  validity: ILogPathValidity[],
): 'valid' | 'unreadable' | 'missing' | 'pending' {
  const found = validity.find((item) => item.path === path)
  if (!found) {
    return 'pending'
  }
  if (!found.exists) {
    return 'missing'
  }
  if (!found.readable) {
    return 'unreadable'
  }
  return 'valid'
}

const PATH_STATE_LABEL = {
  valid: '有效',
  unreadable: '不可读',
  missing: '不存在',
  pending: '未检测',
} as const

export default function LogExportPanel(props: ILogExportPanelProps) {
  const [newPath, setNewPath] = useState('')
  const [outputDirDraft, setOutputDirDraft] = useState(props.outputDir)

  useEffect(() => {
    setOutputDirDraft(props.outputDir)
  }, [props.outputDir])

  const paths = props.pathConfig?.paths ?? []
  const selected = props.pathConfig?.selected ?? null

  function submitAddPath() {
    const path = newPath.trim()
    if (path) {
      props.onAddPath(path)
      setNewPath('')
    }
  }

  function submitOutputDir() {
    const dir = outputDirDraft.trim()
    if (dir) {
      props.onSetOutputDir(dir)
    }
  }

  async function editPath(path: string) {
    const next = await LunaModal.prompt('修改路径', path)
    if (next && next.trim() && next.trim() !== path) {
      props.onModifyPath(path, next.trim())
    }
  }

  return (
    <div className={Style.overlay}>
      <div className={Style.dialog}>
        <div className={Style.header}>
          <div>
            <h2 className={Style.title}>日志管理</h2>
            <p className={Style.subtitle}>
              配置当前设备的日志导出路径与平台识别
            </p>
          </div>
          <button
            className={Style.close}
            title="关闭"
            aria-label="关闭"
            onClick={props.onClose}
          >
            x
          </button>
        </div>

        <div className={Style.body}>
          <section className={Style.section}>
            <h3 className={Style.sectionTitle}>设备与平台</h3>
            <dl>
              <div className={Style.infoRow}>
                <dt>当前设备</dt>
                <dd>{props.deviceName || '未连接'}</dd>
              </div>
              <div className={Style.infoRow}>
                <dt>当前芯片平台</dt>
                <dd>
                  <span className={Style.platformBadge}>
                    {platformLabel(props.platform)}
                  </span>
                </dd>
              </div>
              <div className={Style.infoRow}>
                <dt>自动识别结果</dt>
                <dd>
                  {platformLabel(props.detected)}
                  {props.detectedKeyword ? ` · ${props.detectedKeyword}` : ''}
                </dd>
              </div>
            </dl>

            <div className={Style.controls}>
              <label className={Style.toggle}>
                <input
                  type="checkbox"
                  checked={props.autoDetect}
                  onChange={(e) => props.onToggleAutoDetect(e.target.checked)}
                />
                自动识别平台
              </label>
              <button
                className={className(Style.platformButton, {
                  [Style.active]: props.manualPlatform === 'mtk',
                })}
                disabled={props.autoDetect}
                onClick={() => props.onSelectPlatform('mtk')}
              >
                MTK
              </button>
              <button
                className={className(Style.platformButton, {
                  [Style.active]: props.manualPlatform === 'unisoc',
                })}
                disabled={props.autoDetect}
                onClick={() => props.onSelectPlatform('unisoc')}
              >
                UNISOC
              </button>
              <span style={{ marginLeft: 'auto' }} />
              <button
                className={Style.smallButton}
                onClick={props.onRefreshValidity}
              >
                重新检测路径
              </button>
            </div>
          </section>

          <section className={Style.section}>
            <h3 className={Style.sectionTitle}>日志路径</h3>
            {paths.length === 0 ? (
              <p className={Style.hint}>尚未配置日志路径，请添加。</p>
            ) : (
              <div className={Style.pathList}>
                {paths.map((path) => {
                  const state = pathState(path, props.pathValidity)
                  return (
                    <div className={Style.pathRow} key={path}>
                      <button
                        className={Style.pathName}
                        title="点击设为使用路径"
                        onClick={() => props.onSelectPath(path)}
                      >
                        {path}
                      </button>
                      <span
                        className={className(Style.pathState, Style[state])}
                      >
                        {PATH_STATE_LABEL[state]}
                      </span>
                      {selected === path && (
                        <span className={Style.selectedMark}>使用中</span>
                      )}
                      <button
                        className={Style.smallButton}
                        title="编辑路径"
                        onClick={() => editPath(path)}
                      >
                        编辑
                      </button>
                      <button
                        className={className(Style.smallButton, Style.danger)}
                        title="删除路径"
                        onClick={() => props.onRemovePath(path)}
                      >
                        删除
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
            <div className={Style.addForm}>
              <input
                value={newPath}
                placeholder="/sdcard/debuglogger/"
                onChange={(e) => setNewPath(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    submitAddPath()
                  }
                }}
              />
              <button className={Style.smallButton} onClick={submitAddPath}>
                添加路径
              </button>
              <button
                className={className(Style.smallButton, Style.danger)}
                onClick={props.onRestoreDefaults}
              >
                恢复默认
              </button>
            </div>
          </section>

          <section className={Style.section}>
            <h3 className={Style.sectionTitle}>本地导出目录</h3>
            <div className={Style.outputForm}>
              <input
                value={outputDirDraft}
                onChange={(e) => setOutputDirDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    submitOutputDir()
                  }
                }}
              />
              <button className={Style.smallButton} onClick={submitOutputDir}>
                保存
              </button>
            </div>
          </section>
        </div>

        <div className={Style.footer}>
          <span />
          <button className={Style.smallButton} onClick={props.onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  )
}
