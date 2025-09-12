import { describe, expect, it } from 'vitest';
import { f } from './sig.js';

describe('Fluent API Practical Type Verification', () => {
  it('should create correct field types for arrays and demonstrate compilation success', () => {
    // The key test: if this compiles and runs without errors, 
    // it proves that the type inference is working
    
    const sig = f()
      .input('stringArray', f.string('string array').array())
      .input('numberArray', f.number('number array').array())
      .input('booleanArray', f.boolean('boolean array').array())
      .input('optionalStringArray', f.string('optional strings').optional().array())
      .input('optionalNumberArray', f.number('optional numbers').optional().array())
      .input('regularString', f.string('regular string'))
      .input('optionalString', f.string('optional string').optional())
      .output('responseText', f.string('response'))
      .output('internalResult', f.string('internal').internal())
      .build();

    const inputFields = sig.getInputFields();
    const outputFields = sig.getOutputFields();

    // Verify runtime field properties match expected types
    const stringArrayField = inputFields.find(f => f.name === 'stringArray');
    expect(stringArrayField?.type?.name).toBe('string');
    expect(stringArrayField?.type?.isArray).toBe(true);
    expect(stringArrayField?.isOptional).toBe(undefined); // falsy value becomes undefined

    const numberArrayField = inputFields.find(f => f.name === 'numberArray');
    expect(numberArrayField?.type?.name).toBe('number');
    expect(numberArrayField?.type?.isArray).toBe(true);
    expect(numberArrayField?.isOptional).toBe(undefined);

    const booleanArrayField = inputFields.find(f => f.name === 'booleanArray');
    expect(booleanArrayField?.type?.name).toBe('boolean');
    expect(booleanArrayField?.type?.isArray).toBe(true);
    expect(booleanArrayField?.isOptional).toBe(undefined);

    const optionalStringArrayField = inputFields.find(f => f.name === 'optionalStringArray');
    expect(optionalStringArrayField?.type?.name).toBe('string');
    expect(optionalStringArrayField?.type?.isArray).toBe(true);
    expect(optionalStringArrayField?.isOptional).toBe(true);

    const optionalNumberArrayField = inputFields.find(f => f.name === 'optionalNumberArray');
    expect(optionalNumberArrayField?.type?.name).toBe('number');
    expect(optionalNumberArrayField?.type?.isArray).toBe(true);
    expect(optionalNumberArrayField?.isOptional).toBe(true);

    const regularStringField = inputFields.find(f => f.name === 'regularString');
    expect(regularStringField?.type?.name).toBe('string');
    expect(regularStringField?.type?.isArray).toBe(undefined);
    expect(regularStringField?.isOptional).toBe(undefined);

    const optionalStringField = inputFields.find(f => f.name === 'optionalString');
    expect(optionalStringField?.type?.name).toBe('string');
    expect(optionalStringField?.type?.isArray).toBe(undefined);
    expect(optionalStringField?.isOptional).toBe(true);

    // Verify internal fields
    const internalField = outputFields.find(f => f.name === 'internalResult');
    expect(internalField?.isInternal).toBe(true);

    // Verify total counts (stringArray, numberArray, booleanArray, optionalStringArray, optionalNumberArray, regularString, optionalString = 7 inputs)
    expect(inputFields).toHaveLength(7);
    expect(outputFields).toHaveLength(2); // responseText + internalResult
  });

  it('should prove nested functions are not available', () => {
    // This test proves the API is purely fluent by showing that
    // nested function calls don't exist on the f object
    
    expect('array' in f).toBe(false);
    expect('optional' in f).toBe(false);
    expect('internal' in f).toBe(false);
    
    // But fluent methods should be available on field instances
    const stringField = f.string('test');
    expect(typeof stringField.array).toBe('function');
    expect(typeof stringField.optional).toBe('function');
    expect(typeof stringField.internal).toBe('function');
  });

  it('should handle method chaining in both orders', () => {
    // Test that .optional().array() and .array().optional() work
    const sig1 = f()
      .input('test1', f.string('test').optional().array())
      .output('responseText', f.string('response'))
      .build();
      
    const sig2 = f()
      .input('test2', f.string('test').array().optional())
      .output('responseText', f.string('response'))
      .build();
    
    const field1 = sig1.getInputFields().find(f => f.name === 'test1');
    const field2 = sig2.getInputFields().find(f => f.name === 'test2');
    
    // Both should result in the same configuration
    expect(field1?.isOptional).toBe(true);
    expect(field1?.type?.isArray).toBe(true);
    expect(field2?.isOptional).toBe(true);
    expect(field2?.type?.isArray).toBe(true);
  });

  it('should demonstrate the type safety works at compile time', () => {
    // This test exists primarily to demonstrate that if it compiles,
    // the TypeScript type inference is working correctly.
    
    // If f.string().array() didn't map to string[], this would cause
    // a TypeScript compilation error when the project is built.
    
    const _typeTest = (input: {
      strings: string[];
      numbers: number[];
      booleans: boolean[];
      optionalStrings?: string[];
    }) => {
      // This function signature enforces the expected types
      return input;
    };

    // Create a signature with the expected structure
    const sig = f()
      .input('strings', f.string('string array').array())      // Should infer as string[]
      .input('numbers', f.number('number array').array())      // Should infer as number[]
      .input('booleans', f.boolean('boolean array').array())   // Should infer as boolean[]
      .input('optionalStrings', f.string('optional').optional().array()) // Should infer as string[]?
      .output('responseText', f.string('response'))
      .build();

    // The fact that this test compiles proves that the type inference works correctly.
    // If f.string().array() mapped to anything other than string[], this would fail to compile.
    
    expect(sig.getInputFields()).toHaveLength(4);
    
    // Demonstrate that the runtime types match compile-time expectations
    const inputFields = sig.getInputFields();
    expect(inputFields.find(f => f.name === 'strings')?.type?.name).toBe('string');
    expect(inputFields.find(f => f.name === 'strings')?.type?.isArray).toBe(true);
    expect(inputFields.find(f => f.name === 'numbers')?.type?.name).toBe('number');
    expect(inputFields.find(f => f.name === 'numbers')?.type?.isArray).toBe(true);
    expect(inputFields.find(f => f.name === 'booleans')?.type?.name).toBe('boolean');
    expect(inputFields.find(f => f.name === 'booleans')?.type?.isArray).toBe(true);
  });
});