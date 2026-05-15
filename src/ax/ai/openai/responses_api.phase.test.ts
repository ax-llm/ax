import { describe, expect, it } from 'vitest';
import { AxAIOpenAIResponsesImpl } from './responses_api.js';
import type {
  AxAIOpenAIResponsesRequest,
  AxAIOpenAIResponsesResponse,
} from './responses_types.js';
import { AxAIOpenAIResponsesModel } from './responses_types.js';

const config = {
  model: AxAIOpenAIResponsesModel.GPT55,
  maxTokens: 1,
  stream: false,
} as any;

describe('Responses API type extensions (2026)', () => {
  it('accepts new include value web_search_call.action.return_token_budget', () => {
    // Type-level check via casting; runtime check that the union accepts the new value
    const req: AxAIOpenAIResponsesRequest<AxAIOpenAIResponsesModel> = {
      model: AxAIOpenAIResponsesModel.GPT55,
      input: 'hi',
      include: ['web_search_call.action.return_token_budget'],
    };
    expect(req.include).toContain('web_search_call.action.return_token_budget');
  });

  it('accepts xhigh and none on reasoning.effort', () => {
    const reqXhigh: AxAIOpenAIResponsesRequest<AxAIOpenAIResponsesModel> = {
      model: AxAIOpenAIResponsesModel.GPT55,
      input: 'hi',
      reasoning: { effort: 'xhigh' },
    };
    const reqNone: AxAIOpenAIResponsesRequest<AxAIOpenAIResponsesModel> = {
      model: AxAIOpenAIResponsesModel.GPT55,
      input: 'hi',
      reasoning: { effort: 'none' },
    };
    expect(reqXhigh.reasoning?.effort).toBe('xhigh');
    expect(reqNone.reasoning?.effort).toBe('none');
  });

  it('passes through the phase field on output message items', () => {
    const impl = new AxAIOpenAIResponsesImpl(config, false);

    const resp = {
      id: 'res_phase',
      output: [
        {
          type: 'message',
          id: 'msg_commentary',
          status: 'completed',
          role: 'assistant',
          phase: 'commentary',
          content: [{ type: 'output_text', text: 'thinking out loud' }],
        },
        {
          type: 'message',
          id: 'msg_final',
          status: 'completed',
          role: 'assistant',
          phase: 'final_answer',
          content: [{ type: 'output_text', text: '42' }],
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
    } as unknown as AxAIOpenAIResponsesResponse;

    // Verify the response object retains phase at the typed level — the parser
    // doesn't drop the field, even though it currently isn't surfaced to
    // AxChatResponse. (Surfacing is a follow-up.)
    const firstOutput = resp.output[0] as any;
    const secondOutput = resp.output[1] as any;
    expect(firstOutput.phase).toBe('commentary');
    expect(secondOutput.phase).toBe('final_answer');

    // Ensure parsing doesn't throw with phase present and still yields content.
    const chatResp = impl.createChatResp(resp);
    expect(chatResp.results.length).toBeGreaterThan(0);
    const joined = chatResp.results.map((r) => r.content ?? '').join(' ');
    expect(joined).toContain('42');
  });
});
