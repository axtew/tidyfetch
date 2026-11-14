import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  type ClientOptions,
  createClient,
  HttpError,
  type HttpRequest,
  type HttpResponse,
  NetworkError,
  type RequestError,
  SchemaError,
  TimeoutError,
} from "../..";
import { delayedFetch, fakeServer, flush, json, rejectionOf, unauthorized } from "./_helpers";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Hooks that record every call, in order, into one log. */
function recordingHooks() {
  const log: string[] = [];
  const onRequest = vi.fn<(request: HttpRequest) => void>((request) => {
    log.push(`request ${request.headers.get("authorization") ?? "-"}`);
  });
  const onResponse = vi.fn<(response: HttpResponse, request: HttpRequest) => void>((response) => {
    log.push(`response ${response.status}`);
  });
  const onError = vi.fn<(error: RequestError, request: HttpRequest) => void>((error) => {
    log.push(`error ${error.name}`);
  });
  return { log, onRequest, onResponse, onError };
}

function clientWith(fetch: ClientOptions["fetch"], options: Partial<ClientOptions> = {}) {
  const hooks = recordingHooks();
  const api = createClient({ baseUrl: "/api", fetch, ...hooks, ...options });
  return { api, ...hooks };
}

/** A bearer setup: only `new` is accepted, `refresh` puts it in place and resolves `result`. */
function bearer(result: boolean) {
  let token = "old";
  const server = fakeServer((request) =>
    request.headers.get("authorization") === "new" ? json({ id: 1 }) : unauthorized(),
  );
  const options: Partial<ClientOptions> = {
    headers: () => ({ Authorization: token }),
    refresh: async () => {
      token = "new";
      return result;
    },
  };
  return { server, options };
}

describe("calls and their order", () => {
  it("success: onRequest, then onResponse once with the response and the request", async () => {
    const { api, log, onRequest, onResponse, onError } = clientWith(
      () => Promise.resolve(json({ id: 1 })),
      { headers: { Authorization: "t" } },
    );

    const response = await api.get("/me", { query: { a: 1 } });

    expect(log).toEqual(["request t", "response 200"]);
    const [request] = onRequest.mock.calls[0] ?? [];
    expect(request).toMatchObject({ method: "GET", url: "/api/me?a=1" });
    expect(onResponse).toHaveBeenCalledExactlyOnceWith(response, expect.anything());
    expect(onResponse.mock.calls[0]?.[1]).toMatchObject({ method: "GET", url: "/api/me?a=1" });
    expect(onError).not.toHaveBeenCalled();
  });

  it("onResponse gets the data after the schema", async () => {
    const { api, onResponse } = clientWith(() => Promise.resolve(json({ name: "ann" })));
    const schema = z.object({ name: z.string().toUpperCase() });

    await api.get("/me", { schema });

    expect(onResponse.mock.calls[0]?.[0].data).toEqual({ name: "ANN" });
  });

  it("HttpError: onError once with the error and its request, before the caller sees it", async () => {
    const { api, log, onError } = clientWith(() => Promise.resolve(json({}, 404)));

    let callsAtRejection = 0;
    const error = await rejectionOf(
      api.get("/x").catch((reason: unknown) => {
        callsAtRejection = onError.mock.calls.length;
        throw reason;
      }),
      HttpError,
    );

    expect(callsAtRejection).toBe(1);
    expect(log).toEqual(["request -", "error HttpError"]);
    expect(onError).toHaveBeenCalledExactlyOnceWith(error, error.request);
  });

  it("timeout: onError with TimeoutError", async () => {
    const { api, log } = clientWith(delayedFetch(100), { timeout: 10 });

    await expect(api.get("/x")).rejects.toBeInstanceOf(TimeoutError);

    expect(log).toEqual(["request -", "error TimeoutError"]);
  });

  it("network error: onError with NetworkError", async () => {
    const { api, log } = clientWith(() => Promise.reject(new TypeError("fetch failed")));

    await expect(api.get("/x")).rejects.toBeInstanceOf(NetworkError);

    expect(log).toEqual(["request -", "error NetworkError"]);
  });

  it("schema error: onError with SchemaError, no onResponse", async () => {
    const { api, log } = clientWith(() => Promise.resolve(json({ id: "1" })));

    await expect(api.get("/x", { schema: z.object({ id: z.number() }) })).rejects.toBeInstanceOf(
      SchemaError,
    );

    expect(log).toEqual(["request -", "error SchemaError"]);
  });

  it("a 401 cured by a refresh: onRequest twice, onResponse once, onError never", async () => {
    const { server, options } = bearer(true);
    const { api, log, onResponse } = clientWith(server.fetch, options);

    await api.get("/me");

    expect(log).toEqual(["request old", "request new", "response 200"]);
    expect(onResponse.mock.calls[0]?.[1].headers.get("authorization")).toBe("new");
  });

  it("a 401 that ends the request: onError once with it", async () => {
    const { server, options } = bearer(false);
    const { api, log } = clientWith(server.fetch, options);

    const error = await rejectionOf(api.get("/me"), HttpError);

    expect(error.status).toBe(401);
    expect(log).toEqual(["request old", "error HttpError"]);
  });

  it("a retry that gets 401 again: onError once, with the retry's error", async () => {
    const server = fakeServer(() => unauthorized());
    const { api, log, onError } = clientWith(server.fetch, { refresh: async () => true });

    const error = await rejectionOf(api.get("/me"), HttpError);

    expect(log).toEqual(["request -", "request -", "error HttpError"]);
    expect(onError.mock.calls[0]?.[0]).toBe(error);
  });

  it("a cancel by the caller is not an error", async () => {
    const { api, log } = clientWith(delayedFetch(100));
    const controller = new AbortController();

    const pending = api.get("/x", { signal: controller.signal });
    await flush();
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(log).toEqual(["request -"]);
  });

  it("a cancel while waiting for a refresh is not an error either", async () => {
    const { server, options } = bearer(true);
    const controller = new AbortController();
    const { api, log } = clientWith(server.fetch, {
      ...options,
      refresh: () => new Promise<boolean>(() => {}),
    });

    const pending = api.get("/me", { signal: controller.signal });
    await flush();
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(log).toEqual(["request old"]);
  });

  it("an error before sending reaches the caller only", async () => {
    const bug = new Error("no token storage");
    const { api, log } = clientWith(() => Promise.resolve(json({})), {
      headers: () => {
        throw bug;
      },
    });

    await expect(api.get("/x")).rejects.toBe(bug);
    // With the type given, the query is not checked by the types.
    await expect(api.get<{ id: number }>("/x", { query: { a: {} } })).rejects.toBeInstanceOf(
      TypeError,
    );
    expect(log).toEqual([]);

    // JSON.stringify cannot send a BigInt.
    const other = clientWith(() => Promise.resolve(json({})));
    await expect(other.api.post("/x", { body: { n: 1n } })).rejects.toBeInstanceOf(TypeError);
    expect(other.log).toEqual([]);
    expect(log).toEqual([]);
  });
});

const never = (): Promise<void> => new Promise(() => {});

describe("hooks cannot change the request or the outcome", () => {
  it("a header set in onRequest is not sent", async () => {
    const server = fakeServer(() => json({}));
    const api = createClient({
      baseUrl: "/api",
      fetch: server.fetch,
      onRequest: (request) => {
        request.headers.set("Authorization", "injected");
        request.url = "/elsewhere";
      },
    });

    await api.get("/x");

    expect(server.sent[0]?.url).toBe("/api/x");
    expect(server.sent[0]?.headers.has("authorization")).toBe(false);
  });

  it("a field replaced in onResponse does not reach the caller", async () => {
    const api = createClient({
      baseUrl: "/api",
      fetch: () => Promise.resolve(json({ id: 1 })),
      onResponse: (response) => {
        response.data = "replaced";
        response.status = 500;
      },
    });

    const response = await api.get("/x");

    expect(response.data).toEqual({ id: 1 });
    expect(response.status).toBe(200);
  });

  it("hooks are not awaited", async () => {
    const api = createClient({
      baseUrl: "/api",
      fetch: () => Promise.resolve(json({ id: 1 })),
      onRequest: never,
      onResponse: never,
    });

    expect((await api.get("/x")).data).toEqual({ id: 1 });
  });
});

describe("an exception in a hook", () => {
  const thrown = new Error("hook failed");
  const throwing = (): never => {
    throw thrown;
  };
  const rejecting = (): Promise<never> => Promise.reject(thrown);

  it.each([
    ["throws", throwing],
    ["rejects", rejecting],
  ])("leaves a success as it was when a hook %s, and is reported", async (_, hook) => {
    const reportError = vi.fn<(error: unknown) => void>();
    vi.stubGlobal("reportError", reportError);
    const api = createClient({
      baseUrl: "/api",
      fetch: () => Promise.resolve(json({ id: 1 })),
      onRequest: hook,
      onResponse: hook,
    });

    expect((await api.get("/x")).data).toEqual({ id: 1 });
    await flush();

    expect(reportError).toHaveBeenCalledTimes(2);
    expect(reportError).toHaveBeenCalledWith(thrown);
  });

  it.each([
    ["throws", throwing],
    ["rejects", rejecting],
  ])("leaves a failure as it was when onError %s, and is reported", async (_, hook) => {
    const reportError = vi.fn<(error: unknown) => void>();
    vi.stubGlobal("reportError", reportError);
    const api = createClient({
      baseUrl: "/api",
      fetch: () => Promise.resolve(json({}, 500)),
      onError: hook,
    });

    await expect(api.get("/x")).rejects.toBeInstanceOf(HttpError);
    await flush();

    expect(reportError).toHaveBeenCalledExactlyOnceWith(thrown);
  });

  it("is logged with console.error where there is no reportError (Node)", async () => {
    vi.stubGlobal("reportError", undefined);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const api = createClient({
      baseUrl: "/api",
      fetch: () => Promise.resolve(json({ id: 1 })),
      onRequest: throwing,
      onResponse: rejecting,
    });

    const { data } = await api.get("/x");
    await flush();

    expect(data).toEqual({ id: 1 });
    expect(consoleError).toHaveBeenCalledTimes(2);
    expect(consoleError).toHaveBeenCalledWith(expect.any(String), thrown);
    // Not rethrown: Vitest fails a run on an uncaught exception, as Node ends the process.
  });
});
