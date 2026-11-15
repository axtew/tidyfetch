import { vi } from "vitest";

import { createClient, type FetchFunction } from "../..";

export interface RecordedCall {
  url: string;
  init: RequestInit;
  headers: Headers;
}

/** A `fetch` that records every call and answers with a fresh response from `respond`. */
export function recordingFetch(
  respond: () => Response = () => new Response(null, { status: 204 }),
): {
  fetch: FetchFunction;
  calls: RecordedCall[];
  last: () => RecordedCall;
} {
  const calls: RecordedCall[] = [];
  const fetch: FetchFunction = (url, init) => {
    calls.push({ url, init, headers: new Headers(init.headers) });
    return Promise.resolve(respond());
  };
  const last = (): RecordedCall => {
    const call = calls.at(-1);
    if (call === undefined) throw new Error("fetch was not called");
    return call;
  };
  return { fetch, calls, last };
}

/** Rejects like the real `fetch` on an aborted signal: with the signal's reason. */
function onAbort(signal: AbortSignal | null | undefined, reject: (reason: unknown) => void): void {
  if (!signal) return;
  if (signal.aborted) {
    reject(signal.reason);
    return;
  }
  signal.addEventListener("abort", () => reject(signal.reason), { once: true });
}

/**
 * A `fetch` that answers after `delay` ms and honours `init.signal` like the
 * real one. `delay` may depend on the URL.
 */
export function delayedFetch(
  delay: number | ((url: string) => number),
  respond: () => Response = () => new Response("ok"),
): FetchFunction {
  return (url, init) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => resolve(respond()),
        typeof delay === "number" ? delay : delay(url),
      );
      onAbort(init.signal, (reason) => {
        clearTimeout(timer);
        reject(reason);
      });
    });
}

/**
 * A `fetch` whose headers arrive at once and whose body sends `first`, then
 * `rest` after `restDelay` ms. Like the real one, an abort errors the body
 * stream with the signal's reason.
 */
export function slowBodyFetch(
  first: string,
  rest: string,
  restDelay: number,
  contentType = "application/json",
): FetchFunction {
  return (_url, init) => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(first));
        const timer = setTimeout(() => {
          controller.enqueue(encoder.encode(rest));
          controller.close();
        }, restDelay);
        onAbort(init.signal, (reason) => {
          clearTimeout(timer);
          controller.error(reason);
        });
      },
    });
    return Promise.resolve(new Response(body, { headers: { "content-type": contentType } }));
  };
}

/** Awaits a promise that must reject with an instance of `errorClass`, and returns it typed. */
export async function rejectionOf<E>(
  promise: Promise<unknown>,
  errorClass: abstract new (...args: never[]) => E,
): Promise<E> {
  const error = await promise.then(
    () => new Error("expected a rejection, the promise resolved"),
    (reason: unknown) => reason,
  );
  if (!(error instanceof errorClass)) {
    throw new Error(`expected a rejection with ${errorClass.name}, got ${String(error)}`);
  }
  return error;
}

export interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

/** A promise settled from the outside, to put steps of a test in a fixed order. */
export function deferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

/** Lets every pending promise callback run: resolves after the current macrotask. */
export function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export interface SentRequest {
  url: string;
  method: string;
  headers: Headers;
  body: RequestInit["body"];
  credentials: RequestCredentials | undefined;
}

/**
 * A fake server behind a `fetch`: `handle` answers each request, possibly later.
 * Records what was sent.
 */
export function fakeServer(handle: (request: SentRequest) => Response | Promise<Response>): {
  fetch: FetchFunction;
  sent: SentRequest[];
  sentTo: (path: string) => SentRequest[];
} {
  const sent: SentRequest[] = [];
  const fetch: FetchFunction = async (url, init) => {
    const request: SentRequest = {
      url,
      method: init.method ?? "GET",
      headers: new Headers(init.headers),
      body: init.body,
      credentials: init.credentials,
    };
    sent.push(request);
    return handle(request);
  };
  const sentTo = (path: string): SentRequest[] => sent.filter((request) => request.url === path);
  return { fetch, sent, sentTo };
}

export const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

export const unauthorized = (): Response => json({ message: "token expired" }, 401);

export const authOf = (request: SentRequest | undefined): string | null =>
  request?.headers.get("authorization") ?? null;

/**
 * A bearer-token setup: the server accepts only `Bearer <valid>`, the client
 * reads `token` at send time, and `refresh` waits for `gate` (open by default)
 * before it puts the valid token in place and resolves with `result`.
 */
export function bearerSetup({
  result = true,
  gated = false,
  hold,
}: {
  result?: boolean;
  gated?: boolean;
  /** Holds the answer to the matching request until the returned promise resolves. */
  hold?: (request: SentRequest) => Promise<void> | undefined;
} = {}) {
  const state = { token: "old", valid: "new" };
  const gate = deferred();
  if (!gated) gate.resolve();
  const refresh = vi.fn<() => Promise<boolean>>(async () => {
    await gate.promise;
    if (result) state.token = state.valid;
    return result;
  });
  const server = fakeServer(async (request) => {
    const ok = authOf(request) === `Bearer ${state.valid}`;
    if (!ok) await hold?.(request);
    return ok ? json({ url: request.url }) : unauthorized();
  });
  const headers = vi.fn<() => HeadersInit>(() => ({ Authorization: `Bearer ${state.token}` }));
  const api = createClient({ baseUrl: "/api", headers, refresh, fetch: server.fetch });
  return { api, state, gate, refresh, server, headers };
}

/** The listeners of the "abort" calls among recorded add/removeEventListener calls. */
const abortOnly = (calls: unknown[][]): unknown[] =>
  calls.filter(([type]) => type === "abort").map(([, listener]) => listener);

/**
 * Watches the abort listeners put on a signal: how many were added and removed,
 * and how many of the added ones were never removed.
 */
export function abortListeners(signal: AbortSignal): {
  added: () => number;
  removed: () => number;
  left: () => number;
} {
  const add = vi.spyOn(signal, "addEventListener");
  const remove = vi.spyOn(signal, "removeEventListener");
  return {
    added: () => abortOnly(add.mock.calls).length,
    removed: () => abortOnly(remove.mock.calls).length,
    left: () => {
      const removed = new Set(abortOnly(remove.mock.calls));
      return abortOnly(add.mock.calls).filter((listener) => !removed.has(listener)).length;
    },
  };
}
