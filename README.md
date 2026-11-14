# tidyfetch

[![CI](https://github.com/axtew/tidyfetch/actions/workflows/ci.yml/badge.svg)](https://github.com/axtew/tidyfetch/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/tidyfetch)](https://www.npmjs.com/package/tidyfetch)
[![license](https://img.shields.io/npm/l/tidyfetch)](./LICENSE)

A small HTTP client on top of `fetch`. Requests that get 401 at the same time share one token refresh and are then sent once more. Errors are classes you can tell apart with `instanceof`, every request has a timeout, and the response can be checked with a schema.

[Live demo](https://tidyfetch.stevvy1122.workers.dev) · [Русская версия](./README.ru.md)

```ts
import { createClient, HttpError } from "tidyfetch";

const api = createClient({
  baseUrl: "/api",
  headers: () => ({ Authorization: `Bearer ${tokens.access}` }),
  refresh: async () => {
    const { data } = await api.post<Tokens>("/auth/refresh", {
      body: { refresh: tokens.refresh },
      skipRefresh: true,
    });
    tokens.save(data);
    return true;
  },
});

try {
  const { data: user } = await api.get<User>("/me");
  showProfile(user);
} catch (error) {
  if (error instanceof HttpError && error.status === 404) showNotFound();
  else throw error;
}
```

- **One refresh for parallel 401s.** Requests that get 401 while a refresh is running wait for that refresh, then each is sent once more. A second 401 is final.
- **An error class for each failure.** `HttpError`, `TimeoutError`, `NetworkError`, `ParseError`, `SchemaError`. A cancelled request rejects with a standard `AbortError`.
- **A timeout on every request.** 30 seconds by default, per attempt, built on `AbortSignal`.
- **Typed `data`.** From a type parameter, from `responseType`, or from a schema (Zod, Valibot, ArkType through Standard Schema).
- **The usual fetch chores done.** A relative `baseUrl`, arrays in the query, merged headers, JSON and `FormData` bodies, empty responses.
- **Small, no dependencies.** 3.1 kB min + gzip, see [Bundle size](#bundle-size).

## Contents

- [Why](#why)
- [Install](#install)
- [Quick start](#quick-start)
- [Authentication](#authentication)
- [Requests](#requests)
- [Responses](#responses)
- [Errors](#errors)
- [Timeouts and cancellation](#timeouts-and-cancellation)
- [Token refresh in detail](#token-refresh-in-detail)
- [Schema validation](#schema-validation)
- [Hooks](#hooks)
- [Retries](#retries)
- [API](#api)
- [Bundle size](#bundle-size)
- [Testing](#testing)
- [License](#license)

## Why

tidyfetch started as the HTTP layer of a production app. Its most important part is the token refresh: when an access token expires, several requests get 401 at once, and they should wait for one refresh instead of starting one each.

The first version had a bug there. The retry counter lived inside the shared refresh promise, and every new request reset it for the others. Against a server that kept answering 401, the requests were retried forever. In tidyfetch the limit belongs to each request: it is retried at most once, and a second 401 goes to the caller.

The rest is what every project writes around `fetch` sooner or later: a base URL, a query string, headers, JSON, a timeout, errors that say what went wrong. The tests cover the parallel 401s and the races around them, and the [demo](https://tidyfetch.stevvy1122.workers.dev) shows five requests, five 401s and one refresh.

## Install

```sh
pnpm add tidyfetch
# or: npm install tidyfetch
```

- ESM only, ES2022.
- Browsers with `AbortSignal.any`: Chrome 116, Firefox 124, Safari 17.4. Node 20.3 or newer.
- TypeScript 5.0 or newer for the types.
- No dependencies.

## Quick start

One client for the app, in its own module:

```ts
// api.ts
import { createClient } from "tidyfetch";

export const api = createClient({ baseUrl: "/api" });
```

Then the methods:

```ts
import { HttpError } from "tidyfetch";

import { api } from "./api";

interface User {
  id: number;
  name: string;
}

const { data: user } = await api.get<User>("/users/1");
const { data: created } = await api.post<User>("/users", { body: { name: "Anna" } });
await api.patch(`/users/${created.id}`, { body: { name: "Anna K." } });
await api.delete(`/users/${created.id}`);

try {
  await api.get("/users/999");
} catch (error) {
  if (error instanceof HttpError && error.status === 404) console.log("No such user");
  else throw error;
}
```

A request resolves with `{ ok, status, statusText, headers, url, data }` for a 2xx status and throws for anything else. `get`, `post`, `put`, `patch` and `delete` are shortcuts for `api.request(method, path, options)`; use it for `HEAD` or `OPTIONS`.

## Authentication

### Bearer token

```ts
import { createClient } from "tidyfetch";

import { tokens } from "./tokens"; // wherever the app keeps them

export const api = createClient({
  baseUrl: "/api",
  // Called before every request, so the current token is sent.
  headers: () => (tokens.access ? { Authorization: `Bearer ${tokens.access}` } : {}),
  refresh: async () => {
    if (!tokens.refresh) return false;
    const { data } = await api.post<Tokens>("/auth/refresh", {
      body: { refresh: tokens.refresh },
      skipRefresh: true,
    });
    tokens.save(data);
    return true;
  },
  // A wrong password must reach the login form as a 401.
  skipRefresh: (request) => request.url.endsWith("/auth/login"),
});
```

- `headers` as a function is called before every request and may be async. The token is read when the request is sent, so after a refresh the retry goes with the new one.
- `refresh` resolves `true` when new tokens are in place. Then every request that got 401 is sent once more. `false` or a throw means the session cannot be renewed, and those requests fail with their 401.
- The request inside `refresh` has `skipRefresh: true`. Without it, a 401 from the refresh endpoint would wait for the refresh it belongs to, and neither would ever settle.
- The `skipRefresh` option excludes login. A 401 there means a wrong password, and it must reach the form, not start a refresh.

### Cookies

With HttpOnly cookies the browser sends the session itself, so the client needs no token code:

```ts
import { createClient } from "tidyfetch";

function readCookie(name: string): string | undefined {
  return document.cookie
    .split("; ")
    .find((pair) => pair.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

export const api = createClient({
  baseUrl: "https://api.example.com",
  // Send cookies to another origin. Not needed when the API is on the same origin.
  credentials: "include",
  // Django checks the CSRF token in a header on unsafe methods.
  headers: () => {
    const csrf = readCookie("csrftoken");
    return csrf === undefined ? {} : { "X-CSRFToken": csrf };
  },
  // The server sets new cookies; the retry goes with them.
  refresh: async () => {
    await api.post("/auth/refresh", { skipRefresh: true });
    return true;
  },
  skipRefresh: (request) => request.url.endsWith("/auth/login"),
});
```

If the refresh endpoint answers with an error, `api.post` throws, and every waiting request fails with its own 401, with that error in `cause`. The session is over then. To send the user to the login page, catch that error inside `refresh`, do the redirect there, and return `false`.

## Requests

### URL and baseUrl

```ts
const api = createClient({ baseUrl: "/api" });

await api.get("/users"); // /api/users
await api.get("users"); // /api/users, slashes are joined
await api.get("https://cdn.example.com/config.json"); // a full URL skips baseUrl
```

`baseUrl` may be relative (`/api`) or absolute (`https://api.example.com/v1`). A path with a scheme (`https://...`) is used as is. The URL goes to `fetch` as a string, so a relative one works in the browser; on the server `fetch` needs an absolute `baseUrl`.

### Query

```ts
await api.get("/items", {
  query: { tag: ["red", "blue"], page: 2, archived: false, search: undefined },
});
// /api/items?tag=red&tag=blue&page=2&archived=false
```

- Values are strings, numbers, booleans or arrays of them. An array repeats the key.
- `null` and `undefined` are skipped, so optional filters can be passed as they are.
- A ready `URLSearchParams` works too.
- Other values (a `Date`, a nested object) are a type error and a `TypeError` at run time. Convert them first, for example `date.toISOString()`.

Query objects typed with an `interface` are accepted, so filters can come straight from a function parameter:

```ts
interface ItemFilters {
  page?: number;
  tag?: string[];
}

function getItems(filters: ItemFilters) {
  return api.get<Item[]>("/items", { query: filters });
}

await api.get("/items", { query: { from: new Date() } }); // type error: convert the date first
```

### Headers

```ts
const api = createClient({
  baseUrl: "/api",
  headers: () => ({ Authorization: `Bearer ${tokens.access}`, "Accept-Language": "en" }),
});

// Adds a header, the client ones stay.
await api.get("/reports", { headers: { "X-Request-Id": crypto.randomUUID() } });

// Replaces a client header with the same name (names are case-insensitive).
await api.get("/reports", { headers: { "accept-language": "de" } });

// Removes a client header: a presigned S3 URL must not get our token.
await api.put(uploadUrl, { body: file, headers: { Authorization: undefined } });
```

The client headers and the request headers are merged for every request: a request header wins by name. Any `HeadersInit` works: an object, `Headers`, an array of pairs. In the object form `undefined` removes a client header for that request. A completely different API with other headers is better served by a second `createClient`.

### Body

```ts
// An object is sent as JSON with Content-Type: application/json.
await api.post("/notes", { body: { text: "Hello" } });

// FormData goes as multipart, fetch adds the boundary.
const form = new FormData();
form.append("file", file);
await api.post("/upload", { body: form });

// These go as they are, fetch picks their Content-Type.
await api.post("/search", { body: new URLSearchParams({ q: "fetch" }) });
await api.put("/files/readme.txt", { body: "plain text" });
```

- Sent as they are: `string`, `Blob` and `File`, `ArrayBuffer`, typed arrays, `FormData`, `URLSearchParams`, `ReadableStream`.
- Anything else goes through `JSON.stringify`, with `Content-Type: application/json` unless a `Content-Type` is already set (for example `application/merge-patch+json`).
- `FormData` is always sent without a set `Content-Type`. A multipart type is only valid with the boundary that `fetch` generates, so a header from the client or the request would break the upload.
- A `Content-Type: application/json` in the client headers is not needed: objects get it anyway. Set there, it would also label strings, files and `URLSearchParams` as JSON.

A `ReadableStream` body is sent with `duplex: "half"`, which `fetch` requires. Browser support for streaming uploads is limited: Chromium-based browsers only, over HTTP/2 or newer. A stream can be read only once, so such a request is not retried after a token refresh: it fails with its 401, and the caller can send a new stream, the token is fresh by then.

## Responses

### Shape

```ts
const response = await api.get<User>("/me");

response.ok; // true: a status outside 200-299 throws HttpError
response.status; // 200
response.statusText; // "OK", may be empty over HTTP/2
response.headers; // Headers
response.url; // the final URL after redirects
response.data; // User
```

### Body type

Without `responseType` the body is read by its `Content-Type`:

| Content-Type                         | `data`      |
| ------------------------------------ | ----------- |
| `application/json`, `*+json`         | parsed JSON |
| `text/*`, XML, no `Content-Type`     | `string`    |
| anything else (images, PDF, archive) | `Blob`      |

`responseType` sets it explicitly: `"json"`, `"text"`, `"blob"`, `"arrayBuffer"` or `"stream"` (the unread `ReadableStream` of `response.body`).

Empty bodies:

- Without `responseType` or with `"json"`, a body that is missing or empty gives `data: undefined`. This covers 204, 205, `HEAD` and a 200 with nothing in it. Broken JSON in a 2xx response throws `ParseError`.
- With `"text"`, `"blob"`, `"arrayBuffer"` or `"stream"`, `data` is always a value of that type, an empty one when there is no body.
- An error body is read by its own `Content-Type`, whatever `responseType` says: a failed file download usually answers with JSON.

### Typing data

```ts
const { data: user } = await api.get<User>("/me"); // User, as you claim, not checked
const { data: csv } = await api.get("/export", { responseType: "text" }); // string
const { data: pdf } = await api.get("/report", { responseType: "blob" }); // Blob
const { data: me } = await api.get("/me", { schema: UserSchema }); // the schema's output, checked
const { data: raw } = await api.get("/me"); // unknown

await api.get<User>("/export", { responseType: "text" }); // type error: drop <User>, data is a string
```

The type parameter `T` describes JSON. With a non-JSON `responseType` or a `schema`, the type of `data` follows them, and an explicit `T` next to them is a type error: drop `T`.

## Errors

Every failure of a sent request is one of five classes. All extend `Error` and carry `request`: `{ method, url, headers }` as it was sent.

| Class          | When                                                           | Fields                                                                 |
| -------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `HttpError`    | the server answered with a status outside 200-299              | `status`, `statusText`, `data` (the error body), `response`, `request` |
| `TimeoutError` | no answer within `timeout`                                     | `timeout` (ms), `request`, `cause`                                     |
| `NetworkError` | `fetch` failed without a response: offline, DNS, CORS, refused | `request`, `cause` (the error from `fetch`)                            |
| `ParseError`   | a 2xx body that does not parse, such as broken JSON            | `response`, `request`, `cause` (the `SyntaxError`)                     |
| `SchemaError`  | a 2xx body that does not pass the request `schema`             | `issues`, `data` (the body before the schema), `response`, `request`   |

`HttpError.data` is the error body parsed by its `Content-Type`, or its text when it does not parse. The type `RequestError` is the union of the five.

```ts
import { HttpError, NetworkError, TimeoutError } from "tidyfetch";

try {
  await api.post("/orders", { body: order });
} catch (error) {
  if (error instanceof HttpError && error.status === 422) {
    showFieldErrors(error.data);
  } else if (error instanceof NetworkError || error instanceof TimeoutError) {
    showToast("No connection, try again");
  } else {
    throw error;
  }
}
```

A request cancelled through its `signal` is not a library error: it rejects with the signal's reason, by default a `DOMException` named `AbortError`, the same as plain `fetch`. TanStack Query and other callers that cancel requests already know how to handle it.

```ts
async function search(q: string, signal: AbortSignal) {
  try {
    const { data } = await api.get<SearchResult>("/search", { query: { q }, signal });
    return data;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return undefined;
    throw error;
  }
}
```

## Timeouts and cancellation

```ts
const api = createClient({ baseUrl: "/api", timeout: 10_000 });

await api.get("/reports/yearly", { timeout: 60_000 }); // longer for one request
await api.get("/events", { responseType: "stream", timeout: 5_000 }); // 5 s to get the headers
await api.get("/export", { timeout: 0 }); // no timeout
```

- 30 seconds by default. The client `timeout` sets it for every request, the request `timeout` for one. `0` turns it off.
- The timeout covers sending the request and reading the body.
- It is counted per attempt: the retry after a token refresh gets its own, and the wait for the refresh is not counted.
- With `responseType: "stream"` it stops once the headers arrive, so a long download, server-sent events or a streamed answer are not cut off. The caller's `signal` still works.
- The caller's `signal` cancels the request at any point, the wait for a refresh included. The refresh itself goes on for the other requests.
- An async check in a schema (a rare case, such as an async refinement) is not covered by the timeout or the signal.

## Token refresh in detail

When a request gets 401, the client has `refresh`, and the request is not excluded through `skipRefresh`:

- **Single flight.** The first 401 starts `refresh`. Every request that gets 401 while it runs waits for the same call.
- **One retry.** On `true` each waiting request is sent once more, with the client headers computed again. The 401 of a retry is final: it goes to the caller as `HttpError`, and no new refresh starts for it. This is what keeps a server that answers 401 to everything from being asked forever.
- **A late 401.** A request sent with the old token whose 401 arrives after the refresh is already done is retried without a second refresh.
- **Failure.** `false` or a throw: every waiting request fails with its own 401 `HttpError`. What `refresh` threw is in that error's `cause`.
- **Stream bodies** are not sent twice: such a request fails with its 401 after the refresh.
- **Only 401.** A 403 means "not allowed", not "not logged in", and never starts a refresh.
- **Cancellation.** The caller's signal ends this request's wait, not the refresh.
- **Requests inside `refresh`** need `skipRefresh: true` (or a match in the `skipRefresh` option). Otherwise their 401 waits for the refresh they are part of, and nothing settles.

The [demo](https://tidyfetch.stevvy1122.workers.dev) shows this step by step: five requests, five 401s, one refresh, five retries, with switches for a failing refresh and a late 401.

## Schema validation

Any [Standard Schema](https://standardschema.dev) works: Zod, Valibot, ArkType and others. tidyfetch has no dependency on them, it only knows the interface.

```ts
import { z } from "zod";

const UserSchema = z.object({ id: z.number(), name: z.string(), email: z.email() });

const { data } = await api.get("/me", { schema: UserSchema });
// data: { id: number; name: string; email: string }
```

A body that does not match throws `SchemaError` with the issues, and the message names the first one:

```
GET /api/me: response does not match the schema: email: Invalid email address
```

With more issues the message ends with `(and 2 more issues)`; all of them are in `error.issues`. `data` is the schema's output, so transforms and defaults apply. Only successful bodies are checked, after `responseType`. Valibot is the same:

```ts
import * as v from "valibot";

const UserSchema = v.object({ id: v.number(), name: v.string() });
const { data } = await api.get("/me", { schema: UserSchema });
```

## Hooks

```ts
const api = createClient({
  baseUrl: "/api",
  onRequest: (request) => {
    console.debug(request.method, request.url);
  },
  onResponse: (response, request) => {
    console.debug(response.status, request.method, request.url);
  },
  onError: (error, request) => {
    errorTracker.capture(error, { method: request.method, url: request.url });
  },
});
```

The hooks only observe: they are not awaited, what they return is ignored, and they cannot change the request or its result.

- `onRequest` runs before every attempt, the retry after a refresh included.
- `onResponse` runs once, on the final success, with `data` already through the schema.
- `onError` runs once, with the error the request finally fails with. A 401 fixed by a refresh never gets there.
- `onError` is not called when the caller cancels the request, nor for errors thrown before it is sent: a `headers` function that throws, a bad query value, a body that cannot be serialized. Those reach the caller only.
- A hook that throws does not break the request. Its error goes to `reportError` in browsers (it shows in the console and reaches error trackers) and to `console.error` in Node, so a broken log line cannot take down a server.

`request.headers` and `error.request.headers` hold the `Authorization` header as it was sent. A `Headers` object turns into `{}` with `JSON.stringify`, so it does not leak by accident, but drop `Authorization` and `Cookie` before you copy headers into a log.

## Retries

tidyfetch does not retry failed requests on its own, on purpose:

- **Retries multiply.** TanStack Query already retries a failed query 3 times. With 3 more retries inside the client, one failing endpoint gets 4 x 4 = 16 requests.
- **A POST is not safe to repeat.** A request can reach the server and lose its response on the way back. Sent again, it creates the order twice.
- **The app knows better.** Which errors are worth a retry, how long to wait, whether to show a spinner or a message: that depends on the screen, not on the HTTP client.

The error classes make the rule short. With TanStack Query:

```ts
import { QueryClient } from "@tanstack/query-core"; // or @tanstack/react-query
import { HttpError, NetworkError, TimeoutError } from "tidyfetch";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        if (failureCount >= 2) return false; // at most 2 retries
        // 4xx will not change on a retry: a missing page, a validation error, no access.
        if (error instanceof HttpError) return error.status >= 500;
        return error instanceof NetworkError || error instanceof TimeoutError;
      },
    },
  },
});
```

Mutations are not retried by TanStack Query by default, and that is the right default for a POST.

Without TanStack Query, a small wrapper does the same for idempotent methods:

```ts
import { HttpError, NetworkError, TimeoutError } from "tidyfetch";

const IDEMPOTENT = new Set(["GET", "HEAD", "OPTIONS", "PUT", "DELETE"]);

function isRetryable(error: unknown): boolean {
  const temporary =
    (error instanceof HttpError && error.status >= 500) ||
    error instanceof NetworkError ||
    error instanceof TimeoutError;
  return temporary && IDEMPOTENT.has(error.request.method);
}

export async function withRetry<T>(send: () => Promise<T>, retries = 2): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await send();
    } catch (error) {
      if (attempt >= retries || !isRetryable(error)) throw error;
      // 0.5 s, 1 s, 2 s...
      await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
    }
  }
}

const { data: report } = await withRetry(() => api.get<Report>("/reports/42"));
```

## API

### createClient options

| Option        | Type                                                        | Default             | What it does                                                                                                     |
| ------------- | ----------------------------------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `baseUrl`     | `string`                                                    | required            | Prefix for every relative path. May be relative (`/api`). A full URL in a request skips it.                      |
| `headers`     | `HeadersInit` or `() => HeadersInit \| Promise<...>`        | none                | Sent with every request. A function is called before each request, so a token is read at send time.              |
| `credentials` | `RequestCredentials`                                        | the `fetch` default | Passed to `fetch`. `"include"` sends cookies to another origin.                                                  |
| `timeout`     | `number`                                                    | `30000`             | Milliseconds per attempt, body included. `0` turns it off.                                                       |
| `refresh`     | `() => Promise<boolean>`                                    | none                | Renews the credentials after a 401. `true`: retry once. See [Token refresh in detail](#token-refresh-in-detail). |
| `skipRefresh` | `(request: HttpRequest) => boolean`                         | none                | Requests whose 401 never starts a refresh, such as login.                                                        |
| `onRequest`   | `(request: HttpRequest) => unknown`                         | none                | Before every attempt. See [Hooks](#hooks).                                                                       |
| `onResponse`  | `(response: HttpResponse, request: HttpRequest) => unknown` | none                | Once, on success.                                                                                                |
| `onError`     | `(error: RequestError, request: HttpRequest) => unknown`    | none                | Once, on the final error.                                                                                        |
| `fetch`       | `(url: string, init: RequestInit) => Promise<Response>`     | global `fetch`      | Your own `fetch`: tests, SSR, a fake server. The global one is read at call time.                                |

### Request options

| Option         | Type                                                      | Default              | What it does                                                                          |
| -------------- | --------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------- |
| `query`        | object or `URLSearchParams`                               | none                 | Added to the URL. Arrays repeat the key, `null` and `undefined` are skipped.          |
| `headers`      | `HeadersInit` or an object with `undefined` values        | none                 | Merged over the client headers. `undefined` removes a client header.                  |
| `body`         | `unknown`                                                 | none                 | Not on `get`. Objects go as JSON, `FormData`, strings, files and streams as they are. |
| `timeout`      | `number`                                                  | the client `timeout` | For this request. `0` turns it off.                                                   |
| `signal`       | `AbortSignal`                                             | none                 | Cancels the request, the wait for a refresh included.                                 |
| `responseType` | `"json" \| "text" \| "blob" \| "arrayBuffer" \| "stream"` | by `Content-Type`    | How to read a successful body. Sets the type of `data`.                               |
| `schema`       | a Standard Schema                                         | none                 | Checks a successful `data`; `data` gets the schema's output type.                     |
| `skipRefresh`  | `boolean`                                                 | `false`              | A 401 of this request never starts a refresh. For the requests inside `refresh`.      |

Every optional option also accepts `undefined`, so a value of type `T | undefined` can be passed through with `exactOptionalPropertyTypes` on.

The package also exports the types `HttpClient`, `ClientOptions`, `RequestOptions`, `HttpRequest`, `HttpResponse`, `RequestError`, `FetchFunction`, `ResponseBodyType` and `StandardSchemaV1`.

## Bundle size

The same small app in each library: a client with a base URL, a timeout and an `Authorization` header read at send time, a GET of JSON, a POST of JSON, a check for a 404. Minified with esbuild, gzip, dependencies included. Method and code: [`bench/size`](./bench/size), run with `pnpm bench:size`.

| Library       | min + gzip | Notes                                                                                             |
| ------------- | ---------: | ------------------------------------------------------------------------------------------------- |
| wretch        |     2.1 kB | the timeout is an addon; one error type                                                           |
| **tidyfetch** | **3.1 kB** | shared token refresh, an error class per failure, Standard Schema, hooks; no retries, no progress |
| ofetch        |     4.1 kB | automatic retries, `destr` and `ufo` for JSON and URLs; one error type                            |
| ky            |    10.9 kB | retries with backoff, many hooks, upload and download progress, Standard Schema                   |
| axios         |    21.9 kB | interceptors, XHR and `fetch` adapters, progress, many more options                               |

With every other library here, one refresh shared by parallel 401s is written by hand, usually in an interceptor or a hook. Measured in November 2026, the versions are in [`bench/size/package.json`](./bench/size/package.json).

## Testing

The `fetch` option takes any function with the `fetch` signature, so tests need no network and no mocking library:

```ts
import { createClient, type FetchFunction } from "tidyfetch";

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const fakeFetch: FetchFunction = async (url, init) => {
  if (url === "/api/me" && init.method === "GET") return json({ id: 1, name: "Anna" });
  return json({ detail: "Not found" }, 404);
};

const api = createClient({ baseUrl: "/api", fetch: fakeFetch });
const { data } = await api.get<{ id: number; name: string }>("/me");
```

The same option passes a framework's `fetch` during server rendering. Without it, the global `fetch` is read on every call, so a spy or a mock server (such as MSW) set up after `createClient` still works. The demo runs on a fake server this way: [`example/src/fakeServer.ts`](./example/src/fakeServer.ts).

## License

[MIT](./LICENSE)
