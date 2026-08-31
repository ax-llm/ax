import type {
  ConverseCommandOutput,
  ConverseRequest,
  ConverseStreamOutput,
} from '@aws-sdk/client-bedrock-runtime';
import type {
  AxAIServiceOptions,
  AxChatRequest,
  AxChatResponse,
} from '@ax-llm/ax';
import { describe, expect, it } from 'vitest';

import { AxAIBedrock } from './api.js';
import type { BedrockTitanEmbedRequest } from './types.js';
import { AxAIBedrockEmbedModel, AxAIBedrockModel } from './types.js';

type BedrockChatRequest = AxChatRequest<AxAIBedrockModel> & {
  model: AxAIBedrockModel;
};

type BedrockImpl = {
  createChatReq: (
    req: Readonly<BedrockChatRequest>,
    options?: Readonly<AxAIServiceOptions>
  ) => Promise<[unknown, ConverseRequest]>;
  createChatResp: (resp: {
    response: ConverseCommandOutput;
    model: AxAIBedrockModel;
    showThoughts: boolean;
  }) => AxChatResponse;
  createChatStreamResp: (
    resp: {
      event: ConverseStreamOutput;
      model: AxAIBedrockModel;
      requestId?: string;
      showThoughts: boolean;
    },
    state: object
  ) => AxChatResponse;
};

function getImpl(ai: AxAIBedrock): BedrockImpl {
  return (ai as unknown as { aiImpl: BedrockImpl }).aiImpl;
}

function createAI(model = AxAIBedrockModel.ClaudeSonnet5): AxAIBedrock {
  return new AxAIBedrock({ config: { model } });
}

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
        model: AxAIBedrockModel.ClaudeOpus45,
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
        model: AxAIBedrockModel.ClaudeOpus45,
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
        model: AxAIBedrockModel.ClaudeOpus45,
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

describe('AxAIBedrock Converse capabilities', () => {
  it('advertises native Claude capabilities per model', () => {
    const ai = createAI();
    const features = ai.getFeatures(AxAIBedrockModel.ClaudeSonnet5);

    expect(features).toMatchObject({
      functions: true,
      streaming: true,
      functionCot: true,
      structuredOutputs: false,
      thinking: true,
      multiTurn: true,
      serviceTiers: ['standard'],
      media: {
        images: { supported: true },
        files: { supported: true, uploadMethod: 'inline' },
      },
      caching: { supported: true, types: ['ephemeral'] },
    });
  });

  it('keeps GPT OSS capabilities conservative and model-specific', () => {
    const ai = createAI(AxAIBedrockModel.GptOss120B);
    const features = ai.getFeatures(AxAIBedrockModel.GptOss120B);

    expect(features).toMatchObject({
      functions: false,
      streaming: true,
      structuredOutputs: true,
      structuredOutputModes: ['native'],
      thinking: false,
      serviceTiers: ['standard', 'flex', 'priority'],
      media: {
        images: { supported: false },
        files: { supported: false },
      },
      caching: { supported: false },
    });
  });

  it('advertises Haiku 4.5 native structured output support', () => {
    const features = createAI(AxAIBedrockModel.ClaudeHaiku45).getFeatures(
      AxAIBedrockModel.ClaudeHaiku45
    );

    expect(features).toMatchObject({
      structuredOutputs: true,
      structuredOutputModes: ['native', 'function'],
    });
  });
});

describe('AxAIBedrock Converse request mapping', () => {
  it('maps tools, native media, caching, thinking, and service tier', async () => {
    const ai = createAI();
    const image = Buffer.from('image-bytes').toString('base64');
    const document = Buffer.from('document-bytes').toString('base64');
    const [, request] = await getImpl(ai).createChatReq(
      {
        model: AxAIBedrockModel.ClaudeSonnet5,
        modelConfig: { maxTokens: 8192, temperature: 0.4 },
        chatPrompt: [
          { role: 'system', content: 'Use the supplied evidence.' },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Inspect both attachments.' },
              { type: 'image', image, mimeType: 'image/png' },
              {
                type: 'file',
                data: document,
                filename: 'notes.md',
                mimeType: 'text/markdown',
              },
            ],
          },
          {
            role: 'assistant',
            thoughtBlocks: [
              { data: 'signed reasoning', encrypted: false, signature: 'sig' },
            ],
            functionCalls: [
              {
                id: 'tool-1',
                type: 'function',
                function: { name: 'lookup', params: { id: 7 } },
              },
            ],
          },
          {
            role: 'function',
            functionId: 'tool-1',
            result: '{"name":"Ax"}',
          },
        ],
        functions: [
          {
            name: 'lookup',
            description: 'Look up a record',
            parameters: {
              type: 'object',
              properties: {
                id: { type: 'number', description: 'Record ID' },
              },
              required: ['id'],
            },
          },
        ],
        functionCall: 'required',
      },
      {
        contextCache: { ttlSeconds: 3600 },
        thinkingTokenBudget: 'high',
        showThoughts: true,
        serviceTier: 'standard',
      }
    );

    expect(request.modelId).toBe(AxAIBedrockModel.ClaudeSonnet5);
    expect(request.inferenceConfig).toEqual({ maxTokens: 8192 });
    expect(request.additionalModelRequestFields).toEqual({
      thinking: { type: 'adaptive' },
    });
    expect(request.outputConfig).toEqual({ effort: 'high' });
    expect(request.serviceTier).toEqual({ type: 'default' });
    expect(request.system).toEqual([
      { text: 'Use the supplied evidence.' },
      { cachePoint: { type: 'default', ttl: '1h' } },
    ]);
    expect(request.toolConfig?.toolChoice).toEqual({ any: {} });
    expect(request.toolConfig?.tools?.at(-1)).toEqual({
      cachePoint: { type: 'default', ttl: '1h' },
    });

    const userContent = request.messages?.[0]?.content ?? [];
    expect(userContent[0]).toEqual({ text: 'Inspect both attachments.' });
    expect(Array.from(userContent[1].image?.source.bytes ?? [])).toEqual(
      Array.from(Buffer.from('image-bytes'))
    );
    expect(userContent[2].document).toMatchObject({
      format: 'md',
      name: 'notes md',
    });
    expect(Array.from(userContent[2].document?.source.bytes ?? [])).toEqual(
      Array.from(Buffer.from('document-bytes'))
    );
    expect(request.messages?.[1]?.content).toEqual([
      {
        reasoningContent: {
          reasoningText: { text: 'signed reasoning', signature: 'sig' },
        },
      },
      {
        toolUse: { toolUseId: 'tool-1', name: 'lookup', input: { id: 7 } },
      },
    ]);
    expect(request.messages?.[2]?.content).toEqual([
      {
        toolResult: {
          toolUseId: 'tool-1',
          content: [{ json: { name: 'Ax' } }],
        },
      },
    ]);
  });

  it('maps native structured output and GPT service tiers without tools', async () => {
    const ai = createAI(AxAIBedrockModel.GptOss120B);
    const [, request] = await getImpl(ai).createChatReq(
      {
        model: AxAIBedrockModel.GptOss120B,
        chatPrompt: [{ role: 'user', content: 'Return a count.' }],
        functions: [
          { name: 'ignored', description: 'Not native on this model' },
        ],
        responseFormat: {
          type: 'json_schema',
          schema: {
            title: 'count_response',
            type: 'object',
            properties: { count: { type: 'number' } },
            required: ['count'],
          },
        },
      },
      { serviceTier: 'flex' }
    );

    expect(request.toolConfig).toBeUndefined();
    expect(request.serviceTier).toEqual({ type: 'flex' });
    expect(request.outputConfig).toEqual({
      textFormat: {
        type: 'json_schema',
        structure: {
          jsonSchema: {
            name: 'count_response',
            schema: JSON.stringify({
              title: 'count_response',
              type: 'object',
              properties: { count: { type: 'number' } },
              required: ['count'],
            }),
          },
        },
      },
    });
  });

  it('rejects disabling Sonnet 5 adaptive thinking', async () => {
    await expect(
      getImpl(createAI()).createChatReq(
        {
          model: AxAIBedrockModel.ClaudeSonnet5,
          chatPrompt: [{ role: 'user', content: 'Answer briefly.' }],
        },
        { thinkingTokenBudget: 'none' }
      )
    ).rejects.toThrow('Adaptive thinking cannot be disabled');
  });

  it('allows disabling Opus 5 adaptive thinking', async () => {
    const [, request] = await getImpl(
      createAI(AxAIBedrockModel.ClaudeOpus5)
    ).createChatReq(
      {
        model: AxAIBedrockModel.ClaudeOpus5,
        chatPrompt: [{ role: 'user', content: 'Answer briefly.' }],
      },
      { thinkingTokenBudget: 'none' }
    );

    expect(request.additionalModelRequestFields).toEqual({
      thinking: { type: 'disabled' },
    });
  });

  it('rejects unsupported cache TTLs and service tiers', async () => {
    const ai = createAI(AxAIBedrockModel.ClaudeSonnet4);
    const request: BedrockChatRequest = {
      model: AxAIBedrockModel.ClaudeSonnet4,
      chatPrompt: [{ role: 'user', content: 'Hello' }],
    };

    await expect(
      getImpl(ai).createChatReq(request, {
        contextCache: { ttlSeconds: 3600 },
      })
    ).rejects.toThrow('Prompt-cache TTL 3600s is not supported');
    await expect(
      getImpl(ai).createChatReq(request, { serviceTier: 'priority' })
    ).rejects.toThrow('Service tier priority is not supported');
  });

  it('adds a message checkpoint when context caching has no system or tools', async () => {
    const [, request] = await getImpl(createAI()).createChatReq(
      {
        model: AxAIBedrockModel.ClaudeSonnet5,
        chatPrompt: [{ role: 'user', content: 'Cache this prefix.' }],
      },
      { contextCache: { ttlSeconds: 300 } }
    );

    expect(request.messages?.[0]?.content).toEqual([
      { text: 'Cache this prefix.' },
      { cachePoint: { type: 'default', ttl: '5m' } },
    ]);
  });

  it('counts a cached tool schema toward the four-checkpoint limit', async () => {
    const ai = createAI();
    await expect(
      getImpl(ai).createChatReq({
        model: AxAIBedrockModel.ClaudeSonnet5,
        chatPrompt: [
          { role: 'system', content: 'System', cache: true },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'one', cache: true },
              { type: 'text', text: 'two', cache: true },
              { type: 'text', text: 'three', cache: true },
            ],
          },
        ],
        functions: [{ name: 'lookup', description: 'Lookup', cache: true }],
      })
    ).rejects.toThrow('at most four cache checkpoints');
  });
});

describe('AxAIBedrock Converse response mapping', () => {
  it('maps text, tool calls, reasoning, usage, and stop reason', () => {
    const ai = createAI();
    const response = getImpl(ai).createChatResp({
      model: AxAIBedrockModel.ClaudeSonnet5,
      showThoughts: true,
      response: {
        $metadata: { requestId: 'request-1' },
        output: {
          message: {
            role: 'assistant',
            content: [
              {
                reasoningContent: {
                  reasoningText: { text: 'considering', signature: 'sig' },
                },
              },
              { text: 'I need a record.' },
              {
                toolUse: {
                  toolUseId: 'tool-1',
                  name: 'lookup',
                  input: { id: 7 },
                },
              },
            ],
          },
        },
        stopReason: 'tool_use',
        usage: {
          inputTokens: 10,
          outputTokens: 4,
          totalTokens: 14,
          cacheReadInputTokens: 6,
          cacheWriteInputTokens: 2,
        },
        serviceTier: { type: 'default' },
      },
    });

    expect(response).toMatchObject({
      remoteId: 'request-1',
      remoteRequestId: 'request-1',
      results: [
        {
          content: 'I need a record.',
          thought: 'considering',
          thoughtBlocks: [
            { data: 'considering', encrypted: false, signature: 'sig' },
          ],
          functionCalls: [
            {
              id: 'tool-1',
              type: 'function',
              function: { name: 'lookup', params: { id: 7 } },
            },
          ],
          finishReason: 'function_call',
        },
      ],
    });
  });

  it('maps streaming text, tools, reasoning, usage, and finish events', () => {
    const impl = getImpl(createAI());
    const state = {};
    const envelope = (event: ConverseStreamOutput) => ({
      event,
      model: AxAIBedrockModel.ClaudeSonnet5,
      requestId: 'request-stream',
      showThoughts: true,
    });

    expect(
      impl.createChatStreamResp(
        envelope({ messageStart: { role: 'assistant' } }),
        state
      ).results[0]
    ).toMatchObject({ id: 'request-stream', content: '' });
    expect(
      impl.createChatStreamResp(
        envelope({
          contentBlockDelta: { contentBlockIndex: 0, delta: { text: 'Hi' } },
        }),
        state
      ).results[0]
    ).toMatchObject({ content: 'Hi' });
    expect(
      impl.createChatStreamResp(
        envelope({
          contentBlockStart: {
            contentBlockIndex: 1,
            start: { toolUse: { toolUseId: 'tool-1', name: 'lookup' } },
          },
        }),
        state
      ).results[0]?.functionCalls?.[0]
    ).toMatchObject({ id: 'tool-1', function: { name: 'lookup', params: '' } });
    expect(
      impl.createChatStreamResp(
        envelope({
          contentBlockDelta: {
            contentBlockIndex: 1,
            delta: { toolUse: { input: '{"id":7}' } },
          },
        }),
        state
      ).results[0]?.functionCalls?.[0]
    ).toMatchObject({ id: 'tool-1', function: { params: '{"id":7}' } });
    expect(
      impl.createChatStreamResp(
        envelope({
          contentBlockDelta: {
            contentBlockIndex: 2,
            delta: { reasoningContent: { text: 'thinking' } },
          },
        }),
        state
      ).results[0]
    ).toMatchObject({
      thought: 'thinking',
      thoughtBlocks: [{ data: 'thinking', encrypted: false }],
    });
    expect(
      impl.createChatStreamResp(
        envelope({
          metadata: {
            usage: { inputTokens: 5, outputTokens: 3, totalTokens: 8 },
            metrics: { latencyMs: 12 },
            serviceTier: { type: 'priority' },
          },
        }),
        state
      ).results[0]
    ).toMatchObject({ content: '' });
    expect(
      impl.createChatStreamResp(
        envelope({ messageStop: { stopReason: 'end_turn' } }),
        state
      ).results[0]
    ).toMatchObject({ content: '', finishReason: 'stop' });
  });
});
