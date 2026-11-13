import { SchemaError } from "../errors";
import type { HttpRequest } from "../request";
import type { StandardSchemaV1 } from "./_standardSchema";

/**
 * Checks `data` against `schema` and returns the schema's output, so its
 * transforms and defaults apply. Throws `SchemaError` with the issues.
 */
export async function validate(
  schema: StandardSchemaV1,
  data: unknown,
  response: Response,
  request: HttpRequest,
): Promise<unknown> {
  // `validate` may answer at once or with a promise (async refinements).
  const result = await schema["~standard"].validate(data);
  // The spec: a falsy `issues` means success.
  if (result.issues) {
    throw new SchemaError({ request, response, data, issues: result.issues });
  }
  return result.value;
}
