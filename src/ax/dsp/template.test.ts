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
    const sig = s('"Analyze customer feedback" feedback:string -> sentiment:class "positive, negative", confidence:number');

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
    const sig = s('userInput:string -> outValue?:string, reasoningText!:string "Internal reasoning"');

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
      description
    });
    
    expect(gen.signature.getDescription()).toBe(description);
  });

  it('should create generator without options', () => {
    const gen = ax('userInput:string -> responseText:string');
    
    expect(gen).toBeInstanceOf(AxGen);
    expect(gen.signature.getDescription()).toBeUndefined();
  });
});