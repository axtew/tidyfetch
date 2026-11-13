/** A value `fetch` accepts as a body directly. */
function isBodyInit(body: unknown): body is BodyInit {
  return (
    typeof body === "string" ||
    body instanceof Blob ||
    body instanceof ArrayBuffer ||
    ArrayBuffer.isView(body) ||
    body instanceof FormData ||
    body instanceof URLSearchParams ||
    body instanceof ReadableStream
  );
}

/**
 * Turns a request body into a `fetch` body. Values `fetch` understands go as is,
 * and `fetch` picks their `Content-Type` itself (for `FormData` it must, to add
 * the boundary). Anything else is sent as JSON, with `Content-Type:
 * application/json` unless the headers already name a type. Mutates `headers`.
 */
export function prepareBody(body: unknown, headers: Headers): BodyInit | undefined {
  if (body === undefined) return undefined;
  if (isBodyInit(body)) return body;

  if (!headers.has("content-type")) headers.set("content-type", "application/json");
  return JSON.stringify(body);
}
