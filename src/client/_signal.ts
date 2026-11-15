export const DEFAULT_TIMEOUT = 30_000;

// `AbortSignal.any` and `AbortSignal.timeout` are missing in older browsers, and
// `any` is missing from the DOM types of older TypeScript (5.0 among them), which
// the library must compile with: read both through this narrower view.
interface AbortSignalStatics {
  timeout?(milliseconds: number): AbortSignal;
  any?(signals: AbortSignal[]): AbortSignal;
}

const signalStatics = (): AbortSignalStatics => AbortSignal;

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
  const statics = signalStatics();
  if (!untilHeaders && statics.timeout !== undefined) {
    return { signal: statics.timeout(timeout), stop: () => {} };
  }

  // `AbortSignal.timeout` cannot be cancelled (and older browsers lack it), so
  // here a timer is needed. The controller is local to this attempt and only
  // ever aborted by this timer, with the same reason `AbortSignal.timeout` gives.
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new DOMException("The operation timed out.", "TimeoutError"));
  }, timeout);
  return { signal: controller.signal, stop: () => clearTimeout(timer) };
}

export interface CombinedSignal {
  signal: AbortSignal;
  /**
   * Takes our listeners off the sources. Safe to call more than once. Without
   * `AbortSignal.any` it must be called once the signal is no longer needed,
   * or every request leaves a listener on the caller's signal.
   */
  release: () => void;
}

const noop = (): void => {};

/**
 * One signal for `fetch` from the caller's signal and the deadline.
 * `AbortSignal.any` puts no listener on its sources, so a long-lived caller
 * signal collects nothing from our requests. It wraps even a single caller
 * signal: then `fetch` subscribes to the derived signal, not to the caller's.
 * Where `AbortSignal.any` is missing, the sources are joined by hand.
 */
export function combineSignals(
  callerSignal: AbortSignal | undefined,
  deadline: Deadline | undefined,
): CombinedSignal | undefined {
  const signals: AbortSignal[] = [];
  if (callerSignal !== undefined) signals.push(callerSignal);
  if (deadline !== undefined) signals.push(deadline.signal);
  if (signals.length === 0) return undefined;
  const statics = signalStatics();
  if (statics.any !== undefined) return { signal: statics.any(signals), release: noop };
  return joinSignals(signals);
}

/** What `AbortSignal.any` does, with listeners that `release` takes off. */
function joinSignals(signals: AbortSignal[]): CombinedSignal {
  const controller = new AbortController();
  let removers: (() => void)[] = [];
  const release = (): void => {
    for (const remove of removers) remove();
    removers = [];
  };

  for (const source of signals) {
    if (source.aborted) {
      release();
      controller.abort(source.reason);
      break;
    }
    const onAbort = (): void => {
      release();
      controller.abort(source.reason);
    };
    source.addEventListener("abort", onAbort, { once: true });
    removers.push(() => source.removeEventListener("abort", onAbort));
  }
  return { signal: controller.signal, release };
}

/**
 * Throws the signal's reason when it is aborted. The same as
 * `signal.throwIfAborted()`, which some browsers got a little later than `reason`.
 */
export function throwIfAborted(signal: AbortSignal | undefined): void {
  // The reason is whatever the caller aborted with: it is theirs, rethrown as is.
  if (signal?.aborted === true) throw signal.reason;
}
