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
import { useEffect, useRef, useState } from 'react'
import store from '../../store'
import copy from 'licia/copy'
import download from 'licia/download'
import toStr from 'licia/toStr'
import { t } from 'common/util'
import { IpcLogSource } from 'common/types'
import ToolbarIcon from 'share/renderer/components/ToolbarIcon'
import contextMenu from 'share/renderer/lib/contextMenu'
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
  const logcatRef = useRef<Logcat>(null)
  const entriesRef = useRef<any[]>([])
  const logcatIdRef = useRef('')
  const kernelKeywordRef = useRef('')
  const filterRef = useRef(filter)

  const { device } = store

  useEffect(() => {
    function onLogcatEntry(id, entry) {
      if (logcatIdRef.current !== id) {
        return
      }
      entriesRef.current.push(entry)
      if (logcatRef.current) {
        if (source !== 'kernel' || matchKernelEntry(entry, kernelKeywordRef.current)) {
          logcatRef.current.append(entry)
        }
      }
    }
    const offLogcatEntry = main.on('logcatEntry', onLogcatEntry)
    if (device) {
      main.openLogcat(device.id, source).then((id) => {
        logcatIdRef.current = id
      })
    }

    return () => {
      offLogcatEntry()
      if (logcatIdRef.current) {
        main.closeLogcat(logcatIdRef.current)
      }
    }
  }, [source])

  useEffect(() => {
    kernelKeywordRef.current = kernelKeyword
    if (source === 'kernel') {
      refreshKernelEntries()
    }
  }, [kernelKeyword])

  useEffect(() => {
    filterRef.current = filter
  }, [filter])

  if (store.panel !== 'logcat') {
    if (!paused && logcatIdRef.current) {
      main.pauseLogcat(logcatIdRef.current)
    }
  } else {
    if (!paused && logcatIdRef.current) {
      main.resumeLogcat(logcatIdRef.current)
    }
  }

  function save() {
    const data = map(entriesRef.current, (entry) => {
      return formatEntry(entry)
    }).join('\n')
    const name = `${store.device ? store.device.name : 'logcat'}.${dateFormat(
      'yyyymmddHH'
    )}.txt`

    download(data, name, 'text/plain')
  }

  function clear() {
    if (logcatRef.current) {
      logcatRef.current.clear()
    }
    entriesRef.current = []
  }

  function refreshKernelEntries() {
    const logcat = logcatRef.current
    if (!logcat) {
      return
    }

    logcat.clear()
    for (const entry of entriesRef.current) {
      if (matchKernelEntry(entry, kernelKeywordRef.current)) {
        logcat.append(entry)
      }
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

  return (
    <div className="panel-with-toolbar">
      <LunaToolbar
        className="panel-toolbar"
        onChange={(key, val) => {
          switch (key) {
            case 'source':
              setSource(val)
              clear()
              if (logcatIdRef.current) {
                main.closeLogcat(logcatIdRef.current)
                logcatIdRef.current = ''
              }
              break
            case 'view':
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
          }}
        />
        <LunaToolbarSeparator />
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
        {source === 'kernel' ? (
          <FilterInput
            placeholder={'\u5185\u5bb9\u5173\u952e\u5b57'}
            value={kernelKeyword}
            onChange={setKernelKeyword}
          />
        ) : (
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
                logcatIdRef.current = id
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
      </LunaToolbar>
      {source === 'kernel' && (
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
          filter={source === 'kernel' ? { priority: filter.priority } : filter}
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
    const entryEl = el?.closest('[data-idx]')
    if (!entryEl) {
      return null
    }
    const idx = Number(entryEl.getAttribute('data-idx'))
    return entriesRef.current[idx] || null
  }
})

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

function matchKernelEntry(entry: any, keyword: string) {
  const keywords = keyword
    .toLowerCase()
    .split(/[|,\s]+/)
    .filter(Boolean)

  if (!keywords.length) {
    return true
  }

  const message = `${entry.tag || ''} ${entry.message || ''}`.toLowerCase()
  return keywords.some((keyword) => message.includes(keyword))
}
