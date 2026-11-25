import { IFile } from 'luna-file-list'

/**
 * 把 luna-file-list 的内部结构（列表视图是 luna-data-grid，图标视图是
 * luna-icon-list）适配成"取当前显示项 / 取当前选中下标 / 选中第 n 项 / 滚动到可见"，
 * 让输入定位和键盘导航用同一套逻辑。
 *
 * 这些字段在 luna 里都是 private，但运行时确实存在（ESM 产物没有混淆属性名），
 * 而 luna-file-list 的 React 包装层不暴露组件实例，所以只能这样声明后使用。
 */

// luna-data-grid 的行高是固定的（CSS: .luna-data-grid td { height: 20px }）
export const ROW_HEIGHT = 20

interface INode {
  data: { file: IFile }
  container: HTMLElement
}

export interface IDataGridInternals {
  container: HTMLElement
  dataContainer: HTMLElement
  displayNodes: INode[]
  selectedNode: unknown
  selectNode(node: unknown): void
  renderData(): void
}

export interface IIconListInternals {
  container: HTMLElement
  displayIcons: INode[]
  selectedIcon: unknown
  selectIcon(icon: unknown): void
}

export interface IFileListInternals {
  dataGrid: IDataGridInternals
  iconList: IIconListInternals
}

/** 拿到实例的内部结构，拿不到（还没建好/已销毁）返回 null */
export function getInternals(fileList: unknown): IFileListInternals | null {
  const internals = fileList as IFileListInternals | null
  if (!internals || !internals.dataGrid || !internals.iconList) {
    return null
  }
  return internals
}

/** 当前显示的项，顺序就是列表显示顺序（排序 + filter 之后） */
export function getItems(fileList: IFileListInternals, listView: boolean) {
  const nodes = listView
    ? fileList.dataGrid.displayNodes
    : fileList.iconList.displayIcons
  return nodes.map((node) => node.data.file)
}

/** 当前选中项在显示顺序里的下标，没选中返回 -1 */
export function getSelectedIndex(
  fileList: IFileListInternals,
  listView: boolean
) {
  if (listView) {
    const { displayNodes, selectedNode } = fileList.dataGrid
    return selectedNode ? displayNodes.indexOf(selectedNode as INode) : -1
  }
  const { displayIcons, selectedIcon } = fileList.iconList
  return selectedIcon ? displayIcons.indexOf(selectedIcon as INode) : -1
}

/** 选中第 index 项并滚动到可见 */
export function selectIndex(
  fileList: IFileListInternals,
  listView: boolean,
  index: number
) {
  if (listView) {
    const grid = fileList.dataGrid
    const node = grid.displayNodes[index]
    if (!node) {
      return
    }
    grid.selectNode(node)
    // 列表拿到焦点，选中项才会显示成 Windows 那样的蓝色高亮
    grid.container.focus({ preventScroll: true })
    scrollGridIntoView(grid, index)
    return
  }

  const list = fileList.iconList
  const icon = list.displayIcons[index]
  if (!icon) {
    return
  }
  list.selectIcon(icon)
  scrollIntoViewNearest(list.container, icon.container)
}

export function deselect(fileList: IFileListInternals, listView: boolean) {
  if (listView) {
    fileList.dataGrid.selectNode(null)
  } else {
    fileList.iconList.selectIcon(null)
  }
}

/** 翻页一次跳多少项 */
export function pageStep(fileList: IFileListInternals, listView: boolean) {
  if (listView) {
    const { dataContainer } = fileList.dataGrid
    return Math.max(1, Math.floor(dataContainer.clientHeight / ROW_HEIGHT))
  }

  const list = fileList.iconList
  const box = list.container.getBoundingClientRect()
  let count = 0
  for (let i = 0, len = list.displayIcons.length; i < len; i++) {
    const rect = list.displayIcons[i].container.getBoundingClientRect()
    if (rect.bottom > box.top && rect.top < box.bottom) {
      count++
    }
  }
  return Math.max(1, count)
}

/**
 * 最小滚动：只在目标不可见时滚动，并且滚到刚好可见。
 * 行是虚拟滚动的，屏外的行根本不在 DOM 里，所以只能按行号算位置。
 */
function scrollGridIntoView(grid: IDataGridInternals, index: number) {
  const { dataContainer } = grid
  const top = index * ROW_HEIGHT
  const bottom = top + ROW_HEIGHT
  let scrollTop = dataContainer.scrollTop

  if (top < scrollTop) {
    scrollTop = top
  } else if (bottom > scrollTop + dataContainer.clientHeight) {
    scrollTop = bottom - dataContainer.clientHeight
  }

  if (scrollTop !== dataContainer.scrollTop) {
    dataContainer.scrollTop = scrollTop
  }
  // 手动触发一次渲染，否则跳转过去的行要等滚动事件才会出现
  grid.renderData()
}

/** 图标视图没有虚拟滚动，所有图标都在 DOM 里，直接按位置做最小滚动 */
function scrollIntoViewNearest(box: HTMLElement, el: HTMLElement) {
  const boxRect = box.getBoundingClientRect()
  const rect = el.getBoundingClientRect()

  if (rect.top < boxRect.top) {
    box.scrollTop -= boxRect.top - rect.top
  } else if (rect.bottom > boxRect.bottom) {
    box.scrollTop += rect.bottom - boxRect.bottom
  }
}
