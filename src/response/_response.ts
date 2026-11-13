/** What every request resolves to. */
export interface HttpResponse<T = unknown> {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Headers;
  /** The final URL after redirects; the requested URL when `fetch` reports none. */
  url: string;
  data: T;
}

/**
 * Reads the body: JSON when the content type says so, text otherwise, `undefined`
 * when the body is empty.
 */
export async function readResponse<T>(
  response: Response,
  requestUrl: string,
): Promise<HttpResponse<T>> {
  const text = await response.text();
  const contentType = response.headers.get("content-type") ?? "";
  const isJson = /[/+]json\b/i.test(contentType);
  const data: unknown = text === "" ? undefined : isJson ? JSON.parse(text) : text;

  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
    url: response.url || requestUrl,
    // `T` is the caller's claim about the server, not checked here.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    data: data as T,
  };
}
