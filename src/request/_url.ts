/** One query value. `null` and `undefined` are skipped. */
export type QueryValue = string | number | boolean | null | undefined;

/**
 * What a query object must look like: every value is a query value or an array
 * of them. A mapped type rather than a `Record`, so an `interface` fits too
 * (an interface has no index signature, a `Record` requires one).
 */
export type QueryObject<Q> = { [K in keyof Q]: QueryValue | readonly QueryValue[] };

/**
 * Query parameters: a record of values or arrays of values (an array repeats
 * the key: `a=1&a=2`), or a ready `URLSearchParams`.
 */
export type Query = Readonly<Record<string, QueryValue | readonly QueryValue[]>> | URLSearchParams;

// A scheme followed by `//` (`https://`, `http://`). A leading `//` alone is not
// enough: `//users` is a doubled slash in a path more often than a host.
const ABSOLUTE_URL = /^[a-z][a-z\d+\-.]*:\/\//i;

const isQueryValue = (value: unknown): value is QueryValue =>
  value === null ||
  value === undefined ||
  typeof value === "string" ||
  typeof value === "number" ||
  typeof value === "boolean";

function toSearchParams(query: object): URLSearchParams {
  if (query instanceof URLSearchParams) return query;
  // Untyped callers: a string would be split into characters by Object.entries.
  if (typeof query !== "object" || query === null) {
    throw new TypeError("Query must be an object or URLSearchParams");
  }

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    const items: readonly unknown[] = Array.isArray(value) ? value : [value];
    for (const item of items) {
      // The types catch this only where the query type is inferred, so check here too:
      // `String(item)` would quietly send "[object Object]" or a locale date.
      if (!isQueryValue(item)) {
        throw new TypeError(
          `Query parameter "${key}" must be a string, number, boolean, null, undefined or an array of these`,
        );
      }
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
export function buildUrl(baseUrl: string, path: string, query?: object): string {
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
