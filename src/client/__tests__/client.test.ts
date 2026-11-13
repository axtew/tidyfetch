import { afterEach, describe, expect, it, vi } from "vitest";

import { createClient, type FetchFunction } from "../..";
import { recordingFetch } from "./_helpers";

afterEach(() => {
  vi.unstubAllGlobals();
});

const noContent = (): Promise<Response> => Promise.resolve(new Response(null, { status: 204 }));

describe("sending", () => {
  it("passes credentials to fetch", async () => {
    const { fetch, last } = recordingFetch();
    const api = createClient({ baseUrl: "/api", credentials: "include", fetch });

    await api.get("/me");

    expect(last().init.credentials).toBe("include");
  });

  it("calls fetch with a string URL and the method upper-cased", async () => {
    const { fetch, calls } = recordingFetch();
    const api = createClient({ baseUrl: "/api", fetch });

    await api.patch("/x");
    await api.request("patch", "/x");
    await api.delete("/x");

    expect(calls.map((call) => call.init.method)).toEqual(["PATCH", "PATCH", "DELETE"]);
    expect(calls[0]?.url).toBe("/api/x");
  });

  it("reads the global fetch at call time and calls it with globalThis as this", async () => {
    const api = createClient({ baseUrl: "/api" });
    const spy = vi.fn<FetchFunction>(noContent);
    vi.stubGlobal("fetch", spy);

    await api.get("/me");

    expect(spy).toHaveBeenCalledWith("/api/me", expect.objectContaining({ method: "GET" }));
    expect(spy.mock.contexts[0]).toBe(globalThis);
  });

  it("does not call a custom fetch as a method of the options object", async () => {
    const spy = vi.fn<FetchFunction>(noContent);
    const options = { baseUrl: "/api", fetch: spy };

    await createClient(options).get("/me");

    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.contexts[0]).not.toBe(options);
  });
});

describe("response (minimal until response parsing and errors arrive)", () => {
  it("returns the response shape with JSON data", async () => {
    const { fetch } = recordingFetch(
      () =>
        new Response(JSON.stringify({ id: 1 }), {
          status: 201,
          headers: { "content-type": "application/json; charset=utf-8" },
        }),
    );
    const api = createClient({ baseUrl: "/api", fetch });

    const response = await api.post<{ id: number }>("/items", { body: { name: "a" } });

    expect(response).toMatchObject({ ok: true, status: 201, url: "/api/items", data: { id: 1 } });
    expect(response.headers).toBeInstanceOf(Headers);
  });

  it("gives text for a non-JSON body and undefined for an empty one", async () => {
    let next = new Response("plain", { headers: { "content-type": "text/plain" } });
    const api = createClient({ baseUrl: "/api", fetch: () => Promise.resolve(next) });

    expect((await api.get("/a")).data).toBe("plain");
    next = new Response(null, { status: 204 });
    expect((await api.get("/a")).data).toBeUndefined();
  });
});
