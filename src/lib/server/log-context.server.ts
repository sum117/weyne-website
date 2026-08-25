import { AsyncLocalStorage } from 'node:async_hooks'

/**
 * Ambient request context attached to every log line emitted while a request
 * (or any background work spawned from it) is in flight. The production
 * runtime opens a scope per HTTP request; `node:async_hooks` propagates the
 * store through awaits, timers, and promise chains, so server functions and
 * deferred jobs inherit the caller's correlation ID without threading it
 * through every signature.
 *
 * Work scheduled entirely outside a request (cron-style timers started at
 * boot) has no store and simply logs without a request ID; wrap it in
 * `runWithLogContext` when it needs its own correlation ID.
 */
export type LogContext = Readonly<{
  requestId: string
}>

const storage = new AsyncLocalStorage<LogContext>()

export function runWithLogContext<T>(context: LogContext, fn: () => T): T {
  return storage.run(context, fn)
}

/** Current correlation ID, when called inside a log context. */
export function currentRequestId(): string | undefined {
  return storage.getStore()?.requestId
}
