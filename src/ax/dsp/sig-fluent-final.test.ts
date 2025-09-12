import { describe, expect, it } from 'vitest';
import { f } from './sig.js';

describe('Pure Fluent API - Final Integration Test', () => {
  it('should only support pure fluent methods (.optional(), .array(), .internal())', () => {
    // Verify that nested function calls are not available
    expect('array' in f).toBe(false);
    expect('optional' in f).toBe(false); 
    expect('internal' in f).toBe(false);
    
    // Verify that fluent methods are available on field types
    const stringField = f.string('test');
    expect(typeof stringField.optional).toBe('function');
    expect(typeof stringField.array).toBe('function');
    expect(typeof stringField.internal).toBe('function');
  });

  it('should properly create string[] for f.string().array()', () => {
    const sig = f()
      .input('stringArray', f.string('array of strings').array())
      .output('responseText', f.string('response'))
      .build();
    
    const inputFields = sig.getInputFields();
    const stringArrayField = inputFields.find(field => field.name === 'stringArray');
    
    expect(stringArrayField?.type?.name).toBe('string');
    expect(stringArrayField?.type?.isArray).toBe(true);
  });

  it('should properly handle all array types', () => {
    const sig = f()
      .input('stringArray', f.string('strings').array())
      .input('numberArray', f.number('numbers').array())
      .input('booleanArray', f.boolean('booleans').array())
      .output('responseText', f.string('response'))
      .build();
    
    const inputFields = sig.getInputFields();
    
    const stringArrayField = inputFields.find(f => f.name === 'stringArray');
    expect(stringArrayField?.type?.name).toBe('string');
    expect(stringArrayField?.type?.isArray).toBe(true);
    
    const numberArrayField = inputFields.find(f => f.name === 'numberArray');
    expect(numberArrayField?.type?.name).toBe('number');
    expect(numberArrayField?.type?.isArray).toBe(true);
    
    const booleanArrayField = inputFields.find(f => f.name === 'booleanArray');
    expect(booleanArrayField?.type?.name).toBe('boolean');
    expect(booleanArrayField?.type?.isArray).toBe(true);
  });

  it('should properly handle optional arrays', () => {
    const sig = f()
      .input('optionalStringArray', f.string('optional strings').optional().array())
      .input('optionalNumberArray', f.number('optional numbers').optional().array())
      .output('responseText', f.string('response'))
      .build();
    
    const inputFields = sig.getInputFields();
    
    const optionalStringArrayField = inputFields.find(f => f.name === 'optionalStringArray');
    expect(optionalStringArrayField?.type?.name).toBe('string');
    expect(optionalStringArrayField?.type?.isArray).toBe(true);
    expect(optionalStringArrayField?.isOptional).toBe(true);
    
    const optionalNumberArrayField = inputFields.find(f => f.name === 'optionalNumberArray');
    expect(optionalNumberArrayField?.type?.name).toBe('number');
    expect(optionalNumberArrayField?.type?.isArray).toBe(true);
    expect(optionalNumberArrayField?.isOptional).toBe(true);
  });

  it('should properly handle internal fields', () => {
    const sig = f()
      .input('userInput', f.string('input'))
      .output('publicResult', f.string('public result'))
      .output('internalResult', f.string('internal result').internal())
      .output('internalArray', f.string('internal array').array().internal())
      .build();
    
    const outputFields = sig.getOutputFields();
    
    const publicField = outputFields.find(f => f.name === 'publicResult');
    expect(publicField?.isInternal).toBe(undefined);
    
    const internalField = outputFields.find(f => f.name === 'internalResult');
    expect(internalField?.isInternal).toBe(true);
    
    const internalArrayField = outputFields.find(f => f.name === 'internalArray');
    expect(internalArrayField?.isInternal).toBe(true);
    expect(internalArrayField?.type?.isArray).toBe(true);
  });

  it('should maintain method chaining order', () => {
    // Test both .optional().array() and .array().optional()
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

  it('should work with all field types in fluent mode', () => {
    const sig = f()
      .input('stringField', f.string('string field'))
      .input('numberField', f.number('number field'))
      .input('booleanField', f.boolean('boolean field'))
      .input('jsonField', f.json('json field'))
      .input('dateField', f.date('date field'))
      .input('datetimeField', f.datetime('datetime field'))
      .input('imageField', f.image('image field'))
      .input('audioField', f.audio('audio field'))
      .input('fileField', f.file('file field'))
      .input('urlField', f.url('url field'))
      .input('codeField', f.code('javascript', 'code field'))
      .output('classificationResult', f.class(['positive', 'negative', 'neutral'], 'classification'))
      .build();
      
    const inputFields = sig.getInputFields();
    const outputFields = sig.getOutputFields();
    
    expect(inputFields).toHaveLength(11);
    expect(outputFields).toHaveLength(1);
    
    // All basic field types should be created properly
    expect(inputFields.find(f => f.name === 'stringField')?.type?.name).toBe('string');
    expect(inputFields.find(f => f.name === 'numberField')?.type?.name).toBe('number');
    expect(inputFields.find(f => f.name === 'booleanField')?.type?.name).toBe('boolean');
    expect(inputFields.find(f => f.name === 'jsonField')?.type?.name).toBe('json');
    expect(inputFields.find(f => f.name === 'dateField')?.type?.name).toBe('date');
    expect(inputFields.find(f => f.name === 'datetimeField')?.type?.name).toBe('datetime');
    expect(inputFields.find(f => f.name === 'imageField')?.type?.name).toBe('image');
    expect(inputFields.find(f => f.name === 'audioField')?.type?.name).toBe('audio');
    expect(inputFields.find(f => f.name === 'fileField')?.type?.name).toBe('file');
    expect(inputFields.find(f => f.name === 'urlField')?.type?.name).toBe('url');
    expect(inputFields.find(f => f.name === 'codeField')?.type?.name).toBe('code');
    expect(outputFields.find(f => f.name === 'classificationResult')?.type?.name).toBe('class');
  });
});