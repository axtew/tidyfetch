import type { HeadersOption, HttpRequest, QueryObject, RequestHeaders } from "../request";
import type { HttpResponse, ResponseBodyType } from "../response";

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
}

/** Options of a request without a body (`get`). */
export interface BodylessRequestOptions<Q = object> {
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
   * How to read a successful body; by the content type when not set. With
   * `"stream"` the timeout stops once the headers arrive, the caller's signal keeps working.
   */
  responseType?: ResponseBodyType | undefined;
  /** `true`: a 401 of this request never triggers a refresh. For the requests `refresh` sends. */
  skipRefresh?: boolean | undefined;
}

export interface RequestOptions<Q = object> extends BodylessRequestOptions<Q> {
  /**
   * `string`, `Blob`, `ArrayBuffer`, typed arrays, `FormData`, `URLSearchParams` and
   * `ReadableStream` are sent as is. Anything else is sent as JSON with
   * `Content-Type: application/json`, unless a `Content-Type` is already set.
   * `FormData` always goes without a set `Content-Type`: `fetch` adds it with the boundary.
   * A `ReadableStream` can be sent only once, so a request with it is not retried after a refresh.
   */
  body?: unknown;
}

// `Q` is inferred from `query` and every value is checked against the query value
// types. With `T` given explicitly `Q` is not inferred and falls back to `object`:
// any object passes the types and is checked at run time.
export interface HttpClient {
  /** Any method; the other methods are shortcuts for it. The method name is upper-cased. */
  request<T = unknown, Q extends object & QueryObject<Q> = object>(
    method: string,
    path: string,
    options?: RequestOptions<Q>,
  ): Promise<HttpResponse<T>>;
  get<T = unknown, Q extends object & QueryObject<Q> = object>(
    path: string,
    options?: BodylessRequestOptions<Q>,
  ): Promise<HttpResponse<T>>;
  post<T = unknown, Q extends object & QueryObject<Q> = object>(
    path: string,
    options?: RequestOptions<Q>,
  ): Promise<HttpResponse<T>>;
  put<T = unknown, Q extends object & QueryObject<Q> = object>(
    path: string,
    options?: RequestOptions<Q>,
  ): Promise<HttpResponse<T>>;
  patch<T = unknown, Q extends object & QueryObject<Q> = object>(
    path: string,
    options?: RequestOptions<Q>,
  ): Promise<HttpResponse<T>>;
  delete<T = unknown, Q extends object & QueryObject<Q> = object>(
    path: string,
    options?: RequestOptions<Q>,
  ): Promise<HttpResponse<T>>;
}
