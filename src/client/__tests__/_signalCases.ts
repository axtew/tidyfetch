// Cases about timeouts and cancellation that must behave the same whether the
// runtime has `AbortSignal.any` and `AbortSignal.timeout` or not. They run in
// timeout.test.ts and refresh.test.ts with the real statics, and again in
// fallback.test.ts with them removed.
import { describe, expect, it, vi } from "vitest";

import { createClient, type FetchFunction, NetworkError, TimeoutError } from "../..";
import {
  abortListeners,
  bearerSetup,
  delayedFetch,
  flush,
  recordingFetch,
  rejectionOf,
  slowBodyFetch,
} from "./_helpers";

export function signalCases(): void {
  describe("timeout, cancellation and network failure are told apart", () => {
    it("throws TimeoutError when the timeout fires", async () => {
      const api = createClient({ baseUrl: "/api", timeout: 20, fetch: delayedFetch(200) });

      const error = await rejectionOf(api.get("/slow"), TimeoutError);

      expect(error).toMatchObject({
        name: "TimeoutError",
        timeout: 20,
        message: "GET /api/slow timed out after 20 ms",
        request: { method: "GET", url: "/api/slow" },
      });
      expect(error.cause).toMatchObject({ name: "TimeoutError" });
    });

    it("rethrows the standard AbortError when the caller cancels", async () => {
      const api = createClient({ baseUrl: "/api", fetch: delayedFetch(200) });
      const controller = new AbortController();

      const pending = api.get("/x", { signal: controller.signal });
      controller.abort();
      const error = await rejectionOf(pending, DOMException);

      expect(error).toMatchObject({ name: "AbortError" });
      expect(error).toBe(controller.signal.reason);
    });

    it("rethrows a custom abort reason as is", async () => {
      const api = createClient({ baseUrl: "/api", fetch: delayedFetch(200) });
      const controller = new AbortController();
      const reason = new Error("left the page");

      const pending = api.get("/x", { signal: controller.signal });
      controller.abort(reason);

      await expect(pending).rejects.toBe(reason);
    });

    it("rejects with the reason of a signal aborted before the request, without calling fetch", async () => {
      const fetch = vi.fn<FetchFunction>(delayedFetch(200));
      const api = createClient({ baseUrl: "/api", fetch });
      const reason = new Error("already");

      await expect(api.get("/x", { signal: AbortSignal.abort(reason) })).rejects.toBe(reason);
      expect(fetch).not.toHaveBeenCalled();
    });

    it("prefers the caller's cancel over the timeout when the caller aborted first", async () => {
      const api = createClient({ baseUrl: "/api", timeout: 30, fetch: delayedFetch(200) });
      const controller = new AbortController();
      const reason = new Error("cancel");

      const pending = api.get("/x", { signal: controller.signal });
      setTimeout(() => controller.abort(reason), 5);

      await expect(pending).rejects.toBe(reason);
    });

    it("throws NetworkError with the fetch error as cause", async () => {
      const failure = new TypeError("fetch failed");
      const api = createClient({ baseUrl: "/api", fetch: () => Promise.reject(failure) });

      const error = await rejectionOf(api.post("/x", { body: { a: 1 } }), NetworkError);

      expect(error).toMatchObject({
        name: "NetworkError",
        message: "POST /api/x failed with a network error",
        request: { method: "POST", url: "/api/x" },
      });
      expect(error.cause).toBe(failure);
    });
  });

  describe("abort while the body is being read", () => {
    it("throws TimeoutError when the timeout fires during the body", async () => {
      const api = createClient({
        baseUrl: "/api",
        timeout: 30,
        fetch: slowBodyFetch('{"a":', "1}", 200),
      });

      await expect(api.get("/x")).rejects.toBeInstanceOf(TimeoutError);
    });

    it("rethrows the caller's reason when cancelled during the body", async () => {
      const api = createClient({ baseUrl: "/api", fetch: slowBodyFetch('{"a":', "1}", 200) });
      const controller = new AbortController();
      const reason = new Error("cancel");

      const pending = api.get("/x", { signal: controller.signal });
      setTimeout(() => controller.abort(reason), 20);

      await expect(pending).rejects.toBe(reason);
    });

    it("reads a slow body that ends within the timeout", async () => {
      const api = createClient({
        baseUrl: "/api",
        timeout: 500,
        fetch: slowBodyFetch('{"a":', "1}", 20),
      });

      expect((await api.get("/x")).data).toEqual({ a: 1 });
    });
  });

  describe("timeout values", () => {
    it("passes no signal when there is nothing to watch", async () => {
      const { fetch, last } = recordingFetch();

      await createClient({ baseUrl: "/api", timeout: 0, fetch }).get("/x");

      expect("signal" in last().init).toBe(false);
    });

    it("does not time out with 0 even for a slow response", async () => {
      const api = createClient({ baseUrl: "/api", timeout: 0, fetch: delayedFetch(60) });

      expect((await api.get("/x")).data).toBe("ok");
    });

    it("lets the request timeout override the client timeout", async () => {
      const slowFirst = createClient({ baseUrl: "/api", timeout: 20, fetch: delayedFetch(60) });
      expect((await slowFirst.get("/x", { timeout: 0 })).data).toBe("ok");
      expect((await slowFirst.get("/x", { timeout: 500 })).data).toBe("ok");

      const noTimeout = createClient({ baseUrl: "/api", timeout: 0, fetch: delayedFetch(200) });
      const error = await rejectionOf(noTimeout.get("/x", { timeout: 20 }), TimeoutError);
      expect(error.timeout).toBe(20);
    });

    it("does not affect the next request after one timed out", async () => {
      const api = createClient({
        baseUrl: "/api",
        timeout: 20,
        fetch: delayedFetch((url) => (url.endsWith("/slow") ? 200 : 0)),
      });

      await expect(api.get("/slow")).rejects.toBeInstanceOf(TimeoutError);
      expect((await api.get("/fast")).data).toBe("ok");
      await new Promise((resolve) => setTimeout(resolve, 40));
      expect((await api.get("/fast")).data).toBe("ok");
    });
  });

  describe("the signal passed to fetch", () => {
    it("is a derived signal, not the caller's own", async () => {
      const { fetch, last } = recordingFetch();
      const { signal } = new AbortController();

      await createClient({ baseUrl: "/api", timeout: 0, fetch }).get("/x", { signal });

      expect(last().init.signal).toBeInstanceOf(AbortSignal);
      expect(last().init.signal).not.toBe(signal);
    });
  });

  describe("responseType stream and the timeout", () => {
    it("covers the wait for the headers", async () => {
      const api = createClient({ baseUrl: "/api", timeout: 20, fetch: delayedFetch(200) });

      await expect(api.get("/x", { responseType: "stream" })).rejects.toBeInstanceOf(TimeoutError);
    });

    it("stops once the headers arrive, so a long stream is read to the end", async () => {
      const api = createClient({
        baseUrl: "/api",
        timeout: 20,
        fetch: slowBodyFetch("first ", "second", 80, "text/plain"),
      });

      const { data } = await api.get("/x", { responseType: "stream" });

      expect(await new Response(data).text()).toBe("first second");
    });

    it("keeps the caller's signal on the stream", async () => {
      const api = createClient({
        baseUrl: "/api",
        fetch: slowBodyFetch("first ", "second", 200, "text/plain"),
      });
      const controller = new AbortController();
      const reason = new Error("stop");

      const { data } = await api.get("/x", {
        responseType: "stream",
        signal: controller.signal,
      });
      controller.abort(reason);

      await expect(new Response(data).text()).rejects.toBe(reason);
    });
  });
}

export function refreshCancelCases(): void {
  describe("cancelling while waiting for the refresh", () => {
    it("rejects only the cancelled request; the refresh goes on for the others", async () => {
      const { api, gate, refresh, server } = bearerSetup({ gated: true });
      const cancelled = new AbortController();
      const other = new AbortController();
      const otherListeners = abortListeners(other.signal);
      const reason = new Error("left the page");

      const a = api.get("/a", { signal: cancelled.signal });
      const b = api.get("/b", { signal: other.signal });
      const c = api.get("/c");
      await flush();
      cancelled.abort(reason);

      await expect(a).rejects.toBe(reason);
      expect(refresh).toHaveBeenCalledOnce();

      gate.resolve();
      await expect(b).resolves.toMatchObject({ data: { url: "/api/b" } });
      await expect(c).resolves.toMatchObject({ data: { url: "/api/c" } });
      expect(refresh).toHaveBeenCalledOnce();
      expect(server.sentTo("/api/a")).toHaveLength(1);
      // The wait listens to the caller's signal and lets it go afterwards.
      expect(otherListeners.added()).toBeGreaterThan(0);
      expect(otherListeners.left()).toBe(0);
    });

    it("rejects with the default AbortError when aborted without a reason", async () => {
      const { api, gate } = bearerSetup({ gated: true });
      const controller = new AbortController();

      const pending = api.get("/a", { signal: controller.signal });
      await flush();
      controller.abort();
      const error = await rejectionOf(pending, DOMException);
      gate.resolve();

      expect(error.name).toBe("AbortError");
    });

    it("does not refresh on a timeout", async () => {
      const refresh = vi.fn<() => Promise<boolean>>(() => Promise.resolve(true));
      const api = createClient({
        baseUrl: "/api",
        timeout: 5,
        refresh,
        fetch: delayedFetch(1000),
      });

      await expect(api.get("/x")).rejects.toBeInstanceOf(TimeoutError);
      expect(refresh).not.toHaveBeenCalled();
    });
  });
}
