export const DEFAULT_TIMEOUT = 30_000;

// `AbortSignal.any` is missing from the DOM types of older TypeScript (5.0 among
// them), and the library must compile there: read it through this narrower view.
interface AbortSignalStatics {
  timeout(milliseconds: number): AbortSignal;
  any?(signals: AbortSignal[]): AbortSignal;
}

export interface Deadline {
  signal: AbortSignal;
  /** Stops the timer, if it can be stopped. */
  stop: () => void;
}

/**
 * The timeout of one attempt, or `undefined` when there is none (`0`).
 * `untilHeaders` makes it stoppable once the response headers arrive: a stream
 * body is read by the caller after the request resolves and may run for long.
 */
export function startDeadline(timeout: number, untilHeaders: boolean): Deadline | undefined {
  if (!(timeout > 0 && Number.isFinite(timeout))) return undefined;
  if (!untilHeaders) return { signal: AbortSignal.timeout(timeout), stop: () => {} };

  // `AbortSignal.timeout` cannot be cancelled, so here a timer is needed.
  // The controller is local to this attempt and only ever aborted by this timer.
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new DOMException("The operation timed out.", "TimeoutError"));
  }, timeout);
  return { signal: controller.signal, stop: () => clearTimeout(timer) };
}

/**
 * One signal for `fetch` from the caller's signal and the deadline.
 * `AbortSignal.any` puts no listener on its sources, so a long-lived caller
 * signal collects nothing from our requests. It wraps even a single caller
 * signal: then `fetch` subscribes to the derived signal, not to the caller's.
 */
export function combineSignals(
  callerSignal: AbortSignal | undefined,
  deadline: Deadline | undefined,
): AbortSignal | undefined {
  const signals: AbortSignal[] = [];
  if (callerSignal !== undefined) signals.push(callerSignal);
  if (deadline !== undefined) signals.push(deadline.signal);
  if (signals.length === 0) return undefined;
  const signalStatics: AbortSignalStatics = AbortSignal;
  if (signalStatics.any === undefined) {
    throw new TypeError(
      "AbortSignal.any is not supported here (needs Chrome 116, Firefox 124, Safari 17.4, Node 20.3)",
    );
  }
  return signalStatics.any(signals);
}
