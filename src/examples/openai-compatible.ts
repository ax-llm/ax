import { ai } from '@ax-llm/ax';

const apiKey =
  process.env.AI_COMPAT_API_KEY ?? process.env.AI_GATEWAY_API_KEY ?? '';
const endpoint =
  process.env.AI_COMPAT_API_URL ?? process.env.AI_GATEWAY_API_URL ?? '';
const model =
  process.env.AI_COMPAT_MODEL ?? process.env.OPENAI_COMPAT_MODEL ?? 'gpt-4o-mini';

if (!apiKey || !endpoint) {
  console.error(
    'Set AI_COMPAT_API_KEY and AI_COMPAT_API_URL (or AI_GATEWAY_* aliases) before running this example.'
  );
  process.exit(1);
}

const providerHeader = process.env.AI_COMPAT_PROVIDER_HEADER?.split('=');

const llm = ai({
  name: 'openai-compatible',
  apiKey,
  endpoint,
  headers:
    providerHeader && providerHeader.length === 2
      ? { [providerHeader[0]!]: providerHeader[1]! }
      : undefined,
  config: { model, stream: false },
});

async function main() {
  console.log(`Calling ${endpoint} (${model}) via openai-compatible adapter...`);
  const response = await llm.chat(
    {
      model,
      chatPrompt: [
        {
          role: 'system',
          content:
            'You are an eager assistant that briefly summarizes the users request.',
        },
        {
          role: 'user',
          content:
            'Explain why OpenAI-compatible gateways are useful when building Ax apps.',
        },
      ],
    },
    { stream: false }
  );

  if ('results' in response) {
    console.log(
      `[${response.results[0]?.finishReason}] ${response.results[0]?.content}`
    );
  } else {
    console.log('Received stream; consume reader() to process chunks.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
