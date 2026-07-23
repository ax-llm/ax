// ax-example:start
// title: Centralized Usage Observer
// group: generation
// description: Attributes every completed model call to a tenant, user, and request from one global observer.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: intermediate
// order: 45
// ax-example:end
import { AxAIOpenAIModel, type AxUsageEvent, ai, axGlobals } from '@ax-llm/ax';

const apiKey = process.env.OPENAI_API_KEY ?? process.env.OPENAI_APIKEY;
if (!apiKey) {
  throw new Error('Set OPENAI_API_KEY or OPENAI_APIKEY to run this example.');
}

const events: Readonly<AxUsageEvent>[] = [];
axGlobals.onUsage = (event) => {
  // In production, enqueue this synchronously and persist it out of band.
  events.push(event);
};

const llm = ai({
  name: 'openai',
  apiKey,
  config: { model: AxAIOpenAIModel.GPT54Mini, temperature: 0 },
  options: {
    usageContext: {
      tenantId: 'tenant-42',
      feature: 'support-chat',
      attributes: { environment: 'example' },
    },
  },
});

try {
  await llm.chat(
    {
      chatPrompt: [{ role: 'user', content: 'Reply with one short greeting.' }],
    },
    {
      usageContext: {
        userId: 'user-7',
        requestId: crypto.randomUUID(),
      },
    }
  );
  console.log(JSON.stringify(events, null, 2));
} finally {
  axGlobals.onUsage = undefined;
}
