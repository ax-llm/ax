import { ai, ax } from '@ax-llm/ax';

const llm = ai({
  name: 'openai',
  apiKey: process.env.OPENAI_COMPAT_APIKEY!,
  apiURL: process.env.OPENAI_COMPAT_APIURL ?? 'https://api.example.com/v1',
  models: [
    {
      key: 'default',
      description: 'Configured OpenAI-compatible model',
      model: (process.env.OPENAI_COMPAT_MODEL ?? 'provider/model-name') as any,
    },
  ],
  config: {
    model: 'default' as any,
  },
});

const summarize = ax(
  'documentText:string "Text to summarize" -> summaryText:string "Concise summary"'
);

const result = await summarize.forward(llm, {
  documentText:
    'OpenAI-compatible APIs can use the OpenAI provider with a custom base URL.',
});

console.log(result.summaryText);
