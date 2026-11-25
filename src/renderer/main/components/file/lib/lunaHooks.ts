import { useEffect, useRef } from 'react'

/**
 * luna 组件的 React 包装用得上的几个小 hook。
 *
 * 从 luna-file-list 的 share/hooks 抄进仓库：那个包只导出了 '.'、'/react'
 * 和 css，子路径拿不到（exports 里没有）。
 */

export function usePrevious<T>(value: T) {
  const ref = useRef<T | undefined>(undefined)
  useEffect(() => {
    ref.current = value
  })
  return ref.current
}

export function useNonInitialEffect(
  effect: () => void | (() => void),
  deps?: unknown[]
) {
  const initialRender = useRef(true)

  useEffect(() => {
    if (initialRender.current) {
      initialRender.current = false
      return
    }
    return effect()
  }, deps)
}

interface IComponent {
  on(event: string, handler: (...args: any[]) => void): void
  off(event: string, handler: (...args: any[]) => void): void
  setOption(name: string, val?: any): void
}

export function useEvent(
  component: { current: IComponent | null },
  event: string,
  prev?: (...args: any[]) => void,
  prop?: (...args: any[]) => void
) {
  useEffect(() => {
    const target = component.current
    if (!target) {
      return
    }
    if (prev) {
      target.off(event, prev)
    }
    if (prop) {
      target.on(event, prop)
    }
  }, [prop])
}

export function useOption(
  component: { current: IComponent | null },
  key: string,
  prop: unknown
) {
  useNonInitialEffect(() => {
    component.current?.setOption(key, prop)
  }, [prop])
}
