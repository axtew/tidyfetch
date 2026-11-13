/**
 * Calls an observing hook. It is not awaited and its result is ignored; a
 * throw or a rejection does not reach the request but is reported.
 */
export function notify<A extends unknown[]>(
  hook: ((...args: A) => unknown) | undefined,
  ...args: A
): void {
  if (hook === undefined) return;
  try {
    const result = hook(...args);
    if (result instanceof Promise) result.then(undefined, reportHookError);
  } catch (error) {
    reportHookError(error);
  }
}

// `reportError` is missing in Node; read it through this view to check for it.
interface ErrorReporting {
  reportError?: ((error: unknown) => void) | undefined;
}

/**
 * Reports an exception from a hook as an uncaught one, out of the request's way:
 * through `reportError` where there is one (browsers, Deno), so it reaches the
 * `error` event and error trackers; elsewhere (Node) it is rethrown in a
 * microtask and becomes an `uncaughtException`.
 */
function reportHookError(error: unknown): void {
  const scope: ErrorReporting = globalThis;
  if (scope.reportError === undefined) {
    queueMicrotask(() => {
      throw error;
    });
  } else {
    scope.reportError(error);
  }
}
