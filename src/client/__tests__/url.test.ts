import { describe, expect, it } from "vitest";

import { createClient, type Query } from "../..";
import { recordingFetch } from "./_helpers";

async function urlFor(baseUrl: string, path: string, query?: Query): Promise<string> {
  const { fetch, last } = recordingFetch();
  const api = createClient({ baseUrl, fetch });
  await api.get(path, query === undefined ? {} : { query });
  return last().url;
}

describe("A8: URL building", () => {
  it("works with a relative baseUrl and a query", async () => {
    expect(await urlFor("/api", "/sites", { page: 2 })).toBe("/api/sites?page=2");
  });

  it.each([
    ["/api", "users", "/api/users"],
    ["/api/", "users", "/api/users"],
    ["/api", "/users", "/api/users"],
    ["/api/", "/users", "/api/users"],
    ["/api//", "//users", "/api/users"],
    ["https://example.com/v1/", "/users/1", "https://example.com/v1/users/1"],
    ["https://example.com", "users", "https://example.com/users"],
    ["/", "users", "/users"],
  ])("joins %s and %s with one slash", async (baseUrl, path, expected) => {
    expect(await urlFor(baseUrl, path)).toBe(expected);
  });

  it("uses the baseUrl as is for an empty path", async () => {
    expect(await urlFor("/api/items", "")).toBe("/api/items");
  });

  it.each(["https://cdn.example.com/file.json", "HTTP://example.com/a", "ws://example.com/socket"])(
    "sends %s past the baseUrl",
    async (path) => {
      expect(await urlFor("/api", path)).toBe(path);
    },
  );

  it("appends the query with & when the path already has one", async () => {
    expect(await urlFor("/api", "/items?sort=name", { page: 2 })).toBe(
      "/api/items?sort=name&page=2",
    );
    expect(await urlFor("/api", "/items?", { page: 2 })).toBe("/api/items?page=2");
  });

  it("puts the query before a #hash", async () => {
    expect(await urlFor("/api", "/doc#part", { page: 2 })).toBe("/api/doc?page=2#part");
    expect(await urlFor("/api", "/doc?a=1#part", { page: 2 })).toBe("/api/doc?a=1&page=2#part");
  });

  it("leaves the URL alone when the query is empty", async () => {
    expect(await urlFor("/api", "/items", {})).toBe("/api/items");
    expect(await urlFor("/api", "/items", { a: undefined, b: null })).toBe("/api/items");
  });
});

describe("A9: query values", () => {
  it("repeats the key for an array", async () => {
    expect(await urlFor("/api", "/x", { id: [1, 2, 3] })).toBe("/api/x?id=1&id=2&id=3");
  });

  it("writes booleans as true and false", async () => {
    expect(await urlFor("/api", "/x", { active: true, archived: false })).toBe(
      "/api/x?active=true&archived=false",
    );
  });

  it("skips null and undefined, also inside arrays", async () => {
    const query = { a: null, b: undefined, c: [1, null, undefined, 2], d: 0, e: "" };
    expect(await urlFor("/api", "/x", query)).toBe("/api/x?c=1&c=2&d=0&e=");
  });

  it("accepts URLSearchParams", async () => {
    const params = new URLSearchParams([
      ["tag", "a"],
      ["tag", "b"],
    ]);
    expect(await urlFor("/api", "/x", params)).toBe("/api/x?tag=a&tag=b");
  });

  it("encodes special characters", async () => {
    const url = await urlFor("/api", "/x", { q: "a&b=c d/é?#", "k[]": "1" });
    expect(url).toBe("/api/x?q=a%26b%3Dc+d%2F%C3%A9%3F%23&k%5B%5D=1");
    expect(new URLSearchParams(url.split("?")[1]).get("q")).toBe("a&b=c d/é?#");
  });
});
