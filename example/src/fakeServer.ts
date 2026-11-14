import type { FetchFunction } from "tidyfetch";

/**
 * A server that lives in the page. It is passed to `createClient` as `fetch`, so
 * the client runs exactly as it would against a real backend: requests, headers,
 * timeouts and aborts all go through it.
 *
 * Access tokens carry a version (`token-v1`, `token-v2`...). Only the latest one
 * is accepted, and only until it is expired from the page.
 */

/** One line of the server's own log. `status` is `null` when no response was sent. */
export interface ServerLogEntry {
  method: string;
  path: string;
  status: number | null;
  note: string;
}

export interface ServerSettings {
  /** Milliseconds for an ordinary endpoint, with some jitter. */
  latency: number;
  /** The refresh endpoint answers 401: the refresh token is no longer valid. */
  refreshFails: boolean;
  /** The 401 to `/items/5` comes late, after the refresh is already over. */
  lateResponse: boolean;
}

export interface TokenState {
  token: string;
  expired: boolean;
}

export interface FakeServer {
  fetch: FetchFunction;
  settings: ServerSettings;
  /** The current access token, as a login would hand it out. */
  getToken: () => TokenState;
  /** From now on the current token gets 401, until a refresh issues a new one. */
  expireToken: () => void;
  subscribe: (listener: () => void) => () => void;
}

/** How long the refresh endpoint takes: long enough to see the requests waiting for it. */
export const REFRESH_DELAY = 700;
/** How long the slow endpoints take. */
export const SLOW_DELAY = 4000;
const LATE_DELAY = 1500;

const STATUS_TEXT: Record<number, string> = {
  200: "OK",
  401: "Unauthorized",
  404: "Not Found",
  500: "Internal Server Error",
};

function respond(status: number, body: unknown): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    statusText: STATUS_TEXT[status] ?? "",
    headers: { "Content-Type": "application/json" },
  });
}

/** Waits like a network would, and stops like one when the request is aborted. */
function wait(ms: number, signal: AbortSignal | null | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(signal.reason);
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** The page starts with an expired token, so the first click already shows a refresh. */
export function createFakeServer(log: (entry: ServerLogEntry) => void): FakeServer {
  const settings: ServerSettings = { latency: 300, refreshFails: false, lateResponse: false };
  let state: TokenState = { token: "token-v1", expired: true };
  let version = 1;
  const listeners = new Set<() => void>();

  function setState(next: TokenState): void {
    state = next;
    for (const listener of listeners) listener();
  }

  /** The configured latency, give or take 40%, so that responses do not arrive in lockstep. */
  const latency = (): number => settings.latency * (0.6 + Math.random() * 0.8);

  /** The routes. Each returns a response, or throws to fail like a network error. */
  async function handle(
    method: string,
    path: string,
    headers: Headers,
    signal: AbortSignal | null | undefined,
  ): Promise<{ response: Response; note: string }> {
    if (method === "POST" && path === "/api/auth/refresh") {
      await wait(REFRESH_DELAY, signal);
      if (settings.refreshFails) {
        return { response: respond(401, { error: "refresh token expired" }), note: "refused" };
      }
      version++;
      setState({ token: `token-v${version}`, expired: false });
      return {
        response: respond(200, { accessToken: state.token }),
        note: `issued ${state.token}`,
      };
    }

    const item = /^\/api\/items\/(\d+)$/.exec(path);
    if (method === "GET" && item !== null) {
      const id = Number(item[1]);
      // The token is checked when the request arrives, the answer comes after the latency.
      const sent = headers.get("Authorization")?.replace(/^Bearer /, "") ?? "no token";
      const accepted = sent === state.token && !state.expired;
      const late = settings.lateResponse && id === 5 && !accepted;
      await wait(latency() + (late ? LATE_DELAY : 0), signal);
      if (!accepted) {
        const why = sent === state.token ? "has expired" : "is not valid";
        return { response: respond(401, { error: "unauthorized" }), note: `${sent} ${why}` };
      }
      return { response: respond(200, { id, name: `Item ${id}` }), note: sent };
    }

    if (method === "GET") {
      switch (path) {
        case "/api/slow":
        case "/api/export":
          await wait(SLOW_DELAY, signal);
          return { response: respond(200, { done: true }), note: "finally done" };
        case "/api/server-error":
          await wait(latency(), signal);
          return {
            response: respond(500, { error: "database is unavailable" }),
            note: "database is unavailable",
          };
        case "/api/broken-json":
          await wait(latency(), signal);
          return { response: respond(200, '{"id": 1, "name": "Ite'), note: "cut-off JSON" };
        case "/api/orders":
          await wait(latency(), signal);
          return {
            response: respond(200, {
              items: [
                { id: 1, price: 9.5 },
                { id: 2, price: "12.00" },
              ],
            }),
            note: "a price as a string",
          };
        case "/api/unreachable":
          await wait(latency(), signal);
          // What the browser's fetch rejects with when the server cannot be reached.
          throw new TypeError("Failed to fetch");
      }
    }

    return { response: respond(404, { error: "not found" }), note: "no such route" };
  }

  const fetch: FetchFunction = async (input, init) => {
    const method = init.method ?? "GET";
    const path = new URL(input, "https://tidyfetch.demo").pathname;
    try {
      const { response, note } = await handle(method, path, new Headers(init.headers), init.signal);
      log({ method, path, status: response.status, note });
      return response;
    } catch (error) {
      const aborted = init.signal?.aborted === true;
      log({ method, path, status: null, note: aborted ? "the client hung up" : "unreachable" });
      throw error;
    }
  };

  return {
    fetch,
    settings,
    getToken: () => state,
    expireToken: () => setState({ ...state, expired: true }),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
