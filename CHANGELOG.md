# Changelog

The format follows [Keep a Changelog](https://keepachangelog.com), versions follow [semver](https://semver.org). While the version is 0.x, a minor release may change the API.

## 0.1.0 - 2026-11-14

The first release.

- `createClient` with `get`, `post`, `put`, `patch`, `delete` and `request`; responses as `{ ok, status, statusText, headers, url, data }`.
- Requests: a relative or absolute `baseUrl`, a full URL bypasses it; query objects with arrays and skipped `null` / `undefined`, `interface` types accepted; client and request headers merged by name, `undefined` removes a client header; objects sent as JSON, `FormData`, files, strings and streams as they are.
- Responses read by `Content-Type` or by `responseType`; empty bodies give `undefined`; the type of `data` follows `responseType` and `schema`.
- Errors: `HttpError`, `TimeoutError`, `NetworkError`, `ParseError`, `SchemaError`. A cancelled request rejects with the signal's reason.
- A timeout per attempt, 30 seconds by default, through `AbortSignal`; with `responseType: "stream"` only until the headers.
- Token refresh: parallel 401s share one `refresh` call, a request is retried at most once, a late 401 is retried without a second refresh, `skipRefresh` for login and for the requests inside `refresh`.
- Response validation with any Standard Schema (Zod, Valibot, ArkType), no dependency on them.
- Observing hooks `onRequest`, `onResponse`, `onError`.
- A custom `fetch` for tests, server rendering and the demo.
- ESM, ES2022, Node 20.3 or newer, TypeScript 5.0 or newer.
