// Older browsers lack `AbortSignal.any` (Chrome < 116, Firefox < 124, Safari < 17.4)
// and `AbortSignal.timeout` (Chrome < 103, Firefox < 100, Safari < 16). Here they are
// taken away, the shared timeout and cancel cases run again, and the hand-made
// combining is checked for listeners left on the caller's signal.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { createClient, HttpError, NetworkError, TimeoutError } from "../..";
import {
  abortListeners,
  delayedFetch,
  json,
  recordingFetch,
  rejectionOf,
  slowBodyFetch,
} from "./_helpers";
import { refreshCancelCases, signalCases } from "./_signalCases";

afterEach(() => {
  vi.restoreAllMocks();
});

type Static = "any" | "timeout";

/** Removes static methods of `AbortSignal` for the tests of the enclosing `describe`. */
function withoutAbortSignal(...names: Static[]): void {
  const saved = new Map<Static, PropertyDescriptor>();
  beforeAll(() => {
    for (const name of names) {
      const descriptor = Object.getOwnPropertyDescriptor(AbortSignal, name);
      if (descriptor === undefined) throw new Error(`AbortSignal.${name} is not here to remove`);
      saved.set(name, descriptor);
      Reflect.deleteProperty(AbortSignal, name);
    }
  });
  afterAll(() => {
    for (const [name, descriptor] of saved) Object.defineProperty(AbortSignal, name, descriptor);
  });

  it(`runs without AbortSignal.${names.join(" and AbortSignal.")}`, () => {
    for (const name of names) expect(name in AbortSignal).toBe(false);
  });
}

/** The caller's signal on the hand-made path: every listener added is removed. */
function handMadeCombiningCases(): void {
  describe("listeners on the caller's signal", () => {
    const failing = createClient({
      baseUrl: "/api",
      fetch: () => Promise.reject(new TypeError("down")),
    });
    const api = createClient({
      baseUrl: "/api",
      timeout: 20,
      fetch: delayedFetch((url) => (url.endsWith("/slow") ? 200 : 0)),
    });
    const notFound = createClient({ baseUrl: "/api", fetch: () => Promise.resolve(json({}, 404)) });

    it.each([
      ["a success", (signal: AbortSignal) => api.get("/fast", { signal })],
      [
        "an HttpError",
        (signal: AbortSignal) => rejectionOf(notFound.get("/x", { signal }), HttpError),
      ],
      [
        "a NetworkError",
        (signal: AbortSignal) => rejectionOf(failing.get("/x", { signal }), NetworkError),
      ],
      [
        "a timeout",
        (signal: AbortSignal) => rejectionOf(api.get("/slow", { signal }), TimeoutError),
      ],
    ])("are all removed after %s", async (_outcome, send) => {
      const { signal } = new AbortController();
      const listeners = abortListeners(signal);

      await send(signal);

      expect(listeners.added()).toBe(1);
      expect(listeners.removed()).toBe(1);
      expect(listeners.left()).toBe(0);
    });

    it("do not pile up on one signal reused across many requests", async () => {
      const controller = new AbortController();
      const { signal } = controller;
      const listeners = abortListeners(signal);

      for (let i = 0; i < 50; i++) await api.get("/fast", { signal });
      await rejectionOf(api.get("/slow", { signal }), TimeoutError);
      await rejectionOf(notFound.get("/x", { signal }), HttpError);
      await rejectionOf(failing.get("/x", { signal }), NetworkError);

      expect(listeners.added()).toBe(53);
      expect(listeners.removed()).toBe(53);
      expect(listeners.left()).toBe(0);
      expect(signal.aborted).toBe(false);
    });

    it("are removed when the caller cancels", async () => {
      const controller = new AbortController();
      const listeners = abortListeners(controller.signal);
      const reason = new Error("cancel");

      const pending = api.get("/slow", { signal: controller.signal });
      controller.abort(reason);

      await expect(pending).rejects.toBe(reason);
      expect(listeners.left()).toBe(0);
    });

    it("are never added for a signal aborted before the request", async () => {
      const { fetch, calls } = recordingFetch();
      const reason = new Error("already");
      const signal = AbortSignal.abort(reason);
      const listeners = abortListeners(signal);

      await expect(createClient({ baseUrl: "/api", fetch }).get("/x", { signal })).rejects.toBe(
        reason,
      );

      expect(calls).toHaveLength(0);
      expect(listeners.added()).toBe(0);
    });

    it("stay on a stream that resolved, one per request, until the caller aborts", async () => {
      const streams = createClient({
        baseUrl: "/api",
        fetch: slowBodyFetch("first ", "second", 200, "text/plain"),
      });
      const controller = new AbortController();
      const listeners = abortListeners(controller.signal);
      const reason = new Error("stop");

      const { data } = await streams.get("/x", {
        responseType: "stream",
        signal: controller.signal,
      });
      expect(listeners.left()).toBe(1);
      controller.abort(reason);

      await expect(new Response(data).text()).rejects.toBe(reason);
      expect(listeners.left()).toBe(0);
    });

    it("are removed after a stream request that failed with HttpError", async () => {
      const { signal } = new AbortController();
      const listeners = abortListeners(signal);

      await rejectionOf(notFound.get("/x", { responseType: "stream", signal }), HttpError);

      expect(listeners.left()).toBe(0);
    });
  });
}

/** The timeout on a timer instead of `AbortSignal.timeout`. */
function timerCases(): void {
  describe("the timeout timer", () => {
    it("is 30000 ms by default and is cleared once the request is done", async () => {
      const set = vi.spyOn(globalThis, "setTimeout");
      const clear = vi.spyOn(globalThis, "clearTimeout");
      const { fetch } = recordingFetch();

      await createClient({ baseUrl: "/api", fetch }).get("/x");

      expect(set).toHaveBeenCalledOnce();
      expect(set.mock.calls[0]?.[1]).toBe(30_000);
      expect(clear).toHaveBeenCalledWith(set.mock.results[0]?.value);
    });

    it("is cleared after a failed request too", async () => {
      const set = vi.spyOn(globalThis, "setTimeout");
      const clear = vi.spyOn(globalThis, "clearTimeout");
      const api = createClient({
        baseUrl: "/api",
        fetch: () => Promise.reject(new TypeError("down")),
      });

      await rejectionOf(api.get("/x"), NetworkError);

      expect(clear).toHaveBeenCalledWith(set.mock.results[0]?.value);
    });
  });
}

describe("without AbortSignal.any", () => {
  withoutAbortSignal("any");
  signalCases();
  refreshCancelCases();
  handMadeCombiningCases();
});

describe("without AbortSignal.timeout", () => {
  withoutAbortSignal("timeout");
  signalCases();
  refreshCancelCases();
  timerCases();
});

describe("without AbortSignal.any and AbortSignal.timeout", () => {
  withoutAbortSignal("any", "timeout");
  signalCases();
  refreshCancelCases();
  handMadeCombiningCases();
  timerCases();
});
