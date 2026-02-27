import { describe, expect, it } from 'vitest';
import { AxPromptTemplate } from './prompt.js';
import { AxSignature } from './sig.js';

describe('AxPromptTemplate - Caching Optimization (Instructions First)', () => {
  it('should render instructions BEFORE schema in legacy prompt', () => {
    const signature = new AxSignature('userQuery:string -> aiResponse:string');
    signature.setDescription('task description here');
    const template = new AxPromptTemplate(signature, {
      examplesInSystem: true,
    });
    const result = template.render({ userQuery: 'test' }, {});

    const systemPrompt = result[0]?.content as string;

    // Check that description (instructions) comes before schema definitions
    const instructionIdx = systemPrompt
      .toLowerCase()
      .indexOf('task description here');
    const schemaIdx = systemPrompt.indexOf(
      'You will be provided with the following fields'
    );

    expect(instructionIdx).toBeGreaterThan(-1);
    expect(schemaIdx).toBeGreaterThan(-1);
    expect(instructionIdx).toBeLessThan(schemaIdx);
  });

  it('should render identity (instructions) BEFORE input fields in structured prompt', () => {
    const signature = new AxSignature('userQuery:string -> aiResponse:string');
    signature.setDescription('STABLE_INSTRUCTIONS');
    const template = new AxPromptTemplate(signature);
    const result = template.render({ userQuery: 'test' }, {});

    const systemPrompt = result[0]?.content as string;

    // In current implementation (Adapter.ts), buildLegacyPrompt also puts instructions first.
    const instructionIdx = systemPrompt.indexOf('STABLE_INSTRUCTIONS');
    const schemaIdx = systemPrompt.indexOf(
      'You will be provided with the following fields'
    );

    expect(instructionIdx).toBeLessThan(schemaIdx);
  });
});
