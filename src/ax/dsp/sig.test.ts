import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { extractValues } from './extract.js';
import { parseSignature } from './parser.js';
import { type AxField, AxSignature } from './sig.js';
import { getZodMetadata } from '../zod/metadata.js';

describe('signature parsing', () => {
  it('parses signature correctly', () => {
    const sig = parseSignature(
      `"hello world" contextInfo?:string "some context", queryText:string 'some query' -> reasoningSteps!?:string, answerList:string[], messageType:class "reminder, follow-up"`
    );

    expect(sig.desc).toBe('hello world');

    expect(sig.inputs[0]).toEqual({
      desc: 'some context',
      name: 'contextInfo',
      type: { name: 'string', isArray: false },
      isOptional: true,
    });

    expect(sig.inputs[1]).toEqual({
      desc: 'some query',
      name: 'queryText',
      type: { name: 'string', isArray: false },
      isOptional: undefined,
    });

    expect(sig.outputs[0]).toEqual({
      desc: undefined,
      name: 'reasoningSteps',
      type: { name: 'string', isArray: false },
      isOptional: true,
      isInternal: true,
    });

    expect(sig.outputs[1]).toEqual({
      desc: undefined,
      name: 'answerList',
      type: { name: 'string', isArray: true },
      isOptional: false,
      isInternal: false,
    });

    expect(sig.outputs[2]).toEqual({
      desc: undefined,
      isInternal: false,
      isOptional: false,
      name: 'messageType',
      type: {
        name: 'class',
        isArray: false,
        options: ['reminder', 'follow-up'],
      },
    });
  });

  it('throws descriptive error for invalid signature', () => {
    expect(() =>
      parseSignature(
        'contextInfo?:string, queryText:boom -> testField:image, answerList:string[]'
      )
    ).toThrow('Invalid type "boom"');
  });

  it('throws error for empty signature', () => {
    expect(() => parseSignature('')).toThrow('Empty signature provided');
  });

  it('throws error for missing arrow', () => {
    expect(() => parseSignature('userInput:string')).toThrow(
      'Missing output section'
    );
  });

  it('throws error for missing output fields', () => {
    expect(() => parseSignature('userInput:string ->')).toThrow(
      'No output fields specified after "->"'
    );
  });

  it('throws error for generic field names', () => {
    expect(() => parseSignature('text:string -> response:string')).toThrow(
      'too generic'
    );
  });

  it('throws error for duplicate field names', () => {
    expect(() =>
      parseSignature(
        'userInput:string, userInput:number -> responseText:string'
      )
    ).toThrow('Duplicate input field name');
  });

  it('throws error for field names in both input and output', () => {
    expect(() =>
      parseSignature('userInput:string -> userInput:string')
    ).toThrow('appears in both inputs and outputs');
  });

  it('throws error for class type in input', () => {
    expect(() =>
      parseSignature('categoryType:class "a, b" -> responseText:string')
    ).toThrow('cannot use the "class" type');
  });

  it('throws error for internal marker in input', () => {
    expect(() =>
      parseSignature('userInput!:string -> responseText:string')
    ).toThrow('cannot use the internal marker');
  });

  it('throws error for image type in output', () => {
    expect(() =>
      parseSignature('userInput:string -> outputImage:image')
    ).toThrow('Image type is not supported in output fields');
  });

  it('allows single class option', () => {
    expect(() =>
      parseSignature('userInput:string -> categoryType:class "only-one"')
    ).not.toThrow();
  });

  it('throws error for empty class options', () => {
    expect(() =>
      parseSignature('userInput:string -> categoryType:class ""')
    ).toThrow('Missing class options after "class" type');
  });

  it('allows any class option names including numbers', () => {
    expect(() =>
      parseSignature(
        'userInput:string -> categoryType:class "valid, 123invalid, option-with-dash"'
      )
    ).not.toThrow();
  });

  it('supports both comma and pipe separators for class options', () => {
    // Test comma separator
    const sig1 = parseSignature(
      'userInput:string -> categoryType:class "positive, negative, neutral"'
    );
    expect(sig1.outputs[0]?.type?.options).toEqual([
      'positive',
      'negative',
      'neutral',
    ]);

    // Test pipe separator
    const sig2 = parseSignature(
      'userInput:string -> categoryType:class "positive | negative | neutral"'
    );
    expect(sig2.outputs[0]?.type?.options).toEqual([
      'positive',
      'negative',
      'neutral',
    ]);

    // Test mixed separators
    const sig3 = parseSignature(
      'userInput:string -> categoryType:class "positive, negative | neutral"'
    );
    expect(sig3.outputs[0]?.type?.options).toEqual([
      'positive',
      'negative',
      'neutral',
    ]);
  });

  it('supports class options with mixed separators and spacing', () => {
    expect(() =>
      parseSignature(
        'userInput:string -> categoryType:class "valid, option,with,comma"'
      )
    ).not.toThrow();

    expect(() =>
      parseSignature(
        'userInput:string -> categoryType:class "valid | option|with|pipe"'
      )
    ).not.toThrow();

    const sig1 = parseSignature(
      'userInput:string -> categoryType:class "valid, option,with,comma"'
    );
    const output1 = sig1.outputs[0]?.type;
    if (output1?.name === 'class') {
      expect(output1.options).toEqual(['valid', 'option', 'with', 'comma']);
    }

    const sig2 = parseSignature(
      'userInput:string -> categoryType:class "valid | option|with|pipe"'
    );
    const output2 = sig2.outputs[0]?.type;
    if (output2?.name === 'class') {
      expect(output2.options).toEqual(['valid', 'option', 'with', 'pipe']);
    }
  });

  it('throws error for field names that are too short', () => {
    expect(() => parseSignature('a:string -> b:string')).toThrow('too short');
  });

  it('throws error for field names starting with numbers', () => {
    expect(() =>
      parseSignature('1invalid:string -> responseText:string')
    ).toThrow('cannot start with a number');
  });

  it('throws error for invalid field name characters', () => {
    expect(() =>
      parseSignature('user-input:string -> responseText:string')
    ).toThrow('Expected "->"');
  });

  it('provides type suggestions for common mistakes', () => {
    expect(() =>
      parseSignature('userInput:str -> responseText:string')
    ).toThrow('Did you mean "string"?');
    expect(() =>
      parseSignature('userInput:int -> responseText:string')
    ).toThrow('Did you mean "number"?');
    expect(() =>
      parseSignature('userInput:bool -> responseText:string')
    ).toThrow('Did you mean "boolean"?');
  });

  it('throws error for unterminated strings', () => {
    expect(() =>
      parseSignature('userInput:string "unterminated -> responseText:string')
    ).toThrow('Unterminated string');
  });

  it('throws error for unexpected content after signature', () => {
    expect(() =>
      parseSignature('userInput:string -> responseText:string extra content')
    ).toThrow('Unexpected content after signature');
  });

  it('allows array constraints for image and audio types', () => {
    expect(() =>
      parseSignature('userImages:image[] -> responseText:string')
    ).not.toThrow();
    expect(() =>
      parseSignature('userAudios:audio[] -> responseText:string')
    ).not.toThrow();
  });

  it('allows valid descriptive field names', () => {
    expect(() =>
      parseSignature('userQuestion:string -> analysisResult:string')
    ).not.toThrow();
    expect(() =>
      parseSignature('documentContent:string -> summaryText:string')
    ).not.toThrow();
    expect(() =>
      parseSignature(
        'customer_feedback:string -> sentiment_category:class "positive, negative, neutral"'
      )
    ).not.toThrow();
  });
});

describe('AxSignature class validation', () => {
  it('throws error when adding invalid input field', () => {
    const sig = new AxSignature();
    expect(() =>
      sig.addInputField({
        name: 'text',
        type: { name: 'string', isArray: false },
      })
    ).toThrow('too generic');
  });

  it('throws error when adding invalid output field', () => {
    const sig = new AxSignature();
    expect(() =>
      sig.addOutputField({
        name: 'outputImage',
        type: { name: 'image', isArray: false },
      })
    ).toThrow('image type is not supported in output fields');
  });

  it('throws error when setting non-array input fields', () => {
    const sig = new AxSignature();
    expect(() =>
      sig.setInputFields('not an array' as unknown as readonly AxField[])
    ).toThrow('Input fields must be an array');
  });

  it('throws error when setting non-array output fields', () => {
    const sig = new AxSignature();
    expect(() =>
      sig.setOutputFields('not an array' as unknown as readonly AxField[])
    ).toThrow('Output fields must be an array');
  });

  it('throws error when setting non-string description', () => {
    const sig = new AxSignature();
    expect(() => sig.setDescription(123 as unknown as string)).toThrow(
      'Description must be a string'
    );
  });

  it('validates class options for duplicates', () => {
    expect(
      () =>
        new AxSignature(
          'userInput:string -> categoryType:class "positive, negative, positive"'
        )
    ).toThrow('Duplicate class options found');
  });

  it('validates minimum signature requirements', () => {
    const sig = new AxSignature();

    // Setting fields individually should not trigger full validation
    sig.setOutputFields([
      { name: 'responseText', type: { name: 'string', isArray: false } },
    ]);

    // But explicit validation should fail because there's no input field
    expect(() => sig.validate()).toThrow('must have at least one input field');

    sig.setInputFields([
      { name: 'userInput', type: { name: 'string', isArray: false } },
    ]);

    // Setting empty output fields should work during construction
    sig.setOutputFields([]);

    // But explicit validation should fail because there's no output field
    expect(() => sig.validate()).toThrow('must have at least one output field');
  });

  it('provides helpful suggestions in error messages', () => {
    try {
      new AxSignature('text:string -> response:string');
    } catch (error) {
      expect((error as Error).message).toContain('too generic');
      // The error should have some suggestion, let's check it's informative
      expect(error).toHaveProperty('suggestion');
    }
  });
});

describe('extract values with signatures', () => {
  it('should extract simple answer value', () => {
    const sig = new AxSignature('userQuestion:string -> responseText:string');
    const v1 = {};
    extractValues(sig, v1, `Response Text: "hello world"`);

    expect(v1).toEqual({ responseText: '"hello world"' });
  });

  it('should not extract value with no prefix and single output', () => {
    const sig = new AxSignature('userQuestion:string -> responseText:string');
    const v1 = {};
    extractValues(sig, v1, 'hello world');

    expect(v1).toEqual({ responseText: 'hello world' });
  });

  it('should extract and parse JSON values', () => {
    const sig = new AxSignature('userQuestion:string -> analysisResult:json');

    const v1 = {};
    extractValues(sig, v1, 'Analysis Result: ```json\n{"hello": "world"}\n```');

    expect(v1).toEqual({ analysisResult: { hello: 'world' } });
  });

  it('should extract multiple text values', () => {
    const sig = new AxSignature(
      'documentText:string -> titleText:string, keyPoints:string, descriptionText:string'
    );
    const v1 = {};
    extractValues(
      sig,
      v1,
      'Title Text: Coastal Ecosystem Restoration\nKey Points: Coastal regions prone to natural disasters, Selection criteria based on vulnerability indices and population density, Climate risk assessments conducted for sea-level rise and extreme weather events, Targeted ecosystems include mangrove forests, coral reefs, wetlands\nDescription Text: The project focuses on coastal regions vulnerable to natural disasters like hurricanes and flooding. Selection criteria included vulnerability indices, population density, and proximity to critical infrastructure. Climate risk assessments identified risks related to sea-level rise, storm surges, and extreme weather events. Targeted ecosystems encompass mangrove forests, coral reefs, and wetlands that provide coastal protection, biodiversity support, and livelihood opportunities for local communities.'
    );

    expect(v1).toEqual({
      titleText: 'Coastal Ecosystem Restoration',
      keyPoints:
        'Coastal regions prone to natural disasters, Selection criteria based on vulnerability indices and population density, Climate risk assessments conducted for sea-level rise and extreme weather events, Targeted ecosystems include mangrove forests, coral reefs, wetlands',
      descriptionText:
        'The project focuses on coastal regions vulnerable to natural disasters like hurricanes and flooding. Selection criteria included vulnerability indices, population density, and proximity to critical infrastructure. Climate risk assessments identified risks related to sea-level rise, storm surges, and extreme weather events. Targeted ecosystems encompass mangrove forests, coral reefs, and wetlands that provide coastal protection, biodiversity support, and livelihood opportunities for local communities.',
    });
  });
});

describe('AxSignature', () => {
  it('should create from a valid signature string', () => {
    const sig = new AxSignature(
      'userQuestion:string -> modelAnswer:string, certaintyValue:number'
    );
    expect(sig.getInputFields()).toHaveLength(1);
    expect(sig.getOutputFields()).toHaveLength(2);
    expect(sig.toString()).toBe(
      'userQuestion:string -> modelAnswer:string, certaintyValue:number'
    );
  });

  it('should create from another AxSignature instance', () => {
    const original = new AxSignature(
      'userQuestion:string -> modelAnswer:string, certaintyValue:number'
    );
    const clone = new AxSignature(original);
    expect(clone.toString()).toBe(original.toString());
    expect(clone.hash()).toBe(original.hash());
  });

  it('should throw AxSignatureValidationError for invalid string', () => {
    expect(() => new AxSignature('invalid-signature')).toThrow(
      'Invalid Signature'
    );
  });

  it('should set and get description', () => {
    const sig = new AxSignature('userQuestion:string -> modelAnswer:string');
    sig.setDescription('This is a Q&A signature.');
    expect(sig.getDescription()).toBe('This is a Q&A signature.');
    expect(sig.toString()).toContain('"This is a Q&A signature."');
  });

  it('should add input and output fields', () => {
    const sig = new AxSignature('userQuestion:string -> modelAnswer:string');
    sig.addInputField({
      name: 'userEmail',
      type: { name: 'string', isArray: false },
      description: 'User email address',
    });
    sig.addOutputField({
      name: 'userResponse',
      type: { name: 'string', isArray: false },
      description: 'User response',
    });

    expect(sig.getInputFields().length).toBe(2);
    expect(sig.getOutputFields().length).toBe(2);
  });

  it('should prevent adding fields with reserved names', () => {
    const sig = new AxSignature();
    expect(() =>
      sig.addInputField({
        name: 'string',
        type: { name: 'string', isArray: false },
      })
    ).toThrow('too generic');
    expect(() =>
      sig.addOutputField({
        name: 'response',
        type: { name: 'string', isArray: false },
      })
    ).toThrow('too generic');
  });

  it('should set input and output fields', () => {
    const sig = new AxSignature('userQuestion:string -> modelAnswer:string');
    sig.setInputFields([
      {
        name: 'userEmail',
        type: { name: 'string', isArray: false },
        description: 'User email',
      },
    ]);
    sig.setOutputFields([
      {
        name: 'userResponse',
        type: { name: 'string', isArray: false },
        description: 'User response',
      },
    ]);

    expect(sig.getInputFields().length).toBe(1);
    expect(sig.getOutputFields().length).toBe(1);
  });

  it('should handle complex field definitions', () => {
    const sig = new AxSignature('userQuestion:string -> modelAnswer:string');
    sig.addInputField({
      name: 'contextInfo',
      type: { name: 'string', isArray: false },
      description: 'Context information',
    });
    sig.addOutputField({
      name: 'confidenceScore',
      type: { name: 'number', isArray: false },
      description: 'Confidence score',
      isOptional: true,
    });

    expect(sig.getInputFields().length).toBe(2);
    expect(sig.getOutputFields().length).toBe(2);
  });

  it('should generate a consistent hash', () => {
    const sig1 = new AxSignature(
      'userQuestion:string -> modelAnswer:string, certaintyValue:number'
    );
    const sig2 = new AxSignature(
      'userQuestion:string -> modelAnswer:string, certaintyValue:number'
    );
    const sig3 = new AxSignature('userQuestion:string -> modelAnswer:string');

    expect(sig1.hash()).toBe(sig2.hash());
    expect(sig1.hash()).not.toBe(sig3.hash());
  });

  it('should update hash when modified', () => {
    const sig = new AxSignature('userQuestion:string -> modelAnswer:string');
    const initialHash = sig.hash();
    sig.addOutputField({
      name: 'certaintyValue',
      type: { name: 'number', isArray: false },
    });
    const modifiedHash = sig.hash();

    expect(initialHash).not.toBe(modifiedHash);
  });

  it('should return a JSON representation', () => {
    const sig = new AxSignature(
      '"Q&A" userQuestion:string -> modelAnswer:string, certaintyValue:number'
    );
    const json = sig.toJSON();

    expect(json.id).toBe(sig.hash());
    expect(json.description).toBe('Q&A');
    expect(json.inputFields).toHaveLength(1);
    expect(json.outputFields).toHaveLength(2);
  });
});

describe('extractValues with AxSignature', () => {
  it('should extract values based on a signature', () => {
    const sig = new AxSignature('userQuestion:string -> modelAnswer:string');
    const result: Record<string, unknown> = {};
    const content = 'Model Answer: The answer is 42.';

    extractValues(sig, result, content);

    expect(result).toEqual({ modelAnswer: 'The answer is 42.' });
  });

  it('should handle missing optional fields', () => {
    const sig = new AxSignature(
      'userQuestion:string -> modelAnswer:string, memoText?:string'
    );
    const content = 'Model Answer: The answer is 42.';
    const result = {};
    extractValues(sig, result, content);

    expect(result).toEqual({ modelAnswer: 'The answer is 42.' });
  });

  it('should not return internal fields', () => {
    const sig2 = new AxSignature(
      'userQuestion:string -> modelAnswer:string, thoughtProcess!:string'
    );
    const result: Record<string, unknown> = {};
    const content = `Model Answer: The answer is 42.
Thought Process: I am thinking.`;

    extractValues(sig2, result, content);

    expect(result).toEqual({ modelAnswer: 'The answer is 42.' });
  });

  it('should create signature with mixed input fields and output field', () => {
    // Create a new empty AxSignature
    const sig = new AxSignature();

    // Add first input field (required)
    sig.addInputField({
      name: 'userQuestion',
      type: { name: 'string', isArray: false },
      description: 'User question input',
    });

    // Add second input field (optional)
    sig.addInputField({
      name: 'contextInfo',
      type: { name: 'string', isArray: false },
      description: 'Optional context information',
      isOptional: true,
    });

    // Add output field with descriptive name (not "response" which is too generic)
    sig.addOutputField({
      name: 'answerText',
      type: { name: 'string', isArray: false },
      description: 'Generated answer text',
    });

    // Verify the signature was created correctly
    expect(sig.getInputFields()).toHaveLength(2);
    expect(sig.getOutputFields()).toHaveLength(1);

    // Check input fields
    const inputFields = sig.getInputFields();
    expect(inputFields[0]?.name).toBe('userQuestion');
    expect(inputFields[0]?.isOptional).toBeUndefined();
    expect(inputFields[1]?.name).toBe('contextInfo');
    expect(inputFields[1]?.isOptional).toBe(true);

    // Check output field
    const outputFields = sig.getOutputFields();
    expect(outputFields[0]?.name).toBe('answerText');

    // Verify signature string representation includes descriptions
    expect(sig.toString()).toBe(
      'userQuestion:string "User question input", contextInfo?:string "Optional context information" -> answerText:string "Generated answer text"'
    );

    // Verify we can generate a hash
    expect(sig.hash()).toBeTruthy();
  });

  it('should fail when using generic field name "response"', () => {
    const sig = new AxSignature();

    // This should throw an error because "response" is too generic
    expect(() =>
      sig.addOutputField({
        name: 'response',
        type: { name: 'string', isArray: false },
      })
    ).toThrow('too generic');
  });

  it('should validate full signature consistency when explicitly called', () => {
    const sig = new AxSignature();

    // Add only input field - should work without throwing
    sig.addInputField({
      name: 'userQuestion',
      type: { name: 'string', isArray: false },
    });

    // Full validation should fail because there's no output field
    expect(() => sig.validate()).toThrow('must have at least one output field');

    // Add output field
    sig.addOutputField({
      name: 'answerText',
      type: { name: 'string', isArray: false },
    });

    // Now full validation should pass
    expect(() => sig.validate()).not.toThrow();
  });

  it('should cache validation results and avoid redundant validation', () => {
    const sig = new AxSignature();
    sig.addInputField({
      name: 'userInput',
      type: { name: 'string', isArray: false },
    });
    sig.addOutputField({
      name: 'responseText',
      type: { name: 'string', isArray: false },
    });

    // First validation should pass and cache the result
    const result1 = sig.validate();
    expect(result1).toBe(true);

    // Second validation should return cached result (true) without re-validating
    const result2 = sig.validate();
    expect(result2).toBe(true);

    // Modify signature - this should invalidate cache
    sig.addInputField({
      name: 'contextInfo',
      type: { name: 'string', isArray: false },
    });

    // Validation should run again and pass
    const result3 = sig.validate();
    expect(result3).toBe(true);

    // Another call should use cached result
    const result4 = sig.validate();
    expect(result4).toBe(true);
  });
});

describe('Type-safe field addition methods', () => {
  it('should append input field with type safety', () => {
    const baseSig = AxSignature.create(
      'userInput:string -> responseText:string'
    );
    const enhanced = baseSig.appendInputField('contextInfo', {
      type: 'string',
      description: 'Additional context',
      isOptional: true,
    });

    expect(enhanced.getInputFields()).toHaveLength(2);
    expect(enhanced.getInputFields()[1]?.name).toBe('contextInfo');
    expect(enhanced.getInputFields()[1]?.isOptional).toBe(true);
    expect(enhanced.toString()).toContain(
      'contextInfo?:string "Additional context"'
    );
  });

  it('should prepend input field with type safety', () => {
    const baseSig = AxSignature.create(
      'userInput:string -> responseText:string'
    );
    const enhanced = baseSig.prependInputField('sessionId', {
      type: 'string',
      description: 'Session identifier',
    });

    expect(enhanced.getInputFields()).toHaveLength(2);
    expect(enhanced.getInputFields()[0]?.name).toBe('sessionId');
    expect(enhanced.getInputFields()[1]?.name).toBe('userInput');
    expect(enhanced.toString()).toContain(
      'sessionId:string "Session identifier", userInput:string'
    );
  });

  it('should append output field with type safety', () => {
    const baseSig = AxSignature.create(
      'userInput:string -> responseText:string'
    );
    const enhanced = baseSig.appendOutputField('confidence', {
      type: 'number',
      description: 'Confidence score',
    });

    expect(enhanced.getOutputFields()).toHaveLength(2);
    expect(enhanced.getOutputFields()[1]?.name).toBe('confidence');
    expect(enhanced.toString()).toContain(
      'responseText:string, confidence:number "Confidence score"'
    );
  });

  it('should prepend output field with type safety', () => {
    const baseSig = AxSignature.create(
      'userInput:string -> responseText:string'
    );
    const enhanced = baseSig.prependOutputField('category', {
      type: 'class',
      options: ['question', 'request', 'complaint'],
      description: 'Input category',
    });

    expect(enhanced.getOutputFields()).toHaveLength(2);
    expect(enhanced.getOutputFields()[0]?.name).toBe('category');
    expect(enhanced.getOutputFields()[1]?.name).toBe('responseText');
    expect(enhanced.toString()).toContain(
      'category:class "question | request | complaint"'
    );
  });

  it('should support chaining multiple field additions', () => {
    const baseSig = AxSignature.create(
      'userInput:string -> responseText:string'
    );
    const enhanced = baseSig
      .prependInputField('sessionId', {
        type: 'string',
        description: 'Session ID',
      })
      .appendInputField('metadata', { type: 'json', isOptional: true })
      .prependOutputField('status', {
        type: 'class',
        options: ['success', 'error'],
      })
      .appendOutputField('timestamp', { type: 'datetime' });

    expect(enhanced.getInputFields()).toHaveLength(3);
    expect(enhanced.getOutputFields()).toHaveLength(3);

    const inputNames = enhanced.getInputFields().map((f) => f.name);
    expect(inputNames).toEqual(['sessionId', 'userInput', 'metadata']);

    const outputNames = enhanced.getOutputFields().map((f) => f.name);
    expect(outputNames).toEqual(['status', 'responseText', 'timestamp']);
  });

  it('should handle array field types correctly', () => {
    const baseSig = AxSignature.create(
      'userInput:string -> responseText:string'
    );
    const enhanced = baseSig
      .appendInputField('tags', {
        type: 'string',
        isArray: true,
        description: 'Tag list',
      })
      .appendOutputField('suggestions', { type: 'string', isArray: true });

    expect(enhanced.toString()).toContain('tags:string[] "Tag list"');
    expect(enhanced.toString()).toContain('suggestions:string[]');
  });

  it('should prevent duplicate field names in type-safe methods', () => {
    const baseSig = AxSignature.create(
      'userInput:string -> responseText:string'
    );

    expect(() =>
      baseSig.appendInputField('userInput', { type: 'string' })
    ).toThrow('Duplicate input field name: "userInput"');

    expect(() =>
      baseSig.appendOutputField('responseText', { type: 'string' })
    ).toThrow('Duplicate output field name: "responseText"');
  });

  it('should prevent field names appearing in both input and output', () => {
    const baseSig = AxSignature.create(
      'userInput:string -> responseText:string'
    );

    expect(() =>
      baseSig.appendOutputField('userInput', { type: 'string' })
    ).toThrow('Field name "userInput" appears in both inputs and outputs');

    expect(() =>
      baseSig.appendInputField('responseText', { type: 'string' })
    ).toThrow('Field name "responseText" appears in both inputs and outputs');
  });

  it('should validate field types according to input/output rules', () => {
    const baseSig = AxSignature.create(
      'userInput:string -> responseText:string'
    );

    // Class types not allowed in input
    expect(() =>
      baseSig.appendInputField('category', {
        type: 'class',
        options: ['a', 'b'],
      })
    ).toThrow('Class type is not supported in input fields');

    // Image types not allowed in output
    expect(() =>
      baseSig.appendOutputField('outputImage', { type: 'image' })
    ).toThrow('image type is not supported in output fields');
  });

  it('should return immutable new instances', () => {
    const baseSig = AxSignature.create(
      'userInput:string -> responseText:string'
    );
    const enhanced = baseSig.appendInputField('contextInfo', {
      type: 'string',
    });

    // Original signature should be unchanged
    expect(baseSig.getInputFields()).toHaveLength(1);
    expect(baseSig.toString()).toBe('userInput:string -> responseText:string');

    // Enhanced signature should have the new field
    expect(enhanced.getInputFields()).toHaveLength(2);
    expect(enhanced.toString()).toContain('contextInfo:string');

    // They should have different hashes
    expect(baseSig.hash()).not.toBe(enhanced.hash());
  });

  it('should handle multiline signatures with proper whitespace trimming in type inference', () => {
    // Test the specific case that was reported - field names should not include whitespace
    const sig = AxSignature.create(`searchQuery:string ->
    relevantContext:string,
    sources:string[]`);

    const outputFields = sig.getOutputFields();
    expect(outputFields).toHaveLength(2);

    // Field names should be properly trimmed without newlines or extra spaces
    expect(outputFields[0].name).toBe('relevantContext');
    expect(outputFields[1].name).toBe('sources');

    // Verify no whitespace characters in field names
    expect(outputFields[0].name).not.toMatch(/[\s\n\t\r]/);
    expect(outputFields[1].name).not.toMatch(/[\s\n\t\r]/);
  });
});

describe('Zod integration', () => {
  it('creates signatures from zod schemas with metadata', () => {
    const schema = z.object({
      name: z.string().min(1),
      age: z.number().int().optional(),
      tags: z.array(z.string()).default([]),
    });

    const signature = AxSignature.fromZod(schema, { mode: 'safeParse' });
    const outputs = signature.getOutputFields();
    expect(outputs).toHaveLength(3);
    expect(outputs.map((field) => field.name)).toEqual(['name', 'age', 'tags']);
    expect(outputs[0].type?.name).toBe('string');
    expect(outputs[1].isOptional).toBe(true);
    expect(outputs[2].type?.isArray).toBe(true);

    const inputs = signature.getInputFields();
    expect(inputs).toHaveLength(1);
    expect(inputs[0].name).toBe('prompt');
    expect(inputs[0].type?.name).toBe('string');

    const metadata = getZodMetadata(signature);
    expect(metadata?.schema).toBe(schema);
    expect(metadata?.fieldNames).toEqual(['name', 'age', 'tags']);
    expect(metadata?.options.mode).toBe('safeParse');
  });

  it('round trips to the original zod schema', () => {
    const schema = z.object({
      id: z.string().uuid(),
      isActive: z.boolean().catch(true),
    });

    const signature = AxSignature.fromZod(schema);
    const back = signature.toZod();
    expect(back).toBe(schema);
  });

  it('throws in strict mode when conversion downgrades features', () => {
    const schema = z
      .object({
        payload: z.union([z.string(), z.number()]),
      })
      .describe('union payload');

    expect(() => AxSignature.fromZod(schema, { strict: true })).toThrow(
      /unsupported constructs/i
    );
  });

  it('records validation guidance for default and catch fallbacks', () => {
    const schema = z.object({
      status: z.enum(['ok', 'error']).catch('error'),
      attempts: z.number().min(1).max(5).default(3),
    });

    const signature = AxSignature.fromZod(schema);
    const metadata = getZodMetadata(signature);
    expect(metadata).toBeDefined();
    expect(
      metadata?.issues.filter((issue) => issue.kind === 'validation')
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: expect.stringContaining('default value'),
        }),
        expect.objectContaining({
          message: expect.stringContaining('catch()'),
        }),
      ])
    );
  });

  it('preserves array element types when inner schemas are optional', () => {
    const schema = z.object({
      tags: z.array(z.string().optional()),
    });

    const signature = AxSignature.fromZod(schema);
    const tagsField = signature
      .getOutputFields()
      .find((field) => field.name === 'tags');

    expect(tagsField?.type?.name).toBe('string');
    expect(tagsField?.type?.isArray).toBe(true);

    const metadata = getZodMetadata(signature);
    const hasArrayDowngrade = metadata?.issues.some(
      (issue) =>
        issue.kind === 'unsupported' &&
        issue.path.toLowerCase().includes('tags')
    );
    expect(hasArrayDowngrade).toBe(false);
  });

  it('tracks downgrade telemetry for unions and maps them to json outputs', () => {
    const schema = z.object({
      payload: z.union([z.string(), z.number()]),
    });

    const signature = AxSignature.fromZod(schema);
    const outputs = signature.getOutputFields();
    expect(outputs).toHaveLength(1);
    expect(outputs[0]?.type?.name).toBe('json');

    const metadata = getZodMetadata(signature);
    expect(metadata).toBeDefined();
    expect(
      metadata?.issues.some(
        (issue) =>
          issue.kind === 'downgrade' && /union schema/i.test(issue.message)
      )
    ).toBe(true);
  });
});

describe('File type union support', () => {
  it('should support file type with data field', () => {
    const sig = new AxSignature('fileInput:file -> responseText:string');
    const inputFields = sig.getInputFields();
    expect(inputFields).toHaveLength(1);
    expect(inputFields[0].name).toBe('fileInput');
    expect(inputFields[0].type?.name).toBe('file');
  });

  it('should support file type with fileUri field', () => {
    const sig = new AxSignature('fileInput:file -> responseText:string');
    const inputFields = sig.getInputFields();
    expect(inputFields).toHaveLength(1);
    expect(inputFields[0].name).toBe('fileInput');
    expect(inputFields[0].type?.name).toBe('file');
  });

  it('should support array of files with mixed formats', () => {
    const sig = new AxSignature('fileInputs:file[] -> responseText:string');
    const inputFields = sig.getInputFields();
    expect(inputFields).toHaveLength(1);
    expect(inputFields[0].name).toBe('fileInputs');
    expect(inputFields[0].type?.name).toBe('file');
    expect(inputFields[0].type?.isArray).toBe(true);
  });
});
