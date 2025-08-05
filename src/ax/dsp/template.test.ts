import { describe, expect, it } from 'vitest';

import { AxGen } from './generate.js';
import { AxSignature } from './sig.js';
import { ax, s } from './template.js';

describe('AxSignature String-based Functions', () => {
  it('should create basic signature from string', () => {
    const sig = s('userQuestion:string -> modelAnswer:string');

    expect(sig.getInputFields()).toHaveLength(1);
    expect(sig.getOutputFields()).toHaveLength(1);
    expect(sig.getInputFields()[0]?.name).toBe('userQuestion');
    expect(sig.getOutputFields()[0]?.name).toBe('modelAnswer');
  });

  it('should handle complex signatures with descriptions', () => {
    const sig = s(
      '"Analyze customer feedback" feedback:string -> sentiment:class "positive, negative", confidence:number'
    );

    expect(sig.getInputFields()).toHaveLength(1);
    expect(sig.getOutputFields()).toHaveLength(2);
    expect(sig.getDescription()).toBe('Analyze customer feedback');

    const inputField = sig.getInputFields()[0];
    expect(inputField?.name).toBe('feedback');
    expect(inputField?.type?.name).toBe('string');

    const outputFields = sig.getOutputFields();
    expect(outputFields[0]?.name).toBe('sentiment');
    expect(outputFields[0]?.type?.name).toBe('class');
    expect(outputFields[0]?.type?.options).toEqual(['positive', 'negative']);

    expect(outputFields[1]?.name).toBe('confidence');
    expect(outputFields[1]?.type?.name).toBe('number');
  });

  it('should handle optional and internal fields', () => {
    const sig = s(
      'userInput:string -> outValue?:string, reasoningText!:string "Internal reasoning"'
    );

    const outputFields = sig.getOutputFields();
    expect(outputFields[0]?.isOptional).toBe(true);
    expect(outputFields[1]?.isInternal).toBe(true);
    expect(outputFields[1]?.description).toBe('Internal reasoning');
  });
});

describe('AxGen String-based Functions', () => {
  it('should create generator from string signature', () => {
    const gen = ax('userInput:string -> responseText:string');

    expect(gen).toBeInstanceOf(AxGen);
    expect(gen.signature.getInputFields()).toHaveLength(1);
    expect(gen.signature.getOutputFields()).toHaveLength(1);
  });

  it('should create generator with options', () => {
    const description = 'A simple summarizer';
    const gen = ax('documentText:string -> summaryText:string', {
      description,
    });

    expect(gen.signature.getDescription()).toBe(description);
  });

  it('should create generator without options', () => {
    const gen = ax('userInput:string -> responseText:string');

    expect(gen).toBeInstanceOf(AxGen);
    expect(gen.signature.getDescription()).toBeUndefined();
  });
});

describe('Enhanced ax() and agent() with AxSignature Support', () => {
  it('should work with string signatures in ax()', () => {
    const gen = ax('userInput:string -> responseText:string');

    expect(gen).toBeInstanceOf(AxGen);
    expect(gen.signature.getInputFields()).toHaveLength(1);
    expect(gen.signature.getOutputFields()).toHaveLength(1);
    expect(gen.signature.getInputFields()[0]?.name).toBe('userInput');
    expect(gen.signature.getOutputFields()[0]?.name).toBe('responseText');
  });

  it('should work with AxSignature objects in ax()', () => {
    const signature = s('userInput:string -> responseText:string');
    const gen = ax(signature);

    expect(gen).toBeInstanceOf(AxGen);
    expect(gen.signature.getInputFields()).toHaveLength(1);
    expect(gen.signature.getOutputFields()).toHaveLength(1);
    expect(gen.signature.getInputFields()[0]?.name).toBe('userInput');
    expect(gen.signature.getOutputFields()[0]?.name).toBe('responseText');
  });

  it('should maintain proper type inference with AxSignature in ax()', () => {
    const signature = AxSignature.create(
      'emailText:string, priority:number -> category:string, confidence:number'
    );
    const gen = ax(signature);

    // Should maintain all field information
    expect(gen.signature.getInputFields()).toHaveLength(2);
    expect(gen.signature.getOutputFields()).toHaveLength(2);
    expect(gen.signature.getInputFields()[0]?.name).toBe('emailText');
    expect(gen.signature.getInputFields()[1]?.name).toBe('priority');
    expect(gen.signature.getOutputFields()[0]?.name).toBe('category');
    expect(gen.signature.getOutputFields()[1]?.name).toBe('confidence');
  });

  it('should work with complex signatures in ax()', () => {
    const complexSig = s(`
      userMessage:string "User input",
      contextData:json "Background info" -> 
      responseText:string "AI response",
      sentiment:class "positive, negative, neutral" "Sentiment analysis",
      confidence:number "0-1 confidence score"
    `);

    const gen = ax(complexSig);

    // Should maintain type information
    expect(gen.signature.getInputFields()).toHaveLength(2);
    expect(gen.signature.getOutputFields()).toHaveLength(3);
    expect(gen.signature.getInputFields()[0]?.name).toBe('userMessage');
    expect(gen.signature.getOutputFields()[0]?.name).toBe('responseText');
    expect(gen.signature.getOutputFields()[1]?.name).toBe('sentiment');
    expect(gen.signature.getOutputFields()[1]?.type?.name).toBe('class');
    expect(gen.signature.getOutputFields()[1]?.type?.options).toEqual([
      'positive',
      'negative',
      'neutral',
    ]);
  });

  it('should handle runtime signature creation in ax()', () => {
    // Create signature at runtime
    const sigString = 'dynamicInput:string -> dynamicOutput:string';
    const runtimeSig = AxSignature.create(sigString);
    const gen = ax(runtimeSig);

    // Should work correctly at runtime
    expect(gen.signature.getInputFields()[0]?.name).toBe('dynamicInput');
    expect(gen.signature.getOutputFields()[0]?.name).toBe('dynamicOutput');
  });

  it('should handle both overloads seamlessly in ax()', () => {
    const stringSig = 'userInput:string -> modelOutput:string';
    const axSig = s('userInput:string -> modelOutput:string');

    const gen1 = ax(stringSig);
    const gen2 = ax(axSig);

    // Both should have same structure
    expect(gen1.signature.toString()).toBe(gen2.signature.toString());
    expect(gen1.signature.getInputFields()).toEqual(
      gen2.signature.getInputFields()
    );
    expect(gen1.signature.getOutputFields()).toEqual(
      gen2.signature.getOutputFields()
    );
  });

  it('should work with options for both string and AxSignature in ax()', () => {
    const description = 'Test generator';
    const sig = s('userInput:string -> modelOutput:string');

    const gen1 = ax('userInput:string -> modelOutput:string', { description });
    const gen2 = ax(sig, { description });

    // Both should have the description applied to their signatures
    expect(gen1.signature.getDescription()).toBe(description);
    expect(gen2.signature.getDescription()).toBe(description);
  });
});
