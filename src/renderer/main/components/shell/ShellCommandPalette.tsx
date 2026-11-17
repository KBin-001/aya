import { useEffect, useId, useRef, useState } from 'react'
import fuzzySearch from 'licia/fuzzySearch'
import uuid from 'licia/uuid'
import { t } from 'common/util'
import { isShellCommand } from './commands'
import Style from './Shell.module.scss'

const storageKey = 'aya.shell.customCommands'

interface Command {
  id: string
  title: string
  command: string
}

interface Props {
  builtins: string[][]
  onClose: () => void
  onSelect: (command: string) => void
}

export default function ShellCommandPalette({ builtins, onClose, onSelect }: Props) {
  const [custom, setCustom] = useState(loadCustom)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [editing, setEditing] = useState<Command>()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const id = useId()
  const builtinRows = builtins.map(([title, command], index) => ({
    id: 'builtin-' + index,
    title,
    command: command.trimEnd(),
  }))
  const commands = [...custom, ...builtinRows].map((command) => ({
    ...command,
    search: command.title + ' ' + command.command,
  }))
  const results = query.trim()
    ? fuzzySearch(query.trim(), commands, { key: 'search' })
    : commands
  const activeItem = results[active]
  const editable = custom.find((item) => item.id === activeItem?.id)

  useEffect(() => {
    const dialog = dialogRef.current!
    dialog.showModal()
    return () => dialog.close()
  }, [])

  const showSearch = !editing
  useEffect(() => {
    if (showSearch) {
      searchRef.current?.focus()
    }
  }, [showSearch])

  useEffect(() => {
    document.getElementById(id + '-' + activeItem?.id)?.scrollIntoView({
      block: 'nearest',
    })
  }, [activeItem?.id, id])

  function saveCustom(next: Command[]) {
    localStorage.setItem(storageKey, JSON.stringify(next))
    setCustom(next)
    setActive(0)
  }

  return (
    <dialog
      ref={dialogRef}
      className={Style.palette}
      aria-label={t('shellPalette.title')}
      onCancel={(event) => {
        event.preventDefault()
        if (editing) setEditing(undefined)
        else onClose()
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      {editing ? (
        <form
          className={Style.paletteForm}
          onSubmit={(event) => {
            event.preventDefault()
            const title = editing.title.trim()
            const command = editing.command.trim()
            if (!title || !isShellCommand(command)) return
            const entry = { id: editing.id || uuid(), title, command }
            saveCustom(editing.id
              ? custom.map((item) => item.id === entry.id ? entry : item)
              : [entry, ...custom])
            setQuery('')
            setEditing(undefined)
          }}
        >
          <label>
            {t('name')}
            <input
              required
              autoFocus
              value={editing.title}
              onChange={(event) => setEditing({ ...editing, title: event.currentTarget.value })}
            />
          </label>
          <label>
            {t('shellPalette.command')}
            <input
              required
              spellCheck={false}
              value={editing.command}
              onChange={(event) => setEditing({ ...editing, command: event.currentTarget.value })}
            />
          </label>
          <div className={Style.paletteActions}>
            <button type="button" onClick={() => setEditing(undefined)}>{t('cancel')}</button>
            <button type="submit" disabled={!editing.title.trim() || !isShellCommand(editing.command.trim())}>
              {t('save')}
            </button>
          </div>
        </form>
      ) : (
        <div className={Style.paletteContent}>
          <input
            ref={searchRef}
            role="combobox"
            aria-label={t('shellPalette.search')}
            aria-controls={id}
            aria-expanded={true}
            aria-activedescendant={activeItem && id + '-' + activeItem.id}
            placeholder={t('shellPalette.search')}
            spellCheck={false}
            value={query}
            onChange={(event) => {
              setQuery(event.currentTarget.value)
              setActive(0)
            }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault()
                if (results.length) {
                  const offset = event.key === 'ArrowDown' ? 1 : -1
                  setActive((active + offset + results.length) % results.length)
                }
              } else if (event.key === 'Enter' && activeItem) {
                event.preventDefault()
                onSelect(activeItem.command)
              }
            }}
          />
          <ul id={id} role="listbox" className={Style.paletteList}>
            {results.map(({ id: commandId, title, command }, index) => (
              <li key={commandId} role="presentation">
                <button
                  type="button"
                  id={id + '-' + commandId}
                  role="option"
                  aria-selected={index === active}
                  tabIndex={-1}
                  onClick={() => onSelect(command)}
                >
                  <span>{title}</span>
                  <code title={command}>{command}</code>
                </button>
              </li>
            ))}
          </ul>
          {!results.length && <p className={Style.historyEmpty}>{t('shellHistory.noMatches')}</p>}
          <div className={Style.paletteActions}>
            {editable && (
              <>
                <button type="button" onClick={() => setEditing(editable)}>{t('edit')}</button>
                <button type="button" onClick={() => saveCustom(custom.filter((item) => item.id !== editable.id))}>
                  {t('delete')}
                </button>
              </>
            )}
            <button type="button" onClick={() => setEditing({ id: '', title: '', command: '' })}>
              {t('shellPalette.add')}
            </button>
          </div>
        </div>
      )}
    </dialog>
  )
}

function loadCustom(): Command[] {
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey) || '[]')
    if (Array.isArray(stored)) {
      return stored.filter((entry) =>
        typeof entry?.id === 'string' &&
        typeof entry.title === 'string' &&
        isShellCommand(entry.command)
      )
    }
  } catch {
    // An unreadable local preference does not prevent opening the palette.
  }
  return []
}
