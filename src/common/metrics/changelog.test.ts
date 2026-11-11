import { describe, expect, it } from 'vitest'
import { recordChange } from './changelog'

describe('recordChange', () => {
  it('records a transition with the sample time', () => {
    expect(recordChange([], 1000, 'discharging', 'charging')).toEqual([
      { at: 1000, from: 'discharging', to: 'charging' },
    ])
  })

  it('records nothing when the value did not move', () => {
    // A value that stays put for a long time must not fill the log.
    const log = recordChange([], 1000, 'charging', 'charging')

    expect(log).toEqual([])
  })

  it('records every transition of a value that flaps', () => {
    let log = recordChange([], 1000, 'discharging', 'charging')
    log = recordChange(log, 2000, 'charging', 'discharging')
    log = recordChange(log, 3000, 'discharging', 'charging')

    expect(log).toHaveLength(3)
    expect(log[2]).toEqual({ at: 3000, from: 'discharging', to: 'charging' })
  })

  it('records nothing on the first sample, when there is no previous value', () => {
    expect(recordChange([], 1000, null, 'charging')).toEqual([])
  })

  it('records nothing when the value became unreadable', () => {
    expect(recordChange([], 1000, 'charging', null)).toEqual([])
  })

  it('keeps the newest records when the log is full', () => {
    let log = recordChange([], 0, 'a', 'b', 2)
    log = recordChange(log, 1, 'b', 'c', 2)
    log = recordChange(log, 2, 'c', 'd', 2)

    expect(log.map((record) => record.to)).toEqual(['c', 'd'])
  })

  it('does not mutate the log it is given', () => {
    const original = recordChange([], 0, 'a', 'b')

    recordChange(original, 1, 'b', 'c')

    expect(original).toHaveLength(1)
  })
})
