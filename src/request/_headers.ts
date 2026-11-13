/**
 * Client headers: a value, or a function called before every request
 * (a token that changes over time is read when the request is sent).
 */
export type HeadersOption = HeadersInit | (() => HeadersInit | Promise<HeadersInit>);

/**
 * Request headers: any `HeadersInit`. In the object form a value `undefined`
 * removes a client header of that name for this request:
 * `{ Authorization: undefined }`.
 */
export type RequestHeaders = HeadersInit | Readonly<Record<string, string | undefined>>;

export async function resolveHeaders(option: HeadersOption | undefined): Promise<HeadersInit> {
  if (option === undefined) return {};
  return typeof option === "function" ? option() : option;
}

/**
 * Merges header sources in order: a later source overrides an earlier one by
 * name, case-insensitively, and an `undefined` value in an object removes the
 * name. Any `HeadersInit` form works (object, `Headers`, array of pairs).
 */
export function mergeHeaders(...sources: ReadonlyArray<RequestHeaders | undefined>): Headers {
  const merged = new Headers();
  for (const source of sources) {
    if (source === undefined) continue;
    if (source instanceof Headers || Array.isArray(source)) {
      new Headers(source).forEach((value, name) => {
        merged.set(name, value);
      });
      continue;
    }
    for (const [name, value] of Object.entries(source)) {
      if (value === undefined) merged.delete(name);
      else merged.set(name, value);
    }
  }
  return merged;
}
