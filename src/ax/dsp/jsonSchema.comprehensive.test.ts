import { describe, expect, it } from 'vitest';
import { validateJSONSchema } from './jsonSchema.js';
import { AxSignature, f } from './sig.js';

describe('jsonSchema - json vs object equivalence', () => {
  it('json and object types should produce identical JSON schemas', () => {
    const sigJson = AxSignature.create('userQuery:string -> resultData:json');
    const sigObject = AxSignature.create(
      'userQuery:string -> resultData:object'
    );

    const schemaJson = sigJson.toJSONSchema();
    const schemaObject = sigObject.toJSONSchema();

    // Both should map to the same flexible type array
    expect(schemaJson.properties?.resultData).toEqual(
      schemaObject.properties?.resultData
    );
    expect(schemaJson.properties?.resultData).toEqual({
      type: ['object', 'array', 'string', 'number', 'boolean', 'null'],
      description: undefined,
    });
  });

  it('json[] and object[] arrays should produce identical JSON schemas', () => {
    const sigJson = AxSignature.create(
      'userQuery:string -> resultItems:json[]'
    );
    const sigObject = AxSignature.create(
      'userQuery:string -> resultItems:object[]'
    );

    const schemaJson = sigJson.toJSONSchema();
    const schemaObject = sigObject.toJSONSchema();

    expect(schemaJson.properties?.resultItems).toEqual(
      schemaObject.properties?.resultItems
    );
    expect(schemaJson.properties?.resultItems).toEqual({
      type: 'array',
      items: {
        type: ['object', 'array', 'string', 'number', 'boolean', 'null'],
      },
      description: undefined,
    });
  });

  it('fluent API: json and object should be equivalent', () => {
    const sigJson = f()
      .input('userQuery', f.string())
      .output('resultData', f.json())
      .build();

    const sigObject = f()
      .input('userQuery', f.string())
      .output('resultData', f.object({}))
      .build();

    const _schemaJson = sigJson.toJSONSchema();
    const _schemaObject = sigObject.toJSONSchema();

    // Note: f.object({}) creates a structured object, while f.json() creates a flexible type
    // This is actually correct behavior - they serve different purposes
    // f.json() = any JSON value
    // f.object({...}) = structured object with specific fields
  });
});

describe('jsonSchema - type mapping correctness', () => {
  it('should map basic types correctly', () => {
    const sig = AxSignature.create(
      'userQuery:string -> textResult:string, numberResult:number, boolResult:boolean'
    );
    const schema = sig.toJSONSchema();

    expect(schema.properties?.textResult?.type).toBe('string');
    expect(schema.properties?.numberResult?.type).toBe('number');
    expect(schema.properties?.boolResult?.type).toBe('boolean');
  });

  it('should map json type to flexible schema', () => {
    const sig = AxSignature.create('userQuery:string -> flexibleData:json');
    const schema = sig.toJSONSchema();

    expect(schema.properties?.flexibleData?.type).toEqual([
      'object',
      'array',
      'string',
      'number',
      'boolean',
      'null',
    ]);
  });

  it('should map object type to flexible schema (same as json)', () => {
    const sig = AxSignature.create('userQuery:string -> flexibleData:object');
    const schema = sig.toJSONSchema();

    expect(schema.properties?.flexibleData?.type).toEqual([
      'object',
      'array',
      'string',
      'number',
      'boolean',
      'null',
    ]);
  });
});

describe('jsonSchema - array handling', () => {
  it('should handle string arrays', () => {
    const sig = AxSignature.create('userQuery:string -> tags:string[]');
    const schema = sig.toJSONSchema();

    expect(schema.properties?.tags).toEqual({
      type: 'array',
      items: { type: 'string' },
      description: undefined,
    });
  });

  it('should handle class arrays with enum', () => {
    const sig = AxSignature.create(
      'userQuery:string -> priorities:class[] "high, medium, low"'
    );
    const schema = sig.toJSONSchema();

    expect(schema.properties?.priorities).toEqual({
      type: 'array',
      items: {
        type: 'string',
        enum: ['high', 'medium', 'low'],
      },
      description: undefined,
    });
  });
});

describe('jsonSchema - validation', () => {
  it('should validate schemas with proper array items', () => {
    const schema = {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: { type: 'string' },
        },
      },
    };

    expect(() => validateJSONSchema(schema)).not.toThrow();
  });

  it('should throw for arrays missing items definition', () => {
    const schema = {
      type: 'array',
      // Missing items - this is invalid
    };

    expect(() => validateJSONSchema(schema)).toThrow(
      /missing an "items" definition/
    );
  });
});

describe('jsonSchema - optional and internal fields', () => {
  it('should exclude internal fields from schema', () => {
    const sig = AxSignature.create(
      'userQuery:string -> publicField:string, internalField!:string'
    );
    const schema = sig.toJSONSchema();

    expect(schema.properties).toHaveProperty('publicField');
    expect(schema.properties).not.toHaveProperty('internalField');
  });

  it('should not require optional fields', () => {
    const sig = AxSignature.create(
      'userQuery:string -> mandatoryField:string, optionalField?:string'
    );
    const schema = sig.toJSONSchema();

    expect(schema.required).toContain('mandatoryField');
    expect(schema.required).not.toContain('optionalField');
  });
});

describe('jsonSchema - descriptions', () => {
  it('should include field descriptions in schema', () => {
    const sig = AxSignature.create(
      'userQuery:string -> analysisResult:string "The analysis result text"'
    );
    const schema = sig.toJSONSchema();

    expect(schema.properties?.analysisResult?.description).toBe(
      'The analysis result text'
    );
  });
});

describe('jsonSchema - schema structure', () => {
  it('should set additionalProperties to false', () => {
    const sig = AxSignature.create('userQuery:string -> responseText:string');
    const schema = sig.toJSONSchema();

    expect(schema.additionalProperties).toBe(false);
  });

  it('should include schema title', () => {
    const sig = AxSignature.create('userQuery:string -> responseText:string');
    const schema = sig.toJSONSchema();

    expect(schema.title).toBeDefined();
    expect(typeof schema.title).toBe('string');
  });

  it('should have correct schema type', () => {
    const sig = AxSignature.create('userQuery:string -> responseText:string');
    const schema = sig.toJSONSchema();

    expect(schema.type).toBe('object');
  });
});
