import { describe, expect, it } from 'vitest';

import { buildInternalSummaryRequestOptions } from './runtime.js';

describe('buildInternalSummaryRequestOptions', () => {
  it('preserves request-scoped usage attribution for internal AI calls', () => {
    const usageContext = {
      tenantId: 'tenant-1',
      userId: 'user-1',
      requestId: 'request-1',
      runId: 'run-1',
      parentRunId: 'parent-run-1',
      feature: 'support-chat',
      attributes: {
        environment: 'test',
        subscription: 'pro',
      },
    };

    const options = buildInternalSummaryRequestOptions(
      { usageContext },
      false,
      undefined
    );

    expect(options.usageContext).toEqual(usageContext);
  });
});
