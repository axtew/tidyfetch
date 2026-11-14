import type { RequestError } from "../errors";
import type { HeadersOption, HttpRequest, QueryObject, RequestHeaders } from "../request";
import type { HttpResponse, ResponseBodyType } from "../response";
import type { StandardSchemaV1 } from "../schema";

/** A `fetch` implementation: the global one by default. */
export type FetchFunction = (input: string, init: RequestInit) => Promise<Response>;

// Every optional option also takes `undefined`, meaning "not given". Without it,
// under `exactOptionalPropertyTypes` a value typed `T | undefined` (an optional
// parameter passed through, `{ signal }`) would not fit.

export interface ClientOptions {
  /**
   * Prefix for every relative path. May be relative itself (`/api`) or absolute
   * (`https://api.example.com/v1`). A path with a scheme ignores it.
   */
  baseUrl: string;
  /**
   * Sent with every request. A function is called before every request and may
   * be async, so a token is read at send time. Request headers override these by name.
   */
  headers?: HeadersOption | undefined;
  /** Passed to `fetch` as is: `"include"` sends cookies to another origin. */
  credentials?: RequestCredentials | undefined;
  /**
   * Milliseconds for one request, body included, before it fails with
   * `TimeoutError`. `0` turns it off. 30000 by default. Each attempt gets its own
   * timeout: a retry after a refresh starts anew, the wait for the refresh is not counted.
   */
  timeout?: number | undefined;
  /** Custom `fetch` (tests, SSR, a fake server). The global `fetch`, read at call time, by default. */
  fetch?: FetchFunction | undefined;
  /**
   * Renews the credentials when a request gets 401: resolve `true` when new
   * credentials are in place (the request is then sent once more, with the
   * client headers computed again), `false` when they could not be renewed (the
   * request fails with its 401 `HttpError`). A throw counts as `false` and
   * becomes the `cause` of that `HttpError`.
   *
   * Parallel 401s share one call. A request is retried at most once, and a
   * request that got its 401 after a refresh had already succeeded is retried
   * without another refresh.
   *
   * Requests sent by `refresh` itself must not trigger a refresh: mark them with
   * `skipRefresh: true` or match them with the `skipRefresh` option. Otherwise a
   * 401 there waits for the very refresh it is part of, and never settles.
   *
   * @example
   * refresh: async () => {
   *   const { data } = await api.post<Tokens>("/auth/refresh", {
   *     body: { refresh: getRefreshToken() },
   *     skipRefresh: true,
   *   });
   *   saveTokens(data);
   *   return true;
   * },
   */
  refresh?: (() => Promise<boolean>) | undefined;
  /**
   * Requests whose 401 never triggers a refresh, such as login or the refresh
   * endpoint. Called with the request that got the 401.
   */
  skipRefresh?: ((request: HttpRequest) => boolean) | undefined;

  // The hooks only observe. Each is called without waiting for it, what it
  // returns is ignored, and it cannot change the request or its result.

  /**
   * Before every attempt, the retry after a refresh included. The headers are a
   * copy: to send a header, use the `headers` option. A throw or a rejection here
   * does not affect the request; it is reported: through `reportError` where there
   * is one (browsers, Deno), with `console.error` elsewhere (Node), so a broken hook
   * never ends a server process.
   */
  onRequest?: ((request: HttpRequest) => unknown) | undefined;
  /**
   * Once per request, on the final success, with `data` already through the
   * `schema`. A throw or a rejection is reported, as in `onRequest`.
   */
  onResponse?: ((response: HttpResponse, request: HttpRequest) => unknown) | undefined;
  /**
   * Once per request, with the error it finally fails with: a 401 cured by a
   * refresh never gets here. Not called when the caller cancels the request, nor
   * for errors thrown before it is sent (by a `headers` function, a query or a
   * body that cannot be sent). A throw or a rejection is reported, as in `onRequest`.
   */
  onError?: ((error: RequestError, request: HttpRequest) => unknown) | undefined;
}

/**
 * Options of a request without a body (`get`). `R` and `S` are the types of
 * `responseType` and `schema`, so that the type of `data` can follow them.
 */
export interface BodylessRequestOptions<
  Q = object,
  R extends ResponseBodyType | undefined = ResponseBodyType | undefined,
  S extends StandardSchemaV1 | undefined = StandardSchemaV1 | undefined,
> {
  /**
   * Added to the URL: an object (an `interface` type too) or `URLSearchParams`.
   * Values are strings, numbers, booleans or arrays of them; an array repeats
   * the key, `null` and `undefined` are skipped. Other values throw `TypeError`.
   */
  query?: Q | URLSearchParams | undefined;
  /**
   * Merged over the client headers: a header here wins by name, case-insensitively.
   * In the object form `undefined` removes a client header: `{ Authorization: undefined }`.
   */
  headers?: RequestHeaders | undefined;
  /** Overrides the client `timeout` for this request; `0` turns it off. */
  timeout?: number | undefined;
  /**
   * Cancels the request, the wait for a refresh included. A cancelled request
   * rejects with the signal's `reason` (an `AbortError` `DOMException` by
   * default), not with a library error.
   */
  signal?: AbortSignal | undefined;
  /**
   * How to read a successful body; by the content type when not set. Then, and
   * with `"json"`, a missing or empty body gives `undefined`. `"text"` gives a
   * `string`, `"blob"` a `Blob`, `"arrayBuffer"` an `ArrayBuffer`, `"stream"`
   * the unread `ReadableStream`, each of them empty when there is no body. With
   * `"stream"` the timeout stops once the headers arrive, the caller's signal
   * keeps working.
   */
  responseType?: R;
  /**
   * A Standard Schema (Zod, Valibot, ArkType and others) that a successful
   * `data` must pass. `data` is then the schema's output, so its transforms and
   * defaults apply; a mismatch throws `SchemaError`. The schema gets `data` as
   * read, after `responseType`. Error bodies are not checked.
   */
  schema?: S;
  /** `true`: a 401 of this request never triggers a refresh. For the requests `refresh` sends. */
  skipRefresh?: boolean | undefined;
}

export interface RequestOptions<
  Q = object,
  R extends ResponseBodyType | undefined = ResponseBodyType | undefined,
  S extends StandardSchemaV1 | undefined = StandardSchemaV1 | undefined,
> extends BodylessRequestOptions<Q, R, S> {
  /**
   * `string`, `Blob`, `ArrayBuffer`, typed arrays, `FormData`, `URLSearchParams` and
   * `ReadableStream` are sent as is. Anything else is sent as JSON with
   * `Content-Type: application/json`, unless a `Content-Type` is already set.
   * `FormData` always goes without a set `Content-Type`: `fetch` adds it with the boundary.
   * A `ReadableStream` can be sent only once, so a request with it is not retried after a refresh.
   */
  body?: unknown;
}

/**
 * The type of `data`: the schema's output when there is a `schema`, otherwise
 * by `responseType`, otherwise the caller's `T` (by default `unknown`).
 */
export type ResponseData<
  T,
  R extends ResponseBodyType | undefined,
  S extends StandardSchemaV1 | undefined,
> = S extends StandardSchemaV1
  ? StandardSchemaV1.InferOutput<S>
  : R extends "text"
    ? string
    : R extends "blob"
      ? Blob
      : R extends "arrayBuffer"
        ? ArrayBuffer
        : R extends "stream"
          ? ReadableStream<Uint8Array>
          : T;

/**
 * The client. Every method takes the same type parameters:
 * - `T` is the type of JSON `data`: a claim about the server, not checked.
 * - `Q` is inferred from `query`, and every value is checked against the query
 *   value types.
 * - `R` and `S` are inferred from `responseType` and `schema`.
 *
 * A `T` given explicitly turns the inference of the others off: `Q` falls back
 * to `object` (any object passes the types and is checked at run time), and
 * only `responseType: "json"` and no `schema` are accepted. With a
 * `responseType` or a `schema`, leave `T` out: the type of `data` follows them.
 */
export interface HttpClient {
  /** Any method; the other methods are shortcuts for it. The method name is upper-cased. */
  request<
    T = unknown,
    Q extends object & QueryObject<Q> = object,
    R extends ResponseBodyType | undefined = "json" | undefined,
    S extends StandardSchemaV1 | undefined = undefined,
  >(
    method: string,
    path: string,
    options?: RequestOptions<Q, R, S>,
  ): Promise<HttpResponse<ResponseData<T, R, S>>>;
  get<
    T = unknown,
    Q extends object & QueryObject<Q> = object,
    R extends ResponseBodyType | undefined = "json" | undefined,
    S extends StandardSchemaV1 | undefined = undefined,
  >(
    path: string,
    options?: BodylessRequestOptions<Q, R, S>,
  ): Promise<HttpResponse<ResponseData<T, R, S>>>;
  post<
    T = unknown,
    Q extends object & QueryObject<Q> = object,
    R extends ResponseBodyType | undefined = "json" | undefined,
    S extends StandardSchemaV1 | undefined = undefined,
  >(
    path: string,
    options?: RequestOptions<Q, R, S>,
  ): Promise<HttpResponse<ResponseData<T, R, S>>>;
  put<
    T = unknown,
    Q extends object & QueryObject<Q> = object,
    R extends ResponseBodyType | undefined = "json" | undefined,
    S extends StandardSchemaV1 | undefined = undefined,
  >(
    path: string,
    options?: RequestOptions<Q, R, S>,
  ): Promise<HttpResponse<ResponseData<T, R, S>>>;
  patch<
    T = unknown,
    Q extends object & QueryObject<Q> = object,
    R extends ResponseBodyType | undefined = "json" | undefined,
    S extends StandardSchemaV1 | undefined = undefined,
  >(
    path: string,
    options?: RequestOptions<Q, R, S>,
  ): Promise<HttpResponse<ResponseData<T, R, S>>>;
  delete<
    T = unknown,
    Q extends object & QueryObject<Q> = object,
    R extends ResponseBodyType | undefined = "json" | undefined,
    S extends StandardSchemaV1 | undefined = undefined,
  >(
    path: string,
    options?: RequestOptions<Q, R, S>,
  ): Promise<HttpResponse<ResponseData<T, R, S>>>;
}
