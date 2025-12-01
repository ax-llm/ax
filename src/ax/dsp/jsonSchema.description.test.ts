import { describe, expect, it } from 'vitest';

import { toJsonSchema } from './jsonSchema.js';
import { f } from './sig.js';

describe('JSON Schema Description Support', () => {
  it('should include description for top-level f.object', () => {
    const sig = f()
      .input('in', f.string())
      .output(
        'out',
        f.object(
          {
            field1: f.string(),
          },
          'Top level object description'
        )
      )
      .build();

    const schema = toJsonSchema(sig.getOutputFields());

    // The schema for 'out' should have the description
    expect(schema.properties?.out).toBeDefined();
    expect(schema.properties?.out.description).toBe(
      'Top level object description'
    );
  });

  it('should include description for nested f.object', () => {
    const sig = f()
      .input('in', f.string())
      .output(
        'out',
        f.object({
          nested: f.object(
            {
              inner: f.string(),
            },
            'Nested object description'
          ),
        })
      )
      .build();

    const schema = toJsonSchema(sig.getOutputFields());

    // The schema for 'nested' should have the description
    const outSchema = schema.properties?.out;
    expect(outSchema).toBeDefined();
    expect(outSchema.properties?.nested).toBeDefined();
    expect(outSchema.properties?.nested.description).toBe(
      'Nested object description'
    );
  });

  it('should include description for array of objects', () => {
    const sig = f()
      .input('in', f.string())
      .output(
        'list',
        f
          .object(
            {
              item: f.string(),
            },
            'Array item description'
          )
          .array('Array description')
      )
      .build();

    const schema = toJsonSchema(sig.getOutputFields());

    const listSchema = schema.properties?.list;
    expect(listSchema).toBeDefined();
    expect(listSchema.description).toBe('Array description');

    // The items should have the description of the object itself
    expect(listSchema.items).toBeDefined();
    expect(listSchema.items.description).toBe('Array item description');
  });
});
