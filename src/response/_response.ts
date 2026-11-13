import { HttpError, ParseError } from "../errors";
import type { HttpRequest } from "../request";

/** What every successful request resolves to. */
export interface HttpResponse<T = unknown> {
  /** Always `true`: a status outside 200-299 throws `HttpError`. */
  ok: boolean;
  status: number;
  statusText: string;
  headers: Headers;
  /** The final URL after redirects; the requested URL when `fetch` reports none. */
  url: string;
  data: T;
}

/**
 * How to read the response body. `"stream"` gives `response.body` unread.
 * By default it follows the content type: JSON types (`application/json`,
 * `*+json`) as `"json"`, `text/*` and XML as `"text"`, no content type as
 * `"text"`, anything else as `"blob"`.
 */
export type ResponseBodyType = "json" | "text" | "blob" | "arrayBuffer" | "stream";

/** The body as read from the wire, before JSON parsing. */
export interface RawBody {
  type: ResponseBodyType;
  /** A string for json and text, `undefined` when the response has no body. */
  value: unknown;
}

// Statuses that never carry a body.
const NO_BODY_STATUSES = new Set([204, 205, 304]);

export function detectBodyType(contentType: string | null): "json" | "text" | "blob" {
  const mime = (contentType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  if (mime === "") return "text";
  if (mime === "application/json" || mime.endsWith("+json")) return "json";
  if (mime.startsWith("text/") || mime.endsWith("/xml") || mime.endsWith("+xml")) return "text";
  return "blob";
}

/**
 * Reads the body. Only network and abort errors come out of here; parsing is
 * separate, so a timeout while reading is not mistaken for a broken body.
 */
export async function readBody(
  response: Response,
  method: string,
  responseType: ResponseBodyType | undefined,
): Promise<RawBody> {
  // `responseType` describes the success body. An error body is read by its own
  // content type: a failed file download usually answers with JSON.
  const type =
    response.ok && responseType !== undefined
      ? responseType
      : detectBodyType(response.headers.get("content-type"));

  if (method === "HEAD" || NO_BODY_STATUSES.has(response.status)) {
    return { type, value: undefined };
  }
  if (type === "json" || type === "text") return { type, value: await response.text() };
  if (type === "blob") return { type, value: await response.blob() };
  if (type === "arrayBuffer") return { type, value: await response.arrayBuffer() };
  return { type, value: response.body ?? undefined };
}

/** Turns the raw body into `data`. Throws the `SyntaxError` of broken JSON. */
function decodeBody({ type, value }: RawBody): unknown {
  if (typeof value !== "string") return value;
  // An empty body is "no data", not an empty string or a JSON error (A7).
  if (type === "json") return value.trim() === "" ? undefined : JSON.parse(value);
  return value === "" ? undefined : value;
}

/**
 * Builds the resolved response, or throws `HttpError` for a status outside
 * 200-299 and `ParseError` for a successful body that does not parse.
 */
export function toHttpResponse<T>(
  response: Response,
  request: HttpRequest,
  body: RawBody,
): HttpResponse<T> {
  if (!response.ok) {
    let data: unknown;
    try {
      data = decodeBody(body);
    } catch {
      // A broken error body is still worth showing: keep its text.
      data = body.value;
    }
    throw new HttpError({ request, response, data });
  }

  let data: unknown;
  try {
    data = decodeBody(body);
  } catch (cause) {
    throw new ParseError({ request, response, cause });
  }

  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
    url: response.url || request.url,
    // `T` is the caller's claim about the server, not checked here.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    data: data as T,
  };
}
