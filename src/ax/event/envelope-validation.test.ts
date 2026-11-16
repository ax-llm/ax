import { describe, expect, it } from 'vitest';

import { axValidateEventEnvelope } from './util.js';

describe('axValidateEventEnvelope rejects non-string identity fields', () => {
  const valid = {
    specversion: '1.0' as const,
    id: 'event-1',
    source: 'test-source',
    type: 'test.type',
  };

  for (const field of ['id', 'source', 'type'] as const) {
    it(`reports a clear validation error when ${field} is a number`, () => {
      const envelope = { ...valid, [field]: 42 };

      expect(() =>
        axValidateEventEnvelope(
          envelope as unknown as Parameters<typeof axValidateEventEnvelope>[0]
        )
      ).toThrowError(`AxEventEnvelope.${field} must be a non-empty string`);
    });

    it(`reports a clear validation error when ${field} is an object`, () => {
      const envelope = { ...valid, [field]: {} };

      expect(() =>
        axValidateEventEnvelope(
          envelope as unknown as Parameters<typeof axValidateEventEnvelope>[0]
        )
      ).toThrowError(`AxEventEnvelope.${field} must be a non-empty string`);
    });
  }
});
