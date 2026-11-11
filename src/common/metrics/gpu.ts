/**
 * True while the GPU is being held below the top frequency the device offers.
 *
 * Derived, not read: hardware publishes a clock, not an opinion about it. The
 * top frequency is what the device has been *observed* reaching, so a GPU with a
 * single step is never considered throttled, and a performance governor is not
 * either - pinning the top step is its job, and a lower reading under it means
 * the policy changed rather than that something is limiting the GPU.
 */
export function isGpuThrottled(
  currentMhz: number | null,
  maxObservedMhz: number | null,
  governor: string | null,
): boolean {
  if (currentMhz === null || maxObservedMhz === null) {
    return false
  }

  if (governor && /performance/i.test(governor)) {
    return false
  }

  return currentMhz < maxObservedMhz
}
