import { describe, expect, it } from 'vitest'
import { isGpuThrottled } from './gpu'

describe('isGpuThrottled', () => {
  it('is true when the GPU runs below the highest frequency it has reached', () => {
    expect(isGpuThrottled(390, 1000, 'simple_ondemand')).toBe(true)
  })

  it('is false on a GPU with only one frequency step', () => {
    // Nothing to be throttled to: the only step is the top step.
    expect(isGpuThrottled(1000, 1000, 'simple_ondemand')).toBe(false)
  })

  it('is false when the governor is the performance one', () => {
    // A performance governor pins the top step; a lower reading is a policy
    // choice, not a limit imposed on the GPU.
    expect(isGpuThrottled(390, 1000, 'performance')).toBe(false)
  })

  it('is false when no top frequency has been observed yet', () => {
    expect(isGpuThrottled(390, null, 'simple_ondemand')).toBe(false)
  })

  it('is false when the current frequency is unknown', () => {
    expect(isGpuThrottled(null, 1000, 'simple_ondemand')).toBe(false)
  })

  it('is false when the governor is unknown and the GPU sits at the top', () => {
    expect(isGpuThrottled(1000, 1000, null)).toBe(false)
  })

  it('ignores case and decoration in the governor name', () => {
    expect(isGpuThrottled(390, 1000, 'Performance')).toBe(false)
    expect(isGpuThrottled(390, 1000, 'gpu_performance')).toBe(false)
  })
})
