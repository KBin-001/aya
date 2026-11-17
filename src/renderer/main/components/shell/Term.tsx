import { observer } from 'mobx-react-lite'
import store from '../../store'
import { Terminal } from '@xterm/xterm'
import type { ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { CanvasAddon } from '@xterm/addon-canvas'
import { WebglAddon } from '@xterm/addon-webgl'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { useEffect, useRef, useState } from 'react'
import {
  colorBgContainer,
  colorPrimary,
  colorText,
  fontFamilyCode,
} from 'common/theme'
import copy from 'licia/copy'
import Style from './Term.module.scss'
import '@xterm/xterm/css/xterm.css'
import { t } from 'common/util'
import contextMenu from 'share/renderer/lib/contextMenu'
import isHidden from 'licia/isHidden'
import { isShellCommand } from './commands'

export interface ShellStatus {
  uid?: number
  root: boolean
  cwd: string
}

interface ITermProps {
  visible: boolean
  history: string[]
  onSessionIdChange: (id: string) => void
  onCreate: (terminal: Terminal) => void
  onCreateInputSetter: (setter: (value: string) => void) => void
  onCommand: (command: string) => void
  onStatus: (status?: ShellStatus) => void
}

export default observer(function Term(props: ITermProps) {
  const [restart, setRestart] = useState(0)
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
  const promptRef = useRef('')
  const reportedStatusRef = useRef<ShellStatus | undefined>(undefined)
  const metadataOnPromptRef = useRef(false)
  const listenersRef = useRef<Array<{ dispose: () => void }>>([])

  const { device } = store
  historyRef.current = props.history

  useEffect(() => {
    disposedRef.current = false
    const term = new Terminal({
      allowProposedApi: true,
      fontSize: 18,
      fontFamily: fontFamilyCode,
      lineHeight: 1.3,
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
    const offShellClose = main.on('shellClose', (id: string) => {
      if (sessionIdRef.current === id) {
        disposeShellListeners()
        setSessionId('')
      }
    })
    const osc = term.parser.registerOscHandler(633, (data) => {
      const match = /^AYA;(\d+);([^\r\n]*)$/.exec(data)
      if (!match) {
        return false
      }
      const uid = Number(match[1])
      metadataOnPromptRef.current = true
      reportStatus({ uid, root: uid === 0, cwd: match[2] })
      return true
    })

    return () => {
      disposedRef.current = true
      outputBufferRef.current = []
      offShellData()
      offShellClose()
      osc.dispose()
      term.dispose()
      window.removeEventListener('resize', fit)
    }
  }, [])

  // The shell session is tied to the device, but the terminal itself is not:
  // when the device disconnects only the dead session is dropped, so everything
  // already on screen stays readable (and is still there after reconnecting).
  // The table is only cleared when the app exits or the tab is closed.
  useEffect(() => {
    const deviceId = device ? device.id : ''
    const term = termRef.current
    if (!term || !deviceId) {
      return
    }

    // The session that just died never wrote a trailing newline, so without this
    // every reconnect would pile another prompt onto the same line. Only do it
    // when there is something on the current line (a fresh terminal is empty).
    if (readInputLine()) {
      outputBufferRef.current.push('\r\n')
      flushOutput()
    }

    let cancelled = false
    main.createShell(deviceId).then((id) => {
      if (cancelled || disposedRef.current) {
        main.killShell(id)
        return
      }
      disposeShellListeners()
      listenersRef.current = [
        term.onData(handleTermData),
        term.onResize((size) => {
          main.resizeShell(sessionIdRef.current, size.cols, size.rows)
        }),
      ]
      setSessionId(id)
      if (fitAddonRef.current && !isHidden(terminalRef.current!)) {
        fitAddonRef.current.fit()
      }
    }).catch(() => {
      if (!cancelled && !disposedRef.current) {
        setSessionId('')
      }
    })

    return () => {
      cancelled = true
      disposeShellListeners()
      if (sessionIdRef.current) {
        main.killShell(sessionIdRef.current)
        sessionIdRef.current = ''
        if (!disposedRef.current) {
          setSessionId('')
        }
      }
    }
  }, [device ? device.id : '', restart])

  useEffect(() => {
    if (props.visible) {
      fitAddonRef.current?.fit()
      termRef.current?.focus()
    }
  }, [props.visible])

  const theme = getTheme(store.theme === 'dark')
  if (termRef.current) {
    termRef.current.options.theme = theme
  }

  function setSessionId(id: string) {
    sessionIdRef.current = id
    metadataOnPromptRef.current = false
    reportStatus()
    props.onSessionIdChange(id)
  }

  function reportStatus(status?: ShellStatus) {
    const previous = reportedStatusRef.current
    if (
      previous?.uid === status?.uid &&
      previous?.root === status?.root &&
      previous?.cwd === status?.cwd
    ) {
      return
    }
    reportedStatusRef.current = status
    props.onStatus(status)
  }

  function readPromptStatus() {
    const term = termRef.current
    if (!sessionIdRef.current || !term || metadataOnPromptRef.current) {
      return
    }
    const buffer = term.buffer.active
    if (buffer.type !== 'normal') {
      return
    }
    const line = buffer.getLine(buffer.baseY + buffer.cursorY)
    const text = line?.translateToString(false, 0, buffer.cursorX)
    // Nested shells and older ADB transports may only emit the Android prompt.
    const match = text && /^(?:\d+\|)?[\w.@-]+:((?:\/|~)[^\r\n]*) ([#$]) $/.exec(text)
    if (match) {
      const root = match[2] === '#'
      reportStatus({ cwd: match[1], root, uid: root ? 0 : undefined })
    }
  }

  /** Re-binding on every reconnect would otherwise duplicate keystroke input. */
  function disposeShellListeners() {
    for (const listener of listenersRef.current) {
      listener.dispose()
    }
    listenersRef.current = []
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
      readPromptStatus()
      if (outputBufferRef.current.length) {
        requestAnimationFrame(flushOutput)
      }
    })
  }

  function handleTermData(data: string) {
    if (!handleHistoryKeys(data)) {
      writeInput(data)
    }
  }

  function writeInput(data: string) {
    if (['\r', '\n', '\x03', '\x04'].some((key) => data.includes(key))) {
      metadataOnPromptRef.current = false
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
    if (!sessionIdRef.current || (value !== '' && !isShellCommand(value))) {
      return
    }
    inputRef.current = value
    main.writeShell(sessionIdRef.current, `\x15${value}`)
  }

  function trackInput(data: string) {
    if (!inputRef.current) {
      snapshotPrompt()
    }
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

  /** Text currently on the terminal's input line (trailing blanks trimmed). */
  function readInputLine() {
    const term = termRef.current
    if (!term) {
      return ''
    }
    const buffer = term.buffer.active
    const line = buffer.getLine(buffer.baseY + buffer.cursorY)
    return line ? line.translateToString(true) : ''
  }

  /**
   * Remember the prompt so a rewritten line can be split into prompt + command.
   * Called right before the first keystroke of a line, while the line still
   * holds nothing but the prompt.
   */
  function snapshotPrompt() {
    if (promptRef.current) {
      return
    }
    const line = readInputLine()
    if (line) {
      promptRef.current = line
    }
  }

  /**
   * Resolve the command that is really on the input line.
   *
   * Keystroke tracking alone only sees what the user typed, while the shell may
   * rewrite the line itself — tab completion (`cat foo<TAB>` becomes
   * `cat foobar`) is the common case, cursor editing another. The screen always
   * shows the final line, so read it back and fall back to the tracked
   * keystrokes whenever the screen cannot be trusted.
   */
  function resolveCommand(typed: string): string {
    if (!typed) {
      return ''
    }

    const line = readInputLine()
    if (!line) {
      return typed
    }

    // Untouched case: the line is exactly the prompt plus what was typed, which
    // also lets us learn the prompt.
    if (line.endsWith(typed)) {
      promptRef.current = line.slice(0, line.length - typed.length)
      return typed
    }

    const prompt = promptRef.current
    if (prompt && line.startsWith(prompt)) {
      const onScreen = line.slice(prompt.length).trim()
      // Reject a line that is merely trailing behind our keystrokes (echo lag,
      // or a paste that has not been written to the shell yet), otherwise the
      // recorded command would be truncated.
      if (onScreen && !typed.startsWith(onScreen)) {
        return onScreen
      }
    }

    return typed
  }

  function commitInput() {
    const command = resolveCommand(inputRef.current).trim()
    if (command) {
      props.onCommand(command)
    }
    inputRef.current = ''
    historyIdxRef.current = -1
    historyDraftRef.current = ''
  }

  async function pasteClipboard() {
    const text = await navigator.clipboard.readText()
    if (text) {
      writeInput(text)
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
          inputRef.current = ''
          promptRef.current = ''
          historyIdxRef.current = -1
          historyDraftRef.current = ''
          outputBufferRef.current = []
          term.reset()
          setRestart((value) => value + 1)
          term.focus()
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

function getTheme(dark = false): ITheme {
  if (dark) {
    return {
      background: '#0e1022',
      foreground: '#eae8f5',
      cursor: '#b383f5',
      cursorAccent: '#0e1022',
      selectionForeground: '#fff',
      selectionBackground: '#47346d',
    }
  }

  return {
    background: colorBgContainer,
    foreground: colorText,
    cursor: colorText,
    selectionForeground: '#fff',
    selectionBackground: colorPrimary,
  }
}
