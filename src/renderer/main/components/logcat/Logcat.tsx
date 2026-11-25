import { observer } from 'mobx-react-lite'
import LunaToolbar, {
  LunaToolbarSelect,
  LunaToolbarSeparator,
  LunaToolbarSpace,
} from 'luna-toolbar/react'
import LunaLogcat from 'luna-logcat/react'
import Logcat from 'luna-logcat'
import map from 'licia/map'
import rpad from 'licia/rpad'
import dateFormat from 'licia/dateFormat'
import toNum from 'licia/toNum'
import trim from 'licia/trim'
import { useEffect, useMemo, useRef, useState } from 'react'
import store from '../../store'
import copy from 'licia/copy'
import download from 'licia/download'
import toStr from 'licia/toStr'
import { t } from 'common/util'
import { IMtkLogCaptureResult, IpcLogSource } from 'common/types'
import ToolbarIcon from 'share/renderer/components/ToolbarIcon'
import contextMenu from 'share/renderer/lib/contextMenu'
import { notify } from 'share/renderer/lib/util'
import LunaModal from 'luna-modal'
import Style from './Logcat.module.scss'
import className from 'licia/className'

const KERNEL_FILTERS = [
  ['\u5145\u7535', 'charger|battery|typec|usb|sgm|mtk_pbm'],
  ['\u6444\u50cf\u5934', 'camera|sensor|imgsensor|cam_cal|isp|mipi'],
  ['TP', 'touch|tp|goodix|focaltech|fts|synaptics'],
  ['LCD', 'lcd|lcm|panel|display|dsi|drm|backlight'],
  ['\u97f3\u9891', 'audio|codec|speaker|headset|aw87'],
  ['\u4f11\u7720', 'suspend|resume|wakeup|sleep'],
  ['\u5f02\u5e38', 'panic|oops|watchdog|hang|fatal'],
] as const

const DEFAULT_MTK_LOG_OUTPUT_DIR = 'D:\\AYA_LOG'
const MTK_LOG_OUTPUT_DIR_STORAGE_KEY = 'aya.logcat.mtkLogOutputDir'

// Rows kept in the logcat widget (must match the maxNum passed to LunaLogcat).
const MAX_RENDER_ENTRIES = 10000
// Entries retained in memory for exporting and for rebuilding the filtered view.
// Kernel streams can produce thousands of lines per second, so this is a hard
// cap: past it the oldest entries are dropped (and reported to the user).
const MAX_BUFFERED_ENTRIES = 100000
// Upper bound of rows appended per animation frame, so a burst can never block
// the main thread for longer than a frame.
const DRAIN_PER_FRAME = 500
// Debounce for the kernel keyword box; rebuilding on every keystroke is O(N).
const KEYWORD_DEBOUNCE = 250

/**
 * Array-backed queue with an O(1) amortised dequeue and a hard capacity.
 * It replaces the previous unbounded `entriesRef` array, which grew without
 * limit and made every full rebuild slower the longer a capture ran.
 */
class BoundedQueue<T> {
  private items: T[] = []
  private head = 0
  private dropped = 0
  constructor(private cap: number) {}
  get length() {
    return this.items.length - this.head
  }
  get droppedCount() {
    return this.dropped
  }
  push(item: T) {
    this.items.push(item)
    const overflow = this.length - this.cap
    if (overflow > 0) {
      this.head += overflow
      this.dropped += overflow
      this.compact()
    }
  }
  take(n: number): T[] {
    const end = Math.min(this.items.length, this.head + n)
    if (end <= this.head) {
      return []
    }
    const out = this.items.slice(this.head, end)
    this.head = end
    this.compact()
    return out
  }
  /** Newest-first scan that stops once `n` matches are collected. */
  recent(n: number, predicate: (item: T) => boolean): T[] {
    const out: T[] = []
    for (let i = this.items.length - 1; i >= this.head && out.length < n; i--) {
      if (predicate(this.items[i])) {
        out.push(this.items[i])
      }
    }
    out.reverse()
    return out
  }
  toArray(): T[] {
    return this.items.slice(this.head)
  }
  clear() {
    this.items = []
    this.head = 0
    this.dropped = 0
  }
  private compact() {
    if (this.head >= 8192 && this.head * 2 >= this.items.length) {
      this.items = this.items.slice(this.head)
      this.head = 0
    }
  }
}

function parseKernelKeywords(keyword: string): string[] {
  return keyword
    .toLowerCase()
    .split(/[|,\s]+/)
    .filter(Boolean)
}

function matchKernelEntry(entry: any, keywords: string[]): boolean {
  if (!keywords.length) {
    return true
  }

  const message = `${entry.tag || ''} ${entry.message || ''}`.toLowerCase()
  return keywords.some((keyword) => message.includes(keyword))
}

/**
 * Append one entry and stamp the widget's internal entry object onto its DOM
 * node. Double-click copy then resolves the row by element identity instead of
 * a mirrored index, which used to drift as soon as the widget trimmed rows.
 */
function appendEntry(logcat: any, entry: any) {
  logcat.append(entry)
  const internal = logcat.entries?.[logcat.entries.length - 1]
  if (internal?.container) {
    internal.container.__ayaEntry = internal
  }
}

export default observer(function Logcat() {
  const [source, setSource] = useState<IpcLogSource>('logcat')
  const [view, setView] = useState<'compact' | 'standard'>('standard')
  const [softWrap, setSoftWrap] = useState(false)
  const [paused, setPaused] = useState(false)
  const [kernelKeyword, setKernelKeyword] = useState('')
  const [filter, setFilter] = useState<{
    priority?: number
    package?: string
    tag?: string
  }>({})
  const [mtkRunning, setMtkRunning] = useState(false)
  const [mtkResult, setMtkResult] = useState<IMtkLogCaptureResult | null>(null)
  const [mtkStatus, setMtkStatus] = useState('')
  const [mtkOutputDir, setMtkOutputDir] = useState(loadMtkOutputDir)
  const [logcatId, setLogcatId] = useState('')
  const logcatRef = useRef<Logcat>(null)
  const logcatIdRef = useRef('')
  const filterRef = useRef(filter)
  // Retained history (export + keyword rebuild) and the render backlog.
  const historyRef = useRef(new BoundedQueue<any>(MAX_BUFFERED_ENTRIES))
  const pendingRef = useRef(new BoundedQueue<any>(MAX_RENDER_ENTRIES))
  const rafRef = useRef(0)
  const renderPausedRef = useRef(store.panel !== 'logcat')
  const kernelKeywordsRef = useRef<string[]>([])
  const kernelLikeRef = useRef(false)
  const viewUserSetRef = useRef(false)

  const { device } = store
  // Kernel view semantics apply to both the 'kernel' and 'mtklog' sources
  // (mtklog = live kernel log capture with explicit start/stop/export).
  const kernelLike = source === 'kernel' || source === 'mtklog'
  kernelLikeRef.current = kernelLike

  // A fresh filter object on every render would make luna-logcat re-filter and
  // rebuild its whole virtual list on every render, so keep the identity stable.
  const logcatFilter = useMemo(
    () => (kernelLike ? { priority: filter.priority } : filter),
    [kernelLike, filter]
  )

  useEffect(() => {
    function onLogcatEntries(id: string, entries: any[]) {
      if (logcatIdRef.current !== id) {
        return
      }
      ingest(entries)
    }
    const offLogcatEntries = main.on('logcatEntries', onLogcatEntries)
    // Auto-open only for logcat/kernel; 'mtklog' waits for an explicit start.
    if (device && (source === 'logcat' || source === 'kernel')) {
      main.openLogcat(device.id, source).then((id) => updateLogcatId(id))
    }

    return () => {
      offLogcatEntries()
      if (logcatIdRef.current) {
        main.closeLogcat(logcatIdRef.current)
        updateLogcatId('')
      }
      pendingRef.current.clear()
      stopDrain()
    }
  }, [source])

  useEffect(() => {
    const off = main.on('mtklogProgress', ({ message }) => {
      setMtkStatus(message)
    })
    return () => {
      off()
    }
  }, [])

  useEffect(() => {
    kernelKeywordsRef.current = parseKernelKeywords(kernelKeyword)
    if (!kernelLike) {
      return
    }
    // Rebuilding walks the retained history, so debounce it.
    const timer = setTimeout(() => rebuildVisibleEntries(), KEYWORD_DEBOUNCE)
    return () => clearTimeout(timer)
  }, [kernelKeyword, kernelLike])

  useEffect(() => {
    filterRef.current = filter
  }, [filter])

  // Hidden panels stay mounted (opacity 0), so the virtual list would keep
  // doing full layout work for a page the user is not looking at. Capture
  // semantics are unchanged (mtklog keeps running, others are paused by the
  // effect below); only the rendering is suspended, and it is rebuilt from
  // history when the panel comes back.
  useEffect(() => {
    const hidden = store.panel !== 'logcat'
    const wasHidden = renderPausedRef.current
    renderPausedRef.current = hidden
    if (hidden) {
      pendingRef.current.clear()
      stopDrain()
    } else if (wasHidden) {
      rebuildVisibleEntries()
    }
  }, [store.panel])

  // Pausing/resuming used to happen in the render body, i.e. an IPC round trip
  // on every render. Do it only when the relevant state actually changes.
  useEffect(() => {
    if (!logcatId || paused || source === 'mtklog') {
      return
    }
    if (store.panel === 'logcat') {
      main.resumeLogcat(logcatId)
    } else {
      main.pauseLogcat(logcatId)
    }
  }, [logcatId, paused, source, store.panel])

  function updateLogcatId(id: string) {
    logcatIdRef.current = id
    setLogcatId(id)
  }

  function stopDrain() {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = 0
    }
  }

  function scheduleDrain() {
    if (rafRef.current) {
      return
    }
    rafRef.current = requestAnimationFrame(drain)
  }

  function drain() {
    rafRef.current = 0
    const logcat = logcatRef.current
    if (!logcat || renderPausedRef.current) {
      return
    }
    const batch = pendingRef.current.take(DRAIN_PER_FRAME)
    for (let i = 0, len = batch.length; i < len; i++) {
      appendEntry(logcat, batch[i])
    }
    if (pendingRef.current.length) {
      scheduleDrain()
    }
  }

  /** Buffer a batch from the main process; rendering is deferred and bounded. */
  function ingest(entries: any[]) {
    const history = historyRef.current
    const pending = pendingRef.current
    const filterKernel = kernelLikeRef.current
    const keywords = kernelKeywordsRef.current
    const hidden = renderPausedRef.current
    for (let i = 0, len = entries.length; i < len; i++) {
      const entry = entries[i]
      history.push(entry)
      if (hidden) {
        continue
      }
      if (filterKernel && !matchKernelEntry(entry, keywords)) {
        continue
      }
      pending.push(entry)
    }
    if (pending.length) {
      scheduleDrain()
    }
  }

  /**
   * Replace the visible rows with the newest matching entries from history.
   * Scanning newest-first keeps the work bounded by the row cap instead of
   * walking the entire (up to 100k) history.
   */
  function rebuildVisibleEntries() {
    const logcat = logcatRef.current
    // While the panel is hidden the pending effect rebuilds on the way back.
    if (!logcat || renderPausedRef.current) {
      return
    }
    pendingRef.current.clear()
    stopDrain()
    logcat.clear()
    const filterKernel = kernelLikeRef.current
    const keywords = kernelKeywordsRef.current
    const entries = historyRef.current.recent(MAX_RENDER_ENTRIES, (entry) =>
      filterKernel ? matchKernelEntry(entry, keywords) : true
    )
    for (let i = 0, len = entries.length; i < len; i++) {
      appendEntry(logcat, entries[i])
    }
    if (entries.length) {
      logcat.scrollToEnd()
    }
  }

  function bufferedText() {
    return map(historyRef.current.toArray(), (entry) => {
      return formatEntry(entry)
    }).join('\n')
  }

  function save() {
    download(
      bufferedText(),
      `${store.device ? store.device.name : 'logcat'}.${dateFormat(
        'yyyymmddHH'
      )}.txt`,
      'text/plain'
    )
  }

  function clear() {
    pendingRef.current.clear()
    historyRef.current.clear()
    stopDrain()
    if (logcatRef.current) {
      logcatRef.current.clear()
    }
  }

  async function startMtkCapture() {
    if (!device || mtkRunning) {
      return
    }
    setMtkRunning(true)
    setMtkResult(null)
    setMtkStatus('\u6b63\u5728\u542f\u52a8\u91c7\u96c6...')
    try {
      // 1) adb root + (best effort) kick on-device MTKLogger
      const res = await main.startMtkLog(device.id)
      // 2) open the live kernel log stream shown in this panel
      clear()
      if (logcatIdRef.current) {
        await main.closeLogcat(logcatIdRef.current)
        updateLogcatId('')
      }
      const id = await main.openLogcat(device.id, 'kernel')
      updateLogcatId(id)
      setMtkStatus(
        res.hasMtkLogger
          ? '\u25cf \u91c7\u96c6\u4e2d\uff08\u8bbe\u5907\u7aef MobileLog \u5df2\u542f\u52a8\uff09'
          : '\u25cf \u91c7\u96c6\u4e2d\uff08\u76f4\u63a5\u5185\u6838\u6d41\uff09'
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setMtkStatus(`\u542f\u52a8\u5931\u8d25: ${message}`)
      notify(`\u542f\u52a8\u5931\u8d25: ${message}`, { icon: 'error' })
      setMtkRunning(false)
    }
  }

  async function stopMtkExport() {
    if (!device || !mtkRunning) {
      return
    }
    setMtkStatus('\u6b63\u5728\u505c\u6b62\u5e76\u5bfc\u51fa...')
    try {
      if (logcatIdRef.current) {
        await main.closeLogcat(logcatIdRef.current)
        updateLogcatId('')
      }
      const dropped = historyRef.current.droppedCount
      const result = await main.stopMtkLog(
        device.id,
        mtkOutputDir,
        bufferedText()
      )
      setMtkResult(result)
      setMtkStatus(`\u25cb \u5df2\u5bfc\u51fa: ${result.outputDir}`)
      notify(
        dropped
          ? `\u5df2\u505c\u6b62\u5e76\u5bfc\u51fa\uff08\u65e9\u4e8e\u6700\u8fd1 ${MAX_BUFFERED_ENTRIES} \u6761\u7684 ${dropped} \u6761\u672a\u4fdd\u7559\uff09`
          : '\u5df2\u505c\u6b62\u5e76\u5bfc\u51fa',
        { icon: 'success' }
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setMtkStatus(`\u5bfc\u51fa\u5931\u8d25: ${message}`)
      notify(`\u5bfc\u51fa\u5931\u8d25: ${message}`, { icon: 'error' })
    } finally {
      setMtkRunning(false)
    }
  }

  function openMtkDir() {
    if (mtkResult) {
      main.openPath(mtkResult.outputDir)
    }
  }

  const onContextMenu = (e: PointerEvent, entry: any) => {
    e.preventDefault()
    const logcat = logcatRef.current!
    const template: any[] = [
      {
        label: t('copy'),
        click: () => {
          if (logcat.hasSelection()) {
            copy(logcat.getSelection())
          } else if (entry) {
            copy(formatEntry(entry))
          }
        },
      },
      {
        type: 'separator',
      },
      {
        label: t('clear'),
        click: clear,
      },
    ]

    contextMenu(e, template)
  }

  function onSourceChange(val: IpcLogSource) {
    if (val !== source && mtkRunning) {
      setMtkRunning(false)
    }
    setSource(val)
    clear()
    if (logcatIdRef.current) {
      main.closeLogcat(logcatIdRef.current)
      updateLogcatId('')
    }
    // Kernel/MTK streams are far denser than logcat, so unless the user has
    // picked a view explicitly, default them to the lighter compact view.
    if (!viewUserSetRef.current) {
      setView(val === 'logcat' ? 'standard' : 'compact')
    }
  }

  return (
    <div className="panel-with-toolbar">
      <LunaToolbar
        className="panel-toolbar"
        onChange={(key, val) => {
          switch (key) {
            case 'source':
              onSourceChange(val)
              break
            case 'view':
              viewUserSetRef.current = true
              setView(val)
              break
            case 'priority':
              setFilter({
                ...filterRef.current,
                priority: toNum(val),
              })
              break
          }
        }}
      >
        <LunaToolbarSelect
          keyName="source"
          disabled={!device}
          value={source}
          options={{
            Logcat: 'logcat',
            Kernel: 'kernel',
            'MTK Log': 'mtklog',
          }}
        />
        <LunaToolbarSeparator />
        {source === 'mtklog' ? (
          <>
            <LunaToolbarSpace />
          </>
        ) : (
          <>
            <LunaToolbarSelect
              keyName="view"
              disabled={!device}
              value={view}
              options={{
                [t('standardView')]: 'standard',
                [t('compactView')]: 'compact',
              }}
            />
            <LunaToolbarSeparator />
            <LunaToolbarSelect
              keyName="priority"
              disabled={!device}
              value={toStr(filter.priority || 2)}
              options={{
                VERBOSE: '2',
                DEBUG: '3',
                INFO: '4',
                WARNING: '5',
                ERROR: '6',
              }}
            />
            {source === 'logcat' && (
              <>
                <FilterInput
                  placeholder={t('package')}
                  value={filter.package || ''}
                  onChange={(val) =>
                    setFilter({
                      ...filterRef.current,
                      package: val,
                    })
                  }
                />
                <FilterInput
                  placeholder={t('tag')}
                  value={filter.tag || ''}
                  onChange={(val) =>
                    setFilter({
                      ...filterRef.current,
                      tag: val,
                    })
                  }
                />
              </>
            )}
            <LunaToolbarSpace />
            <ToolbarIcon
              icon="save"
              title={t('save')}
              onClick={save}
              disabled={!device}
            />
            <LunaToolbarSeparator />
            <ToolbarIcon
              icon="soft-wrap"
              state={softWrap ? 'hover' : ''}
              title={t('softWrap')}
              onClick={() => setSoftWrap(!softWrap)}
            />
            <ToolbarIcon
              icon="scroll-end"
              title={t('scrollToEnd')}
              onClick={() => logcatRef.current?.scrollToEnd()}
              disabled={!device}
            />
            <ToolbarIcon
              icon="reset"
              title={t('restart')}
              onClick={() => {
                if (logcatIdRef.current) {
                  main.closeLogcat(logcatIdRef.current)
                  clear()
                }
                if (device) {
                  main.openLogcat(device.id, source).then((id) => {
                    updateLogcatId(id)
                  })
                }
              }}
              disabled={!device}
            />
            <ToolbarIcon
              icon={paused ? 'play' : 'pause'}
              title={t(paused ? 'resume' : 'pause')}
              onClick={() => {
                if (paused) {
                  main.resumeLogcat(logcatIdRef.current)
                } else {
                  main.pauseLogcat(logcatIdRef.current)
                }
                setPaused(!paused)
              }}
              disabled={!device}
            />
            <LunaToolbarSeparator />
            <ToolbarIcon
              icon="delete"
              title={t('clear')}
              onClick={clear}
              disabled={!device}
            />
          </>
        )}
      </LunaToolbar>
      {source === 'mtklog' && (
        <div className={Style.mtkBar}>
          <button
            className={Style.mtkButton}
            disabled={!device || mtkRunning}
            onClick={startMtkCapture}
            title={
              '\u5148 adb root \u62ff\u6700\u9ad8\u6743\u9650\uff0c\u7136\u540e\u5b9e\u65f6\u5c55\u793a\u5185\u6838\u65e5\u5fd7'
            }
          >
            {'\u5f00\u59cb\u91c7\u96c6'}
          </button>
          <button
            className={Style.mtkButton}
            disabled={!device || !mtkRunning}
            onClick={stopMtkExport}
          >
            {'\u505c\u6b62\u5e76\u5bfc\u51fa'}
          </button>
          <button
            className={Style.mtkButton}
            disabled={!mtkResult}
            onClick={openMtkDir}
          >
            {'\u6253\u5f00\u76ee\u5f55'}
          </button>
          <button
            className={Style.mtkButton}
            onClick={async () => {
              const dir = await LunaModal.prompt(
                'MTK \u65e5\u5fd7\u4fdd\u5b58\u8def\u5f84',
                mtkOutputDir
              )
              if (dir) {
                setMtkOutputDir(dir)
                localStorage.setItem(MTK_LOG_OUTPUT_DIR_STORAGE_KEY, dir)
              }
            }}
          >
            {mtkOutputDir}
          </button>
          <span style={{ flex: 1 }} />
          <span
            className={className(
              Style.mtkDot,
              mtkRunning ? Style.running : Style.stopped
            )}
          />
          <span className={Style.mtkBarStatus}>
            {mtkRunning
              ? mtkStatus || '\u91c7\u96c6\u4e2d...'
              : mtkResult
                ? `\u5df2\u5bfc\u51fa: ${mtkResult.outputDir}`
                : mtkStatus || '\u672a\u5f00\u59cb'}
          </span>
        </div>
      )}
      {kernelLike && (
        <div className={Style.kernelFilters}>
          <span>{'\u5feb\u6377\u7b5b\u9009'}</span>
          {map(KERNEL_FILTERS, ([title, keyword]) => (
            <button
              key={title}
              className={kernelKeyword === keyword ? Style.active : ''}
              onClick={() =>
                setKernelKeyword(kernelKeyword === keyword ? '' : keyword)
              }
            >
              {title}
            </button>
          ))}
          <FilterInput
            placeholder={'\u5185\u5bb9\u5173\u952e\u5b57'}
            value={kernelKeyword}
            onChange={setKernelKeyword}
          />
          <button
            className={!kernelKeyword ? Style.active : ''}
            onClick={() => setKernelKeyword('')}
          >
            {'\u5168\u90e8'}
          </button>
        </div>
      )}
      <div
        className={className('panel-body', Style.logcatBody)}
        tabIndex={0}
        onKeyDown={onLogcatKeyDown}
        onDoubleClick={onLogcatDoubleClick}
      >
        <LunaLogcat
          className={Style.logcat}
          maxNum={10000}
          filter={logcatFilter}
          wrapLongLines={softWrap}
          onContextMenu={onContextMenu}
          view={view}
          onCreate={(logcat) => (logcatRef.current = logcat)}
        />
      </div>
    </div>
  )

  function onLogcatKeyDown(e: React.KeyboardEvent) {
    if (!isCopyShortcut(e)) {
      return
    }
    const copied = copyLogcatSelection()
    if (copied) {
      e.preventDefault()
    }
  }

  function onLogcatDoubleClick(e: React.MouseEvent) {
    const entry = getEntryFromTarget(e.target)
    if (entry) {
      copy(formatEntry(entry))
    }
  }

  function copyLogcatSelection() {
    const logcat = logcatRef.current
    if (logcat?.hasSelection()) {
      copy(logcat.getSelection())
      return true
    }
    const selection = window.getSelection()
    if (selection && selection.toString()) {
      copy(selection.toString())
      return true
    }
    return false
  }

  function getEntryFromTarget(target: EventTarget | null) {
    const el = target instanceof Element ? target : null
    const entryEl = el?.closest('.luna-logcat-entry')
    return (entryEl as any)?.__ayaEntry || null
  }
})

function loadMtkOutputDir() {
  const dir = localStorage.getItem(MTK_LOG_OUTPUT_DIR_STORAGE_KEY)
  return dir || DEFAULT_MTK_LOG_OUTPUT_DIR
}

function FilterInput(props: {
  placeholder: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <div className={Style.filterInputItem}>
      <input
        value={props.value}
        placeholder={props.placeholder}
        spellCheck={false}
        onChange={(e) => props.onChange(e.target.value)}
        onKeyDown={(e) => e.stopPropagation()}
        onPaste={(e) => e.stopPropagation()}
        onCopy={(e) => e.stopPropagation()}
        onCut={(e) => e.stopPropagation()}
      />
    </div>
  )
}

function toLetter(priority: number) {
  return ['?', '?', 'V', 'D', 'I', 'W', 'E'][priority]
}

function formatEntry(entry: any) {
  return trim(
    `${dateFormat(entry.date, 'mm-dd HH:MM:ss.l')} ${rpad(
      entry.pid,
      5,
      ' '
    )} ${rpad(entry.tid, 5, ' ')} ${toLetter(entry.priority)} ${
      entry.tag
    }: ${entry.message}`
  )
}

function isCopyShortcut(e: React.KeyboardEvent) {
  return (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c'
}
