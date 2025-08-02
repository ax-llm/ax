import type { AxFunctionJSONSchema } from '../ai/types.js';

export interface SignatureField {
  name: string;
  type: {
    name: string;
    isArray: boolean;
  };
  description?: string;
  isOptional: boolean;
}

/**
 * Converts JSON Schema properties to signature fields with dot notation
 */
export function jsonSchemaToSignatureFields(
  schema: AxFunctionJSONSchema,
  toolName: string,
  prefix = ''
): SignatureField[] {
  const fields: SignatureField[] = [];

  if (!schema || !schema.properties) {
    return fields;
  }

  const properties = schema.properties as Record<string, AxFunctionJSONSchema>;
  const required = (schema.required as string[] | undefined) || [];

  for (const [key, propSchema] of Object.entries(properties)) {
    const fieldName = prefix ? `${prefix}.${key}` : key;
    const fullName = `${toolName}.${fieldName}`;

    const field = createSignatureField(
      fullName,
      propSchema,
      required.includes(key)
    );
    fields.push(field);

    // Handle nested objects
    if (propSchema.type === 'object' && propSchema.properties) {
      const nestedFields = jsonSchemaToSignatureFields(
        propSchema,
        toolName,
        fieldName
      );
      fields.push(...nestedFields);
    }

    // Handle arrays of objects
    if (propSchema.type === 'array' && propSchema.items) {
      const items = propSchema.items as AxFunctionJSONSchema;
      if (items.type === 'object' && items.properties) {
        const nestedFields = jsonSchemaToSignatureFields(
          items,
          toolName,
          `${fieldName}[]`
        );
        fields.push(...nestedFields);
      }
    }
  }

  return fields;
}

function createSignatureField(
  fullName: string,
  schema: AxFunctionJSONSchema,
  isRequired: boolean
): SignatureField {
  const typeName = getTypeName(schema);
  const isArray = schema.type === 'array';

  return {
    name: sanitizeFieldName(fullName),
    type: {
      name: typeName,
      isArray: isArray && typeName !== 'json',
    },
    description: (schema as { description?: string }).description,
    isOptional: !isRequired,
  };
}

function getTypeName(schema: AxFunctionJSONSchema): string {
  switch (schema.type) {
    case 'string':
      return 'string';
    case 'number':
    case 'integer':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'array': {
      const items = schema.items as AxFunctionJSONSchema;
      return items?.type === 'string' ? 'string' : 'json';
    }
    case 'object':
      return 'json';
    default:
      return 'string';
  }
}

function sanitizeFieldName(name: string): string {
  return name
    .replace(/\./g, '_')
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Flattens nested JSON Schema into flat signature fields
 */
export function flattenJSONSchema(
  schema: AxFunctionJSONSchema,
  toolName: string
): Record<string, { type: string; description?: string; required?: boolean }> {
  const flat: Record<
    string,
    { type: string; description?: string; required?: boolean }
  > = {};

  if (!schema || !schema.properties) {
    return flat;
  }

  const properties = schema.properties as Record<string, AxFunctionJSONSchema>;
  const required = (schema.required as string[] | undefined) || [];

  function flatten(obj: Record<string, AxFunctionJSONSchema>, prefix = '') {
    for (const [key, value] of Object.entries(obj)) {
      const path = prefix ? `${prefix}.${key}` : key;

      if (value.type === 'object' && value.properties) {
        flatten(value.properties as Record<string, AxFunctionJSONSchema>, path);
      } else {
        flat[`${toolName}.${path}`] = {
          type: getTypeName(value),
          description: (value as { description?: string }).description,
          required: required.includes(key),
        };
      }
    }
  }

  flatten(properties);
  return flat;
}
