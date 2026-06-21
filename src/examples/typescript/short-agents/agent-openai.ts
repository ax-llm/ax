// ax-example:start
// title: TypeScript Grounded Support Agent
// group: short-agents
// description: Answers a support question grounded in a handbook that is kept out of the model prompt via contextFields.
// provider: openai
// env: OPENAI_API_KEY, OPENAI_APIKEY
// level: beginner
// order: 10
// story: 20
// ax-example:end
import { AxAIOpenAIModel, AxJSRuntime, agent, ai } from '@ax-llm/ax';

const apiKey = process.env.OPENAI_API_KEY ?? process.env.OPENAI_APIKEY;
if (!apiKey) {
  throw new Error('Set OPENAI_API_KEY or OPENAI_APIKEY to run this example.');
}

const llm = ai({
  name: 'openai',
  apiKey,
  config: {
    model: AxAIOpenAIModel.GPT54Mini,
    temperature: 0,
  },
});

// The handbook can be arbitrarily large. Listing it in `contextFields` keeps it
// in the agent's runtime so it never inflates the model prompt — the agent reads
// it through code, not through tokens. That is the whole point of an Ax agent
// over a plain `ax()` call: the source material stays out of the context window.
const handbook = `
# Acme Cloud — Support Handbook

## Billing
- Invoices are issued on the 1st of each month and are due net-15.
- Plan downgrades take effect at the END of the current billing cycle, not immediately.
- Refunds are issued to the original payment method within 5 business days.

## Access
- Seats can be added by any workspace Owner under Settings -> Members.
- SSO (SAML) is available on Enterprise; SCIM provisioning is Owner-only.

## Incidents
- Status and uptime are published at status.acme.example.
- Sev-1 incidents page the on-call within 5 minutes; updates post every 30 minutes.

## Data
- Exports are available in CSV and JSON from Settings -> Data.
- Deleted workspaces are recoverable for 30 days, then permanently purged.
`.trim();

const assistant = agent(
  'question:string, handbook:string -> answer:string, citations:string[] "Handbook sections the answer relies on"',
  {
    runtime: new AxJSRuntime(),
    // Keep the handbook in the runtime, out of the prompt.
    contextFields: ['handbook'],
    maxTurns: 6,
  }
);

const result = await assistant.forward(llm, {
  question:
    'A customer downgraded their plan today. When does it take effect, and can they get a refund for the current cycle?',
  handbook,
});

console.log(JSON.stringify(result, null, 2));
