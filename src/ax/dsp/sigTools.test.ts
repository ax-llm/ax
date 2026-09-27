import { describe, expect, it } from 'vitest';

import type { AxFunction } from '../ai/types.js';
import { AxSignature } from './sig.js';
import { injectToolFields } from './sigTools.js';
import { ToolSchemaConverter } from './toolSchemaConverter.js';

const tool = (name: string): AxFunction => ({
  name,
  description: `Run ${name}`,
  func: async () => 'ok',
});

describe('tool field titles', () => {
  // A tool with no parameters becomes one optional output field whose title
  // follows the signature's field-title rule.
  const titles = {
    getUserID: 'Get User ID',
    fetchHTTPPage: 'Fetch HTTP Page',
    search_docs: 'Search docs',
    lookup_item2: 'Lookup item 2',
  };

  it('titles the field of a tool without parameters as a signature field', () => {
    const tools = Object.keys(titles).map(tool);
    const { signature } = injectToolFields(
      tools,
      AxSignature.create('question:string -> answer:string')
    );
    const byName = new Map(
      signature.getOutputFields().map((field) => [field.name, field.title])
    );
    for (const [name, title] of Object.entries(titles)) {
      const field = signature
        .getOutputFields()
        .find((candidate) => candidate.description === `Run ${name}`);
      expect(field?.title, name).toBe(title);
    }
    expect(byName.get('answer')).toBe('Answer');
  });

  it('titles a converted tool schema field the same way', () => {
    const converter = new ToolSchemaConverter();
    for (const [name, title] of Object.entries(titles)) {
      expect(converter.convert(tool(name)).field.title, name).toBe(title);
    }
  });
});
