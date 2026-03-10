import {
  AxAIGoogleGeminiModel,
  AxJSRuntime,
  AxJSRuntimePermission,
  agent,
  ai,
} from '@ax-llm/ax';

const llm = ai({
  name: 'google-gemini',
  apiKey: process.env.GOOGLE_APIKEY!,
  config: {
    model: AxAIGoogleGeminiModel.Gemini3FlashLite,
  },
});

const supportAgent = agent(
  'chatHistory:string, customerMessage:string -> answer:string, nextAction:string "Handles long support conversations with RLM while keeping only the latest chat tail in the Actor prompt"',
  {
    contextFields: [
      {
        field: 'chatHistory',
        keepInPromptChars: 500,
        reverseTruncate: true,
      },
    ],
    runtime: new AxJSRuntime({
      permissions: [AxJSRuntimePermission.TIMING],
    }),
    maxSteps: 15,
    maxTurns: 8,
    maxSubAgentCalls: 20,
    mode: 'simple',
    actorOptions: {
      thinkingTokenBudget: 'minimal',
    },
    debug: true,
  }
);

const chatHistory = `
[2026-03-09 09:00] Customer: My Team plan invoice looks wrong after adding 12 new seats.
[2026-03-09 09:02] Agent: I can help with that. Did the seat change happen mid-cycle?
[2026-03-09 09:03] Customer: Yes, seats were added on March 5.
[2026-03-09 09:05] Agent: Mid-cycle seat changes usually create a prorated line item.
[2026-03-09 09:07] Customer: I also see a charge labeled "usage adjustment" that I do not understand.
[2026-03-09 09:10] Agent: Was metered usage enabled for any workspace integrations?
[2026-03-09 09:11] Customer: We turned on data exports for two projects last week.
[2026-03-09 09:12] Agent: That could explain the usage adjustment. I will keep checking.
[2026-03-09 09:20] Customer: One more thing: our finance team needs a single sentence explaining the invoice delta.
[2026-03-09 09:24] Agent: Understood. I will summarize seat proration and any usage-based changes.
[2026-03-09 09:27] Customer: Please avoid refund language unless you see an actual duplicate charge.
[2026-03-09 09:30] Agent: Noted.
[2026-03-09 09:41] Customer: We also changed billing from monthly to annual last quarter, if that matters.
[2026-03-09 09:42] Agent: It may affect how proration is displayed.
[2026-03-09 09:50] Customer: Finance mainly wants the most recent explanation and next step.
[2026-03-09 09:54] Agent: I will focus on the latest invoice delta and the exact follow-up needed.
`.trim();

const result = await supportAgent.forward(llm, {
  chatHistory,
  customerMessage:
    'Reply to the customer. Explain the most likely reason for the invoice delta in plain English and state the next support action.',
});

console.log('Answer:', result.answer);
console.log('Next action:', result.nextAction);
