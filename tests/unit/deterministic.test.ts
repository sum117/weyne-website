import { describe, expect, it } from 'vitest'
import {
  createDeterministicClock,
  createDeterministicIdGenerator,
} from '../support/deterministic'

describe('deterministic test utilities', () => {
  it('restarts clock and ID sequences for every factory instance', () => {
    const start = new Date('2042-01-02T03:04:05.000Z')
    const firstClock = createDeterministicClock(start, 1_000)
    const firstIds = createDeterministicIdGenerator('fixture')

    expect([firstClock(), firstClock()]).toEqual([
      start,
      new Date('2042-01-02T03:04:06.000Z'),
    ])
    expect([firstIds(), firstIds()]).toEqual(['fixture-0001', 'fixture-0002'])

    const secondClock = createDeterministicClock(start, 1_000)
    const secondIds = createDeterministicIdGenerator('fixture')

    expect(secondClock()).toEqual(start)
    expect(secondIds()).toBe('fixture-0001')
  })
})
