import type { AxFunctionJSONSchema } from '../ai/types.js'

export const validateJSONSchema = (
  schema: Readonly<AxFunctionJSONSchema>
): void => {
  const errors: string[] = []

  const validateSchemaObject = (
    schema: Readonly<AxFunctionJSONSchema>,
    path: string = ''
  ): void => {
    const validTypes = [
      'array',
      'integer',
      'number',
      'string',
      'boolean',
      'null',
      'object',
    ]

    if (!validTypes.includes(schema.type)) {
      errors.push(`Invalid type '${schema.type}' at ${path || 'root'}`)
      return
    }

    if (schema.type === 'object' && schema.properties) {
      if (
        typeof schema.properties !== 'object' ||
        Array.isArray(schema.properties)
      ) {
        errors.push(`Invalid properties object at ${path || 'root'}`)
      } else {
        for (const key in schema.properties) {
          const value = schema.properties[key]
          if (typeof value !== 'object') {
            errors.push(`Invalid schema object at ${path}${key}`)
            continue
          }
          validateSchemaObject(value, `${path}${key}.`)
        }
      }

      if (schema.required && !Array.isArray(schema.required)) {
        errors.push(`'required' should be an array at ${path || 'root'}`)
      }
    }

    if (schema.type === 'array' && schema.items) {
      if (typeof schema.items !== 'object') {
        errors.push(`Invalid items schema at ${path || 'root'}`)
      } else {
        validateSchemaObject(schema.items, `${path}items.`)
      }
    }
  }

  validateSchemaObject(schema)

  if (errors.length > 0) {
    throw new Error(errors.join('; '))
  }
}

// Example Usage:

/*
const validSchema: AxFunctionJSONSchema = {
  type: 'object',
  properties: {
    id: { type: 'integer' },
    name: { type: 'string' },
    email: { type: 'string' },
    isActive: { type: 'boolean' },
    tags: {
      type: 'array',
      items: { type: 'string' }
    }
  },
  required: ['id', 'name', 'email']
};

const invalidSchema: any = {
  type: 'object',
  properties: {
    id: { type: 'integer' },
    name: { type: 'string' },
    email: { type: 'unknownType' }, // Invalid type
    isActive: { type: 'boolean' },
    tags: {
      type: 'array',
      items: { type: 'string' }
    }
  },
  required: 'id,name,email' // Invalid 'required' field
};

try {
  validateSchemaStructure(validSchema);
  console.log('Schema is valid!');
} catch (error) {
  console.error('Schema validation failed:', error.message);
}

try {
  validateSchemaStructure(invalidSchema);
  console.log('Schema is valid!');
} catch (error) {
  console.error('Schema validation failed:', error.message);
}
*/
