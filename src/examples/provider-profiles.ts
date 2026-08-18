import { ai, axAIProfiles, axGetAIProfile } from '@ax-llm/ax';

let requestedURL = '';
const local = ai({
  name: 'vllm',
  config: { model: 'example/model', stream: false },
  options: {
    fetch: async (input) => {
      requestedURL = String(input);
      return new Response(
        JSON.stringify({
          id: 'profile-example',
          model: 'example/model',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'profile ok' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    },
  },
});

const response = await local.chat({
  chatPrompt: [{ role: 'user', content: 'Check the selected profile.' }],
});

console.log({
  profileCount: axAIProfiles().length,
  selected: axGetAIProfile('vllm'),
  requestedURL,
  response,
});
