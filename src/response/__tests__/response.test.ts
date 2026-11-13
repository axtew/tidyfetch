import { describe, expect, it } from "vitest";

import { createClient, HttpError, ParseError, type ResponseBodyType } from "../..";
import { rejectionOf } from "../../client/__tests__/_helpers";

/** A client whose `fetch` answers with `make()` every time. */
function clientAnswering(make: () => Response): ReturnType<typeof createClient> {
  return createClient({ baseUrl: "/api", fetch: () => Promise.resolve(make()) });
}

const bytes = (text: string) => new TextEncoder().encode(text);

/** A response with exactly the given content type, or none. */
function answer(body: string, contentType: string | null, status = 200): Response {
  // A string body would get `text/plain` from the Response constructor.
  const headers: HeadersInit = contentType === null ? {} : { "content-type": contentType };
  return new Response(bytes(body), { status, headers });
}

describe("no body gives data undefined", () => {
  it.each([204, 205])("for status %i, even with a JSON content type", async (status) => {
    const api = clientAnswering(
      () => new Response(null, { status, headers: { "content-type": "application/json" } }),
    );

    const response = await api.get("/x");

    expect(response.status).toBe(status);
    expect(response.data).toBeUndefined();
  });

  it("for a HEAD request, whatever the server sends", async () => {
    const api = clientAnswering(() => answer('{"a":1}', "application/json"));

    expect((await api.request("head", "/x")).data).toBeUndefined();
  });

  it("for an empty body with a JSON content type, instead of a parse error", async () => {
    const api = clientAnswering(() => answer("", "application/json; charset=utf-8"));

    expect((await api.get("/x")).data).toBeUndefined();
  });

  it("for a JSON body of whitespace only", async () => {
    const api = clientAnswering(() => answer(" \n", "application/json"));

    expect((await api.get("/x")).data).toBeUndefined();
  });

  it("for an empty text body", async () => {
    const api = clientAnswering(() => answer("", "text/plain"));

    expect((await api.get("/x")).data).toBeUndefined();
  });

  it("for 304, which is not 2xx and so an HttpError", async () => {
    const api = clientAnswering(() => new Response(null, { status: 304 }));

    const error = await rejectionOf(api.get("/x"), HttpError);

    expect(error.data).toBeUndefined();
  });
});

describe("a body that does not parse", () => {
  it("throws ParseError with the SyntaxError as cause, never puts the message into data", async () => {
    const api = clientAnswering(() => answer('{"a":', "application/json"));

    const error = await rejectionOf(api.get("/x"), ParseError);

    expect(error.name).toBe("ParseError");
    expect(error.message).toBe("GET /api/x returned a body that failed to parse");
    expect(error.cause).toBeInstanceOf(SyntaxError);
    expect(error.response).toBeInstanceOf(Response);
    expect(error.response.status).toBe(200);
    expect(error.request).toMatchObject({ method: "GET", url: "/api/x" });
  });

  it("gives HttpError with the text as data when an error body is not JSON", async () => {
    const api = clientAnswering(() => answer("<h1>Bad gateway</h1>", "application/json", 502));

    const error = await rejectionOf(api.get("/x"), HttpError);

    expect(error.data).toBe("<h1>Bad gateway</h1>");
  });
});

describe("default body type by content type", () => {
  it.each([
    ["application/json", '{"a":1}', { a: 1 }],
    ["application/json; charset=utf-8", '{"a":1}', { a: 1 }],
    ["Application/JSON", "[1,2]", [1, 2]],
    ["application/problem+json", '{"title":"x"}', { title: "x" }],
    ["application/vnd.api+json", '{"data":null}', { data: null }],
    ["text/plain", "hello", "hello"],
    ["text/html; charset=utf-8", "<p>hi</p>", "<p>hi</p>"],
    ["text/csv", "a,b", "a,b"],
    ["application/xml", "<a/>", "<a/>"],
    ["text/xml", "<a/>", "<a/>"],
    ["image/svg+xml", "<svg/>", "<svg/>"],
    ["application/atom+xml", "<feed/>", "<feed/>"],
    [null, '{"a":1}', '{"a":1}'],
  ])("%s", async (contentType, body, expected) => {
    const api = clientAnswering(() => answer(body, contentType));

    expect((await api.get("/x")).data).toEqual(expected);
  });

  it.each(["application/octet-stream", "image/png", "application/pdf"])(
    "%s gives a Blob",
    async (contentType) => {
      const api = clientAnswering(() => answer("raw", contentType));

      const { data } = await api.get<Blob>("/x");

      expect(data).toBeInstanceOf(Blob);
      expect(await data.text()).toBe("raw");
    },
  );
});

const json = (): Response => answer('{"a":1}', "text/plain");

describe("responseType overrides the content type", () => {
  it("json", async () => {
    expect((await clientAnswering(json).get("/x", { responseType: "json" })).data).toEqual({
      a: 1,
    });
  });

  it("json with a broken body throws ParseError", async () => {
    const api = clientAnswering(() => answer("nope", "text/plain"));

    await expect(api.get("/x", { responseType: "json" })).rejects.toBeInstanceOf(ParseError);
  });

  it("text", async () => {
    const api = clientAnswering(() => answer('{"a":1}', "application/json"));

    expect((await api.get("/x", { responseType: "text" })).data).toBe('{"a":1}');
  });

  it("blob", async () => {
    const { data } = await clientAnswering(json).get("/x", { responseType: "blob" });

    expect(data).toBeInstanceOf(Blob);
    expect(await data.text()).toBe('{"a":1}');
  });

  it("arrayBuffer", async () => {
    const { data } = await clientAnswering(json).get("/x", {
      responseType: "arrayBuffer",
    });

    expect(data).toBeInstanceOf(ArrayBuffer);
    expect(new TextDecoder().decode(data)).toBe('{"a":1}');
  });

  it("stream gives response.body unread", async () => {
    const { data } = await clientAnswering(json).get("/x", {
      responseType: "stream",
    });

    expect(data).toBeInstanceOf(ReadableStream);
    expect(await new Response(data).text()).toBe('{"a":1}');
  });

  it("does not apply to an error body, which is read by its content type", async () => {
    const api = clientAnswering(() => answer('{"message":"gone"}', "application/json", 404));

    const error = await rejectionOf(api.get("/file", { responseType: "blob" }), HttpError);

    expect(error.data).toEqual({ message: "gone" });
  });
});

/** The body read to the end, as text, whatever form `data` takes. */
async function textOf(data: unknown): Promise<string> {
  if (typeof data === "string") return data;
  if (data instanceof Blob) return data.text();
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  if (data instanceof ReadableStream) return new Response(data).text();
  throw new Error(`unexpected data: ${String(data)}`);
}

const binaryTypes: [ResponseBodyType, abstract new (...args: never[]) => unknown][] = [
  ["blob", Blob],
  ["arrayBuffer", ArrayBuffer],
  ["stream", ReadableStream],
];

describe("an explicit responseType other than json always gives its type, empty without a body", () => {
  const noBody: [string, () => Response, string][] = [
    ["204", () => new Response(null, { status: 204 }), "GET"],
    ["205", () => new Response(null, { status: 205 }), "GET"],
    ["a null body", () => new Response(null), "GET"],
    ["an empty body", () => answer("", "text/plain"), "GET"],
    ["a HEAD request", () => answer("ignored", "text/plain"), "HEAD"],
  ];

  describe.each(noBody)("%s", (_, make, method) => {
    it("text gives an empty string", async () => {
      const api = clientAnswering(make);

      expect((await api.request(method, "/x", { responseType: "text" })).data).toBe("");
    });

    it.each(binaryTypes)("%s gives an empty one", async (responseType, type) => {
      const api = clientAnswering(make);

      const { data } = await api.request(method, "/x", { responseType });

      expect(data).toBeInstanceOf(type);
      expect(await textOf(data)).toBe("");
    });
  });

  it.each(noBody)("json still gives undefined for %s", async (_, make, method) => {
    const api = clientAnswering(make);

    expect((await api.request(method, "/x", { responseType: "json" })).data).toBeUndefined();
  });

  it("without responseType an empty text body is still undefined", async () => {
    const api = clientAnswering(() => answer("", "text/plain"));

    expect((await api.get("/x")).data).toBeUndefined();
  });

  it("the empty stream is a fresh one each time, closed", async () => {
    const api = clientAnswering(() => new Response(null, { status: 204 }));

    const first = await api.get("/x", { responseType: "stream" });
    const second = await api.get("/x", { responseType: "stream" });

    expect(first.data).not.toBe(second.data);
    expect(await first.data.getReader().read()).toEqual({ done: true, value: undefined });
  });
});

describe("the resolved response", () => {
  it("has the agreed shape", async () => {
    const api = clientAnswering(() => answer('{"id":1}', "application/json", 201));

    const response = await api.post<{ id: number }>("/items", { body: { name: "a" } });

    expect(response).toEqual({
      ok: true,
      status: 201,
      statusText: "",
      headers: expect.any(Headers),
      url: "/api/items",
      data: { id: 1 },
    });
  });
});
