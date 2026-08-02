import { describe, expect, it } from 'vitest';

import { resolveVertexAIHost } from './vertex.js';

describe('resolveVertexAIHost', () => {
  it.each([
    ['global', 'aiplatform.googleapis.com'],
    ['us', 'aiplatform.us.rep.googleapis.com'],
    ['eu', 'aiplatform.eu.rep.googleapis.com'],
    ['us-central1', 'us-central1-aiplatform.googleapis.com'],
    ['europe-west4', 'europe-west4-aiplatform.googleapis.com'],
  ])('maps %s to %s', (region, expected) => {
    expect(resolveVertexAIHost(region)).toBe(expected);
  });
});
