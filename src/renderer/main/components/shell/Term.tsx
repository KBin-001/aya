import { observer } from 'mobx-react-lite'
import store from '../../store'
import { Terminal, ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { CanvasAddon } from '@xterm/addon-canvas'
import { WebglAddon } from '@xterm/addon-webgl'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { useEffect, useRef } from 'react'
import {
  colorBgContainer,
  colorBgContainerDark,
  colorPrimary,
  colorText,
  colorTextDark,
  fontFamilyCode,
} from 'common/theme'
import copy from 'licia/copy'
import Style from './Term.module.scss'
import '@xterm/xterm/css/xterm.css'
import { t } from 'common/util'
import contextMenu from 'share/renderer/lib/contextMenu'
import isHidden from 'licia/isHidden'

interface ITermProps {
  visible: boolean
  history: string[]
  onSessionIdChange: (id: string) => void
  onCreate: (terminal: Terminal) => void
  onCreateInputSetter: (setter: (value: string) => void) => void
  onCommand: (command: string) => void
}

export default observer(function Term(props: ITermProps) {
  const terminalRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal>(null)
  const fitAddonRef = useRef<FitAddon>(null)
  const sessionIdRef = useRef('')
  const inputRef = useRef('')
  const historyRef = useRef<string[]>(props.history)
  const historyIdxRef = useRef(-1)
  const historyDraftRef = useRef('')
  const outputBufferRef = useRef<string[]>([])
  const writingRef = useRef(false)
  const disposedRef = useRef(false)

  const { device } = store
  historyRef.current = props.history

  useEffect(() => {
    disposedRef.current = false
    const term = new Terminal({
      allowProposedApi: true,
      fontSize: 14,
      fontFamily: fontFamilyCode,
      theme: getTheme(store.theme === 'dark'),
    })

    const fitAddon = new FitAddon()
    fitAddonRef.current = fitAddon
    term.loadAddon(fitAddon)
    const fit = () => {
      if (!isHidden(terminalRef.current!)) {
        fitAddon.fit()
      }
    }
    window.addEventListener('resize', fit)

    term.loadAddon(new Unicode11Addon())
    term.unicode.activeVersion = '11'

    try {
      term.loadAddon(new WebglAddon())
    } catch {
      term.loadAddon(new CanvasAddon())
    }

    term.open(terminalRef.current!)
    termRef.current = term
    props.onCreate(term)
    props.onCreateInputSetter(setInput)

    function onShellData(id, data) {
      if (sessionIdRef.current !== id) {
        return
      }
      writeOutput(data)
    }
    const offShellData = main.on('shellData', onShellData)

    if (device) {
      main.createShell(device.id).then((id) => {
        setSessionId(id)
        term.onData(handleTermData)
        term.onResize((size) => {
          main.resizeShell(sessionIdRef.current, size.cols, size.rows)
        })
        fit()
      })
    }

    return () => {
      disposedRef.current = true
      outputBufferRef.current = []
      offShellData()
      if (sessionIdRef.current) {
        main.killShell(sessionIdRef.current)
      }
      term.dispose()
      window.removeEventListener('resize', fit)
    }
  }, [])

  useEffect(() => {
    if (fitAddonRef.current && props.visible) {
      fitAddonRef.current.fit()
    }
    if (props.visible) {
      setTimeout(() => {
        if (termRef.current) {
          termRef.current.focus()
        }
      }, 500)
    }
  }, [props.visible])

  const theme = getTheme(store.theme === 'dark')
  if (termRef.current) {
    termRef.current.options.theme = theme
  }

  function setSessionId(id: string) {
    sessionIdRef.current = id
    props.onSessionIdChange(id)
  }

  function writeOutput(data: string) {
    outputBufferRef.current.push(data)
    flushOutput()
  }

  function flushOutput() {
    const term = termRef.current
    if (
      disposedRef.current ||
      !term ||
      writingRef.current ||
      !outputBufferRef.current.length
    ) {
      return
    }

    writingRef.current = true
    const chunk = outputBufferRef.current.splice(0, 32).join('')
    term.write(chunk, () => {
      if (disposedRef.current) {
        return
      }
      writingRef.current = false
      if (outputBufferRef.current.length) {
        requestAnimationFrame(flushOutput)
      }
    })
  }

  function handleTermData(data: string) {
    if (handleHistoryKeys(data)) {
      return
    }

    trackInput(data)
    main.writeShell(sessionIdRef.current, data)
  }

  function handleHistoryKeys(data: string) {
    if (!data || data.length % 3 !== 0) {
      return false
    }

    for (let i = 0; i < data.length; i += 3) {
      if (
        data[i] !== '\x1b' ||
        data[i + 1] !== '[' ||
        (data[i + 2] !== 'A' && data[i + 2] !== 'B')
      ) {
        return false
      }
    }

    for (let i = 0; i < data.length; i += 3) {
      showHistory(data[i + 2] === 'A' ? -1 : 1)
    }
    return true
  }

  function showHistory(direction: -1 | 1) {
    const history = historyRef.current
    if (!history.length) {
      return
    }

    if (historyIdxRef.current < 0) {
      historyDraftRef.current = inputRef.current
      if (direction === -1) {
        historyIdxRef.current = 0
        replaceInput(history[0])
        return
      }
      return
    }

    const nextIdx = historyIdxRef.current + direction
    if (nextIdx < 0) {
      return
    }
    if (nextIdx >= history.length) {
      historyIdxRef.current = -1
      replaceInput(historyDraftRef.current)
      return
    }

    historyIdxRef.current = nextIdx
    replaceInput(history[nextIdx])
  }

  function replaceInput(value: string) {
    inputRef.current = value
    main.writeShell(sessionIdRef.current, `\x15${value}`)
  }

  function trackInput(data: string) {
    for (let i = 0; i < data.length; i++) {
      const char = data[i]
      if (char === '\x1b') {
        i = skipEscapeSequence(data, i)
        continue
      }
      if (char === '\r' || char === '\n') {
        commitInput()
        continue
      }
      if (char === '\x7f' || char === '\b') {
        inputRef.current = inputRef.current.slice(0, -1)
        historyIdxRef.current = -1
        continue
      }
      if (char === '\x03' || char === '\x15') {
        inputRef.current = ''
        historyIdxRef.current = -1
        continue
      }
      if (char >= ' ') {
        inputRef.current += char
        historyIdxRef.current = -1
      }
    }
  }

  function skipEscapeSequence(data: string, start: number) {
    if (data[start + 1] !== '[') {
      return start
    }
    for (let i = start + 2; i < data.length; i++) {
      const code = data.charCodeAt(i)
      if (code >= 0x40 && code <= 0x7e) {
        return i
      }
    }
    return data.length - 1
  }

  function commitInput() {
    const input = inputRef.current.trim()
    if (input) {
      props.onCommand(input)
    }
    inputRef.current = ''
    historyIdxRef.current = -1
    historyDraftRef.current = ''
  }

  async function pasteClipboard() {
    const text = await navigator.clipboard.readText()
    if (text) {
      trackInput(text)
      main.writeShell(sessionIdRef.current, text)
      termRef.current?.focus()
    }
  }

  function setInput(value: string) {
    replaceInput(value)
    termRef.current?.focus()
  }

  const onContextMenu = (e: React.MouseEvent) => {
    if (!device) {
      return
    }

    if (!e.shiftKey) {
      e.preventDefault()
      pasteClipboard()
      return
    }

    const term = termRef.current!
    const template: any[] = [
      {
        label: t('copy'),
        click() {
          if (term.hasSelection()) {
            copy(term.getSelection())
            term.focus()
          }
        },
      },
      {
        label: t('paste'),
        click: pasteClipboard,
      },
      {
        label: t('selectAll'),
        click() {
          term.selectAll()
        },
      },
      {
        type: 'separator',
      },
      {
        label: t('reset'),
        click() {
          if (sessionIdRef.current) {
            main.killShell(sessionIdRef.current)
          }
          term.reset()
          if (device) {
            main.createShell(device.id).then((id) => {
              setSessionId(id)
            })
            term.focus()
          }
        },
      },
      {
        label: t('clear'),
        click() {
          term.clear()
          term.focus()
        },
      },
    ]

    contextMenu(e, template)
  }

  const onMouseUp = (e: React.MouseEvent) => {
    if (e.button !== 0) {
      return
    }
    const term = termRef.current
    if (term?.hasSelection()) {
      copy(term.getSelection())
      term.focus()
    }
  }

  return (
    <>
      <div
        className={Style.term}
        style={{ display: props.visible ? 'block' : 'none' }}
        ref={terminalRef}
        onContextMenu={onContextMenu}
        onMouseUp={onMouseUp}
      />
    </>
  )
})

function getTheme(dark = false) {
  let theme: ITheme = {
    background: colorBgContainer,
    foreground: colorText,
    cursor: colorText,
  }

  if (dark) {
    theme = {
      background: colorBgContainerDark,
      foreground: colorTextDark,
      cursor: colorTextDark,
    }
  }

  return {
    selectionForeground: '#fff',
    selectionBackground: colorPrimary,
    ...theme,
  }
}
