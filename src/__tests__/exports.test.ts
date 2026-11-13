import { describe, expect, expectTypeOf, it } from "vitest";

import type {
  BodylessRequestOptions,
  ClientOptions,
  HttpResponse,
  RequestError,
  RequestOptions,
  ResponseData,
  SchemaErrorInit,
  StandardSchemaV1,
  StandardTypedV1,
} from "../index";
import * as entry from "../index";

describe("entry point", () => {
  it("exports createClient and the error classes, nothing else at runtime", () => {
    expect(Object.keys(entry)).toEqual(
      expect.arrayContaining([
        "createClient",
        "HttpError",
        "NetworkError",
        "ParseError",
        "SchemaError",
        "TimeoutError",
      ]),
    );
    expect(Object.keys(entry)).toHaveLength(6);
    expect(entry.createClient).toBeTypeOf("function");
    for (const errorClass of [
      entry.HttpError,
      entry.NetworkError,
      entry.ParseError,
      entry.SchemaError,
      entry.TimeoutError,
    ]) {
      expect(errorClass.prototype).toBeInstanceOf(Error);
    }
  });

  it("exports the types of schemas, hooks and response data", () => {
    expectTypeOf<RequestError>().toEqualTypeOf<
      | entry.HttpError
      | entry.NetworkError
      | entry.ParseError
      | entry.SchemaError
      | entry.TimeoutError
    >();
    expectTypeOf<SchemaErrorInit["issues"]>().toEqualTypeOf<readonly StandardSchemaV1.Issue[]>();
    expectTypeOf<StandardSchemaV1>().toExtend<StandardTypedV1>();
    expectTypeOf<ResponseData<number, "blob", undefined>>().toEqualTypeOf<Blob>();
    expectTypeOf<BodylessRequestOptions["schema"]>().toEqualTypeOf<StandardSchemaV1 | undefined>();
    expectTypeOf<RequestOptions["responseType"]>().toEqualTypeOf<
      "json" | "text" | "blob" | "arrayBuffer" | "stream" | undefined
    >();
    expectTypeOf<
      Parameters<NonNullable<ClientOptions["onResponse"]>>[0]
    >().toEqualTypeOf<HttpResponse>();
  });
});
