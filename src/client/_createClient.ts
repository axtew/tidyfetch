import { isRequestError, NetworkError, TimeoutError } from "../errors";
import { buildUrl, type HttpRequest, mergeHeaders, prepareBody, resolveHeaders } from "../request";
import { type HttpResponse, type RawBody, readBody, toHttpResponse } from "../response";
import { validate } from "../schema";
import { notify } from "./_hooks";
import { createRefresh } from "./_refresh";
import { combineSignals, DEFAULT_TIMEOUT, startDeadline, throwIfAborted } from "./_signal";
import type { ClientOptions, HttpClient, RequestOptions } from "./_types";

// The DOM types lack `duplex`, which `fetch` requires for a stream body.
type FetchInit = RequestInit & { duplex?: "half" };

/** A successful attempt. */
interface Received {
  result: HttpResponse;
  /** The `fetch` response, for `SchemaError`. */
  response: Response;
  request: HttpRequest;
}

export function createClient(options: ClientOptions): HttpClient {
  const { baseUrl, credentials, fetch: customFetch, onRequest, onResponse, onError } = options;
  const sendWithRefresh =
    options.refresh === undefined ? undefined : createRefresh(options.refresh, options.skipRefresh);

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
  async function attempt(
    method: string,
    url: string,
    requestOptions: RequestOptions,
  ): Promise<Received> {
    const { signal: callerSignal, responseType } = requestOptions;
    const headers = mergeHeaders(await resolveHeaders(options.headers), requestOptions.headers);
    const body = prepareBody(requestOptions.body, headers);
    const httpRequest: HttpRequest = { method, url, headers };

    const init: FetchInit = { method, headers };
    if (body !== undefined) init.body = body;
    if (body instanceof ReadableStream) init.duplex = "half";
    if (credentials !== undefined) init.credentials = credentials;

    // Already cancelled (before the call, or while the headers were computed):
    // nothing is sent and no timer is started.
    throwIfAborted(callerSignal);
    const timeout = requestOptions.timeout ?? options.timeout ?? DEFAULT_TIMEOUT;
    const deadline = startDeadline(timeout, responseType === "stream");
    const combined = combineSignals(callerSignal, deadline);
    if (combined !== undefined) init.signal = combined.signal;

    // A copy of the headers, so that the hook cannot change what is sent.
    if (onRequest !== undefined) notify(onRequest, { method, url, headers: new Headers(headers) });

    let response: Response;
    let raw: RawBody;
    // A successful stream is read by the caller after we return, and the caller's
    // signal must still reach it. Without `AbortSignal.any` that takes our listener
    // on the caller's signal, so it stays until that signal aborts or is garbage
    // collected. Every other outcome takes it off here.
    let keepCallerListener = false;
    try {
      response = await callFetch(url, init);
      raw = await readBody(response, method, responseType);
      keepCallerListener = raw.type === "stream" && response.ok;
    } catch (error) {
      // Cancelled by the caller: theirs to handle, rethrown as their signal's reason
      // rather than turned into a library error.
      throwIfAborted(callerSignal);
      if (deadline?.signal.aborted === true) {
        throw new TimeoutError({ request: httpRequest, timeout, cause: error });
      }
      throw new NetworkError({ request: httpRequest, cause: error });
    } finally {
      deadline?.stop();
      if (!keepCallerListener) combined?.release();
    }

    return { result: toHttpResponse(response, httpRequest, raw), response, request: httpRequest };
  }

  async function request<T>(
    method: string,
    path: string,
    requestOptions: RequestOptions = {},
  ): Promise<HttpResponse<T>> {
    const url = buildUrl(baseUrl, path, requestOptions.query);
    // `fetch` normalizes the case of GET, POST, PUT, DELETE, but not of PATCH.
    const upperMethod = method.toUpperCase();
    // Every call is a fresh attempt: client headers, body and timeout are prepared anew.
    const send = (): Promise<Received> => attempt(upperMethod, url, requestOptions);
    const { schema } = requestOptions;

    let received: Received;
    let result: HttpResponse;
    try {
      received =
        sendWithRefresh === undefined
          ? await send()
          : await sendWithRefresh(send, {
              signal: requestOptions.signal,
              resendable: !(requestOptions.body instanceof ReadableStream),
              skip: requestOptions.skipRefresh === true,
            });
      result = received.result;
      if (schema !== undefined) {
        const { response, request: httpRequest } = received;
        result = { ...result, data: await validate(schema, result.data, response, httpRequest) };
      }
    } catch (error) {
      // Only library errors. A cancel by the caller rejects with the signal's reason
      // and is not a failure; an error thrown before the request is sent (by the
      // headers function, the query, the body) is the caller's to see.
      if (onError !== undefined && isRequestError(error)) notify(onError, error, error.request);
      throw error;
    }

    // A copy, so that the hook cannot replace a field of what the caller gets.
    if (onResponse !== undefined) notify(onResponse, { ...result }, received.request);
    // `T` is the caller's claim about the server, or the schema's output.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    return result as HttpResponse<T>;
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
