// cspell:ignore noul jev
import { describe, expect, it, vi } from 'vitest';
import { f } from '../../dsp/sig.js';
import { ax } from '../../dsp/template.js';
import { AxMockAIService } from '../mock/api.js';
import { AxAIOpenAIModel } from '../openai/chat_types.js';
import { ai } from '../wrap.js';

const signature = f()
  .input('ticket', f.string())
  .output(
    'urgent',
    f
      .boolean('Does this need immediate attention?')
      .describeValues({ true: 'Core task blocked', false: 'Routine request' })
  )
  .output(
    'team',
    f
      .class(['support', 'billing', 'engineering'], 'Which team?')
      .describeValues({
        support: 'Usage help',
        engineering: 'Broken functionality',
      })
  )
  .useStructured()
  .build();
const decision = { urgent: true, team: 'engineering' };
const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
  });

describe('value descriptions across providers', () => {
  it('switches providers without dropping, duplicating, or mutating guidance', async () => {
    const nativeBodies: any[] = [];
    const openaiBodies: any[] = [];
    const nativeFetch = vi.fn(
      async (_url: RequestInfo | URL, init?: RequestInit) => {
        nativeBodies.push(JSON.parse(init!.body as string));
        return json({
          model: 'jev-latest',
          answers: {
            urgent: { type: 'noul', noul: 0.9 },
            team: {
              type: 'choice',
              choice: 'engineering',
              probabilities: { support: 0.1, billing: 0, engineering: 0.9 },
              confidence: 0.8,
            },
          },
          usage: { input_tokens: 10, output_tokens: 3 },
        });
      }
    );
    const native = ai({
      name: 'typesafe',
      apiKey: 'key',
      options: { fetch: nativeFetch },
    });
    const openai = ai({
      name: 'openai',
      apiKey: 'key',
      config: { model: AxAIOpenAIModel.GPT56Luna },
      options: {
        fetch: async (_url, init) => {
          openaiBodies.push(JSON.parse(init!.body as string));
          return json({
            id: 'test',
            model: AxAIOpenAIModel.GPT56Luna,
            choices: [
              {
                index: 0,
                message: {
                  role: 'assistant',
                  content: JSON.stringify(decision),
                },
                finish_reason: 'stop',
              },
            ],
            usage: {
              prompt_tokens: 10,
              completion_tokens: 3,
              total_tokens: 13,
            },
          });
        },
      },
    });
    const program = ax(signature);
    const original = structuredClone(program.getSignature().toJSON());
    for (const provider of [native, openai, native])
      expect(
        await program.forward(
          provider,
          { ticket: 'Checkout fails' },
          { stream: false }
        )
      ).toEqual(decision);
    expect(nativeBodies[0].questions).toEqual({
      urgent: {
        type: 'noul',
        instructions: 'urgent: Does this need immediate attention?',
        criteria: { true: 'Core task blocked', false: 'Routine request' },
      },
      team: {
        type: 'choice',
        instructions: 'team: Which team?',
        criteria: {
          support: 'Usage help',
          billing: null,
          engineering: 'Broken functionality',
        },
      },
    });
    expect(nativeBodies[1].questions).toEqual(nativeBodies[0].questions);
    const schema = openaiBodies[0].response_format.json_schema.schema;
    expect(schema.properties.urgent).toEqual({
      type: 'boolean',
      description:
        'Does this need immediate attention?\ntrue: Core task blocked\nfalse: Routine request',
    });
    expect(schema.properties.team).toEqual({
      type: 'string',
      enum: ['support', 'billing', 'engineering'],
      description:
        'Which team?\nsupport: Usage help\nengineering: Broken functionality',
    });
    expect(openaiBodies[0].response_format).not.toHaveProperty(
      'fieldDescriptions'
    );
    expect(JSON.stringify(openaiBodies[0].messages)).toContain(
      'true: Core task blocked'
    );
    expect(JSON.stringify(openaiBodies[0])).not.toContain('valueDescriptions');
    expect(program.getSignature().toJSON()).toEqual(original);
  });

  it('keeps guidance in conventional scalar prompts without requesting JSON output', async () => {
    const provider = new AxMockAIService({ features: { streaming: false } });
    provider.chat = vi.fn(async (request) => {
      expect(request.responseFormat).toBeUndefined();
      expect(JSON.stringify(request.chatPrompt)).toContain(
        'true: Core task blocked'
      );
      expect(JSON.stringify(request.chatPrompt)).toContain(
        'false: Routine request'
      );
      return { results: [{ index: 0, content: 'Urgent: true' }] };
    });
    const program = ax(
      'ticket:string -> urgent:boolean(true "Core task blocked", false "Routine request") "Urgent?"'
    );
    expect(
      await program.forward(provider, { ticket: 'Checkout fails' })
    ).toEqual({ urgent: true });
  });

  it('rejects incompatible native criteria before credentials or fetch', async () => {
    const fetch = vi.fn();
    const credentialProvider = vi.fn();
    const provider = ai({
      name: 'typesafe',
      credentialProvider,
      options: { fetch },
    });
    const request = {
      chatPrompt: [{ role: 'user' as const, content: 'Ticket' }],
      responseFormat: {
        type: 'json_schema' as const,
        schema: {
          schema: {
            type: 'object',
            properties: { urgent: { type: 'boolean' } },
            required: ['urgent'],
          },
        },
        fieldDescriptions: {
          urgent: { valueDescriptions: { maybe: 'Unknown' } },
        },
      },
    };
    expect(() => provider.validateChatRequest(request)).toThrow(
      'unknown described value'
    );
    await expect(provider.chat(request)).rejects.toThrow(
      'unknown described value'
    );
    expect(fetch).not.toHaveBeenCalled();
    expect(credentialProvider).not.toHaveBeenCalled();
  });
});
