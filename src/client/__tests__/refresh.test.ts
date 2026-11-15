import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createClient,
  type HttpClient,
  HttpError,
  type HttpRequest,
  NetworkError,
  ParseError,
} from "../..";
import {
  authOf,
  bearerSetup,
  deferred,
  fakeServer,
  flush,
  json,
  rejectionOf,
  unauthorized,
} from "./_helpers";
import { refreshCancelCases } from "./_signalCases";

afterEach(() => {
  vi.restoreAllMocks();
});

const jsonType = { headers: { "content-type": "application/json" } };

describe("parallel 401 responses share one refresh", () => {
  it("calls refresh once for five parallel 401s and retries each once with the new token", async () => {
    const { api, gate, refresh, server } = bearerSetup({ gated: true });

    const pending = [1, 2, 3, 4, 5].map((id) => api.get(`/items/${id}`));
    await flush();
    expect(refresh).toHaveBeenCalledOnce();
    expect(server.sent).toHaveLength(5);

    gate.resolve();
    const responses = await Promise.all(pending);

    expect(responses.map((response) => response.data)).toEqual(
      [1, 2, 3, 4, 5].map((id) => ({ url: `/api/items/${id}` })),
    );
    expect(refresh).toHaveBeenCalledOnce();
    expect(server.sent.map(authOf)).toEqual([
      ...Array<string>(5).fill("Bearer old"),
      ...Array<string>(5).fill("Bearer new"),
    ]);
    for (const id of [1, 2, 3, 4, 5]) expect(server.sentTo(`/api/items/${id}`)).toHaveLength(2);
  });

  it("starts a new refresh for a later 401 wave, once the first refresh has settled", async () => {
    const { api, state, refresh } = bearerSetup();

    await Promise.all([api.get("/a"), api.get("/b")]);
    expect(refresh).toHaveBeenCalledTimes(1);

    state.valid = "newer";
    await Promise.all([api.get("/a"), api.get("/b")]);

    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("does not refresh when there is no 401", async () => {
    const { api, state, refresh } = bearerSetup();
    state.token = "new";

    await api.get("/a");

    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("a refresh that fails", () => {
  it("rejects every waiting request with its own 401 HttpError when refresh returns false", async () => {
    const { api, gate, refresh, server } = bearerSetup({ result: false, gated: true });

    const pending = ["/a", "/b", "/c"].map((path) => rejectionOf(api.get(path), HttpError));
    await flush();
    gate.resolve();
    const errors = await Promise.all(pending);

    expect(refresh).toHaveBeenCalledOnce();
    expect(server.sent).toHaveLength(3);
    expect(errors.map((error) => [error.status, error.request.url])).toEqual([
      [401, "/api/a"],
      [401, "/api/b"],
      [401, "/api/c"],
    ]);
    for (const error of errors) {
      expect(error.data).toEqual({ message: "token expired" });
      expect("cause" in error).toBe(false);
    }
  });

  it("rejects with the 401 HttpError and the refresh exception as its cause when refresh throws", async () => {
    const failure = new Error("refresh token expired");
    const gate = deferred();
    const refresh = vi.fn<() => Promise<boolean>>(async () => {
      await gate.promise;
      throw failure;
    });
    const server = fakeServer(() => unauthorized());
    const api = createClient({ baseUrl: "/api", refresh, fetch: server.fetch });

    const pending = ["/a", "/b", "/c"].map((path) => rejectionOf(api.get(path), HttpError));
    await flush();
    gate.resolve();
    const errors = await Promise.all(pending);

    expect(refresh).toHaveBeenCalledOnce();
    expect(server.sent).toHaveLength(3);
    for (const [index, error] of errors.entries()) {
      expect(error.status).toBe(401);
      expect(error.request.url).toBe(["/api/a", "/api/b", "/api/c"][index]);
      expect(error.data).toEqual({ message: "token expired" });
      expect(error.response.status).toBe(401);
      expect(error.cause).toBe(failure);
    }
  });

  it("treats a refresh that throws synchronously like one that rejects, and can run again", async () => {
    const failure = new Error("sync");
    const refresh = vi.fn<() => Promise<boolean>>(() => {
      throw failure;
    });
    const api = createClient({
      baseUrl: "/api",
      refresh,
      fetch: fakeServer(() => unauthorized()).fetch,
    });

    expect((await rejectionOf(api.get("/a"), HttpError)).cause).toBe(failure);
    expect((await rejectionOf(api.get("/b"), HttpError)).cause).toBe(failure);
    expect(refresh).toHaveBeenCalledTimes(2);
  });
});

describe("the old infinite-retry bug: the retry limit lives in each request, not in the shared refresh", () => {
  it("against a server that always answers 401 and a refresh that always succeeds: one refresh per wave, each request sent at most twice", async () => {
    const gate = deferred();
    const refresh = vi.fn<() => Promise<boolean>>(async () => {
      await gate.promise;
      return true;
    });
    // A safety stop: should the retries loop again, the server breaks the loop with
    // a 500 and the counts below fail, instead of the test hanging.
    const server = fakeServer(() => (server.sent.length > 50 ? json({}, 500) : unauthorized()));
    const api = createClient({ baseUrl: "/api", refresh, fetch: server.fetch });

    // First wave, and a fresh request that joins it while the refresh is running:
    // in the old client the fresh request reset the retry counter of the whole wave.
    const wave = ["/a", "/b", "/c"].map((path) => rejectionOf(api.get(path), HttpError));
    await flush();
    wave.push(rejectionOf(api.get("/fresh"), HttpError));
    await flush();
    gate.resolve();
    const errors = await Promise.all(wave);

    expect(errors.map((error) => error.status)).toEqual([401, 401, 401, 401]);
    expect(refresh).toHaveBeenCalledOnce();
    for (const path of ["/api/a", "/api/b", "/api/c", "/api/fresh"]) {
      expect(server.sentTo(path)).toHaveLength(2);
    }

    // A second wave gets its own single refresh, and nothing more.
    const second = ["/a", "/b"].map((path) => rejectionOf(api.get(path), HttpError));
    await Promise.all(second);

    expect(refresh).toHaveBeenCalledTimes(2);
    expect(server.sent).toHaveLength(12);
  });
});

describe("a stale 401: the request went out with the old token", () => {
  it.each([
    ["before the refresh started", false],
    ["while the refresh was running", true],
  ])(
    "is retried without a second refresh when sent %s and answered after it succeeded",
    async (_when, sentDuringRefresh) => {
      const lateAnswer = deferred();
      const { api, gate, refresh, server } = bearerSetup({
        gated: true,
        hold: (request) => (request.url === "/api/slow" ? lateAnswer.promise : undefined),
      });

      let slow = sentDuringRefresh ? undefined : api.get("/slow");
      const fast = api.get("/fast");
      await flush();
      expect(refresh).toHaveBeenCalledOnce();
      slow ??= api.get("/slow");
      await flush();

      gate.resolve();
      await fast;
      // The refresh has succeeded and settled; only now the old-token 401 arrives.
      lateAnswer.resolve();

      await expect(slow).resolves.toMatchObject({ data: { url: "/api/slow" } });
      expect(refresh).toHaveBeenCalledOnce();
      expect(server.sentTo("/api/slow").map(authOf)).toEqual(["Bearer old", "Bearer new"]);
    },
  );

  it("still refreshes for a request sent after the last refresh succeeded", async () => {
    const { api, state, refresh } = bearerSetup();

    await api.get("/a");
    state.valid = "newer";
    await api.get("/b");

    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("gives up after one retry when the stale request gets 401 again", async () => {
    const lateAnswer = deferred();
    const { api, state, gate, refresh, server } = bearerSetup({
      gated: true,
      hold: (request) => (request.url === "/api/slow" ? lateAnswer.promise : undefined),
    });

    const slow = rejectionOf(api.get("/slow"), HttpError);
    const fast = api.get("/fast");
    await flush();
    gate.resolve();
    await fast;
    state.valid = "rotated again";
    lateAnswer.resolve();

    expect((await slow).status).toBe(401);
    expect(refresh).toHaveBeenCalledOnce();
    expect(server.sentTo("/api/slow")).toHaveLength(2);
  });
});

refreshCancelCases();

describe("requests that never trigger a refresh", () => {
  it("skips a request matched by the skipRefresh option, and passes it the request", async () => {
    const skipRefresh = vi.fn<(request: HttpRequest) => boolean>((request) =>
      request.url.endsWith("/auth/login"),
    );
    const refresh = vi.fn<() => Promise<boolean>>(() => Promise.resolve(true));
    const server = fakeServer(() => unauthorized());
    const api = createClient({ baseUrl: "/api", refresh, skipRefresh, fetch: server.fetch });

    const error = await rejectionOf(api.post("/auth/login", { body: { a: 1 } }), HttpError);

    expect(error.status).toBe(401);
    expect(refresh).not.toHaveBeenCalled();
    expect(server.sent).toHaveLength(1);
    expect(skipRefresh).toHaveBeenCalledWith(
      expect.objectContaining({ method: "POST", url: "/api/auth/login" }),
    );
  });

  it("skips a request with skipRefresh: true", async () => {
    const refresh = vi.fn<() => Promise<boolean>>(() => Promise.resolve(true));
    const server = fakeServer(() => unauthorized());
    const api = createClient({ baseUrl: "/api", refresh, fetch: server.fetch });

    await expect(api.get("/me", { skipRefresh: true })).rejects.toMatchObject({ status: 401 });
    expect(refresh).not.toHaveBeenCalled();
    expect(server.sent).toHaveLength(1);
  });

  it.each([
    ["403", () => Promise.resolve(json({}, 403)), HttpError],
    ["500", () => Promise.resolve(json({}, 500)), HttpError],
    ["network error", () => Promise.reject(new TypeError("fetch failed")), NetworkError],
    ["broken JSON", () => Promise.resolve(new Response("{", jsonType)), ParseError],
  ])("does not refresh on a %s", async (_name, fetch, errorClass) => {
    const refresh = vi.fn<() => Promise<boolean>>(() => Promise.resolve(true));
    const api = createClient({ baseUrl: "/api", refresh, fetch });

    await expect(api.get("/x")).rejects.toBeInstanceOf(errorClass);
    expect(refresh).not.toHaveBeenCalled();
  });
});

/** The usual setup: the refresh endpoint answers with a new token, or 401 when the session is over. */
function selfRefreshingClient(
  refreshRequest: (api: HttpClient) => Promise<unknown>,
  options: { sessionOver: boolean; skipRefresh?: ((request: HttpRequest) => boolean) | undefined },
) {
  const state = { token: "old" };
  const server = fakeServer((request) => {
    if (request.url === "/api/auth/refresh") {
      return options.sessionOver ? unauthorized() : json({ access: "new" });
    }
    return authOf(request) === "Bearer new" ? json({ url: request.url }) : unauthorized();
  });
  const api: HttpClient = createClient({
    baseUrl: "/api",
    headers: () => ({ Authorization: `Bearer ${state.token}` }),
    refresh: async () => {
      await refreshRequest(api);
      state.token = "new";
      return true;
    },
    skipRefresh: options.skipRefresh,
    fetch: server.fetch,
  });
  return { api, server };
}

const viaOption = (api: HttpClient) => api.post("/auth/refresh", { skipRefresh: true });
const viaPredicate = (api: HttpClient) => api.post("/auth/refresh");
const isRefreshEndpoint = (request: HttpRequest) => request.url.endsWith("/auth/refresh");

describe("refresh that calls the same client", () => {
  it.each([
    ["skipRefresh: true on the refresh request", viaOption, undefined],
    ["the skipRefresh option matching it", viaPredicate, isRefreshEndpoint],
  ])(
    "does not hang when the refresh request gets 401 (%s)",
    { timeout: 1000 },
    async (_name, refreshRequest, skipRefresh) => {
      const { api, server } = selfRefreshingClient(refreshRequest, {
        sessionOver: true,
        skipRefresh,
      });

      const errors = await Promise.all(
        ["/a", "/b", "/c"].map((path) => rejectionOf(api.get(path), HttpError)),
      );

      expect(server.sentTo("/api/auth/refresh")).toHaveLength(1);
      for (const error of errors) {
        expect(error.status).toBe(401);
        expect(error.cause).toBeInstanceOf(HttpError);
        expect(error.cause).toMatchObject({ status: 401, request: { url: "/api/auth/refresh" } });
      }
    },
  );

  it(
    "renews the token with one refresh request and retries every request",
    { timeout: 1000 },
    async () => {
      const { api, server } = selfRefreshingClient(viaOption, { sessionOver: false });

      const responses = await Promise.all(["/a", "/b", "/c"].map((path) => api.get(path)));

      expect(responses.map((response) => response.status)).toEqual([200, 200, 200]);
      expect(server.sentTo("/api/auth/refresh")).toHaveLength(1);
      expect(server.sent).toHaveLength(7);
    },
  );
});

describe("the retry is a fresh attempt with the same request", () => {
  it("sends the same query, request headers and JSON body, with the client headers computed again", async () => {
    const { api, headers, server } = bearerSetup();

    await api.post("/items", {
      query: { page: 2, tag: ["a", "b"] },
      headers: new Headers({ "X-Trace": "t1" }),
      body: { name: "item" },
    });

    const [first, retry] = server.sent;
    expect(server.sent).toHaveLength(2);
    expect(headers).toHaveBeenCalledTimes(2);
    expect(retry?.url).toBe("/api/items?page=2&tag=a&tag=b");
    expect(retry?.url).toBe(first?.url);
    expect(retry?.method).toBe("POST");
    expect(authOf(retry)).toBe("Bearer new");
    expect(retry?.headers.get("x-trace")).toBe("t1");
    expect(retry?.headers.get("content-type")).toBe("application/json");
    expect(retry?.body).toBe('{"name":"item"}');
  });

  it.each([
    ["a Headers instance", new Headers({ "X-Trace": "t1", "Accept-Language": "ru" })],
    [
      "an array of pairs",
      [
        ["X-Trace", "t1"],
        ["Accept-Language", "ru"],
      ] satisfies Array<[string, string]>,
    ],
    ["an object", { "X-Trace": "t1", "Accept-Language": "ru" }],
  ])("keeps request headers given as %s", async (_form, requestHeaders) => {
    const { api, server } = bearerSetup();

    await api.get("/x", { headers: requestHeaders });

    const retry = server.sent[1];
    expect(retry?.headers.get("x-trace")).toBe("t1");
    expect(retry?.headers.get("accept-language")).toBe("ru");
    expect(authOf(retry)).toBe("Bearer new");
  });

  it("sends the same FormData again, without a Content-Type of its own", async () => {
    const { api, server } = bearerSetup();
    const form = new FormData();
    form.append("file", new Blob(["data"]), "a.txt");

    await api.post("/upload", { body: form, headers: { "Content-Type": "multipart/form-data" } });

    const retry = server.sent[1];
    expect(retry?.body).toBe(form);
    expect(retry?.headers.has("content-type")).toBe(false);
  });

  it("starts the timeout anew for the retry", async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    const { api } = bearerSetup();

    await api.get("/x", { timeout: 5_000 });

    expect(timeoutSpy.mock.calls).toEqual([[5_000], [5_000]]);
  });
});

const stream = (): ReadableStream<Uint8Array> =>
  new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("chunk"));
      controller.close();
    },
  });

describe("a ReadableStream body", () => {
  it("is not sent again after 401, but the refresh still runs for the next request", async () => {
    const { api, refresh, server } = bearerSetup();

    const error = await rejectionOf(api.post("/upload", { body: stream() }), HttpError);

    expect(error.status).toBe(401);
    expect(server.sent).toHaveLength(1);
    expect(refresh).toHaveBeenCalledOnce();

    // A new stream goes with the renewed token.
    await expect(api.post("/upload", { body: stream() })).resolves.toMatchObject({ status: 200 });
    expect(authOf(server.sent[1])).toBe("Bearer new");
  });

  it("rejects with the 401 HttpError when the refresh fails", async () => {
    const { api, refresh, server } = bearerSetup({ result: false });

    await expect(api.post("/upload", { body: stream() })).rejects.toMatchObject({ status: 401 });
    expect(refresh).toHaveBeenCalledOnce();
    expect(server.sent).toHaveLength(1);
  });
});

describe("cookie auth", () => {
  it("refreshes and retries with cookies, without a headers option", async () => {
    // The fake browser sends the cookie jar only with credentials: "include";
    // the refresh endpoint replaces the session cookie in the jar.
    const jar = { session: "old" };
    const server = fakeServer((request) => {
      const cookie = request.credentials === "include" ? `session=${jar.session}` : undefined;
      if (request.url === "/api/auth/refresh") {
        if (cookie === undefined) return unauthorized();
        jar.session = "new";
        return new Response(null, { status: 204 });
      }
      return cookie === "session=new" ? json({ url: request.url }) : unauthorized();
    });
    const api: HttpClient = createClient({
      baseUrl: "/api",
      credentials: "include",
      refresh: async () => {
        await api.post("/auth/refresh", { skipRefresh: true });
        return true;
      },
      fetch: server.fetch,
    });

    const responses = await Promise.all([api.get("/a"), api.get("/b")]);

    expect(responses.map((response) => response.data)).toEqual([
      { url: "/api/a" },
      { url: "/api/b" },
    ]);
    expect(server.sentTo("/api/auth/refresh")).toHaveLength(1);
    expect(server.sentTo("/api/a")).toHaveLength(2);
    expect(server.sent.every((request) => request.credentials === "include")).toBe(true);
    expect(server.sent.some((request) => request.headers.has("authorization"))).toBe(false);
  });
});

describe("options given as undefined", () => {
  it("behave as not given", async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    const state = { token: "old" };
    const server = fakeServer((request) =>
      request.headers.get("x-token") === "new" ? json("ok") : unauthorized(),
    );
    const api = createClient({
      baseUrl: "/api",
      headers: () => ({ "X-Token": state.token }),
      credentials: undefined,
      timeout: undefined,
      fetch: server.fetch,
      refresh: () => {
        state.token = "new";
        return Promise.resolve(true);
      },
      skipRefresh: undefined,
    });

    const { data } = await api.post("/x", {
      query: undefined,
      headers: undefined,
      timeout: undefined,
      signal: undefined,
      responseType: undefined,
      skipRefresh: undefined,
      body: undefined,
    });

    expect(data).toBe("ok");
    expect(server.sent).toHaveLength(2);
    expect(server.sent[1]?.url).toBe("/api/x");
    expect(server.sent[1]?.body).toBeUndefined();
    expect(server.sent[1]?.credentials).toBeUndefined();
    expect(timeoutSpy.mock.calls).toEqual([[30_000], [30_000]]);
  });
});
