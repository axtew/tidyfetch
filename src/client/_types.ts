import type { HeadersOption, QueryObject, RequestHeaders } from "../request";
import type { HttpResponse, ResponseBodyType } from "../response";

/** A `fetch` implementation: the global one by default. */
export type FetchFunction = (input: string, init: RequestInit) => Promise<Response>;

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
  headers?: HeadersOption;
  /** Passed to `fetch` as is: `"include"` sends cookies to another origin. */
  credentials?: RequestCredentials;
  /**
   * Milliseconds for one request, body included, before it fails with
   * `TimeoutError`. `0` turns it off. 30000 by default.
   */
  timeout?: number;
  /** Custom `fetch` (tests, SSR, a fake server). The global `fetch`, read at call time, by default. */
  fetch?: FetchFunction;
}

/** Options of a request without a body (`get`). */
export interface BodylessRequestOptions<Q = object> {
  /**
   * Added to the URL: an object (an `interface` type too) or `URLSearchParams`.
   * Values are strings, numbers, booleans or arrays of them; an array repeats
   * the key, `null` and `undefined` are skipped. Other values throw `TypeError`.
   * `undefined` is allowed explicitly, for an optional `params` passed through.
   */
  query?: Q | URLSearchParams | undefined;
  /**
   * Merged over the client headers: a header here wins by name, case-insensitively.
   * In the object form `undefined` removes a client header: `{ Authorization: undefined }`.
   */
  headers?: RequestHeaders;
  /** Overrides the client `timeout` for this request; `0` turns it off. */
  timeout?: number;
  /**
   * Cancels the request. A cancelled request rejects with the signal's `reason`
   * (an `AbortError` `DOMException` by default), not with a library error.
   */
  signal?: AbortSignal;
  /**
   * How to read a successful body; by the content type when not set. With
   * `"stream"` the timeout stops once the headers arrive, the caller's signal keeps working.
   */
  responseType?: ResponseBodyType;
}

export interface RequestOptions<Q = object> extends BodylessRequestOptions<Q> {
  /**
   * `string`, `Blob`, `ArrayBuffer`, typed arrays, `FormData`, `URLSearchParams` and
   * `ReadableStream` are sent as is. Anything else is sent as JSON with
   * `Content-Type: application/json`, unless a `Content-Type` is already set.
   * `FormData` always goes without a set `Content-Type`: `fetch` adds it with the boundary.
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
