/**
 * Client headers: a value, or a function called before every request
 * (a token that changes over time is read when the request is sent).
 */
export type HeadersOption = HeadersInit | (() => HeadersInit | Promise<HeadersInit>);

export async function resolveHeaders(option: HeadersOption | undefined): Promise<HeadersInit> {
  if (option === undefined) return {};
  return typeof option === "function" ? option() : option;
}

/**
 * Merges header sources in order: a later source overrides an earlier one by
 * name, case-insensitively. Any `HeadersInit` form works (object, `Headers`,
 * array of pairs), because each source goes through `new Headers`.
 */
export function mergeHeaders(...sources: ReadonlyArray<HeadersInit | undefined>): Headers {
  const merged = new Headers();
  for (const source of sources) {
    if (source === undefined) continue;
    new Headers(source).forEach((value, name) => {
      merged.set(name, value);
    });
  }
  return merged;
}
