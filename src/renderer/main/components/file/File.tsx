import { observer } from 'mobx-react-lite'
import LunaToolbar, {
  LunaToolbarHtml,
  LunaToolbarInput,
  LunaToolbarSeparator,
} from 'luna-toolbar/react'
import LunaFileList from './FileList'
import ToolbarIcon from 'share/renderer/components/ToolbarIcon'
import { useEffect, useRef, useState } from 'react'
import Style from './File.module.scss'
import store from '../../store'
import { t } from 'common/util'
import { notify, isFileDrop } from 'share/renderer/lib/util'
import FileList, { IFile } from 'luna-file-list'
import { IncrementalSearch, isSearchChar } from './lib/incrementalSearch'
import {
  deselect,
  getInternals,
  getItems,
  getSelectedIndex,
  pageStep,
  selectIndex,
} from './lib/fileNav'
import { hasOpenModal, isControlTarget, isEditableTarget } from './lib/keyTarget'
import className from 'licia/className'
import isEmpty from 'licia/isEmpty'
import splitPath from 'licia/splitPath'
import contextMenu from 'share/renderer/lib/contextMenu'
import LunaModal from 'luna-modal'
import endWith from 'licia/endWith'
import normalizePath from 'licia/normalizePath'
import LunaPathBar from 'luna-path-bar/react'
import startWith from 'licia/startWith'
import LunaSplitPane, { LunaSplitPaneItem } from 'luna-split-pane/react'
import Transfer from './Transfer'
import FilePreview from 'share/renderer/components/FilePreview'

/**
 * 会自己消费按键的导航键：焦点在按钮等控件上时要让给它们，
 * 否则在工具栏按钮上按回车会被文件列表抢走。
 */
function isNavKey(key: string) {
  switch (key) {
    case 'ArrowDown':
    case 'ArrowUp':
    case 'Home':
    case 'End':
    case 'PageDown':
    case 'PageUp':
    case 'Enter':
    case 'Backspace':
    case 'Escape':
      return true
  }
  return false
}

export default observer(function File() {
  const [fileList, setFileList] = useState<IFile[]>([])
  const [path, setPath] = useState('')
  const [customPath, setCustomPath] = useState('')
  const [filter, setFilter] = useState('')
  const [dropHighlight, setDropHighlight] = useState(false)
  const [history, setHistory] = useState<string[]>([])
  const [historyIdx, setHistoryIdx] = useState(-1)
  const [selected, setSelected] = useState<IFile | undefined>()
  const [selectedUrl, setSelectedUrl] = useState<string>('')
  const draggingRef = useRef(0)
  const fileListRef = useRef<FileList | null>(null)
  const searchRef = useRef(new IncrementalSearch())
  // 键盘选中是异步取预览地址的，连续移动时只认最后一次
  const selectTokenRef = useRef(0)
  // 监听只注册一次，用 ref 拿到最新一次渲染的处理器，避免闭包读到旧的 path/filter
  const handlersRef = useRef<{ keydown: (e: KeyboardEvent) => void }>({
    keydown: () => {},
  })

  const { device, file } = store

  useEffect(() => {
    go('/')
  }, [])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => handlersRef.current.keydown(e)

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  async function getFiles(path: string) {
    if (device) {
      const files: IFile[] = await main.readDir(device.id, path)
      for (let i = 0, len = files.length; i < len; i++) {
        const file = files[i]
        if (!file.directory) {
          const ext = splitPath(file.name).ext
          const type = file.mime
          if (
            !type ||
            (!startWith(type, 'image') &&
              !startWith(type, 'text') &&
              !startWith(type, 'video') &&
              !startWith(type, 'audio'))
          ) {
            file.thumbnail = await main.getFileIcon(ext)
          }
        }
      }
      setPath(path)
      setCustomPath(path)
      setFileList(files)
      setFilter('')
      searchRef.current.reset()
    }
  }

  function fileExist(name: string) {
    for (let i = 0, len = fileList.length; i < len; i++) {
      if (fileList[i].name === name) {
        return true
      }
    }

    return false
  }

  async function back() {
    if (historyIdx <= 0) {
      return
    }
    await getFiles(history[historyIdx - 1])
    setHistoryIdx(historyIdx - 1)
  }

  async function forward() {
    if (historyIdx >= history.length - 1) {
      return
    }
    await getFiles(history[historyIdx + 1])
    setHistoryIdx(historyIdx + 1)
  }

  async function go(p: string) {
    await getFiles(p)
    setHistory([...history.slice(0, historyIdx + 1), p])
    setHistoryIdx(historyIdx + 1)
  }

  async function up() {
    await go(path.split('/').slice(0, -2).join('/') + '/')
  }

  async function open(file: IFile) {
    if (!device) {
      return
    }

    if (file.directory) {
      go(path + file.name + '/')
      return
    }

    if (file.mime) {
      const url = await main.getFileUrl(device.id, path + file.name)
      if (file.mime === 'application/pdf') {
        main.openWindow(url, 'pdf', {
          minHeight: 640,
          minWidth: 450,
          width: 450,
          height: 640,
        })
        return
      } else if (startWith(file.mime, 'video')) {
        main.showVideo(url)
        return
      }
    }

    notify(t('fileDownloading', { path: path + file.name }), { icon: 'info' })
    main.openFile(device.id, path + file.name)
  }

  /** 列表当前能响应键盘吗：文件页可见、有设备、没有弹窗 */
  function canHandleKeys() {
    return store.panel === 'file' && !!device && !hasOpenModal()
  }

  /** 当前显示的项 + 内部结构，拿不到就返回 null */
  function getVisible() {
    const internals = getInternals(fileListRef.current)
    if (!internals) {
      return null
    }
    const listView = file.listView
    const items = getItems(internals, listView)
    if (isEmpty(items)) {
      return null
    }
    return { internals, listView, items }
  }

  /**
   * 输入定位（Windows 资源管理器式）：
   * 敲 b 跳到第一个 b 开头的项，接着敲 c、a 收窄到 bca…，连按同一个键则在
   * b… 之间轮换；停手超过 600ms 缓冲重置，下一次敲字重新开始。
   */
  function onTypeAhead(text: string) {
    if (!canHandleKeys()) {
      return
    }
    const visible = getVisible()
    if (!visible) {
      return
    }

    const { internals, listView, items } = visible
    const search = searchRef.current
    const now = Date.now()
    let buffer = ''
    for (let i = 0, len = text.length; i < len; i++) {
      buffer = search.push(text[i], now)
    }
    if (!buffer) {
      return
    }

    const index = search.find(
      items.map((item) => item.name),
      getSelectedIndex(internals, listView)
    )
    if (index !== -1) {
      selectIndex(internals, listView, index)
    }
  }

  function onKeyDown(e: KeyboardEvent) {
    if (!canHandleKeys()) {
      return
    }
    if (e.ctrlKey || e.altKey || e.metaKey) {
      return
    }
    // 输入法组合过程中不插手：这时拿不到最终字符，按键也不是用户想搜索的内容
    if (e.isComposing || e.key === 'Process' || e.keyCode === 229) {
      return
    }
    if (isEditableTarget(e.target)) {
      return
    }
    if (isNavKey(e.key) && isControlTarget(e.target)) {
      return
    }

    const visible = getVisible()
    if (!visible) {
      return
    }
    const { internals, listView, items } = visible
    const search = searchRef.current
    const current = getSelectedIndex(internals, listView)

    function select(index: number) {
      selectIndex(internals, listView, index)
    }

    function moveBy(delta: number) {
      if (current === -1) {
        // 没选中时：下键选第一项，上键选最后一项
        select(delta > 0 ? 0 : items.length - 1)
        return
      }
      const next = Math.min(Math.max(current + delta, 0), items.length - 1)
      if (next !== current) {
        select(next)
      }
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        moveBy(1)
        return
      case 'ArrowUp':
        e.preventDefault()
        moveBy(-1)
        return
      case 'Home':
        e.preventDefault()
        select(0)
        return
      case 'End':
        e.preventDefault()
        select(items.length - 1)
        return
      case 'PageDown':
        e.preventDefault()
        moveBy(pageStep(internals, listView))
        return
      case 'PageUp':
        e.preventDefault()
        moveBy(-pageStep(internals, listView))
        return
      case 'Enter':
        e.preventDefault()
        if (current !== -1) {
          open(items[current])
        }
        return
      case 'Backspace':
        e.preventDefault()
        search.reset()
        if (path !== '/') {
          up()
        }
        return
      case 'Escape':
        e.preventDefault()
        search.reset()
        deselect(internals, listView)
        return
    }

    if (!isSearchChar(e.key)) {
      return
    }
    e.preventDefault()
    onTypeAhead(e.key)
  }

  // 每次渲染都把最新处理器挂到 ref 上（监听只在挂载时注册一次）
  handlersRef.current.keydown = onKeyDown

  function onContextMenu(e: MouseEvent, file?: IFile) {
    if (!device) {
      return
    }

    if (file) {
      const template: any[] = [
        {
          label: t('open'),
          click: () => open(file),
        },
        {
          label: t('download'),
          click: async () => {
            const { canceled, filePaths } = await main.showOpenDialog({
              properties: ['openDirectory'],
            })
            if (canceled) {
              return
            }
            const dest = filePaths[0] + '/' + file.name
            notify(t('fileDownloading', { path: path + file.name }), {
              icon: 'info',
            })
            await main.pullFile(device.id, path + file.name, dest)
            notify(t('fileDownloaded', { path: dest }), {
              icon: 'success',
              duration: 5000,
            })
          },
        },
        {
          type: 'separator',
        },
        {
          label: t('delete'),
          click: async () => {
            const result = await LunaModal.confirm(
              t('deleteFileConfirm', { name: file.name })
            )
            if (result) {
              const filePath = path + file.name
              if (file.directory) {
                await main.deleteDir(device.id, filePath)
              } else {
                await main.deleteFile(device.id, filePath)
              }
              getFiles(path)
            }
          },
        },
        {
          label: t('rename'),
          click: async () => {
            const name = await LunaModal.prompt(
              t(file.directory ? 'newFolderName' : 'newFileName'),
              file.name
            )
            if (name && name !== file.name) {
              if (fileExist(name)) {
                notify(t('fileExistErr', { name }), { icon: 'error' })
                return
              }
              await main.moveFile(device.id, path + file.name, path + name)
              getFiles(path)
            }
          },
        },
      ]
      contextMenu(e, template)
    } else {
      const template: any[] = [
        {
          label: t('upload'),
          click: uploadFiles,
        },
        {
          label: t('newFolder'),
          click: async () => {
            const name = await LunaModal.prompt(t('newFolderName'))
            if (name) {
              await main.createDir(device.id, path + name)
              getFiles(path)
            }
          },
        },
        {
          label: t('refresh'),
          click: () => getFiles(path),
        },
      ]
      contextMenu(e, template)
    }
  }

  async function onDrop(e: React.DragEvent) {
    e.preventDefault()
    setDropHighlight(false)
    const files = e.dataTransfer.files
    const apkPaths: string[] = []
    for (let i = 0, len = files.length; i < len; i++) {
      apkPaths.push(preload.getPathForFile(files[i]))
    }
    await uploadFiles(apkPaths)
  }

  async function uploadFiles(files?: string[]) {
    if (!device) {
      return
    }

    if (!files) {
      const { filePaths } = await main.showOpenDialog({
        properties: ['openFile', 'multiSelections'],
      })
      if (isEmpty(filePaths)) {
        return
      }
      files = filePaths
    }

    for (let i = 0, len = files!.length; i < len; i++) {
      const file = files![i]
      const { name } = splitPath(file)
      notify(t('fileUploading', { path: file }), { icon: 'info' })
      try {
        await main.pushFile(device.id, file, path + name)
      } catch {
        notify(t('uploadFileErr'), { icon: 'error' })
      }
    }

    await getFiles(path)
  }

  async function goCustomPath(p: string) {
    if (!endWith(p, '/')) {
      p = p + '/'
    }
    p = normalizePath(p)
    if (p === customPath) {
      return
    }

    setCustomPath(p)

    try {
      const stat = await main.statFile(device!.id, p)
      if (stat.directory) {
        go(p)
      } else {
        setCustomPath(customPath)
      }
    } catch {
      setCustomPath(customPath)
      notify(t('folderNotExistErr'), { icon: 'error' })
    }
  }

  return (
    <div className="panel-with-toolbar">
      <LunaToolbar className="panel-toolbar">
        <ToolbarIcon
          icon="bidirection"
          title={t('transfer')}
          className={className({
            [Style.blink]: !isEmpty(file.transfers),
          })}
          state={file.showTransfer ? 'hover' : ''}
          onClick={() => {
            file.set('showTransfer', !file.showTransfer)
          }}
        />
        <LunaToolbarSeparator />
        <ToolbarIcon
          icon="arrow-left"
          title={t('back')}
          onClick={back}
          disabled={historyIdx <= 0}
        />
        <ToolbarIcon
          icon="arrow-right"
          title={t('forward')}
          onClick={forward}
          disabled={historyIdx >= history.length - 1}
        />
        <ToolbarIcon
          icon="arrow-up"
          title={t('up')}
          onClick={up}
          disabled={path === '/' || !device}
        />
        <ToolbarIcon
          icon="refresh"
          title={t('refresh')}
          onClick={() => getFiles(path)}
          disabled={!device}
        />
        <LunaToolbarHtml className={Style.pathContainer} disabled={!device}>
          <LunaPathBar
            className={Style.path}
            rootLabel={t('storage')}
            path={customPath}
            onChange={(path) => goCustomPath('/' + path)}
          />
        </LunaToolbarHtml>
        <LunaToolbarInput
          keyName="filter"
          value={filter}
          placeholder={t('filter')}
          onChange={(val) => setFilter(val)}
        />
        <LunaToolbarSeparator />
        <ToolbarIcon
          icon="grid"
          title={t('iconView')}
          state={file.listView ? '' : 'hover'}
          onClick={() => {
            if (file.listView) {
              searchRef.current.reset()
              file.set('listView', false)
            }
          }}
        />
        <ToolbarIcon
          icon="list"
          title={t('listView')}
          state={file.listView ? 'hover' : ''}
          onClick={() => {
            if (!file.listView) {
              searchRef.current.reset()
              file.set('listView', true)
            }
          }}
        />
        <LunaToolbarSeparator />
        <ToolbarIcon
          icon="eye"
          title={t('preview')}
          state={file.showPreview ? 'hover' : ''}
          onClick={() => {
            file.set('showPreview', !file.showPreview)
          }}
        />
      </LunaToolbar>
      <LunaSplitPane
        direction="vertical"
        onResize={(weights) => {
          const [fileListWeight, transferWeight] = weights
          file.set(
            'transferWeight',
            (transferWeight / (fileListWeight + transferWeight)) * 100
          )
        }}
      >
        <LunaSplitPaneItem minSize={200} weight={100 - file.transferWeight}>
          <LunaSplitPane onResize={(weights) => file.set('weights', weights)}>
            <LunaSplitPaneItem minSize={400} weight={file.weights[0]}>
              <div
                onDrop={onDrop}
                onDragEnter={() => {
                  draggingRef.current++
                }}
                onDragLeave={() => {
                  draggingRef.current--
                  if (draggingRef.current === 0) {
                    setDropHighlight(false)
                  }
                }}
                onDragOver={(e) => {
                  if (!isFileDrop(e)) {
                    return
                  }
                  e.preventDefault()
                  if (device) {
                    setDropHighlight(true)
                  }
                }}
                className={className('panel-body', {
                  [Style.highlight]: dropHighlight,
                })}
              >
                <LunaFileList
                  className={Style.fileList}
                  files={fileList}
                  filter={filter}
                  columns={['name', 'mode', 'mtime', 'type', 'size']}
                  listView={file.listView}
                  onCreate={(fl) => {
                    fileListRef.current = fl
                  }}
                  onDoubleClick={(e: MouseEvent, file: IFile) => open(file)}
                  onContextMenu={onContextMenu}
                  onSelect={async (file: IFile) => {
                    const token = ++selectTokenRef.current
                    const url = await main.getFileUrl(
                      device!.id,
                      path + file.name
                    )
                    // 键盘连续移动时会有多次请求在飞，只认最后一次
                    if (token !== selectTokenRef.current) {
                      return
                    }
                    setSelectedUrl(url)
                    setSelected(file)
                  }}
                  onDeselect={() => {
                    selectTokenRef.current++
                    setSelectedUrl('')
                    setSelected(undefined)
                  }}
                />
              </div>
            </LunaSplitPaneItem>
            <LunaSplitPaneItem
              minSize={180}
              weight={file.weights[1]}
              visible={file.showPreview}
            >
              <FilePreview
                file={file.showPreview ? selected : undefined}
                url={selectedUrl}
              />
            </LunaSplitPaneItem>
          </LunaSplitPane>
        </LunaSplitPaneItem>
        <LunaSplitPaneItem
          className={Style.transfer}
          minSize={150}
          weight={file.transferWeight}
          visible={file.showTransfer}
        >
          <Transfer />
        </LunaSplitPaneItem>
      </LunaSplitPane>
    </div>
  )
})
