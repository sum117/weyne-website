export type TestClock = () => Date
export type TestIdGenerator = () => string

export function createDeterministicClock(
  start: Date,
  stepMilliseconds = 0,
): TestClock {
  const startMilliseconds = start.getTime()
  let invocation = 0

  return () => {
    const value = new Date(startMilliseconds + invocation * stepMilliseconds)
    invocation += 1
    return value
  }
}

export function createDeterministicIdGenerator(
  prefix = 'test',
): TestIdGenerator {
  let sequence = 1

  return () => `${prefix}-${String(sequence++).padStart(4, '0')}`
}
