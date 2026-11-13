import { describe, expect, it } from "vitest";

import { createClient } from "../..";
import { recordingFetch } from "./_helpers";

const methods = ["post", "put", "patch", "delete"] as const;

const passThrough: ReadonlyArray<[string, () => BodyInit]> = [
  [
    "FormData",
    () => {
      const form = new FormData();
      form.append("file", new Blob(["x"]), "x.txt");
      return form;
    },
  ],
  ["URLSearchParams", () => new URLSearchParams({ a: "1" })],
  ["Blob", () => new Blob(["x"], { type: "text/plain" })],
  ["string", () => "raw text"],
  ["ArrayBuffer", () => new ArrayBuffer(4)],
  ["Uint8Array", () => new Uint8Array([1, 2])],
  ["DataView", () => new DataView(new ArrayBuffer(2))],
  ["ReadableStream", () => new ReadableStream()],
];

describe("A3: the body is prepared the same way for every method", () => {
  describe.each(methods)("%s", (method) => {
    it.each(passThrough)("sends %s as is, without a Content-Type", async (_name, make) => {
      const { fetch, last } = recordingFetch();
      const api = createClient({ baseUrl: "/api", fetch });
      const body = make();

      await api[method]("/x", { body });

      expect(last().init.body).toBe(body);
      expect(last().headers.has("content-type")).toBe(false);
    });

    it("sends an object as JSON with Content-Type: application/json", async () => {
      const { fetch, last } = recordingFetch();
      const api = createClient({ baseUrl: "/api", fetch });

      await api[method]("/x", { body: { name: "a", tags: [1, 2] } });

      expect(last().init.body).toBe('{"name":"a","tags":[1,2]}');
      expect(last().headers.get("content-type")).toBe("application/json");
    });
  });

  it.each([
    ["an array", [1, 2], "[1,2]"],
    ["a number", 0, "0"],
    ["a boolean", false, "false"],
    ["null", null, "null"],
  ])("sends %s as JSON", async (_name, body, json) => {
    const { fetch, last } = recordingFetch();
    const api = createClient({ baseUrl: "/api", fetch });

    await api.post("/x", { body });

    expect(last().init.body).toBe(json);
    expect(last().headers.get("content-type")).toBe("application/json");
  });

  it("keeps a Content-Type set by the client or by the request", async () => {
    const { fetch, calls } = recordingFetch();
    const api = createClient({
      baseUrl: "/api",
      headers: { "Content-Type": "application/vnd.api+json" },
      fetch,
    });

    await api.post("/x", { body: { a: 1 } });
    await api.patch("/x", {
      body: { a: 1 },
      headers: { "content-type": "application/merge-patch+json" },
    });

    expect(calls.map((call) => call.headers.get("content-type"))).toEqual([
      "application/vnd.api+json",
      "application/merge-patch+json",
    ]);
  });

  it("sends no body and no Content-Type when the body is undefined", async () => {
    const { fetch, last } = recordingFetch();
    const api = createClient({ baseUrl: "/api", fetch });

    await api.post("/x");

    expect("body" in last().init).toBe(false);
    expect(last().headers.has("content-type")).toBe(false);
  });
});
