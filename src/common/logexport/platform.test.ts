import { describe, expect, it } from 'vitest'
import type { LogPlatform } from './types'
import { classifyPlatform } from './platform'
import { readPropsFixture } from './__fixtures__/load'

const cases: [string, Record<string, string>, LogPlatform | 'unknown'][] = [
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
