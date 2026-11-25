import { useEffect, useRef } from 'react'
import FileList, { IFile, IOptions } from 'luna-file-list'
import { useEvent, useOption, usePrevious } from './lib/lunaHooks'

/**
 * luna-file-list 的本地包装。
 *
 * 上游的 luna-file-list/react 不暴露组件实例（没有 onCreate、也不转发 ref），
 * 拿不到实例就没法做输入定位和键盘导航。这里按上游那份 30 行的包装重写一遍，
 * 补一个 onCreate 回调，其余行为保持一致；好处是不用改 node_modules。
 */

interface IProps {
  className?: string
  files: IFile[]
  listView?: boolean
  filter?: string
  columns?: IOptions['columns']
  onSelect?: (file: IFile) => void
  onDeselect?: () => void
  onClick?: (e: MouseEvent, file: IFile) => void
  onDoubleClick?: (e: MouseEvent, file: IFile) => void
  onContextMenu?: (e: MouseEvent, file?: IFile) => void
  /** 实例创建完成后回调，用于输入定位（上游包装层没有这个口子） */
  onCreate?: (fileList: FileList) => void
}

export default function LunaFileList(props: IProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const fileListRef = useRef<FileList | null>(null)
  const prevProps = usePrevious(props)

  useEffect(() => {
    const fileList = new FileList(containerRef.current!, {
      files: props.files,
      listView: props.listView,
      filter: props.filter,
      columns: props.columns,
    })
    fileListRef.current = fileList
    props.onCreate?.(fileList)

    return () => {
      fileListRef.current = null
      fileList.destroy()
    }
    // 和上游一致：只在挂载时创建实例，后续变化通过 useOption 同步
  }, [])

  useEvent(fileListRef, 'select', prevProps?.onSelect, props.onSelect)
  useEvent(fileListRef, 'deselect', prevProps?.onDeselect, props.onDeselect)
  useEvent(fileListRef, 'click', prevProps?.onClick, props.onClick)
  useEvent(
    fileListRef,
    'dblclick',
    prevProps?.onDoubleClick,
    props.onDoubleClick
  )
  useEvent(
    fileListRef,
    'contextmenu',
    prevProps?.onContextMenu,
    props.onContextMenu
  )

  useOption(fileListRef, 'files', props.files)
  useOption(fileListRef, 'listView', props.listView)
  useOption(fileListRef, 'filter', props.filter)

  return <div className={props.className || ''} ref={containerRef} />
}
