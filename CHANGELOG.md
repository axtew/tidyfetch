# Changelog

The format follows [Keep a Changelog](https://keepachangelog.com), versions follow [semver](https://semver.org). While the version is 0.x, a minor release may change the API.

## 0.2.0 - 2026-11-15

Works in older browsers.

- Browsers without `AbortSignal.any` are supported: Chrome 98, Firefox 97, Safari 15.4 (iOS 15.4) or newer, instead of Chrome 116, Firefox 124, Safari 17.4. Where `AbortSignal.any` is missing, the caller's signal and the timeout are joined by hand, and the listeners on the caller's signal are removed when each attempt ends. The error `AbortSignal.any is not supported here` is gone.
- Browsers without `AbortSignal.timeout` are supported too: the timeout runs on a timer instead.
- Node 20 or newer, instead of 20.3.
- `TimeoutError`, `NetworkError` and a cancel by the caller are told apart the same way on both paths.
- A request whose signal is already aborted rejects with the signal's reason without calling `fetch`, and `onRequest` is not called for it.
- With `responseType: "stream"` in a browser without `AbortSignal.any`, one listener stays on the caller's signal while the stream may still be read, so that the signal can stop it.
- Bundle size 3.2 kB min + gzip, up from 3.1 kB.

## 0.1.0 - 2026-11-15

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
