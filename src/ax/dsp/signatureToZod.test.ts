import { describe, expect, it, vi } from 'vitest';

import { AxSignature } from './sig.js';

describe('AxSignature.toZod', () => {
  it('converts primitive fields with optional arrays to Zod schemas', () => {
    const signature = AxSignature.create(
      'query: string, tags?: string[] -> responseText: string'
    );

    const { input, output, issues } = signature.toZod({
      warnOnFallback: false,
    });

    expect(issues).toEqual([]);
    expect(input).toBeDefined();
    expect(output).toBeDefined();

    expect(input?.parse({ query: 'hello world' })).toEqual({
      query: 'hello world',
    });
    expect(
      output?.parse({
        responseText: 'done',
      })
    ).toEqual({ responseText: 'done' });
    expect(() => input?.parse({ tags: [] })).toThrowError();
  });

  it('preserves class options via enums in the Zod schema', () => {
    const signature = new AxSignature({
      inputs: [
        {
          name: 'userInput',
          type: { name: 'string' },
        },
      ],
      outputs: [
        {
          name: 'status',
          type: { name: 'class', options: ['ok', 'error'] },
        },
      ],
    });

    const { output, issues } = signature.toZod({ warnOnFallback: false });
    expect(issues).toEqual([]);
    expect(output?.parse({ status: 'ok' })).toEqual({ status: 'ok' });
    expect(() => output?.parse({ status: 'unknown' })).toThrowError();
  });

  it('emits downgrade issues for unsupported field types and respects strict mode', () => {
    const signature = new AxSignature({
      inputs: [
        {
          name: 'userInput',
          type: { name: 'string' },
        },
      ],
      outputs: [
        {
          name: 'customResult',
          type: { name: 'mystery' },
        },
      ],
    });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = signature.toZod();

    expect(result.output).toBeDefined();
    expect(result.issues).toEqual([
      expect.objectContaining({
        context: 'output',
        path: ['output', 'customResult'],
        fallback: 'z.any()',
        severity: 'unsupported',
      }),
    ]);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();

    expect(() =>
      signature.toZod({ warnOnFallback: false, strict: true })
    ).toThrowError(
      /Unsupported Ax field types encountered during Zod conversion/
    );
  });

  it('maps multimodal fields to structured Zod objects', () => {
    const signature = new AxSignature({
      inputs: [
        {
          name: 'incidentImage',
          type: { name: 'image' },
        },
        {
          name: 'incidentAttachment',
          type: { name: 'file' },
          isOptional: true,
        },
        {
          name: 'referenceUrl',
          type: { name: 'url' },
          isOptional: true,
        },
      ],
      outputs: [
        {
          name: 'summaryText',
          type: { name: 'string' },
        },
      ],
    });

    const { input, output, issues } = signature.toZod({
      warnOnFallback: false,
    });

    expect(issues).toEqual([]);
    const parsedInput = input?.parse({
      incidentImage: { mimeType: 'image/png', data: 'base64' },
      incidentAttachment: {
        mimeType: 'application/pdf',
        fileUri: 's3://file.pdf',
      },
      referenceUrl: { url: 'https://example.com/details', title: 'Details' },
    });
    expect(parsedInput).toEqual({
      incidentImage: { mimeType: 'image/png', data: 'base64' },
      incidentAttachment: {
        mimeType: 'application/pdf',
        fileUri: 's3://file.pdf',
      },
      referenceUrl: { url: 'https://example.com/details', title: 'Details' },
    });

    expect(
      input?.parse({
        incidentImage: { mimeType: 'image/png', data: 'base64' },
        referenceUrl: 'https://example.com/details',
      })
    ).toEqual({
      incidentImage: { mimeType: 'image/png', data: 'base64' },
      referenceUrl: 'https://example.com/details',
    });

    const parsedOutput = output?.parse({
      summaryText: 'Incident summary created',
    });
    expect(parsedOutput).toEqual({
      summaryText: 'Incident summary created',
    });
  });
});
