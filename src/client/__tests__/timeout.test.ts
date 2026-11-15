import { afterEach, describe, expect, it, vi } from "vitest";

import { createClient, NetworkError, TimeoutError } from "../..";
import { delayedFetch, recordingFetch } from "./_helpers";
import { signalCases } from "./_signalCases";

afterEach(() => {
  vi.restoreAllMocks();
});

signalCases();

describe("with AbortSignal.timeout", () => {
  it("uses 30000 ms by default", async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    const { fetch, last } = recordingFetch();

    await createClient({ baseUrl: "/api", fetch }).get("/x");

    expect(timeoutSpy).toHaveBeenCalledWith(30_000);
    expect(last().init.signal).toBeInstanceOf(AbortSignal);
  });

  it("turns the timeout off with 0, and passes no signal when there is nothing to watch", async () => {
    const { fetch, last } = recordingFetch();
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");

    await createClient({ baseUrl: "/api", timeout: 0, fetch }).get("/x");

    expect(timeoutSpy).not.toHaveBeenCalled();
    expect("signal" in last().init).toBe(false);
  });
});

describe("with AbortSignal.any, no listeners on the caller's signal", () => {
  it("adds none, over many requests with one signal, failed ones included", async () => {
    const controller = new AbortController();
    const { signal } = controller;
    const add = vi.spyOn(signal, "addEventListener");
    const remove = vi.spyOn(signal, "removeEventListener");
    const api = createClient({
      baseUrl: "/api",
      timeout: 20,
      fetch: delayedFetch((url) => (url.endsWith("/slow") ? 200 : 0)),
    });

    for (let i = 0; i < 50; i++) await api.get("/fast", { signal });
    await expect(api.get("/slow", { signal })).rejects.toBeInstanceOf(TimeoutError);
    await expect(
      createClient({ baseUrl: "/api", fetch: () => Promise.reject(new TypeError("down")) }).get(
        "/x",
        { signal },
      ),
    ).rejects.toBeInstanceOf(NetworkError);

    expect(add).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(signal.aborted).toBe(false);
  });
});
