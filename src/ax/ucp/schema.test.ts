import { describe, expect, it, vi } from 'vitest';
import { AxUCPSchemaValidationError, AxUCPSchemaValidator } from './schema.js';

describe('UCP JSON Schema validation', () => {
  it('resolves bounded remote references and validates composed outcomes', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'https://schemas.example/checkout.json') {
        return Response.json({
          type: 'object',
          required: ['ucp', 'id'],
          properties: {
            ucp: {
              type: 'object',
              required: ['version'],
              properties: { version: { const: '2026-04-08' } },
            },
            id: { type: 'string', minLength: 1 },
            discounts: { $ref: './discount.json#/$defs/discounts' },
          },
          additionalProperties: true,
        });
      }
      return Response.json({
        $defs: {
          discounts: {
            type: 'object',
            required: ['codes'],
            properties: {
              codes: {
                type: 'array',
                items: { type: 'string' },
                uniqueItems: true,
              },
            },
          },
        },
      });
    });
    const validator = new AxUCPSchemaValidator({
      fetch: fetcher,
      ssrfProtection: { disabled: true },
    });

    await expect(
      validator.validate(
        {
          ucp: { version: '2026-04-08' },
          id: 'checkout-1',
          discounts: { codes: ['SAVE10'] },
        },
        'https://schemas.example/checkout.json'
      )
    ).resolves.toBeUndefined();
    await expect(
      validator.validate(
        {
          ucp: { version: '2026-04-08' },
          id: 'checkout-1',
          discounts: { codes: ['SAVE10', 'SAVE10'] },
        },
        'https://schemas.example/checkout.json'
      )
    ).rejects.toBeInstanceOf(AxUCPSchemaValidationError);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
