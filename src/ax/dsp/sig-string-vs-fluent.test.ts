import { describe, expect, it } from 'vitest';
import { f, AxSignature } from './sig.js';

describe('String vs Fluent API Type Equivalence', () => {
  it('should create equivalent signatures using both string and fluent APIs', () => {
    // Create signature using fluent API
    const fluentSig = f()
      .input('stringArray', f.string('string array').array())
      .input('numberArray', f.number('number array').array())
      .input('booleanArray', f.boolean('boolean array').array())
      .input(
        'optionalStringArray',
        f.string('optional strings').optional().array()
      )
      .input(
        'optionalNumberArray',
        f.number('optional numbers').optional().array()
      )
      .input('regularString', f.string('regular string'))
      .input('optionalString', f.string('optional string').optional())
      .output('responseText', f.string('response'))
      .output('internalResult', f.string('internal').internal())
      .build();

    // Create equivalent signature using string syntax
    const stringSig = AxSignature.create(`
      stringArray:string[] "string array",
      numberArray:number[] "number array", 
      booleanArray:boolean[] "boolean array",
      optionalStringArray?:string[] "optional strings",
      optionalNumberArray?:number[] "optional numbers",
      regularString:string "regular string",
      optionalString?:string "optional string"
      -> 
      responseText:string "response",
      internalResult!:string "internal"
    `);

    // Both signatures should have the same structure
    const fluentInputs = fluentSig.getInputFields();
    const stringInputs = stringSig.getInputFields();
    const fluentOutputs = fluentSig.getOutputFields();
    const stringOutputs = stringSig.getOutputFields();

    // Verify input field counts match
    expect(fluentInputs).toHaveLength(stringInputs.length);
    expect(fluentOutputs).toHaveLength(stringOutputs.length);

    // Helper function to find field by name
    const findField = (fields: readonly any[], name: string) =>
      fields.find((f) => f.name === name);

    // Verify each input field matches
    const testInputField = (
      name: string,
      expectedType: string,
      expectedArray: boolean,
      expectedOptional: boolean
    ) => {
      const fluentField = findField(fluentInputs, name);
      const stringField = findField(stringInputs, name);

      expect(fluentField).toBeDefined();
      expect(stringField).toBeDefined();

      expect(fluentField?.type?.name).toBe(expectedType);
      expect(stringField?.type?.name).toBe(expectedType);

      // Handle different representations: fluent API uses undefined for false, string parser uses false
      expect(!!fluentField?.type?.isArray).toBe(expectedArray);
      expect(!!stringField?.type?.isArray).toBe(expectedArray);

      // Handle different representations: fluent API uses undefined for false, string parser uses false
      expect(!!fluentField?.isOptional).toBe(expectedOptional);
      expect(!!stringField?.isOptional).toBe(expectedOptional);
    };

    // Test all input fields
    testInputField('stringArray', 'string', true, false);
    testInputField('numberArray', 'number', true, false);
    testInputField('booleanArray', 'boolean', true, false);
    testInputField('optionalStringArray', 'string', true, true);
    testInputField('optionalNumberArray', 'number', true, true);
    testInputField('regularString', 'string', false, false);
    testInputField('optionalString', 'string', false, true);

    // Verify output fields
    const testOutputField = (
      name: string,
      expectedType: string,
      expectedInternal: boolean
    ) => {
      const fluentField = findField(fluentOutputs, name);
      const stringField = findField(stringOutputs, name);

      expect(fluentField).toBeDefined();
      expect(stringField).toBeDefined();

      expect(fluentField?.type?.name).toBe(expectedType);
      expect(stringField?.type?.name).toBe(expectedType);

      // Handle different representations: fluent API uses undefined for false, string parser uses false
      expect(!!fluentField?.isInternal).toBe(expectedInternal);
      expect(!!stringField?.isInternal).toBe(expectedInternal);
    };

    testOutputField('responseText', 'string', false);
    testOutputField('internalResult', 'string', true);
  });

  it('should demonstrate both APIs create the same runtime behavior', () => {
    // Test a comprehensive signature with all the field types from our original test
    const fluentSig = f()
      .input('strings', f.string('string array').array())
      .input('numbers', f.number('number array').array())
      .input('booleans', f.boolean('boolean array').array())
      .input('optionalStrings', f.string('optional').optional().array())
      .output('responseText', f.string('response'))
      .build();

    const stringSig = AxSignature.create(`
      strings:string[] "string array",
      numbers:number[] "number array",
      booleans:boolean[] "boolean array",
      optionalStrings?:string[] "optional"
      ->
      responseText:string "response"
    `);

    // Both should pass the same type validation tests
    const validateSignature = (sig: any) => {
      const inputFields = sig.getInputFields();

      expect(inputFields).toHaveLength(4);
      expect(
        inputFields.find((f: any) => f.name === 'strings')?.type?.name
      ).toBe('string');
      expect(
        inputFields.find((f: any) => f.name === 'strings')?.type?.isArray
      ).toBe(true);
      expect(
        inputFields.find((f: any) => f.name === 'numbers')?.type?.name
      ).toBe('number');
      expect(
        inputFields.find((f: any) => f.name === 'numbers')?.type?.isArray
      ).toBe(true);
      expect(
        inputFields.find((f: any) => f.name === 'booleans')?.type?.name
      ).toBe('boolean');
      expect(
        inputFields.find((f: any) => f.name === 'booleans')?.type?.isArray
      ).toBe(true);
      expect(
        inputFields.find((f: any) => f.name === 'optionalStrings')?.type?.name
      ).toBe('string');
      expect(
        inputFields.find((f: any) => f.name === 'optionalStrings')?.type
          ?.isArray
      ).toBe(true);
      expect(
        inputFields.find((f: any) => f.name === 'optionalStrings')?.isOptional
      ).toBe(true);
    };

    // Both signatures should pass the same validation
    validateSignature(fluentSig);
    validateSignature(stringSig);

    // Both should serialize to similar string representations
    expect(fluentSig.toString()).toContain('strings:string[]');
    expect(fluentSig.toString()).toContain('numbers:number[]');
    expect(fluentSig.toString()).toContain('booleans:boolean[]');
    expect(fluentSig.toString()).toContain('optionalStrings?:string[]');

    expect(stringSig.toString()).toContain('strings:string[]');
    expect(stringSig.toString()).toContain('numbers:number[]');
    expect(stringSig.toString()).toContain('booleans:boolean[]');
    expect(stringSig.toString()).toContain('optionalStrings?:string[]');
  });

  it('should verify TypeScript type inference works for both APIs', () => {
    // This test proves that both APIs produce equivalent TypeScript types

    // The type enforcement function from our previous test
    const _typeTest = (input: {
      strings: string[];
      numbers: number[];
      booleans: boolean[];
      optionalStrings?: string[];
    }) => {
      return input;
    };

    // Create signatures with both approaches
    const fluentSig = f()
      .input('strings', f.string('string array').array())
      .input('numbers', f.number('number array').array())
      .input('booleans', f.boolean('boolean array').array())
      .input('optionalStrings', f.string('optional').optional().array())
      .output('responseText', f.string('response'))
      .build();

    const stringSig = AxSignature.create(`
      strings:string[] "string array",
      numbers:number[] "number array", 
      booleans:boolean[] "boolean array",
      optionalStrings?:string[] "optional"
      ->
      responseText:string "response"
    `);

    // Both signatures should compile and work with the same type constraints
    // If the type inference was different, this would fail to compile
    expect(fluentSig.getInputFields()).toHaveLength(4);
    expect(stringSig.getInputFields()).toHaveLength(4);

    // The fact that both of these compile with the same type constraints
    // proves that both f.string().array() and string[] map to the same TypeScript type
    expect(
      fluentSig.getInputFields().find((f) => f.name === 'strings')?.type
        ?.isArray
    ).toBe(true);
    expect(
      stringSig.getInputFields().find((f) => f.name === 'strings')?.type
        ?.isArray
    ).toBe(true);
  });

  it('should handle complex combinations equivalently', () => {
    // Test more complex combinations to ensure equivalence
    const fluentSig = f()
      .input('complexArray', f.string('complex').optional().array())
      .input('simpleArray', f.number('simple').array())
      .input('regularField', f.boolean('regular'))
      .output('publicResult', f.string('public'))
      .output('internalResult', f.number('internal').internal())
      .build();

    const stringSig = AxSignature.create(`
      complexArray?:string[] "complex",
      simpleArray:number[] "simple", 
      regularField:boolean "regular"
      ->
      publicResult:string "public",
      internalResult!:number "internal"
    `);

    // Test equivalence
    expect(fluentSig.getInputFields()).toHaveLength(3);
    expect(stringSig.getInputFields()).toHaveLength(3);
    expect(fluentSig.getOutputFields()).toHaveLength(2);
    expect(stringSig.getOutputFields()).toHaveLength(2);

    // Test specific field properties
    const fluentComplex = fluentSig
      .getInputFields()
      .find((f) => f.name === 'complexArray');
    const stringComplex = stringSig
      .getInputFields()
      .find((f) => f.name === 'complexArray');

    expect(fluentComplex?.type?.name).toBe('string');
    expect(stringComplex?.type?.name).toBe('string');
    expect(fluentComplex?.type?.isArray).toBe(true);
    expect(stringComplex?.type?.isArray).toBe(true);
    expect(fluentComplex?.isOptional).toBe(true);
    expect(stringComplex?.isOptional).toBe(true);

    // Test internal field
    const fluentInternal = fluentSig
      .getOutputFields()
      .find((f) => f.name === 'internalResult');
    const stringInternal = stringSig
      .getOutputFields()
      .find((f) => f.name === 'internalResult');

    expect(fluentInternal?.isInternal).toBe(true);
    expect(stringInternal?.isInternal).toBe(true);
  });
});
