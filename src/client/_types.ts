import type { HeadersOption, Query } from "../request";
import type { HttpResponse } from "../response";

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
  /** Custom `fetch` (tests, SSR, a fake server). The global `fetch`, read at call time, by default. */
  fetch?: FetchFunction;
}

export interface RequestOptions {
  /** Added to the URL. `null` and `undefined` values are skipped; an array repeats the key. */
  query?: Query;
  /** Merged over the client headers: a header here wins by name, case-insensitively. */
  headers?: HeadersInit;
  /**
   * `string`, `Blob`, `ArrayBuffer`, typed arrays, `FormData`, `URLSearchParams` and
   * `ReadableStream` are sent as is. Anything else is sent as JSON with
   * `Content-Type: application/json`, unless a `Content-Type` is already set.
   */
  body?: unknown;
}

/** Options of a request without a body (`get`). */
export type BodylessRequestOptions = Omit<RequestOptions, "body">;

export interface HttpClient {
  /** Any method; the other methods are shortcuts for it. The method name is upper-cased. */
  request<T = unknown>(
    method: string,
    path: string,
    options?: RequestOptions,
  ): Promise<HttpResponse<T>>;
  get<T = unknown>(path: string, options?: BodylessRequestOptions): Promise<HttpResponse<T>>;
  post<T = unknown>(path: string, options?: RequestOptions): Promise<HttpResponse<T>>;
  put<T = unknown>(path: string, options?: RequestOptions): Promise<HttpResponse<T>>;
  patch<T = unknown>(path: string, options?: RequestOptions): Promise<HttpResponse<T>>;
  delete<T = unknown>(path: string, options?: RequestOptions): Promise<HttpResponse<T>>;
}
