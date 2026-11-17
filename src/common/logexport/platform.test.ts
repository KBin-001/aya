import { describe, expect, it } from 'vitest'
import type { DetectedPlatform, ILogExportConfig } from './types'
import {
  classifyPlatform,
  matchPlatform,
  platformLabel,
  resolvePlatform,
} from './platform'
import { readPropsFixture } from './__fixtures__/load'

const cases: [string, Record<string, string>, DetectedPlatform][] = [
  ['the mtk literal', { 'ro.board.platform': 'mtk' }, 'mtk'],
  [
    'the mediatek literal in mixed case',
    { 'ro.soc.manufacturer': 'MediaTek' },
    'mtk',
  ],
  ['an mt8xxx model number', { 'ro.board.platform': 'mt8781' }, 'mtk'],
  ['an mt6xxx model number', { 'ro.hardware': 'mt6765' }, 'mtk'],
  ['a real MTK capture', readPropsFixture('getprop-mtk.json'), 'mtk'],
  ['the unisoc literal', { 'ro.board.platform': 'unisoc' }, 'unisoc'],
  ['the sprd literal', { 'ro.hardware': 'sprd' }, 'unisoc'],
  ['a bare ums value', { 'ro.board.platform': 'ums' }, 'unisoc'],
  ['a ums model number', { 'ro.board.platform': 'ums9230' }, 'unisoc'],
  [
    'a real UNISOC capture',
    readPropsFixture('getprop-unisoc.json'),
    'unisoc',
  ],
  [
    'a Qualcomm capture is unknown',
    readPropsFixture('getprop-unknown.json'),
    'unknown',
  ],
  ['an empty property map', {}, 'unknown'],
  [
    'empty property values',
    { 'ro.board.platform': '', 'ro.hardware': '' },
    'unknown',
  ],
  ['an unrecognised platform value', { 'ro.board.platform': 'kona' }, 'unknown'],
  [
    'the first matching property wins',
    { 'ro.board.platform': 'mtk', 'ro.soc.manufacturer': 'unisoc' },
    'mtk',
  ],
]

describe('classifyPlatform', () => {
  it.each(cases)('classifies %s', (_case, props, expected) => {
    expect(classifyPlatform(props)).toBe(expected)
  })
})

const keywordCases: [string, Record<string, string>, string | null][] = [
  ['mtk', { 'ro.board.platform': 'mtk' }, 'mtk'],
  ['mediatek', { 'ro.soc.manufacturer': 'MediaTek' }, 'mediatek'],
  ['an mt model number', { 'ro.hardware': 'mt8781' }, 'mt8781'],
  ['unisoc', { 'ro.board.platform': 'unisoc' }, 'unisoc'],
  ['sprd', { 'ro.hardware': 'sprd' }, 'sprd'],
  ['ums', { 'ro.board.platform': 'ums9230' }, 'ums'],
  ['no match', { 'ro.board.platform': 'kona' }, null],
]

describe('matchPlatform', () => {
  it.each(keywordCases)('reports the keyword for %s', (_case, props, keyword) => {
    expect(matchPlatform(props).keyword).toBe(keyword)
  })

  it('keeps platform and keyword consistent', () => {
    const match = matchPlatform(readPropsFixture('getprop-mtk.json'))
    expect(match).toEqual({ platform: 'mtk', keyword: 'mt8781' })
  })
})

function config(overrides: Partial<ILogExportConfig>): ILogExportConfig {
  return {
    autoDetect: true,
    manualPlatform: null,
    platforms: {
      mtk: { paths: ['/sdcard/debuglogger/'], selected: null },
      unisoc: { paths: ['/storage/emulated/0/ylog/'], selected: null },
    },
    outputDir: 'C:\\logs',
    ...overrides,
  }
}

const resolveCases: [
  string,
  ILogExportConfig,
  DetectedPlatform,
  DetectedPlatform,
][] = [
  [
    'the detected platform when auto-detect is on',
    config({ autoDetect: true }),
    'mtk',
    'mtk',
  ],
  [
    'the manual platform when detection is unknown',
    config({ autoDetect: true, manualPlatform: 'unisoc' }),
    'unknown',
    'unisoc',
  ],
  [
    'the manual platform when auto-detect is off',
    config({ autoDetect: false, manualPlatform: 'mtk' }),
    'unisoc',
    'mtk',
  ],
  [
    'unknown when auto-detect is off with no manual platform',
    config({ autoDetect: false, manualPlatform: null }),
    'mtk',
    'unknown',
  ],
]

describe('resolvePlatform', () => {
  it.each(resolveCases)('resolves %s', (_case, cfg, detected, expected) => {
    expect(resolvePlatform(cfg, detected)).toBe(expected)
  })
})

describe('platformLabel', () => {
  it.each([
    ['mtk', 'MTK'],
    ['unisoc', 'UNISOC'],
    ['unknown', '未知平台'],
  ] as const)('labels %s', (platform, label) => {
    expect(platformLabel(platform)).toBe(label)
  })
})
