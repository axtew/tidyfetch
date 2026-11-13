import { NetworkError, TimeoutError } from "../errors";
import { buildUrl, type HttpRequest, mergeHeaders, prepareBody, resolveHeaders } from "../request";
import { type HttpResponse, type RawBody, readBody, toHttpResponse } from "../response";
import { combineSignals, DEFAULT_TIMEOUT, startDeadline } from "./_signal";
import type { ClientOptions, HttpClient, RequestOptions } from "./_types";

// The DOM types lack `duplex`, which `fetch` requires for a stream body.
type FetchInit = RequestInit & { duplex?: "half" };

export function createClient(options: ClientOptions): HttpClient {
  const { baseUrl, credentials, fetch: customFetch } = options;

  function callFetch(url: string, init: FetchInit): Promise<Response> {
    // Called as a plain function, not as `options.fetch(...)`: the browser `fetch`
    // throws "Illegal invocation" when `this` is not the window. The global one is
    // read here, so a polyfill or a test spy installed after createClient is used.
    return customFetch === undefined ? globalThis.fetch(url, init) : customFetch(url, init);
  }

  /**
   * One round trip: headers, body, fetch, reading the body, under the timeout of
   * this attempt. The caller's signal is passed in, not created here, so it can
   * span several attempts.
   */
  async function attempt<T>(
    method: string,
    url: string,
    requestOptions: RequestOptions,
  ): Promise<HttpResponse<T>> {
    const { signal: callerSignal, responseType } = requestOptions;
    const headers = mergeHeaders(await resolveHeaders(options.headers), requestOptions.headers);
    const body = prepareBody(requestOptions.body, headers);
    const httpRequest: HttpRequest = { method, url, headers };

    const init: FetchInit = { method, headers };
    if (body !== undefined) init.body = body;
    if (body instanceof ReadableStream) init.duplex = "half";
    if (credentials !== undefined) init.credentials = credentials;

    const timeout = requestOptions.timeout ?? options.timeout ?? DEFAULT_TIMEOUT;
    const deadline = startDeadline(timeout, responseType === "stream");
    const signal = combineSignals(callerSignal, deadline);
    if (signal !== undefined) init.signal = signal;

    let response: Response;
    let raw: RawBody;
    try {
      response = await callFetch(url, init);
      raw = await readBody(response, method, responseType);
    } catch (error) {
      // Cancelled by the caller: theirs to handle, rethrown as their signal's reason (A6).
      callerSignal?.throwIfAborted();
      if (deadline?.signal.aborted === true) {
        throw new TimeoutError({ request: httpRequest, timeout, cause: error });
      }
      throw new NetworkError({ request: httpRequest, cause: error });
    } finally {
      deadline?.stop();
    }

    return toHttpResponse<T>(response, httpRequest, raw);
  }

  async function request<T>(
    method: string,
    path: string,
    requestOptions: RequestOptions = {},
  ): Promise<HttpResponse<T>> {
    const url = buildUrl(baseUrl, path, requestOptions.query);
    // `fetch` normalizes the case of GET, POST, PUT, DELETE, but not of PATCH.
    return attempt<T>(method.toUpperCase(), url, requestOptions);
  }

  return {
    request,
    get: (path, requestOptions) => request("GET", path, requestOptions),
    post: (path, requestOptions) => request("POST", path, requestOptions),
    put: (path, requestOptions) => request("PUT", path, requestOptions),
    patch: (path, requestOptions) => request("PATCH", path, requestOptions),
    delete: (path, requestOptions) => request("DELETE", path, requestOptions),
  };
}
