/**
 * Windows 资源管理器（comctl32 ListView）风格的输入定位。
 *
 * 语义参考 Raymond Chen《How does the classic Win32 ListView handle
 * incremental searching?》(2024-04-08)，以及 Wine/ReactOS 的
 * LISTVIEW_ProcessLetterKeys 实现：
 *
 * - 连着敲的字符会累积成输入缓冲，超过 timeout 没有新按键就重新开始；
 * - 缓冲里全是同一个字符（b、bb、bbb）时是"重复字符"模式：按单字符从
 *   当前项往后轮换，这样连按同一个键可以在 b… 之间依次跳；
 * - 缓冲里出现不同字符（bca）时是"前缀"模式：用整个缓冲做前缀匹配，
 *   从当前项（含）往后找，找不到再从头回绕；
 * - 只匹配前缀，忽略大小写，按列表当前显示顺序搜索。
 */

// comctl32 的 KEY_DELAY 是 450ms，这里放宽到 600ms，连打多个字符不容易断开
export const SEARCH_TIMEOUT = 600

// 缓冲长度上限，参考 comctl32 用的 MAX_PATH - 1
const MAX_LENGTH = 255

/**
 * 全同字符缓冲时是否先尝试"以整个缓冲为前缀"的精确匹配。
 *
 * true ：连按 b 先跳到 bb…（存在的话），没有才在 b… 之间轮换。
 * false：Raymond Chen 描述的纯 Win32 行为 —— 直接按单字符轮换
 *        （原文例子里缓冲变成 "LL" 时选的是第二个 L 开头的 Lemur，
 *        而不是以 "Ll" 开头的 Llama）。
 */
const PREFER_EXACT_ON_REPEAT = true

/** 缓冲是否由同一个字符重复组成 */
export function isRepeatedChar(str: string) {
  for (let i = 1, len = str.length; i < len; i++) {
    if (str[i] !== str[0]) {
      return false
    }
  }
  return str.length > 0
}

/**
 * 这个按键算不算输入定位用的字符。
 *
 * comctl32 只接受字母数字和一批符号，空格等一律忽略（并且不重置缓冲）。
 * 这里放宽为"任意单个可打印字符"，因为 Android 上文件名可以包含 "、'、
 * : 这些 Windows 文件名不允许的字符；空格仍然忽略。
 */
export function isSearchChar(key: string) {
  return key.length === 1 && key > ' '
}

export class IncrementalSearch {
  private buffer = ''
  private lastKeyTime = 0

  constructor(private timeout = SEARCH_TIMEOUT) {}

  get text() {
    return this.buffer
  }

  /** 清空缓冲，切换目录、刷新、切换视图时调用 */
  reset() {
    this.buffer = ''
    this.lastKeyTime = 0
  }

  /** 记录一次按键，返回更新后的缓冲 */
  push(char: string, timestamp: number) {
    if (this.buffer && timestamp - this.lastKeyTime < this.timeout) {
      if (this.buffer.length < MAX_LENGTH) {
        this.buffer += char
      }
    } else {
      this.buffer = char
    }
    this.lastKeyTime = timestamp
    return this.buffer
  }

  /**
   * 在 names（当前显示顺序）里找目标下标，找不到返回 -1。
   * current 是当前选中项的下标，-1 表示没有选中。
   */
  find(names: string[], current: number) {
    const len = names.length
    const buffer = this.buffer.toLowerCase()
    if (!buffer || len === 0) {
      return -1
    }

    const lowerNames = names.map((name) => name.toLowerCase())
    // 缓冲只有一个字符时从"当前项的下一项"开始，连按同一个键才会往后轮换；
    // 缓冲变长时从当前项本身开始，收窄过程中当前项仍然可能命中。
    const start =
      current >= 0 && len > 1
        ? buffer.length > 1
          ? current
          : (current + 1) % len
        : 0
    const nextStart = current >= 0 ? (current + 1) % len : 0

    if (isRepeatedChar(buffer)) {
      if (PREFER_EXACT_ON_REPEAT && buffer.length > 1) {
        const exact = scan(lowerNames, start, buffer)
        if (exact !== -1) {
          return exact
        }
      }
      return scan(lowerNames, nextStart, buffer[0])
    }

    return scan(lowerNames, start, buffer)
  }
}

/** 从 start 开始按显示顺序找第一个以 prefix 开头的项，找不到返回 -1（会回绕一圈） */
function scan(names: string[], start: number, prefix: string) {
  const len = names.length
  for (let i = 0; i < len; i++) {
    const idx = (start + i) % len
    if (names[idx].startsWith(prefix)) {
      return idx
    }
  }
  return -1
}
