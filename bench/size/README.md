# Bundle size

The same small example built with each library: a client with a base URL, a timeout and an `Authorization` header read when the request is sent, a GET of JSON, a POST of JSON, and a check for a 404 error. The code is in [`entries`](./entries).

- Bundled with esbuild, minified, ESM, for the browser.
- Counted: everything the example imports, the library's own dependencies included (ofetch brings `destr` and `ufo`).
- gzip at level 9, brotli at its default level.

Run from the repository root:

```sh
pnpm bench:size
```

It builds tidyfetch, installs the pinned versions from `package.json` and writes [`results.md`](./results.md).

The libraries do not do the same job. wretch puts the timeout in an addon and has one error type; ofetch and ky retry failed requests; ky and axios report upload and download progress; axios has interceptors and an XHR adapter next to `fetch`. None of them shares one token refresh between parallel 401 responses: with them it is written by hand. The README of tidyfetch lists these notes next to the numbers.
