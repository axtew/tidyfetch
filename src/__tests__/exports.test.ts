import { describe, expect, it } from "vitest";

import * as entry from "../index";

describe("entry point", () => {
  it("exports createClient and the error classes, nothing else at runtime", () => {
    expect(Object.keys(entry)).toEqual(
      expect.arrayContaining([
        "createClient",
        "HttpError",
        "NetworkError",
        "ParseError",
        "TimeoutError",
      ]),
    );
    expect(Object.keys(entry)).toHaveLength(5);
    expect(entry.createClient).toBeTypeOf("function");
    for (const errorClass of [
      entry.HttpError,
      entry.NetworkError,
      entry.ParseError,
      entry.TimeoutError,
    ]) {
      expect(errorClass.prototype).toBeInstanceOf(Error);
    }
  });
});
