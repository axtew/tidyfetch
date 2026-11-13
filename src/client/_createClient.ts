import { buildUrl, mergeHeaders, prepareBody, resolveHeaders } from "../request";
import { type HttpResponse, readResponse } from "../response";
import type { ClientOptions, HttpClient, RequestOptions } from "./_types";

export function createClient(options: ClientOptions): HttpClient {
  const { baseUrl, credentials, fetch: customFetch } = options;

  async function request<T = unknown>(
    method: string,
    path: string,
    requestOptions: RequestOptions = {},
  ): Promise<HttpResponse<T>> {
    const url = buildUrl(baseUrl, path, requestOptions.query);
    const headers = mergeHeaders(await resolveHeaders(options.headers), requestOptions.headers);
    const body = prepareBody(requestOptions.body, headers);

    // `fetch` normalizes the case of GET, POST, PUT, DELETE, but not of PATCH.
    const init: RequestInit = { method: method.toUpperCase(), headers };
    if (body !== undefined) init.body = body;
    if (credentials !== undefined) init.credentials = credentials;

    // Called as a plain function, not as `options.fetch(...)`: the browser `fetch`
    // throws "Illegal invocation" when `this` is not the window. The global one is
    // read here, so a polyfill or a test spy installed after createClient is used.
    const response =
      customFetch === undefined ? await globalThis.fetch(url, init) : await customFetch(url, init);

    return readResponse<T>(response, url);
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
