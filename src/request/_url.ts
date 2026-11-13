/** One query value. `null` and `undefined` are skipped. */
export type QueryValue = string | number | boolean | null | undefined;

/**
 * Query parameters: a record of values or arrays of values (an array repeats
 * the key: `a=1&a=2`), or a ready `URLSearchParams`.
 */
export type Query = Readonly<Record<string, QueryValue | readonly QueryValue[]>> | URLSearchParams;

// A scheme followed by `//` (`https://`, `http://`). A leading `//` alone is not
// enough: `//users` is a doubled slash in a path more often than a host.
const ABSOLUTE_URL = /^[a-z][a-z\d+\-.]*:\/\//i;

const isList = (value: QueryValue | readonly QueryValue[]): value is readonly QueryValue[] =>
  Array.isArray(value);

function toSearchParams(query: Query): URLSearchParams {
  if (query instanceof URLSearchParams) return query;

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    for (const item of isList(value) ? value : [value]) {
      if (item !== null && item !== undefined) params.append(key, String(item));
    }
  }
  return params;
}

function joinPath(baseUrl: string, path: string): string {
  if (ABSOLUTE_URL.test(path)) return path;
  if (path === "") return baseUrl;
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

/**
 * Builds the request URL as a string. No `new URL()`: it throws on a relative
 * base such as `/api`, which is the usual case in a browser app.
 */
export function buildUrl(baseUrl: string, path: string, query?: Query): string {
  const url = joinPath(baseUrl, path);
  const search = query === undefined ? "" : toSearchParams(query).toString();
  if (search === "") return url;

  // The query goes before a `#hash`, and after a query already in the path.
  const hashStart = url.indexOf("#");
  const beforeHash = hashStart === -1 ? url : url.slice(0, hashStart);
  const hash = hashStart === -1 ? "" : url.slice(hashStart);
  const separator = !beforeHash.includes("?") ? "?" : /[?&]$/.test(beforeHash) ? "" : "&";

  return `${beforeHash}${separator}${search}${hash}`;
}
