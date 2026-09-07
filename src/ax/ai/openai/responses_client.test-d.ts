import { expectTypeOf } from 'vitest';
import { AxAIOpenAIResponsesClient } from './responses_client.js';
import type {
  AxAIOpenAIResponsesResponse,
  AxAIOpenAIResponsesSessionEvent,
} from './responses_types.js';
import { AxAIOpenAIResponsesModel } from './responses_types.js';

const client = new AxAIOpenAIResponsesClient({
  apiKey: 'test',
  defaults: { model: AxAIOpenAIResponsesModel.GPT6Astra },
  options: () => ({}),
  estimateCost: () => 0,
});
expectTypeOf(client.create({ input: 'hi' })).toEqualTypeOf<
  Promise<AxAIOpenAIResponsesResponse>
>();
expectTypeOf(client.create({ input: 'hi', stream: true })).toEqualTypeOf<
  Promise<AsyncIterable<AxAIOpenAIResponsesSessionEvent>>
>();
client.create({
  input: [{ type: 'configuration_update', reasoning: { effort: 'max' } }],
  tools: [{ type: 'custom', name: 'lookup', async: true }],
  text: {
    format: {
      type: 'json_schema',
      name: 'result',
      schema: { type: 'object' },
      strict: true,
    },
  },
});
client.create({
  // @ts-expect-error Configuration updates cannot disable Astra reasoning.
  input: [{ type: 'configuration_update', reasoning: { effort: 'none' } }],
});
async function replay(response: AxAIOpenAIResponsesResponse) {
  await client.create({
    input: [
      ...response.output,
      { type: 'message', role: 'user', content: 'next' },
    ],
  });
  const session = await client.connect();
  session.steer({
    previous_response_id: 'r',
    // @ts-expect-error Steering accepts only user messages.
    input: [{ type: 'message', role: 'system', content: 'no' }],
  });
}
void replay;
