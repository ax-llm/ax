import type { AxFunctionJSONSchema } from '@ax-llm/ax';
import { z } from 'zod';

type AnyZod =
  | z.AnyZodObject
  | z.ZodString
  | z.ZodNumber
  | z.ZodBoolean
  | z.ZodArray<AnyZod>
  | z.ZodOptional<AnyZod>;

export function convertToZodSchema(
  jsonSchema: Readonly<AxFunctionJSONSchema>
): AnyZod {
  const { type, properties, required, items } = jsonSchema;

  switch (type) {
    case 'string':
      return z.string();
    case 'number':
      return z.number();
    case 'boolean':
      return z.boolean();
    case 'array':
      if (!items) {
        throw new Error("Array type must have 'items' property.");
      }
      return z.array(convertToZodSchema(items));
    case 'object': {
      if (!properties) {
        throw new Error("Object type must have 'properties' property.");
      }
      const shape: Record<string, AnyZod> = {};

      for (const [key, value] of Object.entries(properties)) {
        const schema = convertToZodSchema(value);
        let val = required?.includes(key) ? schema : schema.optional();
        val = value.description ? val.describe(value.description) : val;
        shape[key] = val;
      }
      return z.object(shape);
    }
    default:
      throw new Error(`Unsupported type: ${type}`);
  }
}
