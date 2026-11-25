/**
 * 判断按键该不该由文件列表来接。
 *
 * 文件页里的键盘监听挂在 window 上（列表自身不接收焦点），所以要自己
 * 把"正在输入框里打字"和"焦点在按钮等会消费按键的控件上"这两种情况排除。
 */

const EDITABLE_TAGS = ['INPUT', 'TEXTAREA', 'SELECT']

const CONTROL_TAGS = ['BUTTON', 'A', 'SUMMARY', 'OPTION']

const CONTROL_ROLES = [
  'button',
  'tab',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'option',
  'checkbox',
  'radio',
  'switch',
]

/** 可编辑控件（输入框、路径栏、filter 框、contenteditable），一律不抢 */
export function isEditableTarget(target: EventTarget | null) {
  const el = target as HTMLElement | null
  if (!el || !el.tagName) {
    return false
  }
  if (EDITABLE_TAGS.includes(el.tagName)) {
    return true
  }
  return el.isContentEditable === true
}

/**
 * 自己会消费按键的控件：上下键、回车、退格要留给它们，
 * 否则焦点在工具栏按钮上按回车会被文件列表抢走。
 * 搜索字符不受这个限制（在按钮上敲字母照样定位，符合"页面内直接打字"的期望）。
 */
export function isControlTarget(target: EventTarget | null) {
  const el = target as HTMLElement | null
  if (!el || !el.tagName) {
    return false
  }
  if (isEditableTarget(el)) {
    return true
  }
  if (CONTROL_TAGS.includes(el.tagName)) {
    return true
  }
  const role = el.getAttribute ? el.getAttribute('role') : null
  return role !== null && CONTROL_ROLES.includes(role)
}

/** 有弹窗开着时不要动列表选择 */
export function hasOpenModal() {
  const modal = document.querySelector('.luna-modal:not(.luna-modal-hidden)')
  // 再确认一下里面确实有内容：被 destroy 过的弹窗只剩一个空壳，
  // 不这样判断的话一个空壳就能让输入定位永久失效
  return !!modal && !!modal.querySelector('.luna-modal-body')
}
