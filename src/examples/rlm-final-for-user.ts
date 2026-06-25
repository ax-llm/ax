import {
  AxAIGoogleGeminiModel,
  AxJSRuntime,
  agent,
  ai,
  f,
  fn,
} from '@ax-llm/ax';

const llm = ai({
  name: 'google-gemini',
  apiKey: process.env.GOOGLE_APIKEY!,
  config: {
    model: AxAIGoogleGeminiModel.Gemini35Flash,
  },
});

const attachmentTools = [
  fn('count')
    .description('Count attachment manifest entries')
    .namespace('attachments')
    .arg('manifest', f.json('Attachment manifest array'))
    .returns(f.number('Attachment count'))
    .handler(async ({ manifest }) =>
      Array.isArray(manifest) ? manifest.length : 0
    )
    .build(),
];

// Case A pipeline (contextFields + tools). The explorer's
// `final(task, evidence)` payload feeds the executor as
// `inputs.distilledTask` / `inputs.distilledContext`. When no tool call is
// needed (e.g. a simple greeting with no attachments), the executor
// short-circuits by calling `final(...)` directly with the distilled
// context.
const assistant = agent(
  'userRequest:string, attachmentManifest?:json -> answer:string "Responds to short user requests, using attachment tools only when attachments exist"',
  {
    contextFields: ['userRequest', 'attachmentManifest'],
    runtime: new AxJSRuntime(),
    functions: attachmentTools,
    maxTurns: 6,
    contextOptions: {
      description: [
        'If userRequest is a simple greeting and attachmentManifest is empty, distill that fact and call final("answer the greeting", { userRequest: inputs.userRequest, attachmentCount: 0 }).',
      ].join('\n'),
    },
    executorOptions: {
      description: [
        'Start from inputs.distilledTask and inputs.distilledContext. Do not re-probe runtime-only fields unless a specific missing fact blocks completion.',
      ].join('\n'),
    },
    debug: true,
  }
);

const result = await assistant.forward(llm, {
  userRequest: 'hey',
  attachmentManifest: [],
});

console.log('Answer:', result.answer);
