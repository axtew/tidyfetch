import { HttpError } from "../errors";
import type { HttpRequest } from "../request";

/** How one shared refresh ended. */
interface RefreshOutcome {
  renewed: boolean;
  /** What `refresh` threw, when it threw. */
  error?: unknown;
}

export interface RefreshableRequest {
  /** The caller's signal: aborting it ends this caller's wait for the refresh, not the refresh. */
  signal: AbortSignal | undefined;
  /** `false` when the request cannot be sent twice (a stream body). */
  resendable: boolean;
  /** `true` when a 401 of this request must not trigger a refresh. */
  skip: boolean;
}

/** Sends a request, and on 401 refreshes the credentials and sends it once more. */
export type SendWithRefresh = <T>(
  send: () => Promise<T>,
  request: RefreshableRequest,
) => Promise<T>;

/**
 * The refresh of one client. Every request that gets 401 while a refresh is
 * running waits for that same refresh instead of starting its own, and is then
 * sent once more. The retry is not covered: its 401 is final. A retry limit
 * kept per request, not inside the shared refresh, is what keeps a server that
 * answers 401 to everything from being asked forever.
 */
export function createRefresh(
  refresh: () => Promise<boolean>,
  skipRefresh: ((request: HttpRequest) => boolean) | undefined,
): SendWithRefresh {
  // The refresh in progress, shared by all requests that got 401 meanwhile.
  let inFlight: Promise<RefreshOutcome> | undefined;
  // How many refreshes have succeeded. A request reads it before it is sent: if it
  // changed by the time the 401 arrives, the request went with replaced credentials.
  let renewals = 0;

  async function runRefresh(): Promise<RefreshOutcome> {
    try {
      // Only a real `true` counts: an untyped `refresh` may return anything.
      const result: unknown = await refresh();
      const renewed = result === true;
      if (renewed) renewals++;
      return { renewed };
    } catch (error) {
      return { renewed: false, error };
    }
  }

  function sharedRefresh(): Promise<RefreshOutcome> {
    // Cleared once settled, so a later 401 starts a new refresh. The `finally`
    // callback runs after this assignment even if `refresh` throws at once.
    inFlight ??= runRefresh().finally(() => {
      inFlight = undefined;
    });
    return inFlight;
  }

  return async function sendWithRefresh<T>(
    send: () => Promise<T>,
    { signal, resendable, skip }: RefreshableRequest,
  ): Promise<T> {
    const renewalsAtSend = renewals;
    try {
      return await send();
    } catch (error) {
      if (!isUnauthorized(error) || skip || skipRefresh?.(error.request) === true) throw error;

      // No refresh succeeded since the request was sent, so its credentials are the
      // current ones and they are rejected: renew them. Otherwise the request went
      // out with the old ones, and a second refresh for it would be one too many.
      if (renewals === renewalsAtSend) {
        const outcome = await untilAborted(sharedRefresh(), signal);
        if (!outcome.renewed) throw withCause(error, outcome.error);
      }

      // A stream body was used up by the first attempt. The credentials are fresh
      // by now either way, so the caller can send a new stream.
      if (!resendable) throw error;
      return send();
    }
  };
}

function isUnauthorized(error: unknown): error is HttpError {
  return error instanceof HttpError && error.status === 401;
}

function withCause(error: HttpError, cause: unknown): HttpError {
  if (cause === undefined) return error;
  const { request, response, data } = error;
  return new HttpError({ request, response, data, cause });
}

/**
 * Waits for `promise`, or rejects with the signal's reason when the signal aborts
 * first. Only this wait ends: the promise goes on for everyone else.
 */
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (signal === undefined) return promise;
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = (): void => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    void promise.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", onAbort);
    });
  });
}
