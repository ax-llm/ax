import { describe, expect, it } from 'vitest';

import { AxAIBedrock } from './api.js';
import type { BedrockTitanEmbedRequest } from './types.js';
import { AxAIBedrockEmbedModel, AxAIBedrockModel } from './types.js';

// Access the private implementation's request builder without hitting AWS.
// createEmbedReq only assembles the Titan request body; the AWS SDK call is
// deferred to the returned apiConfig.localCall, so this needs no credentials.
async function buildEmbedReq(
  ai: AxAIBedrock
): Promise<BedrockTitanEmbedRequest> {
  const impl = (
    ai as unknown as {
      aiImpl: {
        createEmbedReq: (req: {
          texts: string[];
          embedModel: AxAIBedrockEmbedModel;
        }) => Promise<[unknown, BedrockTitanEmbedRequest]>;
      };
    }
  ).aiImpl;
  const [, embedRequest] = await impl.createEmbedReq({
    texts: ['hello world'],
    embedModel: AxAIBedrockEmbedModel.TitanEmbedV2,
  });
  return embedRequest;
}

describe('AxAIBedrock Titan embeddings dimensions', () => {
  it('honors config.dimensions when set', async () => {
    const ai = new AxAIBedrock({
      config: {
        model: AxAIBedrockModel.ClaudeSonnet4,
        embedModel: AxAIBedrockEmbedModel.TitanEmbedV2,
        dimensions: 1024,
      },
    });

    const embedRequest = await buildEmbedReq(ai);
    expect(embedRequest.dimensions).toBe(1024);
  });

  it('passes through a non-default supported dimension (256)', async () => {
    const ai = new AxAIBedrock({
      config: {
        model: AxAIBedrockModel.ClaudeSonnet4,
        embedModel: AxAIBedrockEmbedModel.TitanEmbedV2,
        dimensions: 256,
      },
    });

    const embedRequest = await buildEmbedReq(ai);
    expect(embedRequest.dimensions).toBe(256);
  });

  it('omits dimensions when unset so Titan uses its default (1024)', async () => {
    const ai = new AxAIBedrock({
      config: {
        model: AxAIBedrockModel.ClaudeSonnet4,
        embedModel: AxAIBedrockEmbedModel.TitanEmbedV2,
      },
    });

    const embedRequest = await buildEmbedReq(ai);
    expect(embedRequest.dimensions).toBeUndefined();
    // JSON.stringify drops undefined, so the wire payload carries no
    // dimensions field and Titan v2 applies its 1024 default.
    expect(JSON.parse(JSON.stringify(embedRequest))).not.toHaveProperty(
      'dimensions'
    );
  });
});
