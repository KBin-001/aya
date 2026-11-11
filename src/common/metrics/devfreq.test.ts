import { describe, expect, it } from 'vitest'
import { readFixture } from './__fixtures__/load'
import { parseDevfreqReadings, selectDevfreqNode } from './devfreq'

describe('selectDevfreqNode', () => {
  it.each([
    ['mtk-dvfsrc-devfreq', 'ddr'],
    ['13000000.mali', 'gpu'],
  ])('picks %s for the %s domain', (node, kind) => {
    // The real listing from an MT8781: one DVFS resource node driving DDR
    // bandwidth, one Mali node driving the GPU.
    expect(
      selectDevfreqNode(['mtk-dvfsrc-devfreq', '13000000.mali'], kind as any),
    ).toBe(node)
  })

  it.each([
    [
      'a soc:qcom,ddr node on a Qualcomm board',
      ['soc:qcom,cpubw', 'soc:qcom,ddr'],
      'ddr',
      'soc:qcom,ddr',
    ],
    ['a kgsl node', ['kgsl-3d0', 'soc:qcom,cpubw'], 'gpu', 'kgsl-3d0'],
    [
      'an emi (MTK memory interface) node',
      ['mtk-emi', 'mali'],
      'ddr',
      'mtk-emi',
    ],
  ])('finds %s', (_case, nodes, kind, expected) => {
    expect(selectDevfreqNode(nodes as string[], kind as any)).toBe(expected)
  })

  it('returns nothing when no node matches the domain', () => {
    expect(selectDevfreqNode(['mtk-dvfsrc-devfreq'], 'gpu')).toBeNull()
  })

  it('returns nothing for a device without devfreq nodes', () => {
    expect(selectDevfreqNode([], 'ddr')).toBeNull()
  })

  it('prefers the first matching node, so the choice is stable across ticks', () => {
    expect(selectDevfreqNode(['mtk-ddr-1', 'mtk-ddr-0'], 'ddr')).toBe(
      'mtk-ddr-1',
    )
  })
})

describe('parseDevfreqReadings', () => {
  it('reads a DDR node in MHz with its whole frequency table', () => {
    // cur_freq 4266000000 Hz, and the table is reported highest first.
    expect(
      parseDevfreqReadings(
        readFixture('mtk-sysfs-reference', 'devfreq-ddr.txt'),
      ),
    ).toEqual({
      ok: true,
      value: {
        frequencyMhz: 4266,
        availableMhz: [1066, 1600, 2133, 2736, 3600, 4266],
        governor: 'simple_ondemand',
        loadPct: null,
      },
    })
  })

  it('reads a GPU node with its load', () => {
    expect(
      parseDevfreqReadings(
        readFixture('mtk-sysfs-reference', 'devfreq-gpu.txt'),
      ),
    ).toEqual({
      ok: true,
      value: {
        frequencyMhz: 390,
        availableMhz: [390, 525, 650, 700, 800, 900, 1000],
        governor: 'simple_ondemand',
        loadPct: 37,
      },
    })
  })

  it('reports no load when the node does not publish one', () => {
    const result = parseDevfreqReadings('cur_freq|390000000\nload|\n')
    if (!result.ok) throw new Error('frequency alone is a reading')

    expect(result.value.loadPct).toBeNull()
  })

  it('reports a load of zero as a reading, not as unavailable', () => {
    // An idle GPU reports exactly 0; dropping it would blank the load chart
    // whenever nothing is being drawn.
    const result = parseDevfreqReadings('cur_freq|200000000\nload|0\n')
    if (!result.ok) throw new Error('fixture should parse')

    expect(result.value.loadPct).toBe(0)
  })

  it('reports a readable error when no frequency could be read', () => {
    const result = parseDevfreqReadings('cur_freq|\ngovernor|simple_ondemand\n')

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.reason).toContain('cur_freq')
  })

  it('treats an unparsable frequency as unavailable, never as NaN', () => {
    expect(parseDevfreqReadings('cur_freq|n/a\n').ok).toBe(false)
  })

  it('drops unparsable entries from the frequency table', () => {
    const result = parseDevfreqReadings(
      'cur_freq|1000000\navailable_frequencies|1000000 n/a 2000000\n',
    )
    if (!result.ok) throw new Error('frequency alone is a reading')

    expect(result.value.availableMhz).toEqual([1, 2])
  })
})
