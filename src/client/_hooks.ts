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
 * Reports an exception from a hook out of the request's way. Where there is
 * `reportError` (browsers, Deno), through it: it reaches the `error` event and
 * error trackers and stops nothing. Elsewhere (Node) it is logged with
 * `console.error`: rethrown, it would become an `uncaughtException`, which by
 * default ends the process, a whole server for one broken log line.
 */
function reportHookError(error: unknown): void {
  const scope: ErrorReporting = globalThis;
  if (scope.reportError === undefined) {
    console.error("tidyfetch: a hook threw", error);
  } else {
    scope.reportError(error);
  }
}
