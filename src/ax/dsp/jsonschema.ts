import type { AxFunctionJSONSchema } from '../ai/types.js'

// Extended type to handle flexible JSON schemas with union types
type FlexibleJSONSchema = AxFunctionJSONSchema & {
  anyOf?: FlexibleJSONSchema[]
  oneOf?: FlexibleJSONSchema[]
  allOf?: FlexibleJSONSchema[]
  properties?: Record<string, FlexibleJSONSchema | undefined>
}

interface ValidationError {
  path: string
  issue: string
  fix: string
  example?: string
}

export const validateJSONSchema = (
  schema: Readonly<AxFunctionJSONSchema>
): void => {
  const errors: ValidationError[] = []

  const validateSchemaObject = (
    schema: Readonly<FlexibleJSONSchema | undefined>,
    path: string = ''
  ): void => {
    // Skip validation if schema is undefined or null
    if (!schema || typeof schema !== 'object') {
      return
    }

    const validTypes = [
      'array',
      'integer',
      'number',
      'string',
      'boolean',
      'null',
      'object',
    ]

    // Handle schemas with anyOf (union types)
    if (schema.anyOf && Array.isArray(schema.anyOf)) {
      if (schema.anyOf.length === 0) {
        errors.push({
          path: path || 'root',
          issue: 'anyOf array is empty',
          fix: 'Add at least one schema to the anyOf array',
          example: 'anyOf: [{ type: "string" }, { type: "null" }]',
        })
      }
      // Validate each schema in anyOf
      schema.anyOf.forEach((subSchema: FlexibleJSONSchema, index: number) => {
        validateSchemaObject(subSchema, `${path}anyOf[${index}].`)
      })
      return
    }

    // Handle schemas with oneOf
    if (schema.oneOf && Array.isArray(schema.oneOf)) {
      if (schema.oneOf.length === 0) {
        errors.push({
          path: path || 'root',
          issue: 'oneOf array is empty',
          fix: 'Add at least one schema to the oneOf array',
          example: 'oneOf: [{ type: "string" }, { type: "number" }]',
        })
      }
      schema.oneOf.forEach((subSchema: FlexibleJSONSchema, index: number) => {
        validateSchemaObject(subSchema, `${path}oneOf[${index}].`)
      })
      return
    }

    // Handle schemas with allOf
    if (schema.allOf && Array.isArray(schema.allOf)) {
      if (schema.allOf.length === 0) {
        errors.push({
          path: path || 'root',
          issue: 'allOf array is empty',
          fix: 'Add at least one schema to the allOf array',
          example:
            'allOf: [{ type: "object" }, { properties: { name: { type: "string" } } }]',
        })
      }
      schema.allOf.forEach((subSchema: FlexibleJSONSchema, index: number) => {
        validateSchemaObject(subSchema, `${path}allOf[${index}].`)
      })
      return
    }

    // Skip validation if no type is specified (might be a reference or other valid schema)
    if (!schema.type) {
      return
    }

    if (!validTypes.includes(schema.type)) {
      errors.push({
        path: path || 'root',
        issue: `Invalid type '${schema.type}'`,
        fix: `Change type to one of: ${validTypes.join(', ')}`,
        example: `{ type: "string" } or { type: "object" }`,
      })
      return
    }

    if (schema.type === 'object') {
      if (schema.properties) {
        if (
          typeof schema.properties !== 'object' ||
          Array.isArray(schema.properties)
        ) {
          errors.push({
            path: path || 'root',
            issue: 'properties must be an object, not an array or primitive',
            fix: 'Change properties to be an object with property names as keys',
            example:
              'properties: { name: { type: "string" }, age: { type: "number" } }',
          })
        } else {
          for (const key in schema.properties) {
            const value = schema.properties[key]
            // Skip undefined or null properties
            if (value === undefined || value === null) {
              continue
            }
            if (typeof value !== 'object') {
              errors.push({
                path: `${path}${key}`,
                issue: `Property schema must be an object, got ${typeof value}`,
                fix: 'Define the property as a proper schema object',
                example: `${key}: { type: "string", description: "..." }`,
              })
              continue
            }
            validateSchemaObject(value, `${path}${key}.`)
          }
        }
      }

      if (schema.required) {
        if (!Array.isArray(schema.required)) {
          errors.push({
            path: path || 'root',
            issue: `'required' must be an array, got ${typeof schema.required}`,
            fix: 'Change required to be an array of property names',
            example:
              'required: ["name", "email"] instead of required: "name,email"',
          })
        } else if (schema.required.length === 0) {
          // This is valid but might be worth noting
        } else {
          // Validate that required properties exist in properties
          if (schema.properties) {
            for (const requiredProp of schema.required) {
              if (typeof requiredProp !== 'string') {
                errors.push({
                  path: `${path}required`,
                  issue: `Required property names must be strings, got ${typeof requiredProp}`,
                  fix: 'Ensure all items in required array are strings',
                  example:
                    'required: ["name", "email"] not required: [123, "email"]',
                })
              } else if (!(requiredProp in schema.properties)) {
                errors.push({
                  path: `${path}required`,
                  issue: `Required property '${requiredProp}' is not defined in properties`,
                  fix: `Either add '${requiredProp}' to properties or remove it from required`,
                  example: `properties: { ${requiredProp}: { type: "string" } }`,
                })
              }
            }
          }
        }
      }
    }

    if (schema.type === 'array') {
      if (schema.items) {
        if (typeof schema.items !== 'object') {
          errors.push({
            path: `${path}items`,
            issue: `Array items schema must be an object, got ${typeof schema.items}`,
            fix: 'Define items as a proper schema object',
            example:
              'items: { type: "string" } or items: { type: "object", properties: {...} }',
          })
        } else {
          validateSchemaObject(schema.items, `${path}items.`)
        }
      }
    }
  }

  validateSchemaObject(schema)

  if (errors.length > 0) {
    const errorMessage = [
      'JSON Schema validation failed:',
      '',
      ...errors.map((error, index) => {
        const parts = [
          `${index + 1}. Path: ${error.path}`,
          `   Issue: ${error.issue}`,
          `   Fix: ${error.fix}`,
        ]
        if (error.example) {
          parts.push(`   Example: ${error.example}`)
        }
        return parts.join('\n')
      }),
      '',
      'Please fix these issues and try again.',
    ].join('\n')

    throw new Error(errorMessage)
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
    },
    optionalField: {
      anyOf: [
        { type: 'string' },
        { type: 'null' }
      ]
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
  validateJSONSchema(validSchema);
} catch (error) {
  console.error('Schema validation failed:', error.message);
}

try {
  validateJSONSchema(invalidSchema);
} catch (error) {
  console.error('Schema validation failed:', error.message);
}
*/
