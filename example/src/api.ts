import { createClient, type HttpClient } from "tidyfetch";
import { z } from "zod";

import { createFakeServer } from "./fakeServer";
import { addEntry, type Tone } from "./timelineStore";

/** The URL without its query, to match the lines of one endpoint. */
const pathOf = (url: string): string => url.split("?")[0] ?? url;

const toneOf = (status: number): Tone =>
  status === 401 ? "warn" : status >= 200 && status < 300 ? "ok" : "error";

export const server = createFakeServer(({ method, path, status, note }) => {
  addEntry({
    source: "server",
    label: status === null ? "no reply" : String(status),
    path,
    text: `${method} ${path}: ${note}`,
    tone: status === null ? "error" : path === "/api/auth/refresh" ? "refresh" : toneOf(status),
  });
});

const Tokens = z.object({ accessToken: z.string() });

// What a login would have stored.
let accessToken = server.getToken().token;

/** The demo's client: one per app, as in a real one. */
export const api: HttpClient = createClient({
  baseUrl: "/api",
  headers: () => ({ Authorization: `Bearer ${accessToken}` }),
  refresh: async () => {
    addEntry({
      source: "client",
      label: "refresh()",
      path: "",
      text: "called once, every 401 waits for it",
      tone: "refresh",
    });
    const { data } = await api.post("/auth/refresh", { schema: Tokens, skipRefresh: true });
    accessToken = data.accessToken;
    return true;
  },
  onRequest: (request) => {
    addEntry({
      source: "client",
      label: "onRequest",
      path: pathOf(request.url),
      text: `${request.method} ${request.url} with ${request.headers.get("Authorization") ?? "no token"}`,
      tone: "plain",
    });
  },
  onResponse: (response, request) => {
    addEntry({
      source: "client",
      label: "onResponse",
      path: pathOf(request.url),
      text: `${response.status} ${request.method} ${request.url}`,
      tone: "ok",
    });
  },
  onError: (error, request) => {
    addEntry({
      source: "client",
      label: "onError",
      path: pathOf(request.url),
      text: `${error.name}: ${error.message}`,
      tone: "error",
    });
  },
  // No backend: the server is in the page.
  fetch: server.fetch,
});
