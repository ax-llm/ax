import { expect, it, vi } from 'vitest';
import { ai } from '../ai/wrap.js';
import { runControl } from '../dsp/runControl.js';
import { fn } from '../dsp/sig.js';
import { AxJSRuntime } from '../funcs/jsRuntime.js';
import { agent } from './index.js';

it('executes one native actor tool through its runtime binding and records it in the action log', async () => {
  const requests: any[] = [];
  const turns: any[] = [];
  const model = 'gpt-6-astra';
  const control = runControl();
  const paths: string[] = [];
  control.onEvent((event) => {
    if (event.type === 'started') paths.push(event.path);
  });
  const handler = vi.fn(async (_args, extra) => {
    expect(extra?.ai).toBeDefined();
    expect(extra?.abortSignal).toBeInstanceOf(AbortSignal);
    await Promise.resolve();
    return { code: 'AX-742' };
  });
  const lookup = fn('lookup')
    .description('Look up delivery')
    .execution('background')
    .handler(handler)
    .build();
  const llm = ai({
    name: 'openai',
    apiKey: 'test',
    config: { model },
    options: {
      fetch: async (_url, init) => {
        const request = JSON.parse(String(init?.body));
        requests.push(request);
        const id = `r${requests.length}`;
        let output: any[];
        let events: any[] = [];
        const message = (value: unknown) => ({
          type: 'message',
          id: `msg${id}`,
          role: 'assistant',
          status: 'completed',
          content: [
            {
              type: 'output_text',
              text: typeof value === 'string' ? value : JSON.stringify(value),
            },
          ],
        });
        if (request.instructions.includes('You (`distiller`)')) {
          output = [
            message({ javascriptCode: 'await final("Look up delivery", {});' }),
          ];
        } else if (request.instructions.includes('You (`executor`)')) {
          if (!request.previous_response_id) {
            expect(request.tools).toContainEqual(
              expect.objectContaining({ name: 'utils_lookup', async: true })
            );
            const call = {
              type: 'function_call',
              id: 'item1',
              call_id: 'call1',
              name: 'utils_lookup',
              arguments: '{}',
              status: 'completed',
            };
            events = [{ type: 'response.output_item.done', item: call }];
            output = [call];
          } else {
            expect(request.input).toContainEqual(
              expect.objectContaining({
                call_id: 'call1',
                type: 'function_call_output',
              })
            );
            output = [
              message({
                javascriptCode:
                  'await final("Report delivery", { code: "AX-742" });',
              }),
            ];
          }
        } else
          output = [
            message(
              request.text?.format?.type === 'json_schema'
                ? { answer: 'AX-742' }
                : 'Answer: AX-742'
            ),
          ];
        const response = {
          id,
          model,
          output,
          status: 'completed',
          usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
        };
        return request.stream
          ? new Response(
              [...events, { type: 'response.completed', response }]
                .map((event) => `data: ${JSON.stringify(event)}\n\n`)
                .join('')
            )
          : Response.json(response);
      },
    },
  });
  const assistant = agent('question -> answer', {
    runtime: new AxJSRuntime(),
    functions: [lookup],
    actorTurnCallback: (turn) => {
      turns.push(turn);
    },
  });
  const result = await assistant.forward(
    llm,
    { question: 'Get delivery' },
    { control, thinkingTokenBudget: 'low' }
  );
  expect(result.answer).toBe('AX-742');
  expect(handler).toHaveBeenCalledTimes(1);
  expect(
    turns.some((turn) => turn.output.includes('[Native tool utils.lookup]'))
  ).toBe(true);
  expect(paths).toContain('root/executor');
  expect(paths).toContain('root/responder');
});
