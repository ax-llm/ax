/**
 * RLM Shared Fields — Automatic field propagation to subagents
 *
 * Demonstrates the `sharedFields` feature which allows a parent agent to
 * declare input fields that are automatically injected into subagent calls,
 * bypassing the parent's LLM entirely.
 *
 * In this example a customer-support agent receives a long knowledge base
 * (context field) and a userId (shared field). Two child agents — a policy
 * lookup agent and a billing agent — each receive the knowledge base as a
 * context field and the userId directly, without the parent Actor having to
 * pass them explicitly in generated code.
 *
 * Key concepts:
 *
 *   fields.shared     — input fields forwarded to every subagent call
 *   contextFields     — fields kept out of the LLM prompt (loaded into runtime)
 *   fields.excluded   — lets a subagent opt out of receiving specific fields
 *
 * When a shared field is also a context field in the parent, it is
 * automatically added to each child's contextFields so the child's RLM
 * handles it the same way (runtime variable, not LLM prompt).
 */

import {
  AxAIGoogleGeminiModel,
  AxJSRuntime,
  AxJSRuntimePermission,
  agent,
  ai,
} from '@ax-llm/ax';

// ---------------------------------------------------------------------------
// LLM
// ---------------------------------------------------------------------------

const llm = ai({
  name: 'google-gemini',
  apiKey: process.env.GOOGLE_APIKEY!,
  config: {
    model: AxAIGoogleGeminiModel.Gemini3Flash,
  },
});

// ---------------------------------------------------------------------------
// Shared runtime
// ---------------------------------------------------------------------------

const runtime = new AxJSRuntime({
  permissions: [AxJSRuntimePermission.TIMING],
});

// ---------------------------------------------------------------------------
// Child agents
// ---------------------------------------------------------------------------

/**
 * Policy lookup agent — answers policy questions.
 * It will automatically receive `knowledgeBase` (as a context field)
 * and `userId` (as a regular input) from the parent's shared fields.
 */
const policyAgent = agent(
  'question:string -> answer:string "Looks up company policies and returns a concise answer"',
  {
    agentIdentity: {
      name: 'Policy Lookup',
      description:
        'Searches the company knowledge base for policy-related answers',
    },
    contextFields: [],
    runtime,
  }
);

/**
 * Billing agent — handles billing inquiries.
 * It will automatically receive `knowledgeBase` (as a context field)
 * and `userId` from shared fields.
 */
const billingAgent = agent(
  'question:string -> answer:string "Resolves billing and account questions"',
  {
    agentIdentity: {
      name: 'Billing Helper',
      description:
        'Answers billing, payment, and account-related questions using account data',
    },
    contextFields: [],
    runtime,
  }
);

/**
 * Sentiment agent — classifies the tone of the customer message.
 * It opts OUT of receiving the knowledgeBase and userId since it only
 * needs the raw message text (provided by the Actor via its question field).
 */
const sentimentAgent = agent(
  'question:string -> sentiment:string "positive, negative, or neutral"',
  {
    agentIdentity: {
      name: 'Sentiment Classifier',
      description: 'Classifies the sentiment of a customer message',
    },
    // This agent does not need the knowledge base or userId
    fields: { excluded: ['knowledgeBase', 'userId'] },
    contextFields: [],
    runtime,
  }
);

// ---------------------------------------------------------------------------
// Parent agent — orchestrates the child agents
// ---------------------------------------------------------------------------

/**
 * The parent declares:
 *   - `knowledgeBase` as both a contextField AND a sharedField:
 *       → kept out of the parent's LLM prompt (context field)
 *       → automatically injected into child agent calls (shared field)
 *       → auto-added to each child's contextFields
 *   - `userId` as a sharedField only:
 *       → excluded from the parent's Actor/Responder LLM prompts
 *       → automatically injected into child agent calls
 *
 * The Actor only sees `query` as its input. When it calls
 * `agents.policyLookup({ question: "..." })`, the runtime wrapper
 * automatically merges in `{ knowledgeBase, userId }`.
 */
const supportAgent = agent(
  'query:string, knowledgeBase:string, userId:string -> answer:string',
  {
    agentIdentity: {
      name: 'Customer Support',
      description:
        'Routes customer queries to the right specialist agent and synthesizes a final answer',
    },
    agents: { local: [policyAgent, billingAgent, sentimentAgent] },
    contextFields: ['knowledgeBase'],
    fields: { shared: ['knowledgeBase', 'userId'] },
    runtime,
    debug: true,
  }
);

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

const knowledgeBase = `
=== COMPANY POLICIES ===

REFUND POLICY:
- Full refund within 30 days of purchase for unused items.
- Partial refund (50%) for items returned between 31-60 days.
- No refunds after 60 days.
- Digital products are non-refundable after download.

SHIPPING POLICY:
- Standard shipping: 5-7 business days, free for orders over $50.
- Express shipping: 2-3 business days, $12.99 flat rate.
- International shipping: 10-15 business days, varies by destination.

LOYALTY PROGRAM:
- Bronze tier: 0-499 points — 5% discount on all orders.
- Silver tier: 500-1499 points — 10% discount + free standard shipping.
- Gold tier: 1500+ points — 15% discount + free express shipping + early access to sales.
- Points earned: $1 spent = 1 point.

=== ACCOUNT DATA (userId: cust-42) ===

Name: Alice Johnson
Tier: Silver (720 points)
Recent Orders:
  - Order #A100: Widget Pro, purchased 12 days ago, $89.99, delivered
  - Order #A101: Smart Lamp, purchased 45 days ago, $34.50, delivered
  - Order #A102: USB-C Hub, purchased 3 days ago, $24.99, shipped
Payment Method: Visa ending in 4242
`.trim();

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

const result = await supportAgent.forward(llm, {
  query:
    'I want to return the Smart Lamp from order #A101. Am I eligible for a full refund? ' +
    'Also, how many more points do I need to reach Gold tier?',
  knowledgeBase,
  userId: 'cust-42',
});

console.log('\n=== Support Answer ===');
console.log(result.answer);
