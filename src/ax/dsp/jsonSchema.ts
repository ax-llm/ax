import type { AxFunctionJSONSchema } from '../ai/types.js';
import type { AxField } from './sig.js';

/**
 * Enhances field description with validation constraint information
 * so the LLM understands the requirements
 */
function enhanceDescriptionWithValidation(
  baseDescription: string | undefined,
  type?: AxField['type']
): string | undefined {
  if (!type) return baseDescription;

  const constraints: string[] = [];

  // Email format
  if (type.format === 'email') {
    constraints.push('Must be a valid email address format');
  }

  // URL format
  if (type.format === 'uri' || type.format === 'url' || type.name === 'url') {
    constraints.push('Must be a valid URL format');
  }

  // String length constraints
  if (
    type.name === 'string' ||
    type.name === 'code' ||
    type.name === 'url' ||
    type.name === 'date' ||
    type.name === 'datetime'
  ) {
    if (type.minLength !== undefined && type.maxLength !== undefined) {
      constraints.push(
        `Minimum length: ${type.minLength} characters, maximum length: ${type.maxLength} characters`
      );
    } else if (type.minLength !== undefined) {
      constraints.push(`Minimum length: ${type.minLength} characters`);
    } else if (type.maxLength !== undefined) {
      constraints.push(`Maximum length: ${type.maxLength} characters`);
    }
  }

  // Number range constraints
  if (type.name === 'number') {
    if (type.minimum !== undefined && type.maximum !== undefined) {
      constraints.push(
        `Minimum value: ${type.minimum}, maximum value: ${type.maximum}`
      );
    } else if (type.minimum !== undefined) {
      constraints.push(`Minimum value: ${type.minimum}`);
    } else if (type.maximum !== undefined) {
      constraints.push(`Maximum value: ${type.maximum}`);
    }
  }

  // Regex pattern - patternDescription is required
  if (type.pattern !== undefined) {
    if (!type.patternDescription) {
      throw new Error(
        `Field with pattern '${type.pattern}' must include a patternDescription to explain the pattern to the LLM`
      );
    }
    constraints.push(type.patternDescription);
  }

  // Date/DateTime format hints
  if (type.name === 'date') {
    constraints.push('Format: YYYY-MM-DD');
  }
  if (type.name === 'datetime') {
    constraints.push('Format: ISO 8601 date-time');
  }

  // Combine base description with constraints
  if (constraints.length === 0) {
    return baseDescription;
  }

  const constraintText = constraints.join('. ');

  if (!baseDescription || baseDescription.trim().length === 0) {
    return constraintText;
  }

  // Ensure base description ends with period
  const normalizedBase = baseDescription.trim().endsWith('.')
    ? baseDescription.trim()
    : `${baseDescription.trim()}.`;

  return `${normalizedBase} ${constraintText}`;
}

export function toJsonSchema(
  fields: Readonly<AxField[]> | Readonly<AxField>,
  schemaTitle: string = 'Schema'
): AxFunctionJSONSchema {
  // Handle single field case (for recursive calls or single output)
  if ('name' in fields && 'type' in fields) {
    return fieldToSchema(fields as AxField);
  }

  // Handle array of fields (root object)
  const properties: Record<string, any> = {};
  const required: string[] = [];

  for (const field of fields as AxField[]) {
    if (field.isInternal) continue;

    const schema = fieldToSchema(field);
    properties[field.name] = schema;

    if (!field.isOptional) {
      required.push(field.name);
    }
  }

  return {
    type: 'object',
    title: schemaTitle,
    properties,
    required,
    additionalProperties: false,
  };
}

function fieldToSchema(field: Readonly<AxField>, isNested = false): any {
  const type = field.type;

  // Enhance description with validation constraints
  const description = enhanceDescriptionWithValidation(field.description, type);

  // Validate that media types are not used in nested objects
  if (
    isNested &&
    type?.name &&
    (type.name === 'image' || type.name === 'audio' || type.name === 'file')
  ) {
    throw new Error(
      `Media type '${type.name}' is not allowed in nested object fields. ` +
        `Media types (image, audio, file) can only be used as top-level input fields. ` +
        `Field: ${field.name}`
    );
  }

  const schema: any = {};

  if (description) {
    schema.description = description;
  }

  if (type?.isArray) {
    schema.type = 'array';
    if (type.fields) {
      // Array of objects
      schema.items = {
        type: 'object',
        properties: {},
        required: [],
        additionalProperties: false,
      };
      for (const [key, fieldType] of Object.entries(type.fields)) {
        const nestedField: AxField = {
          name: key,
          description: fieldType.description,
          type: {
            name: fieldType.type,
            isArray: fieldType.isArray,
            options: fieldType.options ? [...fieldType.options] : undefined,
            fields: fieldType.fields,
            minLength: fieldType.minLength,
            maxLength: fieldType.maxLength,
            minimum: fieldType.minimum,
            maximum: fieldType.maximum,
            pattern: fieldType.pattern,
            patternDescription: fieldType.patternDescription,
            format: fieldType.format,
          },
          isOptional: fieldType.isOptional,
          isInternal: fieldType.isInternal,
        };
        schema.items.properties[key] = fieldToSchema(nestedField, true);
        if (!fieldType.isOptional) {
          schema.items.required.push(key);
        }
      }
    } else if (type.name === 'class' && type.options) {
      schema.items = {
        type: 'string',
        enum: type.options,
      };
    } else {
      // Array of primitives
      // Enhance description for array items
      const itemDescription = enhanceDescriptionWithValidation(
        field.description,
        type
      );

      schema.items = {
        type: mapAxTypeToJsonSchemaType(type.name),
      };

      if (itemDescription) {
        schema.items.description = itemDescription;
      }

      // Add constraints to array items
      if (
        type.name === 'string' ||
        type.name === 'code' ||
        type.name === 'url' ||
        type.name === 'date' ||
        type.name === 'datetime'
      ) {
        if (type.minLength !== undefined) {
          schema.items.minLength = type.minLength;
        }
        if (type.maxLength !== undefined) {
          schema.items.maxLength = type.maxLength;
        }
        if (type.pattern !== undefined) {
          schema.items.pattern = type.pattern;
        }
        if (type.format !== undefined) {
          schema.items.format = type.format;
        }
      } else if (type.name === 'number') {
        if (type.minimum !== undefined) {
          schema.items.minimum = type.minimum;
        }
        if (type.maximum !== undefined) {
          schema.items.maximum = type.maximum;
        }
      }
    }
  } else if (type?.name === 'object' && type.fields) {
    schema.type = 'object';
    schema.properties = {};
    schema.required = [];
    schema.additionalProperties = false;

    for (const [key, fieldType] of Object.entries(type.fields)) {
      const nestedField: AxField = {
        name: key,
        description: fieldType.description,
        type: {
          name: fieldType.type,
          isArray: fieldType.isArray,
          options: fieldType.options ? [...fieldType.options] : undefined,
          fields: fieldType.fields,
          minLength: fieldType.minLength,
          maxLength: fieldType.maxLength,
          minimum: fieldType.minimum,
          maximum: fieldType.maximum,
          pattern: fieldType.pattern,
          patternDescription: fieldType.patternDescription,
          format: fieldType.format,
        },
        isOptional: fieldType.isOptional,
        isInternal: fieldType.isInternal,
      };
      schema.properties[key] = fieldToSchema(nestedField, true);
      if (!fieldType.isOptional) {
        schema.required.push(key);
      }
    }
  } else if (type?.name === 'class' && type.options) {
    schema.type = 'string';
    schema.enum = type.options;
  } else {
    schema.type = mapAxTypeToJsonSchemaType(type?.name ?? 'string');

    // Add constraints based on field type
    if (
      type?.name === 'string' ||
      type?.name === 'code' ||
      type?.name === 'url' ||
      type?.name === 'date' ||
      type?.name === 'datetime'
    ) {
      if (type.minLength !== undefined) {
        schema.minLength = type.minLength;
      }
      if (type.maxLength !== undefined) {
        schema.maxLength = type.maxLength;
      }
      if (type.pattern !== undefined) {
        schema.pattern = type.pattern;
      }
      if (type.format !== undefined) {
        schema.format = type.format;
      }
      // Add default format hints for special types
      if (type.name === 'url' && !type.format) {
        schema.format = 'uri';
      }
      if (type.name === 'date' && !type.format) {
        schema.format = 'date';
      }
      if (type.name === 'datetime' && !type.format) {
        schema.format = 'date-time';
      }
    } else if (type?.name === 'number') {
      if (type.minimum !== undefined) {
        schema.minimum = type.minimum;
      }
      if (type.maximum !== undefined) {
        schema.maximum = type.maximum;
      }
    }
  }

  return schema;
}

function mapAxTypeToJsonSchemaType(axType: string): string | string[] {
  switch (axType) {
    case 'string':
    case 'code':
    case 'url':
    case 'date':
    case 'datetime':
    case 'image':
    case 'audio':
    case 'file':
      return 'string';
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'json':
    case 'object':
      return ['object', 'array', 'string', 'number', 'boolean', 'null'];
    default:
      return 'string';
  }
}

export function validateJSONSchema(schema: any): void {
  if (!schema || typeof schema !== 'object') {
    throw new Error('Schema must be an object');
  }

  if (schema.type === 'array') {
    if (!schema.items) {
      throw new Error(
        'Array schema is missing an "items" definition (required by JSON Schema and all LLM providers for function tools)'
      );
    }
    validateJSONSchema(schema.items);
  } else if (schema.type === 'object') {
    if (schema.properties) {
      for (const prop of Object.values(schema.properties)) {
        validateJSONSchema(prop);
      }
    }
  }
}
